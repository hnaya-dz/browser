# Protocole de reprise de session — Hnaya DZ Browser

> À coller en début de toute nouvelle conversation avec Claude
> (desktop, mobile, ou nouvelle session web)

---

## 1. Message d'introduction à copier-coller

```
Je travaille sur Hnaya DZ Browser, un navigateur Electron/Next.js pour utilisateurs algériens.
Mon repo GitHub public : https://github.com/hnaya-dz/browser (branche principale : main)

Pour lire mes fichiers, utilise cette commande curl :
curl -sL "https://raw.githubusercontent.com/hnaya-dz/browser/main/{chemin}" 2>/dev/null

Exemples de fichiers clés :
- public/electron.js         → processus principal Electron
- public/preload.js          → pont IPC sécurisé
- public/vault.js            → chiffrement AES-256 mots de passe
- public/vault-ipc.js        → handlers IPC vault
- public/update-check.js     → vérification de mise à jour
- components/urlbar.tsx      → barre URL + boutons ⬇️ et 🔐
- components/tabbar.tsx      → onglets avec scroll horizontal
- components/DownloadPanel.tsx → panneau téléchargement vidéo
- components/VaultPanel.tsx  → gestionnaire mots de passe
- components/UpdateBanner.tsx → bannière mise à jour
- context/tabcontext.tsx     → état des onglets
- context/customthemecontext.tsx → thème personnalisé
- shared/supportedHosts.ts   → plateformes yt-dlp (TypeScript)
- shared/supportedHosts.js   → plateformes yt-dlp (JavaScript)
- locales/fr.json            → traductions français
- locales/ar.json            → traductions arabe
- locales/en.json            → traductions anglais
- chat-module/src/server.js  → hôte de salon messagerie locale (LAN)
- chat-module/src/client.js  → client + découverte messagerie locale
- chat-module/src/worker.js  → pont fork() entre Electron et le module
- context/chatstore.ts       → état global messagerie (icône, non-lus)
- components/ChatPanel.tsx   → dock messagerie locale (colonne droite)
- components/ChatDockMount.tsx → point de montage unique du dock
- app/layout.tsx             → layout racine Next.js
- DEV-INVARIANTS.md              → configurations critiques à ne pas modifier
- DEV-RETOUR-EXPERIENCE.md       → bugs résolus et tentatives échouées
- version.json               → version actuelle pour les mises à jour

Stack : Electron 35, Next.js 15, TypeScript, Tailwind CSS, yt-dlp
Mon workflow : je modifie les fichiers sur GitHub (interface web), puis git pull en local.
```

---

## 2. Comment accéder à n'importe quel fichier raw

### Format de l'URL raw GitHub

```
https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{chemin/complet/du/fichier}
```

Pour Hnaya DZ Browser :
```
https://raw.githubusercontent.com/hnaya-dz/browser/main/{chemin}
```

### Exemples concrets

| Fichier | URL raw complète |
|---|---|
| electron.js | `https://raw.githubusercontent.com/hnaya-dz/browser/main/public/electron.js` |
| preload.js | `https://raw.githubusercontent.com/hnaya-dz/browser/main/public/preload.js` |
| urlbar.tsx | `https://raw.githubusercontent.com/hnaya-dz/browser/main/components/urlbar.tsx` |
| tabbar.tsx | `https://raw.githubusercontent.com/hnaya-dz/browser/main/components/tabbar.tsx` |
| fr.json | `https://raw.githubusercontent.com/hnaya-dz/browser/main/locales/fr.json` |
| DEV-INVARIANTS.md | `https://raw.githubusercontent.com/hnaya-dz/browser/main/DEV-INVARIANTS.md` |

### Trouver le chemin d'un fichier sur GitHub

1. Allez sur `https://github.com/hnaya-dz/browser`
2. Naviguez jusqu'au fichier voulu
3. L'URL GitHub ressemble à :
   `https://github.com/hnaya-dz/browser/blob/main/components/urlbar.tsx`
4. Remplacez `github.com` par `raw.githubusercontent.com`
   et supprimez `/blob` :
   `https://raw.githubusercontent.com/hnaya-dz/browser/main/components/urlbar.tsx`

---

## 3. Contexte technique essentiel

### Architecture

```
browser/
├── public/
│   ├── electron.js          ← processus principal (Node.js/ESM)
│   ├── preload.js           ← whitelist IPC contextBridge
│   ├── vault.js             ← chiffrement AES-256-GCM + safeStorage
│   ├── vault-ipc.js         ← canaux IPC gestionnaire mots de passe
│   └── update-check.js      ← vérification hebdomadaire de mise à jour
├── components/
│   ├── urlbar.tsx           ← barre URL navigateur
│   ├── tabbar.tsx           ← onglets avec flèches de scroll
│   ├── DownloadPanel.tsx    ← téléchargement vidéo (yt-dlp)
│   ├── VaultPanel.tsx       ← gestionnaire mots de passe
│   ├── UpdateBanner.tsx     ← bannière nouvelle version
│   ├── UpdateBannerClient.tsx ← wrapper client pour UpdateBanner
│   └── CustomThemePanel.tsx ← thème fond personnalisé
├── context/
│   ├── tabcontext.tsx       ← état global des onglets
│   ├── customthemecontext.tsx ← thème image de fond
│   └── langcontext.tsx      ← langue sélectionnée (AR/FR/EN)
├── shared/
│   ├── supportedHosts.ts    ← 30+ plateformes yt-dlp (TypeScript)
│   └── supportedHosts.js    ← même chose en JS pur (pour electron.js)
├── locales/
│   ├── ar.json / fr.json / en.json
├── app/
│   └── layout.tsx           ← layout racine Next.js
├── DEV-INVARIANTS.md            ← ⚠️ configurations critiques
├── DEV-RETOUR-EXPERIENCE.md     ← historique des bugs résolus
└── version.json             ← version pour update-check
```

