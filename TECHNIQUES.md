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

---

## 10. Téléchargement automatique multi-OS de yt-dlp — `public/electron.js`

### Le problème

Le binaire `yt-dlp.exe` était commité dans `public/bin/` et hardcodé pour Windows
(`process.resourcesPath, "bin", "yt-dlp.exe"`). Cette approche ne fonctionne que sur
Windows. Sur macOS ou Linux, `existsSync(ytDlpPath)` retourne systématiquement faux
et le téléchargement de vidéos échoue silencieusement — aucun message d'erreur clair
n'indique à l'utilisateur que c'est un problème de plateforme.

### Ce qui est en place

```js
function getYtDlpBinaryName() {
  if (process.platform === "win32") return "yt-dlp.exe";
  return "yt-dlp"; // macOS et Linux — pas d'extension
}

function getYtDlpDownloadUrl() {
  const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
  if (process.platform === "win32") return base + "yt-dlp.exe";
  if (process.platform === "darwin") return base + "yt-dlp_macos";
  return base + "yt-dlp"; // Linux
}

async function ensureYtDlp() {
  if (existsSync(ytDlpPath)) return true;
  // ... télécharge avec gestion des redirections GitHub (jusqu'à 5)
  // ... pose chmod 755 sur macOS/Linux (requis pour exécuter le binaire)
}
```

Appelé au démarrage dans `app.on("ready", ...)`, en arrière-plan, sans bloquer le
lancement de la fenêtre principale.

### Pourquoi cette approche

- **Auto-téléchargement plutôt que binaires multiples committés** : embarquer 3
  binaires (Windows/Mac/Linux) dans le repo Git alourdit chaque clone et chaque
  build, même pour les utilisateurs qui n'utiliseront qu'un seul OS.
- **`.gitignore` sur `public/bin/`** : le dossier contiendra un binaire différent
  selon l'OS de la machine de développement — il ne doit jamais être commité, sinon
  un développeur Mac écraserait le `.exe` Windows d'un collègue au prochain commit.
- **Toujours la dernière version** : contrairement à un binaire figé dans le repo,
  chaque nouvelle installation télécharge la version yt-dlp à jour — résout
  automatiquement les avertissements de version obsolète et les ruptures de
  compatibilité avec les sites cibles (YouTube change son API régulièrement).
- **`chmod 755` obligatoire hors Windows** : sans ce bit d'exécution, macOS et
  Linux refusent de lancer le binaire téléchargé (erreur "Permission denied").

### ⚠️ Ne pas faire

- **Ne pas committer `public/bin/yt-dlp*`** dans Git — le `.gitignore` l'exclut
  intentionnellement. Si un binaire s'y retrouve par erreur, le supprimer avec
  `git rm --cached public/bin/yt-dlp.exe`.
- **Ne pas retirer le `chmod 755`** sur la branche macOS/Linux du téléchargement —
  sans lui, le binaire téléchargé est inutilisable sur ces OS même s'il existe.
- **Ne pas supprimer la limite de 5 redirections** dans `download()` — GitHub
  redirige systématiquement `releases/latest/download/...` vers une URL S3 signée ;
  sans limite, une boucle de redirection infinie bloquerait l'application.
- **Ne pas rendre `ensureYtDlp()` bloquant** pour `createWindow()` — il doit
  s'exécuter en arrière-plan pour ne pas retarder l'affichage de la fenêtre au
  premier lancement, le téléchargement peut prendre plusieurs secondes selon la
  connexion.
- **Ne pas oublier `extraResources` retiré de `package.json`** — si réintroduit
  pour Windows uniquement, `electron-builder` échouera silencieusement à inclure
  un fichier qui n'existe plus dans `public/bin/` au moment du build (puisqu'il
  n'est plus committé).

### Canal IPC ajouté

| Canal | Direction | Description |
|---|---|---|
| `ytdlp-setup-status` | main → renderer | `{ status: "downloading" \| "ready" \| "error" }` — diffusé pendant le premier lancement si yt-dlp est absent |

Ce canal utilise `receive()` côté renderer, qui n'a **pas** besoin d'être ajouté à
une whitelist (contrairement à `send`/`invoke`) — voir section 1 de ce document.

### Ligne à ajouter au tableau récapitulatif final de TECHNIQUES.md

| Configuration | Fichier | Risque si supprimée |
|---|---|---|
| `ensureYtDlp()` multi-OS + `.gitignore public/bin/` | `electron.js` + `.gitignore` + `package.json` | yt-dlp inutilisable sur Mac/Linux, ou binaires committés écrasés entre développeurs |

---

## 11. Messagerie locale — configurations critiques (v0.3.0)

