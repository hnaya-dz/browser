# Hnaya DZ Browser — Retour d'expérience de développement

> **But de ce document** : tracer l'historique des tentatives échouées, des solutions finales
> retenues, et identifier les configurations à ne jamais modifier pour éviter de réintroduire
> des bugs déjà résolus.

---

## 1. Bouton de téléchargement HnayaTube Watch

### Tentatives échouées

| Tentative | Raison de l'échec |
|---|---|
| `window.location.href = 'hnaya-dl://...'` | Schéma custom bloqué par sandbox Electron — navigation silencieusement annulée |
| `will-navigate` pour intercepter `hnaya-dl://` | Ne se déclenche pas depuis une WebContentsView avec `sandbox: true` |
| `did-navigate` + `view.webContents.goBack()` | Ne se déclenche pas non plus en sandbox pour les schémas customs |
| `postMessage` + `ipc-message` | Non fonctionnel depuis une WebContentsView sandbox sans preload attaché |
| Injection bouton via `URLSearchParams.get('v')` | La page charge son contenu en JS après `did-finish-load` — `?v=` présent dans l'URL mais `data-video-id` absent au moment de l'injection |

### Solution finale retenue ✅

```js
// 1. Lire data-video-id directement depuis Electron (après 2s d'attente)
setTimeout(() => {
  view.webContents.executeJavaScript(`
    document.querySelector('[data-video-id]')?.getAttribute('data-video-id') || null;
  `).then(videoId => {
    const ytUrl = 'https://www.youtube.com/watch?v=' + videoId;

    // 2. Injecter un bouton qui mute document.title
    view.webContents.executeJavaScript(`
      btn.addEventListener('click', () => {
        document.title = 'hnaya-dl::${ytUrl}';
      });
    `);
  });
}, 2000);

// 3. Intercepter via page-title-updated (seul événement fiable depuis le main process en sandbox)
view.webContents.on("page-title-updated", (event, title) => {
  if (title.startsWith("hnaya-dl::")) {
    const ytUrl = title.replace("hnaya-dl::", "");
    mainWindow.contentView.removeChildView(view); // cacher la vue avant le panneau
    setTimeout(() => {
      mainWindow.webContents.send("open-download-panel", ytUrl);
    }, 150);
    return; // ← NE PAS envoyer ce titre à tabcontext
  }
  mainWindow.webContents.send("update-tab-title", { id, title });
});
```

### ⚠️ Ne jamais modifier

- **Le `return` après le bloc `hnaya-dl::`** dans `page-title-updated` — sans lui, le titre
  `hnaya-dl::URL` s'affiche dans l'onglet.
- **Le délai de 2000ms** dans `did-finish-load` — la page HnayaTube charge son contenu
  via JavaScript après le chargement initial. En dessous de 2s, `data-video-id` est absent du DOM.
- **`data-video-id`** comme source de l'ID — c'est un attribut WordPress stable posé par
  le plugin HnayaTube. Ne pas tenter de parser l'URL à la place.
- **`will-navigate` et `did-navigate`** peuvent rester dans le code mais ne servent à rien
  pour les WebContentsViews sandbox — ils ne nuisent pas mais ne doivent pas remplacer
  `page-title-updated`.

---

## 2. Affichage du panneau de téléchargement (DownloadPanel)

### Tentatives échouées

| Tentative | Raison de l'échec |
|---|---|
| `send("hide-active-view") + setTimeout(150ms)` dans urlbar | Timing fragile — sur machines lentes, React monte le panneau avant qu'Electron retire la vue, qui repasse par-dessus |
| Afficher `DownloadPanel` sans cacher la vue | Panneau invisible — recouvert par la WebContentsView |
| `position: fixed` sur le panneau dans `URLBar` (composant enfant) | Un `fixed` dans un `fixed` ne couvre pas toute la fenêtre dans Electron |

### Solution finale retenue ✅

```ts
// urlbar.tsx — invoke synchrone : attend confirmation avant d'afficher
const handleDownloadClick = useCallback(async () => {
  await (window as any)?.electronAPI?.invoke("hide-active-view-sync");
  setDownloadUrl(url);
  setShowDownload(true);
}, [url]);
```

