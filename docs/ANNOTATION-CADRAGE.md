# Hnaya DZ Browser — Annotation de pages : cadrage technique

> Document de décision. Destiné à l'équipe produit, au développement et à
> Claude Code. Il fixe **ce qu'on fait, ce qu'on ne fait pas, et pourquoi**.
> Statut : phase 1 écrite et vérifiée en application réelle (§10 à §12).
>
> Objectif fonctionnel : permettre à un utilisateur d'annoter une page web
> (dessin, flèches, surlignage, texte, caviardage, commentaires) et
> d'envoyer le résultat à un collègue **par la Messagerie locale**, sans
> serveur, sans que rien ne quitte le réseau interne.

---

## 1. Point de départ : intégrer un outil existant ?

Une note de veille proposait d'intégrer un outil d'annotation web existant
plutôt que d'en construire un. Les solutions du domaine ont été examinées
avant de décider. Le constat est constant, quelle que soit celle qu'on
regarde :

| Bloc | Ce qu'on y trouve | Verdict pour Hnaya |
|---|---|---|
| Modèle de données d'annotation | Un tableau d'opérations typées, sérialisable | **Sain et instructif** — mais c'est une idée d'architecture, pas du code à reprendre |
| Couche de dessin cliente | Framework, outil de build et extension navigateur dédiés | Étrangère à notre pile Next.js |
| Backend | Fonctions et bases hébergées chez un fournisseur cloud | **Incompatible** avec « votre réseau, vos données » |
| Collaboration temps réel | WebSockets + WebRTC (voix/vidéo) | Hors périmètre |
| Liens de partage publics, comptes | — | Contraires au positionnement |

**Conclusion.** Environ un cinquième de ces projets (la couche de dessin et
la conception du modèle de données) est intéressant. Les quatre cinquièmes
restants — backend hébergé, comptes, collaboration temps réel, partage
public — entrent en conflit direct avec la souveraineté des données et avec
la maîtrise de la taille du code.

---

## 2. Décision

**On n'intègre, ne forke et n'auto-héberge aucune solution tierce. On
n'embarque aucune extension.**

On écrit un overlay d'annotation **réduit et maison**, dans notre renderer.
Le transport est déjà en place : le module `chat-module` (WebSocket chiffré
AES-256-GCM, signatures Ed25519, backlog, transfert de fichiers en
morceaux). Une annotation devient une pièce jointe de message, plus un bloc
de métadonnées structuré.

Raisons :

1. **Souveraineté.** Rien à concéder tant qu'on reste sur le LAN. Aucun
   serveur, aucune dépendance cloud, aucune donnée sortante.
2. **Taille maîtrisée.** Pas de monorepo, pas de pile parallèle, pas de
   build séparé. On réutilise le canal média que la Messagerie possède déjà
   (`chat-module/src/media.js`).
3. **Aucune dette juridique.** Rien n'est copié, donc rien à suivre : ni
   `NOTICE`, ni `THIRD_PARTY_NOTICES`, ni synchronisation avec un projet
   amont (voir §7).
4. **Cohérence.** L'annotation se branche sur les mécanismes maison
   existants (identité Ed25519, panneau admin, rétention, quota par
   appareil).

---

## 3. Contrainte d'architecture à intégrer d'emblée

Un overlay React flottant au-dessus d'une `WebContentsView` **est
impossible** dans Hnaya : la vue web recouvre nativement le DOM React
(c'est déjà la raison pour laquelle le dock messagerie *rétrécit* la vue au
lieu de flotter dessus — voir `docs/DEV-INVARIANTS.md`).

Deux voies, prises dans l'ordre :

### Voie A — capturer puis annoter l'image (phase 1)

