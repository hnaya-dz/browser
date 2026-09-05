# Messagerie locale Hnaya — dossier de production du tutoriel vidéo

**À l'usage de Claude Design.** Ce document n'est pas un guide
d'utilisation : c'est le dossier de tournage. Le guide, lui, est
[MESSAGERIE-GUIDE.md](MESSAGERIE-GUIDE.md) — il dit *ce que fait* le
produit ; celui-ci dit *ce qu'il faut montrer, dans quel ordre, avec quels
mots, et pendant combien de temps*.

Tout ce qui suit — libellés, couleurs, chemins, ordre des boutons — est
relevé dans le code, pas reconstitué de mémoire. Si une divergence apparaît
à l'écran, c'est le produit qui fait foi : signalez-la plutôt que de
l'aligner sur ce document.

---

## 0. Lisez ceci avant tout le reste

La première production tirée de ce dossier a échoué sur trois points
précis. Ils sont corrigés ici, et les trois corrections sont
**impératives**.

**Défaut 1 — les clips étaient trop courts.** Les durées de la §7 sont des
durées **planchers**, pas des cibles à comprimer. Un plan d'interface tenu
moins de trois secondes n'est pas lisible : le spectateur voit un
scintillement, pas un produit. Chaque séquence impose désormais un **nombre
minimal de plans** et une **durée minimale par plan** — §6.

**Défaut 2 — l'interface reconstituée manquait de boutons.** Le dossier
décrivait l'esprit du produit, jamais son anatomie. La **§5 est nouvelle**
et donne, écran par écran, la liste exhaustive des commandes dans leur
ordre réel d'affichage. Une reconstitution qui omet un bouton de la §5 est
à refaire.

**Défaut 3 — le bouton « Achat » n'a jamais pu être reproduit. ✅ RÉSOLU À
LA SOURCE le 04/09/2026.** La faute en revenait à ce dossier, non au
concepteur : deux de ses règles l'interdisaient. La §3 imposait de
n'employer que des icônes `lucide-react`, alors que celle-ci était une
**image** (`market.png`) ; la §4 affirmait qu'un texte absent de
`locales/` n'existe pas, alors que le libellé « Achat » est écrit en dur
dans `app/page.tsx`.

Les règles avaient d'abord été nuancées, et la console de recherche
décrite en **§5.7** — mais le bouton restait irreproductible pour qui ne
peut pas ouvrir un fichier binaire du dépôt. **Le produit a donc été
changé** : l'icône est désormais `ShoppingCart` de `lucide-react`, comme
tout le reste. Elle se cherche, se trouve et se dessine comme les autres.
Il n'existe plus **aucune** icône bitmap dans une barre d'outils.

**Pourquoi la deuxième omission était prévisible, et comment ne pas la répéter :**
l'interface n'est pas dans un fichier mais dans **quinze composants**. Les
boutons *Joindre un fichier* et *Enregistrer un message vocal* ne sont pas
dans `ChatPanel.tsx` — ils vivent dans `ChatComposerMedia.tsx`. Qui n'ouvre
que le panneau principal ne peut pas les voir. La liste des quinze est en
§5.0 : ouvrez-les tous.

---

## 1. Ce qu'il faut avoir compris avant de dessiner

Hnaya Messagerie est une messagerie d'entreprise qui **ne sort pas du
réseau local**. Aucun serveur distant, aucun compte, aucune inscription :
les messages vont d'un poste à l'autre par le réseau interne, chiffrés, et
l'historique reste sur la machine qui héberge le salon.

C'est le seul argument qui compte pour la cible — administrations et
entreprises algériennes soumises à des exigences de confidentialité. Toute
la vidéo doit servir cette idée, jamais la contredire par une image de
nuage, de planète, de cadenas flottant ou de « cloud sécurisé ».

**Trois erreurs de représentation à éviter absolument :**

- pas de globe, pas de nuage, pas de satellite — le produit est *local* ;
- pas de bulles de conversation façon messagerie grand public : le ton est
  institutionnel, on parle de validations, de réunions, de directions ;
- pas de personnages qui s'envoient des cœurs ou des émojis : le **panneau
  de messagerie** n'en emploie aucun, c'est un choix assumé.

> ⚠️ **Aucune barre d'outils ne porte plus d'émoji.** La barre d'adresse,
> l'accueil et le sélecteur de thème en employaient comme icônes — ⬇️,
> ★/☆, 📑, 🔐, 🇩🇿, ☀️ 🌅 🖼️ 🎨 🌙 — et ce sont précisément les boutons qui
> disparaissaient des reconstitutions : leur icône n'était ni un composant
> ni un fichier, mais un caractère. **Tous sont passés aux icônes `lucide`
> le 18/08/2026.** Il reste des émojis À L'INTÉRIEUR des panneaux (coffre,
> favoris, téléchargement) : ceux-là sont réels, représentez-les tels
> quels. Inventaire complet en **§5.8**.

---

## 2. Public, ton, langues

**Public** : un directeur, un chef de service, un responsable informatique
d'une administration ou d'une PME. Il n'a pas de temps, il se demande si ça
remplace des courriels internes et si ça sort de son réseau.

**Ton** : sobre, affirmatif, sans superlatif. Registre professionnel
soutenu. Pas de « révolutionnaire », pas de « incroyable ». Une
démonstration vaut mieux qu'une promesse.

