# Hnaya DZ Browser

> **Navigateur algérien souverain** — données locales, interface arabe
> native (RTL), téléchargement vidéo intégré, messagerie locale sans
> serveur. Windows · macOS · Linux.

Hnaya DZ Browser est un navigateur de bureau construit avec **Electron 35**
et **Next.js 15**, conçu pour les utilisateurs arabophones et francophones
— institutions, PME, écoles et familles — qui veulent naviguer et
collaborer **sans dépendre de services étrangers ni d'abonnements**.

## Fonctionnalités principales

- **Interface trilingue native** AR / FR / EN, y compris le sens de lecture
  (RTL), les menus contextuels et les boîtes de dialogue système.
- **Messagerie locale** *(v0.3.0)* — communication d'équipe chiffrée
  (AES-256, code PIN) entièrement sur le réseau local : sans serveur, sans
  compte, sans abonnement. Panneau ancré pour discuter en naviguant,
  découverte automatique des salons, configuration du pare-feu Windows
  guidée. Voir [`chat-module/README.md`](chat-module/README.md).
- **Téléchargement vidéo intégré** — 30+ plateformes (YouTube, TikTok,
  Facebook…) via yt-dlp, téléchargé automatiquement au premier lancement.
- **Gestionnaire de mots de passe** local chiffré (AES-256 + safeStorage)
  — aucune inscription, aucune donnée dans le cloud.
- **Favoris et groupes d'onglets**, thèmes (sombre, clair, coucher de
  soleil, image personnalisée), recherche orientée Algérie.
- **Mises à jour non intrusives** — vérification hebdomadaire, bannière
  discrète, jamais imposées.

La liste complète est dans [`FICHE_TECHNIQUE.md`](FICHE_TECHNIQUE.md).

## Démarrage

### Prérequis

- Node.js ≥ 18
- Yarn 1.x

### Installation

```bash
git clone https://github.com/hnaya-dz/browser.git
cd browser
yarn install
cd chat-module && yarn install && cd ..   # dépendances de la messagerie locale
```

### Développement

```bash
yarn dev        # Next.js + Electron
yarn kill-dev   # arrêter tous les processus de dev (Windows)
```

### Distribution

```bash
yarn dist         # Windows (.exe NSIS)
yarn dist:mac     # macOS (.dmg x64 + arm64)
yarn dist:linux   # Linux (AppImage)
```

> ⚠️ Ne jamais lancer `yarn dist` pendant qu'un `yarn dev` tourne — le
> build de production écrase le cache `.next` du serveur de dev.

## Documents de référence

| Fichier | Contenu |
|---|---|
| [`TECHNIQUES.md`](TECHNIQUES.md) | Configurations critiques et invariants à ne pas casser |
| [`RETOUR_EXPERIENCE.md`](RETOUR_EXPERIENCE.md) | Tentatives échouées et solutions finales, par fonctionnalité |
| [`FICHE_TECHNIQUE.md`](FICHE_TECHNIQUE.md) | Fiche produit complète |
| [`PROTOCOLE_SESSION.md`](PROTOCOLE_SESSION.md) | Protocole de reprise de session de développement |
| [`chat-module/README.md`](chat-module/README.md) | Architecture et modèle de sécurité de la messagerie locale |

## Licence

MIT — © 2026 Nacib Hamida.

*Hnaya DZ Browser — Navigateur algérien souverain.*