`webContents.capturePage()` sur la vue active → PNG → surface d'annotation
React (un `<canvas>` au-dessus de l'image figée). On contourne
intégralement : CSP stricte, applications monopage, scroll infini, éléments
DOM qui disparaissent, iframes, Shadow DOM. Le livrable — image annotée +
URL + titre + commentaire — part directement dans un message.

C'est le MVP. Il fait tout ce que 90 % des usages réels demandent
(« regarde ce bouton », « cette ligne du tableau est fausse », « valide
cette maquette »).

### Voie B — overlay vivant dans la page (phase 2)

Script injecté **dans** la `WebContentsView` (preload dédié à la vue),
`<canvas>` dans le contexte de la page, épingles de commentaire ancrées au
DOM. Ancrage à trois niveaux : sélecteur CSS + rectangle + **empreinte
texte** de repli, pour retrouver l'élément quand le sélecteur ne résout
plus après un rechargement.

Réservé à la phase 2 : plus de valeur, mais tout le coût de robustesse
(SPA, reflow, navigation) est là.

---

## 4. Trajectoire et taille

| Phase | Contenu | Taille estimée | Souveraineté |
|---|---|---|---|
| **1 — MVP** | Bouton « Annoter la page » → `capturePage()` → canvas sur image. Outils : crayon, flèche, rectangle, surlignage, texte, **flou (caviardage)**. Export PNG. Envoi comme pièce jointe `image` via le canal média existant + bloc `annotation` (les `ops` + contexte de page) pour permettre la réouverture. | ~½ de `chat-module` : 1 module renderer, 3–4 composants, 1 IPC de capture, 1 champ de protocole. Aucune dépendance lourde ajoutée. | **Totale.** |
| **2 — Overlay vivant** | Script injecté dans la vue ; épingles de commentaire ancrées DOM ; modèle `ops` maison versionné. | +1 module de taille comparable. | Totale. |
| **3 — File de travail (entreprise)** | Persistance des fils d'annotation dans le store `node:sqlite` de `chat-module` (`store.js`) ; statut / priorité / assigné ; visible dans le panneau admin ; export JSON / CSV / Markdown (BOM UTF-8, déjà en place pour l'admin). | Petit. | Totale (données sur le poste hôte ou le serveur permanent). |

Le futur « agent IA » du navigateur se branche en phase 3 : une opération
d'inspection d'élément (sélecteur + rectangle + capture Markdown du
fragment) serait exactement le format de transmission dont un agent a
besoin. À noter, pas à faire maintenant.

---

## 5. Modèle de données maison

**Écrit de zéro, aucun fichier importé d'où que ce soit.**

```ts
// types/annotation.ts
export interface AnnotationDoc {
  v: 1;
  id: string;                       // uuid ; sur origine http:// mobile, getRandomValues (cf. crypto-src.mjs)
  page: {
    url: string;
    title: string;
    capturedAt: number;             // epoch ms
    viewport: { w: number; h: number };
  };
  screenshot?: {
    sha256: string;                 // le PNG voyage par le canal média (media-begin/chunk/end)
    thumb?: string;                 // vignette base64 <= MAX_THUMB_BYTES, pour l'aperçu inline
  };
  ops: Op[];
  author: { name: string; fp: string };   // fp = empreinte Ed25519 déjà fournie par identity.js
}

export type Op =
  | { k: "pen";    id: string; pts: [number, number][]; color: string; width: number }
  | { k: "rect";   id: string; a: [number, number]; b: [number, number]; color: string; width: number }
  | { k: "circle"; id: string; a: [number, number]; b: [number, number]; color: string; width: number }
  | { k: "line";   id: string; a: [number, number]; b: [number, number]; color: string; width: number; arrow?: boolean }
  | { k: "text";   id: string; at: [number, number]; text: string; size: number; color: string }
  | { k: "blur";   id: string; a: [number, number]; b: [number, number] }              // caviardage
  | { k: "comment"; id: string; at: [number, number]; body: string; status: "open" | "resolved" };
```

Règles :

- Coordonnées en pixels de l'image capturée. `viewport` permet de
  reprojeter si l'affichage du destinataire diffère.
- Le champ `v` est obligatoire dès le premier jour : il permet de faire
  évoluer le format sans rien casser (même logique que le protocole chat).
- `blur` est un choix de souveraineté : caviarder un nom, un montant, une
  adresse **avant** l'envoi, sans outil externe.

---

## 6. Intégration au protocole `chat-module`

Le protocole possède déjà tout le nécessaire. Rien de neuf côté transport.

### Réutilisation directe