**Langues** : français, arabe, anglais. Les trois fichiers de traduction
comportent **exactement 268 clés `Chat.*` chacun**, plus **23 clés
`Annotation.*`** pour la capsule 5 — aucune langue n'est en retard, vous
pouvez produire les trois versions sans arbitrage. *(Compté le 04/09/2026 ;
le dossier annonçait 264 avant l'ajout des fonctions de la 0.8.0.)*

**L'arabe est en écriture de droite à gauche** : l'interface bascule
entièrement, y compris l'alignement des messages et la position des
boutons. Une version arabe qui garderait la mise en page latine serait
perçue comme un placage.

**Durée visée** : **cinq capsules** autonomes, adressées à des publics
différents (§7), pour un total d'environ huit minutes. Chacune se diffuse
seule.

---

## 3. Identité visuelle — valeurs réelles

| Élément | Valeur | Où elle est définie |
|---|---|---|
| Vert Hnaya (accent) | `#006341` | `components/ChatPanel.tsx` |
| Vert clair (actif, en cours) | `#00c853` | `chat-module/mobile/index.html` |
| Fond sombre | `#0d1a12` | idem |
| Panneau | `#122419` | idem |
| Texte | `#ffffff`, secondaire à 50 % | idem |
| Alerte / refus | `#ff5252` | idem |
| Orange (thème « sunset ») | `#c83200` | `components/ChatPanel.tsx` |

**Jeu d'icônes** : `lucide-react`, et **uniquement** celui-là. Les icônes
réellement employées par le panneau sont : `MessageSquare`, `Shield`,
`Lock`, `Smartphone`, `KeyRound`, `Eye`, `EyeOff`, `Send`, `History`,
`DoorOpen`, `Trash2`, `KeySquare`, `Users`, `ArrowLeft`, `CornerUpLeft`,
`X`, `CheckCircle2`, `AlertTriangle`, `Volume2`, `VolumeX`,
`CalendarClock`, `MoreHorizontal`, `ChevronUp`, `User`, `Plus`. N'inventez
pas d'icône hors de cette liste : le spectateur qui ouvrira le produit
après la vidéo doit retrouver les mêmes signes.

> ⚠️ **Toutes les icônes ne viennent PAS de `lucide-react`.** La consigne
> ci-dessus vaut pour le **panneau de messagerie**. Ailleurs dans le
> navigateur, certaines icônes sont des **fichiers image**, qu'aucune
> bibliothèque ne peut fournir :
>
> | Fichier | Format | Où |
> |---|---|---|
> | `public/hnaya.png` | PNG | le logo, barre de navigation et page d'accueil |
> | émojis divers | **émojis** | uniquement À L'INTÉRIEUR des panneaux (`VaultPanel`, `FavoritesPanel`, `DownloadPanel`) — aucune barre d'outils |
>
> Les fichiers `public/icons/arrow.*.svg`, `house.svg` et
> `magnifyingglass.svg` existent mais **ne sont référencés nulle part** :
> ce sont des ressources mortes. Les flèches de navigation sont des **SVG
> écrits en ligne** dans `components/urlbar.tsx` (`IconBack`,
> `IconForward`, `IconRefresh`, `IconSearch`). N'allez pas chercher les
> fichiers.
>
> **`public/icons/market.png` a quitté cette liste le 04/09/2026.** C'est
> lui qui avait empêché de reproduire le bouton « Achat » : cherché dans
> `lucide-react` il n'existait pas, et il était interdit d'inventer — le
> bouton ne pouvait qu'être omis. Le produit a été corrigé plutôt que la
> consigne : l'icône est maintenant `ShoppingCart` de `lucide-react`. Le
> fichier PNG dort encore dans le dépôt, **plus aucun code ne s'en sert** ;
> si vous le croisez, ignorez-le.

**Logo** : le fennec à la loupe, `public/icons/icon.ico` — sept tailles de
16 à 256 px. Pour une animation, partez du 256.

> ⚠️ Si vous régénérez ce fichier, les tailles **inférieures à 256 doivent
> être en BMP**, jamais en PNG : Windows ne lit le PNG de façon fiable que
> pour l'entrée 256, et un fichier tout en PNG fait apparaître l'icône par
> défaut du système. L'incident est raconté dans
> [`DEV-RETOUR-EXPERIENCE.md`](DEV-RETOUR-EXPERIENCE.md) §9.

Le produit existe en thème sombre et clair ; **tournez en sombre**, c'est
le rendu par défaut et le plus lisible en vidéo.

---

## 4. Vocabulaire exact de l'interface

Ne traduisez pas librement : ces libellés sont ceux du produit. Une vidéo
qui nomme un bouton autrement que l'écran est une vidéo qui égare.

| Français | English | العربية |
|---|---|---|
| Créer un salon | Create a room | إنشاء غرفة |
| Rejoindre un salon | Join a room | الانضمام إلى غرفة |
| Réunion | Meeting | اجتماع |
| Admin | Admin | الإدارة |
| Appareils | Devices | الأجهزة |
| Historique | History | السجل |
| Réglages | Settings | الإعدادات |
| Salons | Rooms | الغرف |

Le mot **salon** désigne un espace de discussion cloisonné. Ne le rendez ni
par « canal » ni par « groupe » : le cloisonnement est physique — historique,
codes et registre séparés — et le vocabulaire doit le porter.

Les 264 libellés complets de la messagerie sont dans `locales/fr.json`,
section `Chat`. **Aucun texte affiché à l'image ne doit être inventé.**

> ⚠️ **`locales/` ne contient pas tout.** Les libellés de la **page
> d'accueil** — dont le bouton **Achat** — sont écrits en dur dans
> `app/page.tsx`, pas dans les fichiers de traduction. Un texte absent de
> `locales/` n'est donc pas forcément inexistant : vérifiez aussi
> `app/page.tsx` avant de conclure. Cette règle, appliquée trop
> littéralement, a contribué à faire disparaître le bouton « Achat » d'une
> reconstitution.

---

## 5. Anatomie des écrans — la liste des commandes

> **Section normative.** Elle donne, dans l'ordre réel d'affichage, chaque
> commande visible. Une reconstitution qui en omet une est incomplète. Les
> libellés sont donnés entre guillemets ; ce sont exactement ceux du produit.

### 5.0 Les quinze composants à ouvrir

Ne travaillez pas depuis le seul `ChatPanel.tsx` : c'est l'erreur qui a
produit une interface amputée.

| Composant | Ce qu'il dessine |
|---|---|
| `ChatPanel.tsx` | le panneau entier, l'accueil, le fil, la barre d'outils |
| `ChatComposerMedia.tsx` | **pièce jointe, page en PDF, micro, aperçu avant envoi** |
| `ChatMediaBubble.tsx` | une pièce jointe reçue dans le fil |
| `ChatRoster.tsx` | l'annuaire et « Mes appareils » |
| `ChatIdentite.tsx` | le bloc « Vous êtes », pseudo et photo |
| `ChatAvatar.tsx` | la pastille : photo, ou initiales colorées |
| `ChatAdminPanel.tsx` | l'administration et ses quatre onglets |
| `ChatDemandeCard.tsx` | la carte d'une demande qualifiée et sa décision |
| `ChatVoteCard.tsx` | la carte d'un vote et son dépouillement |
| `ChatMeetingCard.tsx` | la carte d'une réunion annoncée |
| `ChatMeetingChip.tsx` | la pastille épinglée avec compte à rebours |
| `ChatServerSetup.tsx` | l'installation du serveur permanent |
| `ChatDockMount.tsx` | le point de montage (rien de visible) |
| `AnnotationSurface.tsx` | **la surface d'annotation plein écran** *(hors messagerie, 04/09/2026)* |
| `AnnotationMount.tsx` | son point de montage (rien de visible) |

### 5.1 Écran A — Accueil du panneau

1. En-tête : icône `MessageSquare`, titre **« Messagerie locale »**,
   sous-titre **« Communication sécurisée sur votre réseau interne »**.
2. Bloc identité (`ChatIdentite`) : **« Vous êtes »** *pseudo*, bouton
   **« Modifier »**. Déplié : champ **« Votre pseudo »** (indication
   *« ex. Directeur RH »*), bouton **« OK »**, bouton **« Ma photo »**, et
   **« Retirer »** si une photo est posée.
3. Si un salon de ce poste est ouvert : bandeau **« Salon toujours
   ouvert : »** *nom*, boutons **« Revenir »** et **« Fermer le salon »**.
4. Bouton principal **« Rejoindre un salon »**.
5. Bloc **replié par défaut** **« Créer un salon »**. Déplié : champ **« Nom
   du salon »** (*« ex. Équipe Prospection Clients »*), champ **« PIN
   administrateur (optionnel — généré sinon) »**, boutons **« Créer un
   salon »** et **« Annuler »**.
6. Entrée **« Serveur permanent (organisations) »**.
7. Mention basse : **« Chiffré par PIN sur ce réseau local — pas un
   chiffrement de bout en bout. »**

> Le repli du bloc de création est **voulu** : une entreprise crée ses
> salons à l'installation, rarement ensuite. Ne le montrez pas ouvert au
> repos.

### 5.2 Écran B — Chercher et rejoindre

- **« Recherche de salons sur le réseau… »**, puis la liste, ou **« Aucun
  salon trouvé sur ce réseau. »**
- **« Rechercher à nouveau »**, **« Retour »**.
- **« Un salon existe mais n'apparaît pas ? »** + **« Autoriser l'accès
  réseau »**.
- **« Salon introuvable ? Saisissez l'adresse IP du serveur… »** +
  **« Rejoindre »**.
- Puis : **« Code PIN du salon »** (indication **« 6 chiffres »**), case
  **« Rester connecté à ce salon sur ce PC »**, boutons **« Retour »** et
  **« Rejoindre »**, état transitoire **« Connexion… »**.
- Erreurs possibles à l'image : **« Code PIN incorrect. »**

### 5.3 Écran C — Salon ouvert *(l'écran principal, à ne pas amputer)*

**Barre d'outils, dans cet ordre exact :**

| # | Libellé | Note |
|---|---|---|
| 1 | *nom du salon* + **« N en ligne »** | jamais masqué : voir §8 |
| 2 | **« Codes »** | révèle **« Code PIN à partager »** et **« PIN admin »** |
| 3 | **« Annuaire »** | icône `Users` |
| 4 | *son* | `Volume2` / `VolumeX` — bascule |
| 5 | **« Réunion »** | icône `CalendarClock` |
| 6 | **« Vote »** | |
| 7 | **« Inviter vers… »** | |
| 8 | **« Admin »** | icône `Shield` |
| 9 | **« Plus »** | `MoreHorizontal` — replie 5 à 8 si la largeur manque |

**Barre de saisie, de haut en bas :**

1. Quatre étiquettes, **dans cet ordre** : **« Pour info »**, **« Avis »**,
   **« Validation »**, **« Approbation »**.
2. Liste de destinataires — valeur par défaut **« Sans destinataire
   précis »**.
3. Champ de texte. Son indication **nomme le salon** : **« Écrire dans »**
   *nom du salon*, ou **« Écrire à »** *personne* dans un fil privé.
4. Bouton **« Joindre un fichier »**, icône `Paperclip`
   *(`ChatComposerMedia`)*.
5. Bouton **« Joindre la page ouverte, en PDF »**, icône `FileText`
   *(`ChatComposerMedia`, 04/09/2026)*. **Il n'apparaît que si un onglet
   web est ouvert** : sur la page d'accueil, il n'y a rien à imprimer, et
   le bouton est alors *absent*, pas grisé. Ne le dessinez donc pas sur un
   plan où le navigateur est sur son accueil.
6. Bouton **« Enregistrer un message vocal »**, qui devient **« Arrêter
   l'enregistrement »** pendant la prise *(`ChatComposerMedia`)*.
7. Bouton **« Envoyer »**, icône `Send`.

**Aperçu avant envoi** *(à montrer, c'est un argument)* : le nom du fichier
ou **« Message vocal · N s »**, le champ **« Ajouter un mot
(facultatif)… »**, le bouton **« Retirer la pièce jointe »**.

**Dans le fil :** l'avatar accompagne **chaque prise de parole** ;
**« Répondre »** ; **« Vu par »** sous **vos propres messages seulement** ;
**« Aucun message pour l'instant. »** quand le salon est vide.

### 5.4 Écran D — Annuaire

**« Annuaire »**, **« En ligne »**, **« vous »**, **« Sans nom »**,
**« Écrire en privé »**, **« Personne d'autre n'a encore rejoint ce
salon. »**

Bloc **« Mes appareils »**, avec son explication **« M'envoyer un fichier à
moi-même »**.

Fil privé : **« Privé »**, **« Revenir au salon »**, **« Aucun message dans
cette conversation privée. »**

### 5.5 Écran E — Administration

Entrée : **« Saisissez le PIN administrateur du salon »** + **« Accéder »**.
Puis **quatre onglets** : **« Appareils »**, **« Historique »**,
**« Salons »**, **« Réglages »**.

- **Appareils** — **« Étiquette (ex. Poste 3 — Bureau RH) »**,
  **« Fonction (DRH, DGA…) »**, **« Enregistrer »**, **« Bloquer »** /
  **« Débloquer »**, **« Pseudos utilisés »**, **« Dernière connexion »**,
  **« Places de licence occupées »**, **« Libérer la place »** /
  **« Reprendre la place »**.
- **Historique** — **« Mot-clé… »**, **« Auteur… »**, **« Chercher »**,
  **« Aucun résultat »**, **« Message signé et vérifié »**.
- **Salons** — **« Choisir un salon… »**, **« Ont accès »**, **« Annuaire
  du serveur »**, **« Ajouter »**, **« Retirer »**, **« Personne pour
  l'instant. »**
- **Réglages** — **« Rétention des messages (jours) »**,
  **« Verrouiller »** / **« Déverrouiller »**, **« Changer le PIN
  administrateur »**.

### 5.6 Écran F — Page mobile

En-tête, sélecteur **« Salon »**, pseudo, code d'accès, **« Rejoindre »**.
Les **quatre mêmes étiquettes** qu'au poste. Sous 400 px de large, le
bouton d'envoi devient **une flèche** — c'est le rendu normal, pas un
défaut : montrez-le tel quel.

### 5.7 Écran G — Console de recherche *(hors messagerie)*

Cet écran n'appartient pas au module de messagerie, mais il apparaît dès
qu'on montre le navigateur. Il a été **omis d'une reconstitution
précédente** faute d'être décrit ici. Source : `app/page.tsx`.

De gauche à droite, la ligne de recherche « Algérie » :

1. **Champ de recherche**, avec son indication.
2. Bouton de recherche principal — style `glass-btn-primary`.
3. **Bouton « Achat »** — style `glass-btn-amber`, donc **ambre, pas
   vert** : c'est le seul bouton de cette teinte, et sa couleur fait partie
   de son identité.

Le bouton **Achat** se compose de deux éléments, dans cet ordre :

| Élément | Valeur exacte |
|---|---|
| Icône | **`ShoppingCart` (lucide)**, taille 18, **blanche** — elle suit la couleur du texte |
| Libellé `fr` | **« Achat »** |
| Libellé `en` | **« Buy »** |
| Libellé `ar` | **« بحث للتسوّق »** |

Il ouvre un onglet sur la boutique Hnaya, en y reportant la recherche
saisie. Le tutoriel intégré au produit le décrit ainsi : *« Ce bouton lance
votre recherche sur Hnaya Market et affiche directement les résultats d'une
sélection de sites e-commerce algériens connus et fiables. »*

> **Corrigé le 04/09/2026 — ce point avait fait échouer une
> reconstitution.** L'icône était `public/icons/market.png` : un rendu 3D
> brillant de 172 px, **en vert**, réduit à 20 px sur un bouton **ambre**.
> À cette taille il n'en restait qu'une tache, sa couleur jurait avec le
> bouton, et surtout ce n'était **pas un pictogramme de bibliothèque** —
> donc introuvable pour qui le cherchait comme tel. C'est désormais
> `ShoppingCart` de lucide, comme ⬇️ ★ ☆ 📑 🔐 et le drapeau 🇩🇿 avant lui.
> Le fichier PNG reste dans le dépôt mais **n'est plus utilisé** : si vous
> le rencontrez, ignorez-le.
>
> **À ne pas rater** : le libellé arabe n'est pas la traduction littérale
> du français — c'est « recherche pour achat ». Reprenez les trois
> libellés tels quels.

Le sélecteur **Algérie / Monde** et la barre d'adresse complètent l'écran.
Leur inventaire complet est en **§5.8**.

---

### 5.8 Écran H — Barre d'adresse, navigation et onglets *(hors messagerie)*

> **Liste de contrôle.** À l'œil, un bouton manquant ne se voit pas : on
> voit une interface plausible. Cochez donc les trente-quatre entrées
> ci-dessous une par une sur toute reconstitution montrant le navigateur.

#### Barre d'adresse — 12 boutons (`components/urlbar.tsx`)

| # | Icône | Infobulle | Nature de l'icône |
|---|---|---|---|
| 1 | ← | « Page précédente » | SVG **en ligne** (`IconBack`) |
| 2 | → | « Page suivante » | SVG en ligne (`IconForward`) |
| 3 | ↻ | « Actualiser la page » | SVG en ligne (`IconRefresh`) |
| 4 | 🔍 | « Rechercher » | SVG en ligne (`IconSearch`) |
| 5 | `Download` + « Télécharger » | « Télécharger la vidéo de cette page » | lucide |
| 6 | `Star` | « Retirer des favoris » / ajouter | lucide — **deux états par le remplissage**, ambre `#f5c518` quand la page est en favori |
| 7 | `BookMarked` | « Favoris » | lucide |
| 8 | `KeyRound` | « Mots de passe » / « Identifiant enregistré pour ce site » | lucide + pastille `vault-dot` si identifiant connu |
| 9 | **`PenLine`** | **« Annoter la page »** | lucide — **nouveau, 04/09/2026** |
| 10 | `MessageSquare` | « Messagerie locale » | lucide |
| 11 | `Bell` | « Notifications » | lucide |
| 12 | `Shield` | « Confidentialité » | lucide |

Le bouton **9** est nouveau et se place **juste avant** la messagerie :
les deux se suivent dans l'usage — on annote, puis on envoie au collègue.
Toute la barre ne s'affiche que sur une page web ; sur l'accueil, elle
n'existe pas.

**Les entrées 5 à 8 sont celles qui disparaissaient des reconstitutions.**
Leur icône était un **caractère** — ⬇️ ★ ☆ 📑 🔐 — ni composant ni fichier,
donc introuvable pour qui la cherchait comme un pictogramme. Elles sont
passées à `lucide` le 18/08/2026 : elles se traitent désormais comme les
autres. Vérifié à l'écran : `lucide-star`, `lucide-book-marked`,
`lucide-key-round` présents dans la barre d'adresse.

Les boutons 5 à 8 **n'apparaissent qu'une fois un site ouvert** — le
tutoriel du produit le dit lui-même. Sur une page d'accueil vide, leur
absence est normale : ne la reproduisez pas comme si elle était l'état
courant.

#### Barre de navigation — 10 boutons

`components/navbar.tsx` en dessine 6, mais **deux composants en ajoutent
quatre** et sont faciles à oublier : ils ne sont pas dans ce fichier.

| # | Contenu | Infobulle | Fichier |
|---|---|---|---|
| 1 | logo `public/hnaya.png` | — | `navbar.tsx` |
| 2 | libellé du raccourci (ex. **« Hnaya Market »**) | — | idem |
| 3 | `BookOpen` | « Tutoriel » | idem |
| 4 | `MessageSquare` | « Messagerie locale » | idem |
| 5 | `Bell` + pastille du nombre de notifications non lues | « Notifications » | idem |
| 6 | `Shield` | « Confidentialité » | idem |
| 7-9 | **ع · FR · EN** — trois boutons, celui de la langue active surligné par un fond glissant | — | **`lang-switch.tsx`** |
| 10 | icône du **thème courant** | « Thème : *nom du thème* » | **`theme-switch.tsx`** |

##### Le bouton 10 ouvre une liste — surface à part entière

Ce n'est pas une bascule : un clic déroule un menu de **sept entrées**,
chacune précédée d'une **pastille montrant sa couleur réelle**, la ligne
active portant une **coche**.

| Entrée | Icône | Pastille |
|---|---|---|
| Sombre | `Moon` | `#001208` |
| Vert émeraude | `Gem` | `#04261d` |
| Gris | `Circle` | `#17191b` |
| Coucher de soleil | `Sunset` | `#1a0005` |
| Clair | `Sun` | `#f0f7f4` |
| Blanc | `Sun` | `#ffffff` |
| Image personnalisée | `Image` | `#2a2a2a` |

Quand une image de fond est déjà posée, cette dernière ligne porte en plus
un bouton **crayon** (`Pencil`, « Changer l'image »). Le menu **suit le
thème** : fond sombre sur les thèmes sombres, blanc sur les thèmes clairs,
et une variante propre au **coucher de soleil** — ne le dessinez pas
systématiquement sombre.

**Trois détails ajoutés depuis, tous nés d'un défaut réel :**

- **L'icône du bouton déclencheur est blanche à 70 %, posée
  explicitement.** La barre est `bg-black/40` sur tous les thèmes ; un
  pictogramme vectoriel suit `currentColor` et héritait donc d'une teinte
  invisible. **L'icône avait purement disparu sur « coucher de soleil »**.
  L'emoji qui occupait cette place avant avait ses couleurs propres et ne
  posait pas le problème. Ne représentez jamais ce bouton sans son icône.
- **Le contour des pastilles contraste avec le MENU, pas avec la couleur
  montrée.** Sur le menu blanc, un contour blanc faisait disparaître les
  pastilles « Clair » et « Blanc » — les deux seules concernées.
- **Le menu est un vrai menu au sens de l'accessibilité** :
  `aria-haspopup="menu"` sur le bouton, `role="menu"` sur la liste,
  `aria-checked` sur la ligne active — c'est un choix **exclusif**, pas
  une série de cases. Il se parcourt au clavier.

> Le code porte ici une note explicite : *« Icône vectorielle : rendu
> identique sur Windows 10 et 11, contrairement aux emoji »*. Cette barre
> a **déjà** été migrée vers des icônes vectorielles, et la barre
> d'adresse l'a été depuis (18/08/2026), tout comme le bouton « Achat »
> (04/09/2026). **Il ne reste plus aucune icône bitmap ni emoji dans
> l'interface.** Représentez chaque commande telle qu'elle est aujourd'hui.

#### Onglets — 6 boutons (`components/tabbar.tsx`)

Fermer l'onglet (croix) · défilement des onglets (`ChevronLeft` /
`ChevronRight`) · **« Nouvel onglet »** · **« Onglets à droite »**
(`PanelRight`) · **« Onglets en haut »** (`PanelTop`) · nouvel onglet en
liste latérale.

#### Page d'accueil — 6 boutons (`app/page.tsx`)

| # | Contenu | Note |
|---|---|---|
| 1 | **« Algérie »** | sélecteur de portée, état actif visible |
| 2 | **« Monde »** | idem |
| 3 | bouton de recherche Algérie | style `glass-btn-primary` |
| 4 | **`ShoppingCart` + « Achat »** | style `glass-btn-amber` — **ambre**, icône **blanche**, voir §5.7 |
| 5 | bouton de recherche Monde | |
| 6 | `Compass` + « Découvrir » | lucide — **remplace l'émoji drapeau 🇩🇿** depuis le 18/08/2026 |

> **Pourquoi le drapeau a été retiré** : Windows ne rend pas les émojis de
> drapeau — il affichait deux lettres encadrées « DZ ». Le bouton ne
> montrait donc aucun drapeau à personne. Si vous tombez sur une capture
> d'écran antérieure au 18/08/2026, c'est « DZ » que vous y verrez : ne la
> prenez pas pour référence.
>
> De même, toute capture antérieure au **04/09/2026** montre au bouton
> « Achat » une petite image verte brillante au lieu du panier blanc :
> même consigne, ne la prenez pas pour référence.


---

### 5.9 Écran I — Le serveur autonome, qui n'a pas d'écran

> **La question a été posée : « à quoi ressemble une installation de
> hnaya-server ? ». Réponse : à une console, puis à rien.**
>
> **N'INVENTEZ PAS D'INTERFACE GRAPHIQUE POUR LE SERVEUR.** Il n'en a
> aucune. C'est un processus Node qui tourne en service Windows ou en
> unité systemd. Une reconstitution qui lui prête une fenêtre, un tableau
> de bord ou un assistant d'installation montre un produit qui n'existe
> pas.

Le serveur permanent est le module `chat-module` livré **sans le
navigateur** — une organisation n'installe pas un navigateur sur son
serveur. Il se déploie depuis l'archive `hnaya-serveur-<version>.zip` ou
`.tar.gz`, jamais publiée sur GitHub, remise au client avec sa licence.

#### Trois moments, trois écrans de terminal

**1. L'installation.** Une console d'administrateur. Sous Windows, à la
fin d'une installation réussie :

```
✔ Tâche 'HnayaChat' installée et démarrée.
  Données : C:\ProgramData\HnayaChat
  PIN : voir le premier journal (Get-ScheduledTaskInfo HnayaChat) ou la console :
  C:\Program Files\nodejs\node.exe ...
```

Sous Linux :

```
✔ Service hnaya-chat installé et démarré.
  Licence     : /var/lib/hnaya-chat/licence.hnaya-lic
  PIN d'accès : journalctl -u hnaya-chat | grep 'PIN'
```

**2. Le démarrage du serveur.** Toutes les lignes sont préfixées
`[hnaya-serve]` :

```
[hnaya-serve] Licence « Direction des Systèmes d'Information » — 50 appareils, échéance 31/12/2026
[hnaya-serve] Salon permanent "Direction Générale"
[hnaya-serve] Données : /var/lib/hnaya-chat
[hnaya-serve] PIN d'accès (stable) : 483920 — PIN admin : 771205
[hnaya-serve] Postes : découverte automatique ou « Rejoindre par IP » ; mobiles : http://<ip>:4803
```

Quand le serveur porte **plusieurs salons** :

```
[hnaya-serve] 3 salons permanents sur le port 4802
[hnaya-serve] Données : /var/lib/hnaya-chat
[hnaya-serve] Mobiles : http://<ip>:4803 — le salon se choisit sur la page.
[hnaya-serve]   « Direction Générale » — code 483920 — admin 771205
```

**3. Le refus sans licence** — à montrer, c'est le modèle commercial en une
image. Sortie réelle, relevée sur l'archive 0.8.1 :

```
[hnaya-serve] Licence introuvable (/var/lib/hnaya-chat/licence.hnaya-lic).
Le serveur permanent est réservé aux organisations disposant d'une licence
Hnaya DZ. Placez le fichier .hnaya-lic remis à l'installation dans le
répertoire de données, ou indiquez son chemin avec --licence.
Le mode poste (salon créé depuis le navigateur) reste libre et sans licence.
Hnaya DZ — +213558303030 — contact@hnaya.dz
```

#### Puis plus rien — et c'est l'argument

Une fois installé, **le serveur est invisible**. Aucune icône, aucune
fenêtre, aucune barre des tâches. Il redémarre avec la machine. Un
administrateur qui veut le voir consulte le planificateur de tâches
Windows ou `systemctl status hnaya-chat`.

**C'est un point de scénario, pas une lacune** : ce serveur tourne sur une
machine qui n'a ni écran ni utilisateur. Le montrer comme tel — une
console, puis un rack ou un poste éteint dans un local technique — dit
mieux la nature du produit qu'une interface inventée.

#### L'administration se fait depuis le NAVIGATEUR

C'est là que l'interface graphique réapparaît, et c'est un écran déjà
décrit : le **panneau d'administration** de la §5.5. L'administrateur
ouvre Hnaya sur son propre poste, va dans la messagerie, et rejoint le
serveur par **« Rejoindre par IP »** — l'indication exacte est :

> *« Salon introuvable ? Saisissez l'adresse IP du serveur, avec port si
> besoin — ex. 192.168.1.10:4812 (multi-sites, VPN, serveur permanent). »*

Puis il saisit le **PIN admin** relevé dans le journal du serveur, et
retrouve les quatre onglets d'administration.

**Enchaînement à filmer** : console du serveur → PIN lu dans le journal →
le même PIN saisi dans le navigateur d'un poste → le panneau
d'administration s'ouvre. C'est ce plan qui fait comprendre que le serveur
n'a pas besoin d'écran parce que son écran, c'est le navigateur des
administrateurs.

#### Comment filmer un terminal

- Police à chasse fixe, corps généreux — un terminal illisible ne
  s'enseigne pas.
- **Ne composez pas de fausses sorties.** Les blocs ci-dessus sont les
  chaînes réelles du code ; les valeurs (noms d'organisation, PIN,
  chemins) sont des exemples à remplacer, le reste est littéral.
- Le préfixe `[hnaya-serve]` est constant : il ne s'invente pas et ne se
  traduit pas.
- Sources : `chat-module/src/serve.js`,
  `chat-module/service/install-windows.ps1`,
  `chat-module/service/install-linux.sh`. Le guide de déploiement complet
  est `docs/SERVEUR-MESSAGERIE.md`.

---

## 6. Règles de rythme *(défaut 1)*

Elles ne sont pas indicatives.

- **Aucun plan sous 2,5 s.** Un plan d'interface où le spectateur doit lire
  un libellé : **4 s minimum**.
- **Un texte incrusté tient 1 seconde par tranche de trois mots**, plancher
  à 2 s.
- **Nombre minimal de plans par séquence** : la durée cible divisée par 4,
  arrondie au supérieur. Une séquence de 30 s comporte donc **au moins huit
  plans** — sinon la caméra stagne et le montage paraît vide.
- **Un mouvement de curseur qui montre un clic dure au moins 1,2 s** :
  approche, appui, résultat. Un clic instantané ne s'enseigne pas.
- **Après un clic, tenir le résultat 2 s** avant de couper. C'est là qu'est
  la démonstration.
- Les durées de la §7 sont des **planchers**. Dépasser de 20 % est bon ;
  descendre en dessous est un défaut de production.

---

## 7. Découpage — cinq capsules

Le découpage n'est plus une suite de séquences interchangeables : il est
organisé en **cinq capsules**, chacune **autonome** et adressée à un
**public différent**. Une capsule se diffuse seule, sans les autres, et se
comprend sans les avoir vues.

| Capsule | Public | Durée | Ce qu'elle doit obtenir |
|---|---|---|---|
| **1. Découvrir** | direction, décideur | ~1 min | comprendre que rien ne sort du réseau |
| **2. Le salon et le mobile** | tout utilisateur | ~2 min | savoir s'en servir dès le lendemain |
| **3. Décider dans le fil** | direction, encadrement | ~1 min 15 | voir la trace d'une décision |
| **4. Serveur permanent et licence** | **administrateur informatique** | ~3 min | savoir l'installer et l'exploiter |
| **5. Annoter une page, l'envoyer** | tout utilisateur | ~1 min 15 | montrer une page à un collègue sans la décrire |

> **La capsule 4 ne s'adresse pas au même monde que les trois autres.**
> Elle parle à quelqu'un qui installe et exploite, pas à quelqu'un qui
> achète. Son registre change : pas d'argument de vente, pas de superlatif,
> des chemins, des versions, des ports. Un administrateur qui entend un
> discours commercial se méfie du produit.

Les durées restent des **planchers** (§6), et le nombre minimal de plans
s'applique séquence par séquence.

---

## Capsule 1 — Découvrir · ~1 min · direction

### 1.1 — « Vos messages ne sortent pas d'ici » · 30 s · ≥ 8 plans

**À l'image** : un plan d'étage ou un immeuble stylisé, trois bureaux, un
trait vert qui relie les postes entre eux. Le trait ne franchit jamais les
murs du bâtiment. Au-dehors, rien.

**Narration** : « Les échanges de votre organisation restent sur votre
réseau. Pas de serveur distant. Pas de compte à créer. Rien qui transite
par Internet. »

**À éviter** : la tentation du cadenas. Ce qui protège ici, c'est
l'absence de sortie, pas un symbole apposé.

### 1.2 — Votre identité, une fois pour toutes · 25 s · ≥ 7 plans

Une simplification voulue, et qui se voit mal si on ne la montre pas : le
pseudo **ne se ressaisit pas à chaque connexion**. On le change comme on
change un mot de passe — et c'est au même endroit qu'on pose sa photo.

**À l'image** : écran A, le bloc **« Vous êtes »** *pseudo* et son bouton
**« Modifier »**. Déplié : le champ **« Votre pseudo »**
(*« ex. Directeur RH »*), le bouton **« Ma photo »**, le choix d'une image,
la pastille qui se remplit, puis **« OK »**. Enchaîner sur le fil, où
l'avatar accompagne **chaque prise de parole** — et montrer, à côté, un
interlocuteur sans photo : `ChatAvatar` affiche alors ses **initiales
colorées**, stables et distinctives.

**Narration** : « Votre pseudo se saisit une fois. On ne le retape pas à
chaque connexion : on le modifie comme un mot de passe, depuis le même bloc
où l'on ajoute sa photo. Dans le fil, chaque prise de parole porte son
visage — ou ses initiales. »

**Exactitude à respecter** : une photo posée hors d'un salon n'apparaît pas
instantanément dans un fil. Le produit l'annonce lui-même — **« sera
appliquée en entrant dans un salon »**. Ne montez pas une photo qui
surgirait dans une conversation à laquelle on n'est pas connecté.

---

## Capsule 2 — Le salon et le mobile · ~2 min · tout utilisateur

**C'est la capsule de prise en main**, et celle qui sera le plus revue.
Elle doit permettre à quelqu'un qui ne l'a jamais vue de s'en servir le
lendemain. Elle se termine sur le transfert à soi-même, qui est l'argument
que les gens retiennent.

### 2.1 — Ouvrir un salon · 25 s · ≥ 7 plans

**À l'image** : écran A. Le bloc **« Créer un salon »** qu'on déplie — il
est replié au repos —, la saisie du nom, l'apparition du code à six
chiffres sous **« Code PIN à partager »**.

**Narration** : « Un salon s'ouvre en trente secondes depuis le
navigateur. Le code à six chiffres est ce que vous communiquez à vos
collègues — c'est lui, et lui seul, qui donne l'accès. »

**Point à faire passer** : le code n'est pas un mot de passe de compte,
c'est la clé du salon. Il chiffre les échanges.

### 2.2 — Le téléphone, sans installer d'application · 30 s · ≥ 8 plans

**À l'image** : **« Inviter un mobile »**, le QR code, un téléphone qui le
scanne, l'écran F qui s'ouvre. Montrer le sélecteur **« Salon »** quand le
serveur en sert plusieurs, puis le pseudo et le code.

**Narration** : « Les téléphones rejoignent le même salon par une simple
page web, sur le wifi de l'établissement. Aucune application à installer,
aucun magasin d'applications. »

**Exactitude** : la page mobile est servie sur le port 4803 par défaut. Ne
montrez pas d'URL réelle relevée sur une machine — `http://192.168.1.10:4803`
convient.

### 2.3 — Joindre, dicter, réécouter · 30 s · ≥ 8 plans

**À l'image** : la barre de saisie complète. **« Joindre un fichier »** et
le document qui apparaît en aperçu ; puis **« Enregistrer un message
vocal »**, le bouton devenant **« Arrêter l'enregistrement »**, et surtout
**la réécoute avant envoi** avec **« Ajouter un mot (facultatif)… »** et
**« Retirer la pièce jointe »**.

**Narration** : « Images, documents et messages vocaux, jusqu'à 25 Mio. Un
message vocal se réécoute avant d'être envoyé — on ne s'envoie pas soi-même
par erreur. »

**Le plan à ne pas couper** : l'aperçu avant envoi. C'est ce qui distingue
le produit d'une messagerie où l'on relâche le doigt et où c'est parti.

**À ne pas promettre** : depuis le téléphone, l'enregistrement passe par le
magnétophone de l'appareil, pas par un bouton intégré à la page. La
réécoute avant envoi est une fonction **du poste**.

### 2.4 — S'envoyer un fichier à soi-même · 30 s · ≥ 8 plans

Une fonction que les prospects ne demandent pas et qu'ils retiennent :
faire passer un document de son poste à son téléphone, ou l'inverse, sans
clé USB, sans se l'envoyer par courriel, sans passer par un service
extérieur. C'est un **argument de vente**, à traiter comme tel.

**À l'image** : sur le poste, **« Ajouter mon mobile »** et son QR code ;
le téléphone qui le scanne et rejoint **sous le même pseudo** — c'est le
point à faire voir. Puis l'annuaire, écran D, et le bloc **« Mes
appareils »** avec son explication **« M'envoyer un fichier à moi-même »**.
Un document part du poste ; on bascule sur le téléphone, il est là.

**Narration** : « Votre téléphone se rattache à votre poste : un seul nom,
une seule voix dans un vote. Et vous pouvez vous envoyer un fichier à
vous-même — du poste au téléphone, du téléphone au poste — sans clé USB et
sans qu'il quitte votre réseau. »

**Ce qui rend la démonstration lisible** : montrez le **même pseudo** des
deux côtés de l'écran partagé. Sans cela, le spectateur croit voir deux
personnes échanger, et l'argument tombe.

**À ne pas confondre** : **« Ajouter mon mobile »** rattache *votre* second
appareil à votre identité ; **« Inviter un mobile »** fait entrer *une
autre personne* dans le salon. Deux boutons, deux intentions — la vidéo
doit les distinguer explicitement.

---

## Capsule 3 — Décider dans le fil · ~1 min 15 · direction, encadrement

### 3.1 — Qualifier un message · 40 s · ≥ 10 plans

Le cœur de l'argument institutionnel. Un message n'est pas qu'un texte :
il porte une **étiquette** — Pour info, Avis, Validation, Approbation — et
peut désigner **un destinataire précis**.

**À l'image** : les quatre étiquettes de la barre de saisie, le choix de
**« Validation »**, la liste de destinataires quittant **« Sans
destinataire précis »** pour une personne. Puis la carte
(`ChatDemandeCard`) dans le fil, et la décision : **« Validé »**,
**« Refusé »** ou **« Réserves »**, avec son auteur et l'heure.

**Narration** : « Une demande de validation n'est pas un message parmi
d'autres. Elle désigne qui doit se prononcer, et la décision reste attachée
à la demande — signée, datée, sans confusion possible sur son auteur. »

**Détail à ne pas rater** : la décision est **signée
cryptographiquement**. C'est ce qui la distingue d'un simple « ok » dans un
fil de discussion. Une pièce jointe — un rapport, un tableur — peut
accompagner la demande.

### 3.2 — La réunion qui se rappelle à vous · 35 s · ≥ 9 plans

**À l'image** : **« Annoncer une réunion »**, les champs **« Objet de la
réunion »**, **« Lieu (facultatif) »**, **« Durée en minutes »**, le bouton
**« Annoncer »**. Puis la pastille épinglée (`ChatMeetingChip`) et son
compte à rebours, la notification Windows quinze minutes avant, et
**« Ajouter à mon agenda »**. Enchaîner sur **« Décaler »** : la nouvelle
heure s'affiche, **« Était prévue le »** reste lisible en dessous.

**Narration** : « La réunion s'épingle en tête du salon avec son compte à
rebours, et prévient chacun quinze minutes avant — même navigateur fermé.
Si elle se déplace, ce qui avait été convoqué reste lisible : on voit la
nouvelle heure, l'ancienne, et qui a décidé du changement. »

**Pourquoi c'est important** : dans une administration, la trace du report
vaut autant que le report.

---

## Capsule 4 — Serveur permanent et licence · ~3 min · administrateur informatique

> **Changement de public, changement de registre.** Cette capsule se
> diffuse seule, à un service informatique, sans que les trois autres aient
> été vues. Elle ne vend rien : elle informe quelqu'un qui va installer,
> exploiter et sauvegarder. Bannissez « simple », « puissant », « en un
> clic ». Donnez des versions, des ports, des chemins.
>
> **La source de vérité de cette capsule est
> [`SERVEUR-MESSAGERIE.md`](SERVEUR-MESSAGERIE.md)** — n'inventez aucune
> valeur, tout y est relevé dans le code.

### 4.1 — Ce que le serveur apporte, et ce qu'il n'apporte pas · 35 s · ≥ 9 plans

**À l'image** : un poste de travail qui s'éteint, le salon devenu
injoignable ; puis le même poste rallumé et **« Rouvrir un salon de ce
poste »** qui rend l'historique intact. Enchaîner sur une machine serveur
qui, elle, ne s'éteint pas.

**Narration** : « Sans serveur, un salon vit dans le navigateur de celui
qui l'héberge. Sa machine éteinte, le salon devient injoignable — mais rien
n'est perdu : l'historique est conservé sur le disque et revient à la
réouverture. Ce que le serveur apporte, c'est la disponibilité : le salon
reste joignable la nuit, le week-end, et quand la personne qui l'avait
ouvert n'est plus là. »

> ⚠️ **Ne dites jamais que l'historique est perdu quand le poste s'éteint.**
> C'est faux : la base est un fichier SQLite conservé sur la machine hôte,
> et seule une suppression explicite la détruit. Un argument de vente faux
> se retourne à la première démonstration client.

### 4.2 — Deux façons d'installer, selon qui vous êtes · 30 s · ≥ 8 plans

**Le plan le plus utile de toute la capsule** : montrer que le choix
dépend du client, pas d'une préférence technique.

**À l'image** : un écran partagé en deux. À gauche, une PME — la section
**« Serveur permanent »** du navigateur, le fichier de licence choisi, la
confirmation Windows, et c'est fini. À droite, un service informatique —
un terminal, `node --version`, puis l'archive décompressée.

**Narration** : « Deux chemins, deux situations. Une petite structure
installe le serveur depuis le navigateur lui-même : rien d'autre à
installer, le navigateur sert de moteur, et le poste toujours allumé
devient le serveur. Une organisation qui possède un vrai serveur, Windows
ou Linux, y dépose le module seul — sept cents kilo-octets, sans
navigateur. »

> ⚠️ **À dire explicitement, et ne pas laisser deviner** : on choisit
> **l'un ou l'autre**, jamais les deux sur la même machine. Les deux
> services écouteraient les mêmes ports et tiendraient deux historiques
> séparés. Le programme d'installation du module refuse d'ailleurs de
> s'exécuter s'il détecte celui du navigateur.

### 4.3 — Le module autonome : mise en service · 35 s · ≥ 9 plans

> ⚠️ **Lisez la §5.9 avant de dessiner quoi que ce soit ici.** Le serveur
> n'a **aucune interface graphique** : cette séquence se filme en
> terminal, et les sorties exactes y sont relevées. N'inventez ni fenêtre,
> ni assistant d'installation, ni tableau de bord.

**À l'image** : `node --version` d'abord — c'est le premier geste. Puis
les deux systèmes côte à côte : sous Windows la commande PowerShell
administrateur et la tâche planifiée `HnayaChatServer` créée ; sous Linux
`sh install-linux.sh` et `systemctl status hnaya-chat` au vert.

**Narration** : « Le module est un service de sept cents kilo-octets, avec
une seule dépendance et aucune compilation. Node 22.5 ou plus est requis —
le programme d'installation le vérifie et refuse d'aller plus loin sinon.
Il place la licence, crée le service, et le salon démarre avec la
machine. »

**Chiffres exacts, à ne pas arrondir** : 705 Ko, une dépendance (`ws`),
Node **22.5+**, ports **4802** (WebSocket) et **4803** (page mobile).

**Le plan qui rend service** : montrer le **refus** sur une version trop
ancienne, avec son message et le lien de téléchargement. Un administrateur
retient mieux l'erreur qu'il évitera que la réussite qu'il attend.

### 4.4 — La licence : ce qu'elle fait, ce qu'elle ne fait pas · 35 s · ≥ 9 plans

**À l'image** : le fichier `licence.hnaya-lic` déposé dans le répertoire de
données ; puis le tableau des états, animé état par état.

**Narration** : « La licence fixe un plafond d'appareils et une échéance.
À l'approche du terme, un avis s'affiche — rien n'est bloqué. Passé le
terme, trente jours de grâce pendant lesquels tout continue. Ensuite, le
salon passe en lecture seule : l'historique reste consultable, rien n'est
effacé. Le mode poste, lui, reste libre et sans licence. »

**Les quatre points à faire tenir à l'image :**

1. le plafond d'appareils est compté **une seule fois** pour tous les
   salons du serveur ;
2. une place se libère quand un poste est remplacé — **« Libérer la
   place »** ;
3. une licence échue **n'efface jamais rien** ;
4. seule une licence **illisible ou mal signée** empêche le démarrage.

**À ne pas omettre** : le mode poste — un salon créé depuis le navigateur —
ne demande aucune licence. Le taire ferait croire à un produit entièrement
payant.

### 4.5 — Plusieurs salons, un annuaire, une sauvegarde · 40 s · ≥ 10 plans

**À l'image** : un serveur et trois salons qui en partent — Salon général,
Direction, DRH. Un message écrit à la Direction qui **n'apparaît pas** dans
la DRH. Puis l'onglet **« Salons »** de l'administration, avec **« Annuaire
du serveur »**, **« Ont accès »**, **« Ajouter »**. Terminer sur la
sauvegarde : le service arrêté, le répertoire de données archivé, le
service relancé.

**Narration** : « Un seul service, plusieurs salons cloisonnés derrière une
seule adresse. Ce qui se dit à la Direction ne parvient pas à la DRH : le
code d'accès de chaque salon est aussi sa clé de chiffrement, le
cloisonnement n'est pas un filtrage. L'administrateur compose chaque salon
depuis l'annuaire, avant même que ses membres s'y connectent. Et tout ce
qu'il faut sauvegarder tient dans un seul répertoire. »

**Précision technique à ne pas escamoter** : la sauvegarde se fait
**service arrêté**. La base est en mode WAL — copier le seul fichier `.db`
à chaud, sans ses fichiers `-wal` et `-shm`, donne une sauvegarde tronquée.

**Nuance à ne pas écraser** : affecter quelqu'un à un salon ne lui en ouvre
pas la porte. Il lui faut aussi le code de ce salon.

**Clore la capsule 4 sur** : l'adresse de contact pour la licence,
**+213 558 303 030** et **contact@hnaya.dz**, sans slogan.

---

## Capsule 5 — Annoter une page, l'envoyer · ~1 min 15 · tout utilisateur

*Ajoutée le 04/09/2026, pour les fonctions livrées en 0.8.0.*

**Le problème que cette capsule résout, et qu'il faut montrer avant la
solution** : décrire une page à un collègue par écrit prend trois phrases
et se comprend mal. « Le bouton en bas à droite, non, l'autre, celui sous
le tableau. » C'est ce moment-là qu'il faut mettre à l'image en ouverture
— pas l'outil.

**Ce qui n'est pas à dire** : ne présentez pas ces fonctions comme une
suite bureautique ni comme un concurrent d'un lecteur de PDF. Ce sont deux
gestes courts, à l'intérieur du navigateur.

### 5.1 — Entourer, et envoyer · 40 s · ≥ 10 plans

**À l'image** : une page web ouverte. Le bouton **`PenLine`** de la barre
d'adresse (le 9ᵉ, **juste avant** la messagerie). La page **se fige** et la
surface d'annotation s'ouvre en plein écran. Une flèche tracée vers un
élément, un rectangle, un mot écrit avec l'outil **Texte**. Puis
**« Envoyer »**, et le dock de messagerie qui s'ouvre avec l'image déjà
attachée, prête à partir.

**Narration** : « Vous entourez ce dont vous parlez, et vous l'envoyez à
votre collègue. Il reçoit l'image dans le salon, comme une pièce jointe
ordinaire — sur votre réseau, comme le reste. »

**Exactitudes à respecter, chacune vérifiée dans le produit :**

- La barre d'outils comporte **six outils, dans cet ordre** : crayon,
  flèche, rectangle, ellipse, texte, **caviardage** — puis six couleurs,
  trois épaisseurs, annuler, tout effacer, et enfin **« Enregistrer »** et
  **« Envoyer »**.
- **Le bouton « Envoyer » est indisponible tant qu'aucun salon n'est
  rejoint**, et une note ambre dit pourquoi. Si votre plan montre
  « Envoyer » actif, le salon doit être ouvert à l'image. **« Enregistrer »
  reste toujours disponible** : annoter puis garder l'image est un usage
  complet à lui seul.
- C'est une **capture figée**, pas un calque sur la page vivante. Ne
  montrez pas la page qui continue de défiler sous les annotations.
- L'annotation part comme **pièce jointe image ordinaire**. Le
  destinataire n'a besoin d'aucune version particulière : un poste resté
  en 0.7.7 la reçoit et l'ouvre normalement.

### 5.2 — Le caviardage, et la page en PDF · 35 s · ≥ 9 plans

**À l'image** : l'outil **caviardage** passé sur un nom ou un montant, et
la zone qui devient illisible. Puis, dans le composeur, le bouton
**`FileText`** à côté du trombone : la page part **en PDF**, texte
sélectionnable, et la pièce jointe apparaît avec son nom et son poids.

**Narration** : « Un nom, un montant, une adresse : vous les masquez avant
d'envoyer. Et si c'est la page entière qui doit être archivée, elle part en
PDF, avec son texte, prête à être classée. »

**Exactitudes à respecter :**

- **Le caviardage détruit les pixels, il ne les recouvre pas.** C'est
  l'argument, et il est vrai : le destinataire ne peut pas les retrouver.
  Dites-le.
- **Le caviardage prime sur ce qui est dessous** : posé sur une annotation
  antérieure, il l'efface. C'est voulu.
- Le bouton PDF du composeur **n'existe que si un onglet web est ouvert**.
- Le PDF est celui de la page **telle qu'elle s'imprime** (`@media print`)
  — barres de navigation masquées, contenu déplié sur plusieurs pages. Ce
  n'est pas la capture annotée, qui montre la page **telle qu'on la voit**.
  **Les deux sorties sont complémentaires** : ne les présentez pas comme
  deux façons de faire la même chose.
- Le même document s'obtient aussi hors messagerie : **clic droit dans la
  page → « Enregistrer la page en PDF »**.

**Clore la capsule 5 sur** : l'image annotée reçue dans le fil, côté
destinataire. Pas sur l'outil.

**Clore la série sur** : le logo, et une phrase unique. « Hnaya — votre
messagerie reste chez vous. »

---

## 8. Ce qui ne doit JAMAIS apparaître à l'image

Règle absolue, sans exception. Ces éléments viennent des essais de
développement et n'ont rien à faire dans un support diffusé :

- **aucun code d'accès ni code administrateur réel** — inventez-en, ou
  floutez. Les codes visibles à l'écran pendant les essais sont de vrais
  codes ;
- **aucune adresse IP privée relevée sur une machine réelle**. Si une
  adresse doit figurer, utilisez `192.168.1.10`, valeur d'exemple neutre ;
- **aucun nom de personne réel** — ni celui du développeur, ni ceux des
  essais. Employez des fonctions : Directeur, Directrice des ressources
  humaines, Chef de service ;
- **aucun nom d'appareil, de machine ou de salon capté pendant les tests** ;
- **aucun fichier de licence, aucune clé**.

Pour peupler les écrans, servez-vous du jeu de démonstration prévu pour
cela : `chat-module/tools/demo.mjs` *(présent, vérifié)*. Il écrit dans un
répertoire dédié et ne touche à aucune donnée réelle.

**À l'inverse, une chose ne doit jamais être masquée : le nom du salon.**
Il est affirmé dans le bandeau *et* dans le champ de saisie, délibérément.
Un cadrage qui le recouvre trahit une fonction de confidentialité :
se tromper de salon, c'est adresser un document à la mauvaise direction.

---

## 9. Ce qu'il ne faut pas promettre

Le produit a des limites assumées, et une vidéo qui les masque prépare une
déception à la démonstration client :

- **pas de notifications sur téléphone verrouillé** : la page mobile doit
  rester ouverte pour recevoir ;
- **pas de synchronisation d'agenda** : le fichier `.ics` ajoute un
  rendez-vous, il ne tient rien à jour ensuite ;
- **pas d'accès hors du réseau local** : c'est le principe, pas un manque —
  mais ne laissez pas croire qu'on lit ses messages depuis chez soi ;
- **l'enregistrement vocal depuis le téléphone** passe par le magnétophone
  de l'appareil, pas par un bouton d'enregistrement intégré à la page. Sur
  le poste, en revanche, l'enregistrement se fait sur place avec réécoute
  avant envoi ;
- **le serveur permanent est Windows uniquement** pour le moment — le
  produit le dit lui-même : *« Disponible sur Windows uniquement pour le
  moment. »*

---

## 10. Où capturer, où vérifier

| Ce qu'il faut | Où le prendre |
|---|---|
| Interface poste | L'application, panneau latéral de messagerie |
| Anatomie des commandes | Les quinze composants de la §5.0 |
| Interface mobile | `chat-module/mobile/index.html`, port 4803 |
| Logo, toutes tailles | `public/icons/icon.ico` |
| Écrans peuplés sans données réelles | `chat-module/tools/demo.mjs` |
| Textes exacts, 3 langues | `locales/{fr,en,ar}.json`, sections `Chat` (268 clés) et `Annotation` (23 clés) |

Capturez en 1920×1080, thème sombre, langue française d'abord ; les
versions arabe et anglaise se déclinent ensuite depuis le même découpage,
en tenant compte du sens de lecture pour l'arabe.

**Contrôle avant livraison** — trois questions, dans cet ordre :

1. Chaque écran reconstitué porte-t-il **toutes** les commandes de la §5 —
   **y compris les 34 boutons hors messagerie des §5.7 et §5.8, et le
   caractère SANS INTERFACE du serveur autonome (§5.9)** ?
2. Chaque séquence atteint-elle son **nombre minimal de plans** (§6) ?
3. Chaque texte affiché existe-t-il dans `locales/fr.json` **ou dans
   `app/page.tsx`** ?
4. Les icônes qui sont des **fichiers image** — `hnaya.png`, les SVG de
   navigation — sont-elles reprises telles quelles, et non redessinées ni
   remplacées par un pictogramme approchant ? *(`market.png` ne figure plus
   dans cette liste : le bouton « Achat » porte désormais un pictogramme
   lucide — voir §5.7.)*

Une réponse négative à l'une des quatre se corrige avant montage.

---

## 11. Où vit ce dossier

```
docs\MESSAGERIE-TUTORIEL-VIDEO.md   ← ce document
docs\MESSAGERIE-GUIDE.md            ← le guide d'utilisation
docs\PRODUIT.md                     ← la fiche produit, pour le ton et les arguments
locales\                            ← les textes de l'interface, 3 langues
components\Chat*.tsx                ← les composants de la messagerie
components\Annotation*.tsx          ← la surface d'annotation (capsule 5)
public\icons\icon.ico               ← le logo, 7 tailles de 16 à 256
app\page.tsx                       ← la console de recherche et SES libellés
chat-module\mobile\                 ← l'interface téléphone
chat-module\tools\demo.mjs          ← le jeu de démonstration
```

Le dossier à confier à Claude Design est `C:\Users\pc\browser` ; tous les
chemins ci-dessus en sont relatifs. Les documents Markdown suffisent à
écrire le scénario ; **les composants `components\Chat*.tsx` sont
indispensables** dès qu'il s'agit de reconstituer un écran.