```js
// electron.js — retourne true pour confirmer que la vue est retirée
ipcMain.handle("hide-active-view-sync", async () => {
  if (activeTabId && browserViews.has(activeTabId) && mainWindow) {
    mainWindow.contentView.removeChildView(browserViews.get(activeTabId));
  }
  return true;
});
```

### ⚠️ Ne jamais modifier

- **Ne pas remplacer `invoke` par `send`** pour `hide-active-view-sync` — sans l'`await`,
  React affiche le panneau avant qu'Electron retire la vue.
- **Ne pas supprimer `show-active-view`** à la fermeture du panneau — sinon l'onglet
  de navigation reste invisible indéfiniment.

---

## 3. Titres des onglets

### Tentatives échouées

| Tentative | Raison de l'échec |
|---|---|
| Filtre `title !== domain` dans `updateTabInfo` | Filtrait les vrais titres de page — titres bloqués sur `hnaya.dz` |
| Condition `tab.title === "New Tab" \|\| tab.title === domain` dans `updateUrl` | Trop restrictive — le titre initial étant déjà le domaine, la condition était fausse et bloquait la mise à jour |
| Paramètre `event` en premier dans `updateTitle(event, {id, title})` | `preload.js` retire déjà l'`event` — le handler recevait `{id, title}` comme `event` et `undefined` comme données → crash `Cannot destructure property 'id'` |

### Solution finale retenue ✅

```ts
// tabcontext.tsx — sans event en premier paramètre
const updateTitle = ({ id, title }: { id: number; title: string }) => { ... };
const updateUrl = (tabId: number, newUrl: string) => { ... };
const updateFavicon = ({ id, faviconUrl }: { id: number; faviconUrl: string }) => { ... };
```

```js
// electron.js — sans double filtre
const updateTabInfo = () => {
  const currentUrl = view.webContents.getURL();
  const title = view.webContents.getTitle();
  mainWindow.webContents.send("update-url", id, currentUrl);
  if (title && title !== currentUrl) {
    mainWindow.webContents.send("update-tab-title", { id, title });
  }
};
```

### ⚠️ Ne jamais modifier

- **Ne jamais remettre `event` en premier paramètre** des handlers `receive` dans
  `tabcontext.tsx` — `preload.js` le retire systématiquement.
- **Ne pas remettre le filtre `title !== domain`** dans `updateTabInfo`.

---

## 4. Positionnement de la fenêtre CustomThemePanel

### Tentatives échouées

| Tentative | Raison de l'échec |
|---|---|
| `top: "50%", transform: "translate(-50%, -50%)"` | Ne tient pas compte de la navbar — panneau coupé en haut |
| `top: "55%", marginTop: "20px"` | Insuffisant — toujours coupé |
| `padding: "80px 16px 16px"` sur l'overlay centré | 80px insuffisant — tabbar+navbar font 12vh soit ~130px sur écran 1080p |
| `top: "12vh"` sur l'overlay | Fonctionnel sur certaines résolutions mais pas toutes |
| Deux blocs séparés overlay + panneau avec `position:fixed` chacun | Le clic sur l'overlay ne fermait pas le panneau (event.target !== currentTarget) |

### Solution finale retenue ✅

```tsx
// Un seul overlay flex qui contient le panneau
<div style={{
  position: "fixed",
  inset: 0,                      // couvre tout l'écran
  paddingTop: "14vh",            // tabbar(6vh) + navbar(6vh) + marge(2vh)
  alignItems: "flex-start",      // ancré en haut du padding
  justifyContent: "center",
  display: "flex",
}}
  onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
  <div> {/* panneau sans position:fixed propre */} </div>
</div>
```

### ⚠️ Ne jamais modifier

- **`paddingTop: "14vh"`** — valeur calibrée pour tabbar(6vh) + navbar(6vh) + marge.
  Si la hauteur de tabbar ou navbar change, ajuster cette valeur en conséquence.
- **`alignItems: "flex-start"`** avec `paddingTop` — c'est volontairement différent
  de `alignItems: "center"` qui ignore le padding et centre dans l'écran entier.
- **`e.target === e.currentTarget`** pour la fermeture au clic overlay — sans cette
  condition, cliquer dans le panneau ferme aussi le panneau.

---

## 5. Icônes du bouton ThemeSwitch

### Tentative échouée