- **Transfert de l'image** : `media-begin` / `media-chunk` / `media-end` /
  `media-get` (`chat-module/src/media.js`, `server.js`). Le PNG est validé
  par empreinte sha256 côté hôte, nommé d'après cette empreinte, soumis au
  quota par appareil et à la purge de rétention — **aucun régime
  particulier à créer**. `image/png` est déjà dans `ALLOWED_MIME`.
- **Signature** : le message porteur est signé Ed25519 comme les autres.
- **Backlog / reconnexion** : le message d'annotation revient dans
  l'historique comme un message ordinaire.

### Ce qu'il faut ajouter

Un message d'annotation = un `message` normal (donc historisé, cité,
répondable) avec :

```json
{
  "v": 1, "type": "message", "id": "...", "roomId": "...", "from": "...",
  "text": "Le bouton de validation manque",
  "media": { "kind": "image", "sha256": "...", "mime": "image/png", "size": 148213, "thumb": "..." },
  "annotation": { /* AnnotationDoc sans le champ screenshot.thumb, déjà porté par media */ }
}
```

- Côté `server.js` : `sanitizeMedia` existe déjà ; ajouter un
  `sanitizeAnnotation` sur le même modèle (bornes de tailles, nombre d'ops
  plafonné, pas de chaîne non bornée). **Ne jamais faire confiance au
  contenu envoyé par le client** — même règle que le reste du module.
- Côté `worker.js` : laisser passer le champ `annotation` dans la liste
  blanche de recopie (comme `media`).
- Côté `ChatPanel.tsx` : si `msg.annotation` est présent, l'aperçu ouvre la
  surface d'annotation en lecture, avec un bouton « Reprendre » qui
  recharge `ops` par-dessus l'image téléchargée.

### Côté navigateur (Electron)

- Nouveau IPC `annotate-capture` (dans `ALLOWED_INVOKE` de `preload.js`) :
  le main process appelle `capturePage()` sur la vue active et renvoie le
  PNG au renderer. Rien d'autre ne transite par cet IPC.
- La surface d'annotation est un panneau React classique (comme le dock
  messagerie) : elle n'a pas besoin de flotter sur la page puisqu'elle
  travaille sur une image figée.
- Respect strict de `docs/DEV-INVARIANTS.md` : `contextIsolation: true`,
  `nodeIntegration: false`, tout canal nouveau ajouté à la liste blanche,
  aucune chaîne visible codée en dur (i18n `Annotation.*` dans les trois
  locales).

---

## 7. Position juridique

**Ce module est entièrement original. Aucune obligation ne pèse sur lui.**

Rien n'a été copié : ni fichier, ni fonction, ni algorithme. Les licences
libres permissives du domaine (type Apache-2.0 ou MIT) n'imposent leurs
conditions — conserver la licence, les notices, signaler les
modifications — qu'à la **redistribution de l'œuvre ou d'une œuvre
dérivée**, c'est-à-dire au fait d'embarquer du code. Ce n'est pas notre
cas. Aucun `NOTICE`, aucun `THIRD_PARTY_NOTICES.md`, aucune attribution
n'est requis.

**Règle pour la suite.** Si un jour quelqu'un est tenté de reprendre un
fichier ou un algorithme non trivial d'un projet tiers (lissage de trait,
génération de sélecteur CSS…), il faut s'arrêter et en parler d'abord.
Notre `LICENSE` est « tous droits réservés » / `UNLICENSED` : y mêler des
fichiers sous licence libre est autorisé, mais cela brouille le message
propriétaire, impose de suivre un projet amont, et transforme une décision
technique en dette juridique. **La réponse par défaut est : on écrit le
nôtre.**

---

## 8. Souveraineté : la seule concession

Le scénario maison n'en fait **aucune** tant qu'on reste sur le LAN.

La seule tentation à écarter explicitement : le « lien de partage public »
que proposent les outils du domaine (un destinataire sans compte ni
application). Il exige un point de rendez-vous hors réseau. **Hors
périmètre** — la Messagerie locale *est* le canal de partage.

---

## 9. Décisions tranchées