### Règles critiques à rappeler à Claude

1. **`shared/supportedHosts.ts` et `.js` doivent toujours être synchronisés**
2. **`receive()` dans tabcontext.tsx — handlers SANS `event` en premier paramètre**
3. **`hide-active-view-sync` via `invoke` (pas `send`) dans urlbar.tsx**
4. **`page-title-updated` + préfixe `hnaya-dl::` = seul canal fiable depuis WebContentsView sandbox**
5. **`public/bin/` est dans `.gitignore` — yt-dlp est téléchargé automatiquement**
6. **Ne jamais remettre `Menu.setApplicationMenu(null)` — casse Ctrl+C/V/Z**
7. **`setMenuBarVisibility()` doit être appelé APRÈS `new BrowserWindow()`**

### Commandes de développement

```powershell
# Lancer en développement
yarn dev

# Arrêter les serveurs DE CE PROJET (voir DEV-INVARIANTS.md §18)
yarn kill-dev

# Voir ce qui serait arrêté, sans rien toucher
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/kill-dev.ps1 -Lister

# Synchroniser depuis GitHub
git pull origin main

# Builder pour Windows
yarn dist
```

### Workflow de modification

```
1. Modifier le fichier sur GitHub (interface web)
2. git pull origin main  (en local)
3. yarn kill-dev
4. yarn dev
```

---

## 4. État actuel des fonctionnalités

| Fonctionnalité | État |
|---|---|
| Téléchargement vidéo (yt-dlp, 30+ sites) | ✅ Actif |
| Téléchargement multi-OS (Windows/Mac/Linux) | ✅ Actif |
| Choix qualité vidéo (Rapide/Haute qualité) | ✅ Actif |
| Gestionnaire mots de passe (AES-256 + safeStorage) | ✅ Actif |
| Sept thèmes (sombre, émeraude, gris, coucher de soleil, clair, blanc, image personnalisée) | ✅ Actif — sélecteur en liste, voir DEV-INVARIANTS §17 |
| Image de fond personnalisée | ✅ Actif |
| Scroll onglets avec flèches ‹ › | ✅ Actif |
| Titres d'onglets corrects | ✅ Actif |
| Barre URL avec recherche Startpage | ✅ Actif |
| Google OAuth → navigateur système | ✅ Actif |
| Vérification mise à jour hebdomadaire | ✅ Actif |
| Bannière mise à jour multilingue | ✅ Actif |
| Raccourcis clavier (Ctrl+C/V/Z/R/T/W) | ✅ Actif |
| Menu contextuel clic droit | ✅ Actif |
| Zoom interface (Ctrl+±) | ✅ Actif |
| Zoom page web (Ctrl+Shift+±) | ✅ Actif |
| Plein écran (Ctrl+Shift+F) | ✅ Actif |
| DevTools (Ctrl+Shift+I) | ✅ Dev uniquement |
| i18n AR/FR/EN avec RTL | ✅ Actif |
| HnayaTube Watch — bouton téléchargement | ✅ Actif |
| Dimensions fenêtre adaptatives | ✅ Actif |
| Messagerie locale (LAN, PIN, chiffrée, dock) | ✅ Actif (v0.3.0) |
| Pare-feu Windows auto-configuré (UAC, Kaspersky géré) | ✅ Actif (v0.3.0) |
| Icône d'état messagerie + badge non-lus | ✅ Actif (v0.3.0) |
| Libellés natifs (clic droit, dialogues) AR/FR/EN | ✅ Actif (v0.3.0) |
| Netflix DRM (Widevine) | ❌ Non supporté |
| Snapchat | ❌ Bloqué par Snapchat |

---

## 5. Documents de référence dans le repo

| Fichier | Contenu |
|---|---|
| `docs/DEV-INVARIANTS.md` | Configurations critiques avec explication et ⚠️ "Ne pas faire" |
| `docs/DEV-RETOUR-EXPERIENCE.md` | Historique des tentatives échouées et solutions finales |
| `docs/SERVEUR-MESSAGERIE.md` | Serveur autonome : prérequis Node 22.5+, installation Windows et Linux, licence, sauvegarde |
| `docs/PRODUIT.md` | Fiche produit — arguments de vente, à jour des sept thèmes |
| `docs/MESSAGERIE-TUTORIEL-VIDEO.md` | Dossier de tournage : anatomie des écrans, quatre capsules par public |
| `version.json` | Version actuelle + notes de release multilingues (AR/FR/EN) |