| Tentative | Raison de l'échec |
|---|---|
| Icône = thème **suivant** (ex: 🌙 en mode sombre = "aller vers clair") | Contre-intuitif pour l'utilisateur — en mode clair, l'icône ☀️ montrait qu'on était en mode sombre, créant une confusion |

### Solution finale retenue ✅

```ts
// L'icône représente le thème ACTUEL
const icon = currentTheme === "light"  ? "☀️"
           : currentTheme === "sunset" ? "🌅"
           : currentTheme === "custom" ? (customBg ? "🖼️" : "🎨")
           : "🌙"; // dark par défaut
```

### ⚠️ Ne jamais modifier

- **Ne pas inverser** pour montrer le thème suivant — testé et confirmé non intuitif.

---

## 6. Format yt-dlp

### Tentatives échouées

| Tentative | Raison de l'échec |
|---|---|
| `bestvideo[ext=mp4]+bestaudio[ext=m4a]` sans ffmpeg | Produit deux fichiers séparés — un `.mp4` sans son, un `.m4a` sans image |
| `--merge-output-format mp4` sans ffmpeg installé | yt-dlp ignore la fusion et télécharge quand même séparément |

### Solution finale retenue ✅

```js
const formatArgs = quality === "hq"
  ? ["--format", "bestvideo+bestaudio/best", "--merge-output-format", "mp4"]  // nécessite ffmpeg
  : ["--format", "best[ext=mp4][vcodec!*=av01]/bestvideo[ext=mp4][height<=720][vcodec!*=av01]+bestaudio[ext=m4a]/best[height<=720]", "--no-part"];
```

### ⚠️ Ne jamais modifier

- **`vcodec!*=av01`** — le codec AV1 est incompatible avec certains lecteurs Windows.
- **`--no-part`** — évite les fichiers `.part` orphelins si le téléchargement est interrompu.
- **Le mode Rapide ne nécessite pas ffmpeg** — ne pas le remplacer par `bestvideo+bestaudio`.

---

## 7. Formats d'images pour le thème personnalisé

### Tentatives échouées

| Tentative | Raison de l'échec |
|---|---|
| Accepter GIF | Les GIF animés dépassent quasi systématiquement 5Mo en base64 — `localStorage` (limite ~5Mo) échoue silencieusement |
| `file.type.startsWith("image/")` | Sur Windows, certains fichiers JPEG ont un `type` vide ou incorrect — la validation rejetait des images valides |
| Accepter BMP/TIFF | Trop lourds non compressés — base64 × 1.33 dépasse systématiquement `localStorage` |

### Solution finale retenue ✅

```ts
const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
// + vérification que le dataUrl commence par "data:image/"
```

### ⚠️ Ne jamais modifier

- **Ne pas réactiver GIF** — testé et échoue sur `localStorage`.
- **Ne pas utiliser `startsWith("image/")`** — trop permissif sur Windows.
- Si de grands formats sont nécessaires à l'avenir, migrer vers **IndexedDB**
  (pas de limite de taille) plutôt que `localStorage`.

---

## 8. Messagerie locale (chat-module) — v0.3.0

> Fonctionnalité développée et durcie par trois vagues de tests terrain
> réels sur deux machines (PC dev Windows 11 + vieux PC Windows 10 avec
> Kaspersky). Chaque solution ci-dessous a remplacé une tentative qui
> échouait EN CONDITIONS RÉELLES.

### Tentatives échouées

| Tentative | Raison de l'échec |
|---|---|
| Fenêtre d'écoute découverte de 4 s | Sur machine lente (disque dur), le fork du worker dépasse la fenêtre — le salon n'était jamais trouvé au premier essai |
| Lire `$p.ExitCode` après `Start-Process -Verb RunAs` | Sur certaines machines, relire le code de sortie à travers la frontière UAC échoue alors que le script a réussi — faux message « autorisation non accordée » |
| Vérifier les règles pare-feu depuis la session normale | Kaspersky verrouille MÊME LA LECTURE des règles (« Accès refusé » CIM, y compris compte admin) — la re-vérification post-installation concluait toujours à l'échec |
| `Remove-NetFirewallRule` puis `New-` (remplacement) | Kaspersky bloque la suppression même élevée mais laisse passer la création → règles en double à chaque exécution |
| `stop()` de découverte non idempotent | Appelé 2× (minuteur interne + annulation manuelle) → `ERR_SOCKET_DGRAM_NOT_RUNNING` → la nouvelle écoute ne s'installait jamais → découverte morte jusqu'au redémarrage complet de l'app |
| Détection de déconnexion par trame de fermeture seule | `wss.close()` ne termine PAS les connexions existantes ; wifi coupé/veille n'envoie jamais de trame → UI « connectée » à un salon mort, messages envoyés dans le vide |
| Panneau modal pour la messagerie | Masque la page — contredit l'usage « discuter en naviguant ». (Une bulle flottante React est impossible : la WebContentsView recouvre nativement le DOM) |
| Emoji comme icônes d'interface (💬🔒🛡️) | Rendu par la police de l'OS — apparence différente entre Windows 10 et 11 |
| Libellés natifs codés en dur en français | Menu clic-droit et dialogues restaient français en interface arabe — pas « natif » |