| Question | Décision | Motif |
|---|---|---|
| Emplacement | `components/AnnotationSurface.tsx` + `components/AnnotationMount.tsx` + `context/annotationstore.ts` + `types/annotation.ts` | Suit le patron de la messagerie (store de module, point de montage unique dans la mise en page). Pas de dossier à part pour quatre fichiers. |
| Déclencheur | **Barre d'adresse** (`urlbar.tsx`), juste avant le bouton Messagerie | Chemin le plus découvrable, et les deux boutons se suivent dans l'usage : annoter, puis envoyer. Le menu contextuel reste possible plus tard. |
| Sans salon rejoint | **Oui** — capture, annotation et export PNG fonctionnent seuls | L'annotation est utile sans destinataire. Un bouton qui apparaît et disparaît selon l'état du réseau serait par ailleurs illisible. |
| Étendue de capture | **Viewport visible seulement** | Toujours sous le plafond du canal média, immédiat, et sans les échecs de la capture pleine page sur défilement infini. La pleine page est reportée en phase 2. |
| Pages exclues | **Aucune liste pour le MVP** | La capture ne quitte jamais le poste sans un clic explicite, et l'outil de caviardage est fourni. Une liste serait arbitraire, incomplète, et gênerait l'usage légitime le plus probable : une administration qui annote son propre portail. |

---

## 10. Ce qui est implémenté (phase 1)

**Fichiers créés**

- `types/annotation.ts` — modèle `Op` / `AnnotationDoc`, bornes, palette.
- `context/annotationstore.ts` — état, `ouvrirAnnotation()`, `fermerAnnotation()`.
- `components/AnnotationSurface.tsx` — surface plein écran : outils crayon,
  flèche, rectangle, ellipse, texte, caviardage ; couleurs, épaisseurs,
  annuler, tout effacer ; export PNG et envoi.
- `components/AnnotationMount.tsx` — point de montage unique, chargement
  différé du moteur de dessin.

**Fichiers modifiés**

