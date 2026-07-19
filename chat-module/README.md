# Hnaya Chat — module de chat local (LAN)

Module complémentaire, **installable et testable séparément** du navigateur
Hnaya DZ Browser. Permet à des utilisateurs sur un même réseau wifi/local
(famille, PME, école, administration) d'échanger des messages **sans
serveur dédié** : n'importe quel poste peut héberger un salon.

---

## Pourquoi un module à part

- Aucune dépendance (`ws`) n'est ajoutée au navigateur principal — ce
  module a son propre `package.json` et son propre `node_modules`.
- Le navigateur ne lance ce module qu'à la demande (`child_process.fork`
  depuis `electron.js`), uniquement si l'utilisateur active la
  fonctionnalité. Désactivé, il ne consomme aucune ressource et n'ouvre
  aucun port.
- S'il plante, le navigateur n'est jamais affecté (process séparé).

---

## Architecture

```
chat-module/
├── package.json
└── src/
    ├── crypto.js     chiffrement AES-256-GCM dérivé du PIN de session
    ├── discovery.js  découverte réseau (UDP multicast, aucune IP à saisir)
    ├── db.js         persistance JSON simple + purge automatique (30 jours)
    ├── server.js     hôte du salon (n'importe quel poste peut le lancer)
    ├── client.js     rejoint un salon existant
    └── worker.js     pont IPC utilisé par electron.js (fork), ne pas lancer seul
```

Intégration côté navigateur :
- `public/electron.js` : fork `worker.js` à la demande, relaie les
  commandes/événements entre le renderer et le module via un canal unique
  `"chat-event"` (receive) + canaux dédiés (`chat-start-host`,
  `chat-join`, `chat-send-message`, etc. — voir `preload.js`).
- Aucune UI React n'est encore branchée — ce squelette expose l'API prête
  à consommer depuis un futur composant `ChatPanel.tsx`.

---

## Modèle de sécurité — à lire avant tout déploiement

- **Découverte publique, contenu protégé.** N'importe quel appareil sur le
  même réseau local voit qu'un salon existe (nom + port), mais ne peut pas
  lire les messages sans le PIN à 6 chiffres affiché par l'hôte.
- **Chiffrement symétrique dérivé du PIN** (AES-256-GCM), pas un vrai
  chiffrement de bout en bout façon Signal. Suffisant pour bloquer
  l'écoute passive sur un wifi partagé ; pas conçu pour résister à un
  attaquant qui contrôle déjà la machine hôte.
- **`setMulticastTTL(1)`** : la découverte ne sort jamais du réseau local,
  aucun paquet n'est routé sur internet.
- **Purge automatique** des messages après 30 jours (`db.js`,
  `RETENTION_DAYS`) — cohérent avec la philosophie confidentialité du
  projet. Ajustable selon le contexte (famille / PME / administration).
- **Ne jamais transmettre le PIN via le beacon de découverte** —
  uniquement communiqué manuellement par l'hôte (oralement, affiché à
  l'écran, etc.).

### Ce qui n'est PAS couvert par ce MVP
- Pas de protection contre un hôte malveillant (il voit tous les messages
  en clair côté serveur, avant chiffrement de session).
- Pas de limite de débit (rate limiting) — un client peut spammer le
  salon. À ajouter avant un déploiement en administration/école.
- Pas de vérification d'identité forte — `userId` est déclaratif, rien
  n'empêche un participant de se faire passer pour un autre sur le LAN.

---

## Pare-feu Windows — autorisation réseau (poste hôte)

Le poste qui **héberge** un salon doit accepter des connexions **entrantes** :
TCP 4802 (messages) et UDP 41234 (découverte). Sans règle de pare-feu, les
autres postes *voient* le salon (beacon sortant) mais ne peuvent pas s'y
connecter — symptôme : « Connexion… » qui expire côté client.

L'alerte native de Windows ne suffit pas, pour trois raisons vérifiées :
1. Elle ne coche par défaut que « Réseaux privés » — or beaucoup de wifi
   (et les hotspots mobiles) sont classés **Public** par Windows.