### Solutions finales retenues ✅

- **Découverte** : écoute 30 s + `chat-warmup` (fork du worker dès l'ouverture du panneau) + `stop()` idempotents (drapeau `stopped` + try/catch) partout où un socket se ferme.
- **Pare-feu** : le script ÉLEVÉ vérifie lui-même les règles et écrit OK/FAIL dans un fichier résultat lu par l'app ; drapeau local `userData/chat-network-setup.json` après succès (jamais re-demander l'UAC) ; création de règle conditionnelle (`if (-not (Get-NetFirewallRule…))`) ; contenu du `.ps1` en ASCII pur (PowerShell 5.1 lit les fichiers sans BOM en ANSI).
- **Vivacité** : battement de cœur ping/pong 10 s des deux côtés (terminate si pas de pong) + `ws.close(1001)` explicite de chaque client dans `stop()` de l'hôte + événement `disconnected` → écran « Connexion au salon perdue ».
- **UI** : dock ancré 340 px à droite (le main process rétrécit la vue via `chat-dock`, même mécanique que la sidebar d'onglets) ; store global `context/chatstore.ts` chargé avec l'app (icône verte + badge non-lus fiables panneau fermé) ; point de montage unique `ChatDockMount` ; icônes lucide.
- **i18n natif** : canal `set-app-language` + table `NATIVE_LABELS`/`nativeT()` dans electron.js pour menu contextuel et dialogues.

### ⚠️ Ne jamais modifier

- **Tout `stop()`/`close()` retourné par le module doit rester idempotent** — la régression revient sinon (découverte morte jusqu'au relancement).
- **Ne pas se fier aux codes de sortie à travers l'UAC** — seule vérité : le fichier résultat écrit par le script élevé, puis le drapeau local.
- **Ne pas retirer le heartbeat** ni le `ws.close(1001)` de `stop()` — ce sont eux qui empêchent les « salons fantômes » silencieux.
- **Ne pas raccourcir la fenêtre de découverte sous 30 s** — calibrée sur le matériel modeste réel de la cible.
- **Ne pas réintroduire d'emoji ni de chaînes en dur** dans l'interface — lucide + fichiers de langue + `nativeT()` uniquement.

---

## 9. Icône de la barre des tâches disparue — v0.7.x

### Le symptôme

Depuis la 0.7.0, l'icône du bouton de la barre des tâches est celle par
défaut de Windows, application ouverte. Elle était correcte de la 0.3.0 à
la 0.6.2. Tout le reste — icône du fichier dans l'Explorateur, du
raccourci, du menu Démarrer — reste juste, ce qui égare : on cherche du
côté du fichier alors que le fichier n'est pas en cause.

### La cause, en deux morceaux qui ne se voient qu'ensemble

1. `public/icons/icon.ico` ne contenait **qu'une seule image, 256×256**.
   Quand Windows lui demande un 32×32, il reçoit un 256×256 : le format ICO
   ne redimensionne pas, il rend l'entrée disponible.
2. `app.setAppUserModelId()` a été ajouté en 0.7.0 pour que les
   notifications Windows fonctionnent. **Il déplace l'origine de l'icône du
   bouton** : sans lui, le bouton est rattaché à l'exécutable — dont
   electron-builder génère toutes les tailles correctement ; avec lui, le
   bouton suit l'identifiant d'application et l'icône **de la fenêtre**,
   donc le `.ico` chargé à l'exécution.

Aucun des deux ne suffisait. Le fichier à une seule taille existait depuis
toujours sans gêner ; l'identifiant d'application est indispensable aux
notifications. C'est leur rencontre qui casse l'affichage.

### Solution finale retenue ✅

Un `.ico` multi-tailles — 16, 24, 32, 48, 64, 128 en **BMP/DIB**, 256 en
**PNG** — produit par `nativeImage` d'Electron, sans dépendance ajoutée.

### ⚠️ Ne jamais modifier

- **Ne pas encoder les petites tailles en PNG.** Windows n'accepte le PNG
  de façon fiable que pour l'entrée 256. Un `.ico` entièrement en PNG a été
  livré en 0.7.1 : icône par défaut partout, y compris sur le fichier.
- **Ne pas retirer `setAppUserModelId`** pour « régler » l'icône : les
  notifications Windows cesseraient silencieusement de paraître.
- **Ne pas se contenter de `--name` du fichier pour vérifier.** L'entrée
  DIB attend du BGRA **de bas en haut** ; une inversion oubliée donne une
  icône retournée, un mauvais ordre d'octets un fennec bleu.

### Comment vérifier — et comment NE PAS vérifier

Trois contrôles successifs ont donné un résultat rassurant et FAUX :

| Contrôle | Pourquoi il ne prouve rien |
|---|---|
| `ExtractAssociatedIcon` | renvoie 32×32 quelle que soit l'icône réelle — il ne peut pas échouer |
| `ExtractIconEx` | lit le PNG dans les petites tailles, là où le shell ne le lit pas |
| Regarder l'icône du fichier dans l'Explorateur | vient de l'exécutable, pas de la fenêtre — surface différente |

Le seul contrôle qui tranche, parce qu'il interroge le fichier comme
Windows le fait pour une fenêtre :

```powershell
Add-Type -AssemblyName System.Drawing
foreach ($n in 16,24,32,48) {
  $b = (New-Object System.Drawing.Icon('public\icons\icon.ico', $n, $n)).ToBitmap()
  '{0} -> {1}' -f $n, $b.Width      # doit rendre EXACTEMENT la taille demandée
}
```

Avant correction, les quatre demandes rendaient 256. Après, chacune rend sa
taille. Le 256 revient en 128 sous GDI+, qui ignore les entrées PNG — c'est
une limite de cette bibliothèque, pas du shell.

**La leçon générale** : se vérifier avec une API plus tolérante que celle
qui affiche réellement, c'est ne rien vérifier. Trois corrections
successives ont été livrées sur la foi de contrôles verts.

---

## Tableau récapitulatif — Ce qui fonctionne et ne doit pas être touché

| Mécanisme | Fichier(s) | Risque si modifié |
|---|---|---|
| `document.title = 'hnaya-dl::URL'` + `page-title-updated` | `electron.js` | Bouton HnayaTube Watch casse — seul canal fiable en sandbox |
| `return` après bloc `hnaya-dl::` dans `page-title-updated` | `electron.js` | Titre `hnaya-dl::URL` affiché dans l'onglet |
| `setTimeout(2000ms)` dans `did-finish-load` HnayaTube | `electron.js` | `data-video-id` absent au moment de l'injection |
| `await invoke("hide-active-view-sync")` | `urlbar.tsx` + `electron.js` | Panneau invisible derrière la WebContentsView |
| Handlers `receive` sans `event` en premier | `tabcontext.tsx` | Crash `Cannot destructure 'id'` |
| `updateTabInfo` sans filtre `title !== domain` | `electron.js` | Titres bloqués sur `hnaya.dz` |
| `paddingTop: "14vh"` + `alignItems: "flex-start"` | `CustomThemePanel.tsx` | Panneau coupé en haut |
| `e.target === e.currentTarget` pour fermeture overlay | `CustomThemePanel.tsx` | Clic dans le panneau ferme le panneau |
| Icône = thème actuel (pas suivant) | `theme-switch.tsx` | Confusion utilisateur |
| Formats JPG/PNG/WEBP uniquement | `CustomThemePanel.tsx` | Échec silencieux localStorage avec GIF/BMP |
| `vcodec!*=av01` + `--no-part` en mode Rapide | `electron.js` | Fichiers séparés sans son ou image |
