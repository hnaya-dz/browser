# Hnaya DZ Browser

> **Navigateur algérien souverain** — données locales, interface arabe
> native (RTL), téléchargement vidéo intégré, messagerie locale sans
> serveur. Windows · macOS · Linux.

Hnaya DZ Browser est un navigateur de bureau construit avec **Electron 43**
et **Next.js 15**, conçu pour les utilisateurs arabophones et francophones
— institutions, PME, écoles et familles — qui veulent naviguer et
collaborer **sans dépendre de services étrangers ni d'abonnements**.

## Fonctionnalités principales

- **Interface trilingue native** AR / FR / EN, y compris le sens de lecture
  (RTL), les menus contextuels et les boîtes de dialogue système.
- **Messagerie locale** — communication d'équipe chiffrée entièrement sur
  le réseau interne : sans serveur distant, sans compte, sans abonnement.
  Salons cloisonnés, demandes qualifiées avec décision signée, réunions
  avec rappel, annuaire, accès par téléphone sans installer d'application.
  En option sous licence, un **serveur permanent** sert plusieurs salons
  — Salon général, Direction, DRH — derrière une seule adresse.
  Guide d'usage : [`docs/MESSAGERIE-GUIDE.md`](docs/MESSAGERIE-GUIDE.md).
- **Téléchargement vidéo intégré** — 30+ plateformes (YouTube, TikTok,
  Facebook…) via yt-dlp, téléchargé automatiquement au premier lancement.
- **Gestionnaire de mots de passe** local chiffré (AES-256 + safeStorage)
  — aucune inscription, aucune donnée dans le cloud.
- **Favoris et groupes d'onglets**, thèmes (sombre, clair, coucher de
  soleil, image personnalisée), recherche orientée Algérie.
- **Mises à jour non intrusives** — vérification hebdomadaire, bannière
  discrète, jamais imposées.

La liste complète est dans [`docs/PRODUIT.md`](docs/PRODUIT.md).

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

La documentation est rangée **par destinataire** : chacun trouve son
document sans traverser ceux des autres.

### Pour présenter le produit

| Document | Contenu |
|---|---|
| [`docs/PRODUIT.md`](docs/PRODUIT.md) | Fiche produit complète — ce que fait le navigateur, argument par argument |

### Pour se servir de la messagerie

| Document | Contenu |
|---|---|
| [`docs/MESSAGERIE-GUIDE.md`](docs/MESSAGERIE-GUIDE.md) | Guide d'utilisation : salons, demandes qualifiées, réunions, annuaire, serveur permanent |
| [`docs/MESSAGERIE-TUTORIEL-VIDEO.md`](docs/MESSAGERIE-TUTORIEL-VIDEO.md) | Dossier de production du tutoriel vidéo — découpage, narration, identité visuelle |

### Pour développer

| Document | Contenu |
|---|---|
| [`docs/DEV-INVARIANTS.md`](docs/DEV-INVARIANTS.md) | Ce qui ne doit pas être touché, et ce qui casse si on y touche |
| [`docs/DEV-RETOUR-EXPERIENCE.md`](docs/DEV-RETOUR-EXPERIENCE.md) | Défauts vécus : ce qui a été tenté, pourquoi ça a échoué, comment on l'a trouvé |
| [`docs/DEV-DEMARRER-UNE-SESSION.md`](docs/DEV-DEMARRER-UNE-SESSION.md) | Reprendre le travail sur une session neuve : contexte à transmettre, arborescence |
| [`chat-module/README.md`](chat-module/README.md) | Architecture et modèle de sécurité de la messagerie locale |

> Les deux documents de développement se répondent : **INVARIANTS** énonce
> la règle, **RETOUR-EXPERIENCE** raconte l'incident qui l'a fait naître.
> Avant de modifier un mécanisme sensible, lire la règle ; si elle paraît
> arbitraire, l'histoire est à côté.

## Licence

License
Copyright (c) 2026 Hnaya DZ. Tous droits réservés.
All rights reserved.
Ce logiciel et les fichiers de code source associés (le « Logiciel ») sont la propriété exclusive de Hnaya DZ.
Toute reproduction, distribution, modification, ingénierie inverse, sous-licence ou exploitation commerciale du Logiciel, en tout ou en partie, est interdite sans l'autorisation écrite préalable de Hnaya DZ.
La consultation du code source à des fins d'audit, d'apprentissage ou d'évaluation est permise. Cette consultation n'accorde aucun droit d'usage, de copie, de modification ou de redistribution.
LE LOGICIEL EST FOURNI « EN L'ÉTAT », SANS GARANTIE D'AUCUNE SORTE, EXPRESSE OU IMPLICITE. EN AUCUN CAS HNAYA DZ NE POURRA ÊTRE TENU RESPONSABLE DE TOUT DOMMAGE DÉCOULANT DE L'UTILISATION DU LOGICIEL.