2. Un clic passé sur « Annuler » crée une règle de **blocage persistante**
   qui prime sur toute autorisation ultérieure.
3. Le salon tourne dans un **process séparé** du navigateur.

**Le navigateur gère ça automatiquement** : au premier « Créer un salon »,
si les règles nommées `Hnaya Messagerie locale (TCP 4802/UDP 41234)` sont
absentes, un écran explique la situation et le bouton « Autoriser l'accès
réseau » déclenche une élévation UAC (l'utilisateur — ou l'admin du poste —
confirme une seule fois). Les règles créées sont limitées au **sous-réseau
local** (`-RemoteAddress LocalSubnet`) et couvrent **tous les profils**
(`-Profile Any`), donc fonctionnent aussi sur un réseau classé Public.

Équivalent manuel (PowerShell administrateur) :
```powershell
New-NetFirewallRule -DisplayName "Hnaya Messagerie locale (TCP 4802)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4802 -RemoteAddress LocalSubnet -Profile Any
New-NetFirewallRule -DisplayName "Hnaya Messagerie locale (UDP 41234)" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 41234 -RemoteAddress LocalSubnet -Profile Any
```

Limite connue non contournable par logiciel : l'« isolation AP » de
certains routeurs (interdit toute communication entre appareils du wifi).
Seule la configuration du routeur — ou un réseau différent — y remédie.

---

## Tester ce squelette (deux postes ou deux terminaux sur la même machine)

```bash
cd chat-module
yarn install        # installe uniquement "ws"

# Terminal 1 — héberge un salon de test
yarn host
# → affiche : [hnaya-chat] Salon "Salon de test" ouvert — PIN : XXXXXX
```

Pour un test rapide sans UI, un petit script Node (à créer, non fourni
dans ce squelette) peut appeler `discoverSessions()` puis `joinSession()`
depuis `src/client.js` pour simuler un second participant.

---

## Accès mobile — téléphones sur le même wifi (C-bis, Marche 1)

