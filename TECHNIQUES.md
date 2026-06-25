# Hnaya DZ Browser — Techniques & Configurations Critiques

> **But de ce document** : expliquer pourquoi certaines configurations existent et ne doivent pas être modifiées, pour éviter de casser des fonctionnalités qui ont nécessité plusieurs itérations de débogage.

---

## 1. Architecture IPC — `public/preload.js`

### Ce qui est en place

```js
const ALLOWED_INVOKE = ["get-video-info", "choose-download-folder", "check-downloadable", "hide-active-view-sync"];
const ALLOWED_SEND   = ["navigate", "go-back", "go-forward", "download-video", "cancel-download", ...];
```

### Pourquoi

`contextBridge` + `contextIsolation: true` empêche le code des pages web d'accéder directement à Node.js. La whitelist `ALLOWED_INVOKE` / `ALLOWED_SEND` ajoute une deuxième couche : même si une page malveillante accède à `window.electronAPI`, elle ne peut envoyer que des commandes autorisées.

### ⚠️ Ne pas faire

- **Ne pas supprimer la whitelist** — sans elle, n'importe quel site ouvert dans le navigateur peut envoyer des commandes arbitraires au processus principal Electron.
- **Ne pas ajouter `nodeIntegration: true`** — cela donnerait aux pages web un accès complet au système de fichiers.
- **Si vous ajoutez un nouveau canal IPC**, l'ajouter aussi dans `ALLOWED_SEND` ou `ALLOWED_INVOKE` selon le type, sinon il sera silencieusement ignoré avec un `console.warn`.

### Signatures des handlers `receive` dans `tabcontext.tsx`

```ts
// ✅ CORRECT — preload.js retire déjà l'event avant de passer les args
const updateTitle = ({ id, title }: { id: number; title: string }) => { ... };

// ❌ INCORRECT — event est undefined, provoque "Cannot destructure property 'id'"
const updateTitle = (event: any, { id, title }) => { ... };
```

`preload.js` fait `ipcRenderer.on(channel, (event, ...args) => func(...args))` — il retire l'`event` Electron et ne passe que les données. Les handlers dans `tabcontext.tsx` ne doivent donc **pas** avoir de paramètre `event` en premier.

---

## 2. `sandbox: false` sur la fenêtre principale — `public/electron.js`

### Ce qui est en place

```js
mainWindow = new BrowserWindow({
  webPreferences: {
    preload: join(__dirname, "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    // sandbox absent intentionnellement
  },
});
```

### Pourquoi

`ipcRenderer.invoke()` (utilisé pour `get-video-info`, `choose-download-folder`, `hide-active-view-sync`) ne fonctionne pas si `sandbox: true` est activé sur la fenêtre principale. La sécurité est maintenue par `contextIsolation: true` + `contextBridge`.

### ⚠️ Ne pas faire

- **Ne pas ajouter `sandbox: true`** à la fenêtre principale — cela casse tous les appels `invoke` du panneau de téléchargement.
- Les `WebContentsView` (onglets de navigation) ont elles `sandbox: true` — c'est voulu et différent.

---

## 3. WebContentsView sandbox — communication avec le main process

### Le problème

Les `WebContentsView` utilisées pour les onglets de navigation tournent avec `sandbox: true`. Cela signifie que `window.electronAPI` n'y est **pas disponible** — le preload n'y est pas attaché. Un bouton injecté dans une page WordPress ne peut pas appeler `electronAPI.send(...)` directement.

### La solution : `document.title` comme canal de communication

```js
// Dans le bouton injecté (côté page web, sandbox)
btn.addEventListener('click', () => {
  document.title = 'hnaya-dl::https://www.youtube.com/watch?v=VIDEO_ID';
});
```

```js
// Dans electron.js (côté main process)
view.webContents.on("page-title-updated", (event, title) => {
  if (title.startsWith("hnaya-dl::")) {
    const ytUrl = title.replace("hnaya-dl::", "");
    mainWindow.contentView.removeChildView(view);
    setTimeout(() => {
      mainWindow.webContents.send("open-download-panel", ytUrl);
    }, 150);
    return; // ← important : ne pas envoyer ce titre aux onglets
  }
  mainWindow.webContents.send("update-tab-title", { id, title });
});
```

### Pourquoi cette approche

- `will-navigate` et `did-navigate` ne se déclenchent **pas** quand une page sandbox modifie `window.location.href` avec un schéma custom (`hnaya-dl://`).
- `postMessage` + `ipc-message` ne fonctionnent pas non plus en sandbox Electron.
- `page-title-updated` est le seul événement fiable émis par une WebContentsView sandbox vers le main process sans nécessiter de preload.
- L'ID vidéo est lu directement depuis `data-video-id` via `executeJavaScript` côté Electron, avant même d'injecter le bouton — ce qui évite tout parsing d'URL dans la sandbox.

### ⚠️ Ne pas faire