> Détails complets et historique des échecs : `RETOUR_EXPERIENCE.md` §8
> et `chat-module/README.md`. Résumé des invariants à ne pas casser :

| Configuration | Fichier(s) | Risque si modifiée |
|---|---|---|
| `stop()` idempotents (drapeau + try/catch) sur les sockets de découverte | `chat-module/src/discovery.js` | Double fermeture → découverte définitivement morte jusqu'au redémarrage de l'app |
| Battement de cœur ping/pong 10 s des deux côtés | `chat-module/src/server.js` + `client.js` | Connexions mortes jamais détectées (wifi coupé, veille) — messages envoyés dans le vide sans erreur |
| `ws.close(1001)` de chaque client dans `stop()` de l'hôte | `chat-module/src/server.js` | `wss.close()` seul laisse les participants « connectés » à un salon fantôme |
| Verdict pare-feu écrit PAR le script élevé + drapeau `chat-network-setup.json` | `electron.js` | Faux « autorisation non accordée » sur les postes Kaspersky (lecture pare-feu refusée en session normale) |
| Création de règle pare-feu conditionnelle (pas remove+create) | `electron.js` | Règles en double sous Kaspersky (suppression bloquée, création autorisée) |
| Script `.ps1` élevé en ASCII pur | `electron.js` | PowerShell 5.1 lit les .ps1 sans BOM en ANSI — accents corrompus, chemin d'exe invalide |
| Fenêtre de découverte 30 s + `chat-warmup` à l'ouverture du panneau | `ChatPanel.tsx` + `electron.js` | Premier essai raté systématiquement sur machine modeste (fork lent) |
| Store global `context/chatstore.ts` chargé avec l'app (pas dans le panneau paresseux) | `chatstore.ts` + `navbar.tsx` + `urlbar.tsx` | Icône d'état et badge non-lus faux quand le panneau est fermé |
| Point de montage unique `ChatDockMount` piloté par `store.panelOpen` | `ChatDockMount.tsx` + `app/layout.tsx` | Deux docks simultanés + largeurs de vue incohérentes (chaque bouton montait son panneau) |
| `chat-dock` rétrécit la vue (jamais la masquer pour la messagerie) | `electron.js` (`updateBrowserViewSize`) | Le dock recouvrirait la page ou serait invisible — la mécanique est celle de `tabSideWidth` |
| `set-app-language` + `NATIVE_LABELS`/`nativeT()` | `electron.js` + `langcontext.tsx` | Menu clic-droit et dialogues natifs figés en français en interface arabe |
| Dépendance `ws` isolée dans `chat-module/node_modules` (fork, jamais d'import direct) | `chat-module/` + `electron.js` | Alourdit le navigateur principal ; risque sur `yarn dist` |
| `chat-module/node_modules/` et `chat-module/data/` dans `.gitignore` | `.gitignore` | `/node_modules` racine ne couvre PAS les sous-dossiers — dépôt pollué |

---

## 12. Architecture de la recherche (page d'accueil) — `app/page.tsx` + `public/electron.js`

### Ce qui est en place

La page d'accueil propose **deux moteurs distincts**, sélectionnés par les onglets "Algérie" / "Monde" :

**Recherche "Algérie"** — Google Programmable Search Engine (CSE), moteur configuré (`cx=d6cbf11613afc4d13`) chargé via :
```js
script.src = "https://cse.google.com/cse.js?cx=d6cbf11613afc4d13";
```
Les résultats s'affichent **dans la page** (conteneur `.gcse-search`, résultats inline — pas de nouvel onglet). Un `MutationObserver` intercepte chaque clic sur un résultat (`.gsc-results a.gs-title`, `.gsc-webResult a`) pour l'ouvrir dans un nouvel onglet Hnaya (`addTab(href)`) plutôt que de naviguer dans l'iframe de résultats.

**Recherche "Monde"** — Startpage, ouverte dans un nouvel onglet :
```js
addTab(`https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`);
```
Startpage agit comme proxy vers l'index Google : la requête part anonymisée (Startpage ne transmet pas l'IP de l'utilisateur à Google), sans lien avec un compte Google.

### Couche confidentialité appliquée à toute navigation (donc aussi aux résultats de recherche)

Configurée au niveau `session` dans `electron.js`, donc active pour **tous** les onglets, qu'ils viennent d'une recherche Algérie/Monde ou d'une navigation directe :

| Mécanisme | Effet |
|---|---|
| `app.configureHostResolver` (DNS-over-HTTPS, Cloudflare + Quad9) | Le FAI ne voit pas en clair les domaines résolus |
| `setWebRTCIPHandlingPolicy("default_public_interface_only")` | Masque les IP locales dans les candidats ICE WebRTC |
| En-tête `DNT: 1` sur chaque requête | Signal de refus de suivi envoyé aux sites visités |
| `TRACKER_BLOCKLIST` + `PRIVACY_ALLOWLIST` (`onBeforeRequest`) | Bloque les domaines d'analytics connus (Google Analytics, Doubleclick, Hotjar, etc.), sauf domaines explicitement autorisés (Zoom, Teams, Meet…) — **désactivable par l'utilisateur** (voir « Interrupteurs utilisateur ») |
| Nettoyage des paramètres `utm_*`, `fbclid`, `gclid`, `msclkid` | Supprime les identifiants de tracking de clic dans l'URL de destination, sur la navigation principale uniquement — **désactivable par l'utilisateur** |
| Switches `disable-background-networking`, `disable-domain-reliability`, `disable-component-update`, `no-pings` | Coupe la télémétrie de fond de Chromium |

### ⚠️ Point de vigilance — ce que cette couche NE change PAS

- **La recherche "Algérie" interroge l'infrastructure de Google** (Programmable Search Engine) — la requête tapée par l'utilisateur est envoyée aux serveurs Google, même si l'affichage reste dans Hnaya DZ. Le blocage de traqueurs et le DNT s'appliquent aux pages de résultats/destination, pas à la requête de recherche elle-même envoyée au CSE.
- **La recherche "Monde" dépend de Startpage**, société privée basée aux Pays-Bas — la couche de confidentialité de Hnaya DZ (DoH, WebRTC, blocklist) s'ajoute à la protection déjà offerte par Startpage (anonymisation des requêtes vers Google), elle ne la remplace pas.
- Ne pas présenter la recherche comme "100% locale" ou "sans dépendance étrangère" dans une communication externe — ce serait factuellement inexact tant que Google CSE et Startpage restent les moteurs utilisés.

### ⚠️ Ne pas faire

- **Ne pas retirer l'allowlist** avant d'étendre `TRACKER_BLOCKLIST` — un domaine ajouté par erreur (ex. un sous-domaine `*.googleapis.com` utilisé par Teams) casserait des fonctionnalités tierces sans message d'erreur clair pour l'utilisateur.
- **Ne pas bloquer `cse.google.com`** dans une future extension de la blocklist — c'est le moteur de recherche Algérie lui-même, pas un traqueur.
- **Ne pas remplacer `default_public_interface_only` par `disable_non_proxied_udp`** sans revalider la qualité des appels vidéo (Zoom/Teams/Meet web) — ce mode plus strict force un relais TURN et peut dégrader sensiblement la latence.

### Interrupteurs utilisateur — panneau Confidentialité (`components/PrivacyPanel.tsx`)

Sur les 6 mécanismes du tableau, **deux seulement peuvent casser un site
légitime** : le blocage de traqueurs (ex. « Login with Facebook » passe par
`connect.facebook.net` ; GTM charge parfois des bandeaux de consentement ou
des fonctionnalités réelles) et le nettoyage des liens. Ces deux-là sont
donc désactivables par l'utilisateur — bouton bouclier (lucide `Shield`)
dans la navbar et l'urlbar. Les 4 autres (DoH, WebRTC, DNT, anti-bruit
Chromium) sont sans risque fonctionnel : toujours actifs, pas
d'interrupteur. Raison du choix « interrupteur » plutôt qu'« allowlist
extensible » : impossible de prédire tous les sites qui casseront ; un
utilisateur bloqué doit pouvoir se débloquer seul, en un clic, sans mise à
jour de l'application.

Mécanique (pourquoi c'est fait comme ça) :
- **L'état vit dans le main process** (`privacySettings` dans
  `electron.js`), là où tourne le filtre réseau — le renderer n'en garde
  aucune copie d'autorité. Persistance :
  `userData/privacy-settings.json`, chargé dans `app.on("ready")`
  **avant** `createWindow` pour que la toute première requête respecte
  déjà le choix.
- **Le filtre consulte l'objet à chaque requête** (pas de copie au moment
  de l'installation du hook) → un changement s'applique immédiatement,
  sans redémarrage. Vérifié par CDP : requête `google-analytics.com`
  bloquée → interrupteur coupé → la même requête passe → réactivé →
  rebloquée.
- IPC : `privacy-get-settings` (invoke) / `privacy-set-settings` (send) —
  ajoutés aux listes blanches de `preload.js`.
- Défaut : les deux **activés** (positionnement privacy-first). Clés i18n
  `Privacy.*` dans les 3 locales.

**Ne pas faire** : ne pas déplacer l'état d'autorité dans localStorage —
localStorage est indexé par origine (voir §« port fixe ») et le main
process n'y a pas accès au démarrage ; le fichier userData est la seule
source fiable disponible avant la création de la fenêtre.