En plus du WebSocket (4802), l'hôte sert une **page web autonome** sur
**TCP 4803** (`src/mobile-server.js` + `mobile/index.html`). Un téléphone
scanne le QR « Inviter un téléphone » du dock → ouvre
`http://<ip-hôte>:4803` → saisit le PIN → rejoint le salon avec le **même
protocole chiffré** que les postes. Aucune installation, aucun app store,
aucune découverte multicast côté téléphone (le QR transporte l'adresse —
ce qui contourne les restrictions multicast d'iOS).

**Pourquoi une crypto bundlée** : sur une origine `http://` (pas de TLS
possible sur une IP privée), `crypto.subtle` est indisponible. La page
embarque donc `mobile/vendor/crypto-bundle.js` — scrypt + AES-256-GCM
purs JS (@noble/hashes, @noble/ciphers), **compatibles bit-à-bit** avec
`src/crypto.js`. Le bundle est un artefact commité ; pour le reconstruire
après modification de `mobile/crypto-src.mjs` :

```bash
cd chat-module
npx esbuild mobile/crypto-src.mjs --bundle --format=esm --minify --outfile=mobile/vendor/crypto-bundle.js
node test/crypto-interop.test.mjs   # OBLIGATOIRE : vérifie l'interop Node ↔ navigateur
```

**Limites assumées de la Marche 1** (documentées dans la page elle-même) :
notifications uniquement page ouverte (les navigateurs mobiles suspendent
les onglets en arrière-plan) ; la page se reconnecte automatiquement au
retour au premier plan et récupère les messages manqués via le backlog.
Les notifications d'écran verrouillé viendront de la PWA hnaya.dz
(Marche 2, Web Push) puis de l'application Android native (Marche 3).

**Pare-feu** : TCP 4803 fait partie des règles créées par l'autorisation
guidée de l'application (voir section Pare-feu ci-dessus). Les postes
autorisés avant cette version re-proposeront l'autorisation une fois
(drapeau versionné `NETWORK_SETUP_VERSION`). Commande manuelle :

```powershell
New-NetFirewallRule -DisplayName "Hnaya Messagerie locale (TCP 4803 mobile)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4803 -RemoteAddress LocalSubnet -Profile Any
```

---

## Mode serveur permanent (étape D — entreprises et administrations)

Pour un salon **toujours disponible** (une instance par direction/service,
sur une machine allumée en continu) :

```bash
node src/serve.js --name "Salon RH" --pin 123456 --data /srv/hnaya-rh
```

- **PIN d'accès stable** : fourni une fois puis persisté en base — les
  redémarrages le conservent (idem pour le nom et le PIN admin).
- **Données** (`--data`) : historique SQLite, registre des appareils,
  configuration — répertoire sauvegardable par l'IT.
- **Démarrage automatique** : `service/install-windows.ps1` (tâche
  planifiée SYSTEM au démarrage) ou `service/install-linux.sh` (systemd).
  Prérequis : Node.js ≥ 22.5 (pour `node:sqlite`), ou le binaire Electron
  du navigateur en mode nœud (`ELECTRON_RUN_AS_NODE`).
- **Clients hors sous-réseau** (multi-sites, VPN, VLAN cloisonnés) : la
  découverte multicast ne traverse pas les routeurs — utiliser le champ
  **« Rejoindre par IP »** du dock (l'adresse est mémorisée). Le dock
  récupère le nom du salon via `/info.json` (seul endpoint avec CORS
  ouvert — contenu déjà public via le beacon).
- **Cloisonnement** : une instance par machine (ports fixes 4802/4803).
  Chaque direction héberge la sienne — l'information ne circule pas
  entre salons, par construction.

### Identité des appareils et audit (étape D)

Pseudo libre en surface, identité **Ed25519** stable en dessous : chaque
appareil signe ses messages (`src/identity.js`, pendant navigateur dans
`mobile/crypto-src.mjs`). Le serveur vérifie et consigne tout dans le
registre (pseudos utilisés, machine, IP, étiquette posée par l'admin).
Panneau d'administration dans le dock (PIN admin distinct) : registre,
recherche d'historique, exports JSON/CSV, rétention (90 j par défaut,
0 = illimitée). Tests obligatoires après toute modification :
`node test/crypto-interop.test.mjs` (8 assertions, interop bit-à-bit),
`test/store.test.mjs`, `test/signed-protocol.test.mjs`,
`test/admin-protocol.test.mjs`, `test/serve.test.mjs`.

---

## Étapes suivantes (non incluses dans ce squelette)

1. **`ChatPanel.tsx`** — composant React côté renderer : saisie du PIN,
   liste des salons découverts, fil de messages, indicateur de présence.
   Consomme `window.electronAPI.receive("chat-event", ...)` et les
   canaux `send`/`invoke` déjà whitelistés dans `preload.js`.
2. **Médias (image/audio/vidéo enregistrée)** — le champ `media` existe
   déjà dans le schéma de message (`{ mimeType, ... }`), mais **ne pas**
   faire transiter de gros binaires directement dans le WebSocket JSON.
   Prévoir soit un envoi par chunks, soit un petit endpoint HTTP local
   sur l'hôte servant les fichiers avec un token de session.
3. **Rate limiting** côté `server.js` avant tout déploiement en dehors
   du cadre familial.
4. **Mode "hors wifi"** — ne pas développer de réseau ad-hoc/mesh
   maison (Bluetooth, Wi-Fi Direct) : trop complexe et risqué pour ce
   projet. Documenter plutôt l'usage du **point d'accès mobile natif**
   de l'OS (Windows/macOS/Android) comme solution "hors wifi" — la
   découverte mDNS/UDP de ce module fonctionne de façon identique une
   fois les postes connectés à ce hotspot.
5. **Packaging** — décider si `chat-module/` est embarqué dans le
   `.exe` principal (`extraResources`, comme pour `yt-dlp`) ou distribué
   comme installateur séparé, conformément à l'intention initiale
   ("installable séparément").