- **Ne pas supprimer le `return`** après le bloc `hnaya-dl::` dans `page-title-updated` — sinon le titre `hnaya-dl::URL` serait envoyé à `tabcontext.tsx` et affiché dans l'onglet.
- **Ne pas remplacer par `will-navigate`** — testé et non fonctionnel en sandbox avec `location.href`.
- **Ne pas remplacer par `postMessage`** — testé et non fonctionnel en sandbox Electron.

---

## 4. Masquage de la WebContentsView avant le panneau de téléchargement

### Le problème

La `WebContentsView` active (l'onglet de navigation) est rendue par-dessus le contenu React. Si on affiche `DownloadPanel` sans cacher la vue, le panneau apparaît derrière un bandeau flou transparent — la WebContentsView reste visible par-dessus.

### La solution en deux variantes

**Depuis l'urlbar (fenêtre principale)** — utiliser `invoke` synchrone :
```ts
// urlbar.tsx — handleDownloadClick
const handleDownloadClick = useCallback(async () => {
  await (window as any)?.electronAPI?.invoke("hide-active-view-sync");
  setDownloadUrl(url);
  setShowDownload(true); // s'affiche APRÈS confirmation Electron
}, [url]);
```

```js
// electron.js
ipcMain.handle("hide-active-view-sync", async () => {
  if (activeTabId && browserViews.has(activeTabId) && mainWindow) {
    mainWindow.contentView.removeChildView(browserViews.get(activeTabId));
  }
  return true;
});
```

**Depuis HnayaTube Watch (WebContentsView sandbox)** — utiliser `setTimeout(150ms)` :
```js
// electron.js — dans page-title-updated
mainWindow.contentView.removeChildView(view);
setTimeout(() => {
  mainWindow.webContents.send("open-download-panel", ytUrl);
}, 150);
```

### Pourquoi deux approches différentes

- Depuis l'urlbar : on peut utiliser `invoke` (Promise) car c'est la fenêtre principale avec preload.
- Depuis HnayaTube : on est dans le main process, le `removeChildView` est synchrone, le `setTimeout(150ms)` laisse le temps au renderer React de recevoir le message avant de monter le panneau.

### ⚠️ Ne pas faire

- **Ne pas supprimer `hide-active-view-sync`** et revenir à `send("hide-active-view") + setTimeout` dans urlbar — le timing est fragile selon la vitesse de la machine.
- **Ne pas afficher `DownloadPanel` sans cacher la vue** — le panneau sera invisible, recouvert par la WebContentsView.
- **Ne pas oublier `show-active-view`** à la fermeture du panneau — sinon l'onglet de navigation reste invisible après fermeture.

---

## 5. Format yt-dlp — `public/electron.js`

### Ce qui est en place

```js
const formatArgs = quality === "hq"
  ? ["--format", "bestvideo+bestaudio/best", "--merge-output-format", "mp4"]
  : ["--format", "best[ext=mp4][vcodec!*=av01]/bestvideo[ext=mp4][height<=720][vcodec!*=av01]+bestaudio[ext=m4a]/best[height<=720]", "--no-part"];
```

### Pourquoi

Sans `ffmpeg` installé (cas par défaut sur Windows), yt-dlp ne peut pas fusionner vidéo et audio séparément. Le mode **Rapide** (`fast`) force un format MP4 préemballé qui contient déjà les deux — un seul fichier, pas de dépendance ffmpeg.

- `vcodec!*=av01` : exclut le codec AV1 qui pose des problèmes de compatibilité sur certains lecteurs Windows.
- `--no-part` : évite les fichiers `.part` temporaires qui peuvent rester en cas d'interruption.
- Le mode **Haute qualité** (`hq`) utilise `bestvideo+bestaudio` et **nécessite ffmpeg** pour fusionner.

### ⚠️ Ne pas faire

- **Ne pas remplacer le mode Rapide par `bestvideo+bestaudio`** sans ffmpeg — cela produit deux fichiers séparés (un `.mp4` sans son, un `.m4a` sans image).
- **Ne pas supprimer `--no-part`** du mode Rapide — les fichiers `.part` orphelins encombrent le dossier de destination.

---

## 6. Titres des onglets — `context/tabcontext.tsx` + `public/electron.js`

### Le problème

Les titres restaient bloqués sur `hnaya.dz` au lieu d'afficher le vrai titre de la page.

### La solution

**Côté `electron.js`** — `updateTabInfo` envoie le titre sans filtre superflu :
```js
const updateTabInfo = () => {
  const currentUrl = view.webContents.getURL();
  const title = view.webContents.getTitle();
  mainWindow.webContents.send("update-url", id, currentUrl);
  if (title && title !== currentUrl) {
    mainWindow.webContents.send("update-tab-title", { id, title });
  }
};
```

**Côté `tabcontext.tsx`** — `updateUrl` met toujours le domaine comme titre temporaire :
```ts
const updateUrl = (tabId: number, newUrl: string) => {
  setTabs(prevTabs => prevTabs.map(tab => {
    if (tab.id !== tabId) return tab;
    if (tab.isHome) return { ...tab, url: newUrl }; // home garde son titre
    try {
      const domain = new URL(newUrl).hostname.replace('www.', '');
      return { ...tab, url: newUrl, title: domain }; // titre temporaire
    } catch {
      return { ...tab, url: newUrl };
    }
  }));
};
```

Le flux est : navigation → `updateUrl` met le domaine → `page-title-updated` met le vrai titre.

### ⚠️ Ne pas faire

- **Ne pas remettre la condition `title !== domain`** dans `updateTabInfo` — elle filtrait les vrais titres et bloquait la mise à jour.
- **Ne pas remettre `event` en premier paramètre** dans les handlers `updateTitle`, `updateUrl`, `updateFavicon` — le preload retire déjà l'event.

---

## 7. Source unique — `shared/supportedHosts.ts` + `shared/supportedHosts.js`

### Ce qui est en place

```
shared/
  supportedHosts.ts  ← importé par urlbar.tsx (Next.js/TypeScript)
  supportedHosts.js  ← importé par electron.js (Node ESM)
```

### Pourquoi deux fichiers

- Next.js compile le TypeScript — `urlbar.tsx` peut importer `.ts` via `@/shared/supportedHosts`.
- Electron tourne sous Node ESM natif — Node ne compile pas le `.ts`, il faut une version `.js` explicite.
- Les deux fichiers contiennent **exactement le même code** — seul le `.ts` a les types TypeScript en plus.

### ⚠️ Ne pas faire

- **Ne pas modifier la liste dans un seul fichier** — les deux doivent rester synchronisés.
- **Ne pas déplacer dans `components/`** — ce ne sont pas des composants React, mais de la logique pure partagée.
- **Ne pas importer `.ts` depuis `electron.js`** — Node ESM refusera avec `ERR_MODULE_NOT_FOUND`.

---

## 8. User-Agent Chrome — `public/electron.js`

### Ce qui est en place

```js
const chromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
mainWindow.webContents.setUserAgent(chromeUA);
```

### Pourquoi

Electron expose par défaut un User-Agent qui contient `"Electron"`. Certains sites WordPress (dont `hnaya.dz`) détectent cet UA et affichent des pages dégradées ou refusent de charger certains widgets. Forcer un UA Chrome standard résout ces incompatibilités.

### ⚠️ Ne pas faire

- **Ne pas supprimer ce `setUserAgent`** — des widgets WordPress et des iframes YouTube peuvent cesser de fonctionner.

---

## 9. `openDevTools` conditionné — `public/electron.js`

### Ce qui est en place

```js
if (!app.isPackaged) {
  mainWindow.webContents.openDevTools();
}
```

### Pourquoi

Sans cette condition, les DevTools s'ouvrent automatiquement chez les utilisateurs finaux de la version packagée `.exe` — expérience utilisateur dégradée et informations de débogage exposées.

### ⚠️ Ne pas faire

- **Ne pas supprimer le `if (!app.isPackaged)`** pour "déboguer en prod" — utiliser plutôt un raccourci clavier ou un menu caché si nécessaire.

---

## Résumé — Tableau de référence rapide

| Configuration | Fichier | Risque si supprimée |
|---|---|---|
| Whitelist IPC `ALLOWED_SEND/INVOKE` | `preload.js` | Faille sécurité — sites malveillants peuvent contrôler Electron |
| Signatures sans `event` dans les handlers | `tabcontext.tsx` | Crash `Cannot destructure property 'id'` |
| `sandbox` absent sur fenêtre principale | `electron.js` | `invoke()` casse — panneau téléchargement inutilisable |
| `page-title-updated` + préfixe `hnaya-dl::` | `electron.js` | Bouton HnayaTube Watch ne déclenche plus le panneau |
| `removeChildView` avant `open-download-panel` | `electron.js` | Panneau invisible derrière la WebContentsView |
| `hide-active-view-sync` (invoke) dans urlbar | `urlbar.tsx` + `electron.js` | Bandeau flou transparent sur le panneau |
| Format yt-dlp `best[ext=mp4]` + `--no-part` | `electron.js` | Deux fichiers séparés sans son ou image |
| `updateUrl` met toujours le domaine | `tabcontext.tsx` | Titres d'onglets bloqués sur `hnaya.dz` |
| Deux fichiers `shared/supportedHosts.*` | `shared/` | `ERR_MODULE_NOT_FOUND` au lancement d'Electron |
| `setUserAgent` Chrome | `electron.js` | Widgets WordPress et iframes YouTube dégradés |
| `if (!app.isPackaged)` sur DevTools | `electron.js` | DevTools ouverts chez les utilisateurs finaux |