- `public/electron.js` — `annotate-capture` (capture de la vue active) et
  `annotate-save` (dialogue d'enregistrement) ; libellés natifs ×3.
- `public/preload.js` — les deux canaux ajoutés à `ALLOWED_INVOKE`.
- `context/chatstore.ts` — champ `pieceJointeDeposee` + `deposerPieceJointe()`.
- `components/ChatPanel.tsx` — reprise du dépôt dans le composeur.
- `components/urlbar.tsx` — bouton, icône `PenLine`.
- `app/layout.tsx` — montage de `AnnotationMount`.
- `locales/{fr,en,ar}.json` — 22 clés `Annotation.*`.

**Points d'attention pour la relecture**

- L'ordre capture → masquage de la vue est délibéré : `capturePage()` sur
  une vue déjà retirée rend une image vide.
- `fermerAnnotation()` ne rappelle `show-active-view` que si la vue avait
  été masquée — sinon une erreur de capture réafficherait une vue au
  mauvais moment.
- Le caviardage **détruit** les pixels (flou appliqué sur l'image), il ne
  les recouvre pas : le destinataire ne peut pas les retrouver.
- Le tracé en cours vit dans un `ref`, pas dans l'état React — un rendu
  par point rendrait le crayon inutilisable.
- L'annotation est déposée dans le composeur, **jamais envoyée
  directement** : l'utilisateur choisit le fil et rédige son message.

---

## 11. Vérification en application réelle (2026-09-03)

Menée par CDP sur l'application de développement (Electron 43.5.1,
Chromium 150), sur `https://example.com` chargée dans un onglet.

**7 contrôles au vert** : ouverture de la surface avec la capture
(1748×827), absence de bandeau d'erreur, « Envoyer » indisponible hors
salon, « Enregistrer » disponible, note explicative présente, caviardage
mesuré (écart-type de la bande de texte **35,44 → 5,77**, soit un lissage
d'un facteur 6 : le texte est illisible, pas seulement recouvert), surface
saine après enchaînement d'opérations. Tracé à la flèche et bouton
« Annuler » validés lors du premier passage.

**Trois défauts trouvés par cette exécution, tous corrigés :**

1. **Course au premier affichage.** Cliquer « Annoter » pendant le
   chargement d'une page rendait une image de taille nulle, signalée par un
   « la capture a échoué » incompréhensible. → une seule reprise après
   400 ms dans `annotate-capture`, plus un message dédié
   (`erreurPageNonAffichee`) si la page ne s'affiche toujours pas.
2. **« Envoyer » hors salon menait à une impasse.** Le composeur — seul
   endroit où la pièce jointe apparaît — n'existe que dans la vue
   conversation. Hors salon, la messagerie s'ouvrait sur « Créer un
   salon » sans trace de l'annotation : le travail semblait perdu. → le
   bouton est désormais indisponible hors salon, avec une note qui dit
   pourquoi et rappelle que l'enregistrement en PNG, lui, marche toujours.
3. **Faux bandeau d'erreur sur une capture réussie.** L'URL du blob était
   révoquée dans le nettoyage de l'effet ; React montant les effets deux
   fois en développement, le premier chargement d'image était avorté par
   cette révocation et posait l'erreur, tandis que le second dessinait la
   toile. → l'URL vit jusqu'à ce que le chargement soit tranché, et un
   chargement dépassé n'écrit plus rien (drapeau `annule`).

---

## 12. Test terrain et second tour de correctifs (2026-09-03)

**Validé par l'utilisateur** : salon créé, annotation envoyée, **reçue sur
un téléphone ajouté au salon**. La chaîne complète capture → annotation →
canal média → réception mobile fonctionne.

**Défaut signalé : l'outil Texte ne faisait rien, dans aucune langue.**

Cause trouvée en instrumentant l'application : le champ de saisie était
créé sur le `pointerdown`, et **il ne survivait pas au geste**. Après la
distribution de l'événement, le navigateur déplace le focus vers `body` ;
l'input tout juste monté par `autoFocus` le perdait aussitôt, ce qui
déclenchait son `onBlur`, donc la validation d'une valeur vide, donc sa
disparition. Le champ n'existait qu'une fraction de frame — invisible.
Rien à voir avec la langue : le diagnostic initial s'était égaré là-dessus
parce que l'application redémarre en arabe et que les sélecteurs de test
étaient en français.

Correctif, en trois points solidaires :

1. La saisie s'ouvre au **`pointerup`**, quand le déplacement de focus a
   déjà eu lieu (point mémorisé dans `pointTexteRef` entre les deux).
2. Le focus est posé à la **frame suivante** (`requestAnimationFrame`),
   plus par `autoFocus` — un focus posé trop tôt était repris.
3. `onBlur` ne valide que si le champ a **réellement reçu le focus**
   (`saisieFocusee`), pour qu'un `blur` parasite ne referme jamais une
   saisie que l'utilisateur n'a pas vue.

**Vérifié après correctif — 12 contrôles au vert, dans les trois
langues** (FR, EN, **AR**) : le champ apparaît et garde le focus, accepte
le texte, Entrée l'écrit sur l'image (PNG modifié), le champ se referme.
Le rendu **arabe RTL** est conforme : barre d'outils inversée, texte arabe
correctement lié et lisible sur l'image, note alignée à droite, URL de pied
laissée en LTR.

**Décision produit (utilisateur, 2026-09-03) : LE CAVIARDAGE PRIME.**
Un caviardage posé par-dessus une annotation antérieure l'efface — le flou
repart de l'image d'origine. C'est voulu : masquer une donnée sensible ne
doit jamais être empêché par ce qui a été dessiné avant. Ne pas « corriger »
ce comportement.

**Reste à faire**

- [ ] Ajouter le bouton au tutoriel vidéo si besoin
      (`docs/MESSAGERIE-TUTORIEL-VIDEO.md`).
- [ ] Consigner dans `docs/DEV-INVARIANTS.md` les trois règles nées de
      cette phase : « capturer avant de masquer la vue », « ne pas révoquer
      une URL d'objet dans le nettoyage d'un effet », et « ouvrir un champ
      de saisie au relâchement, jamais à l'enfoncement ».
- [ ] Version + note de publication quand la phase 1 sera jugée bonne à
      diffuser.
