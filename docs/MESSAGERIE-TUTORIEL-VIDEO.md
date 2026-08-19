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

La première production tirée de ce dossier a échoué sur deux points
précis. Ils sont corrigés ici, et les deux corrections sont **impératives**.

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

**Pourquoi cette omission était prévisible, et comment ne pas la répéter :**
l'interface n'est pas dans un fichier mais dans **treize composants**. Les
boutons *Joindre un fichier* et *Enregistrer un message vocal* ne sont pas
dans `ChatPanel.tsx` — ils vivent dans `ChatComposerMedia.tsx`. Qui n'ouvre
que le panneau principal ne peut pas les voir. La liste des treize est en
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
- pas de personnages qui s'envoient des cœurs ou des émojis. Les émojis ont
  été délibérément écartés du produit comme non conformes à un usage
  professionnel.

---

## 2. Public, ton, langues

**Public** : un directeur, un chef de service, un responsable informatique
d'une administration ou d'une PME. Il n'a pas de temps, il se demande si ça
remplace des courriels internes et si ça sort de son réseau.

**Ton** : sobre, affirmatif, sans superlatif. Registre professionnel
soutenu. Pas de « révolutionnaire », pas de « incroyable ». Une
démonstration vaut mieux qu'une promesse.

**Langues** : français, arabe, anglais. Les trois fichiers de traduction
comportent **exactement 264 clés `Chat.*` chacun** — aucune langue n'est en
retard, vous pouvez produire les trois versions sans arbitrage.

**L'arabe est en écriture de droite à gauche** : l'interface bascule
entièrement, y compris l'alignement des messages et la position des
boutons. Une version arabe qui garderait la mise en page latine serait
perçue comme un placage.

**Durée visée** : trois à quatre minutes pour la vidéo complète, ou huit
capsules autonomes (§7).

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

Les 264 libellés complets sont dans `locales/fr.json`, section `Chat`.
**Aucun texte affiché à l'image ne doit être inventé** : s'il n'est pas
dans ce fichier, il n'existe pas dans le produit.

---

## 5. Anatomie des écrans — la liste des commandes

> **Section normative.** Elle donne, dans l'ordre réel d'affichage, chaque
> commande visible. Une reconstitution qui en omet une est incomplète. Les
> libellés sont donnés entre guillemets ; ce sont exactement ceux du produit.

### 5.0 Les treize composants à ouvrir

Ne travaillez pas depuis le seul `ChatPanel.tsx` : c'est l'erreur qui a
produit une interface amputée.

| Composant | Ce qu'il dessine |
|---|---|
| `ChatPanel.tsx` | le panneau entier, l'accueil, le fil, la barre d'outils |
| `ChatComposerMedia.tsx` | **pièce jointe, micro, aperçu avant envoi** |
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
4. Bouton **« Joindre un fichier »** *(`ChatComposerMedia`)*.
5. Bouton **« Enregistrer un message vocal »**, qui devient **« Arrêter
   l'enregistrement »** pendant la prise *(`ChatComposerMedia`)*.
6. Bouton **« Envoyer »**, icône `Send`.

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

## 7. Découpage — huit séquences

Chacune se tient seule : elles peuvent devenir huit capsules, ou
s'enchaîner en une vidéo unique. La durée indiquée est celle du montage
final, narration comprise, et c'est un **plancher**.

---

### Séquence 1 — « Vos messages ne sortent pas d'ici » · 30 s · ≥ 8 plans

**À l'image** : un plan d'étage ou un immeuble stylisé, trois bureaux, un
trait vert qui relie les postes entre eux. Le trait ne franchit jamais les
murs du bâtiment. Au-dehors, rien.

**Narration** : « Les échanges de votre organisation restent sur votre
réseau. Pas de serveur distant. Pas de compte à créer. Rien qui transite
par Internet. »

**À éviter** : la tentation du cadenas. Ce qui protège ici, c'est
l'absence de sortie, pas un symbole apposé.

---

### Séquence 2 — Ouvrir un salon · 25 s · ≥ 7 plans

**À l'image** : écran A. Le bloc **« Créer un salon »** qu'on déplie — il
est replié au repos —, la saisie du nom, l'apparition du code à six
chiffres sous **« Code PIN à partager »**.

**Narration** : « Un salon s'ouvre en trente secondes depuis le
navigateur. Le code à six chiffres est ce que vous communiquez à vos
collègues — c'est lui, et lui seul, qui donne l'accès. »

**Point à faire passer** : le code n'est pas un mot de passe de compte,
c'est la clé du salon. Il chiffre les échanges.

---

### Séquence 3 — Le téléphone, sans installer d'application · 30 s · ≥ 8 plans

**À l'image** : **« Inviter un mobile »**, le QR code, un téléphone qui le
scanne, l'écran F qui s'ouvre. Montrer le sélecteur **« Salon »** quand le
serveur en sert plusieurs, puis le pseudo et le code.

**Narration** : « Les téléphones rejoignent le même salon par une simple
page web, sur le wifi de l'établissement. Aucune application à installer,
aucun magasin d'applications. »

**Exactitude** : la page mobile est servie sur le port 4803 par défaut. Ne
montrez pas d'URL réelle relevée sur une machine — `http://192.168.1.10:4803`
convient.

---

### Séquence 4 — Qualifier un message · 40 s · ≥ 10 plans

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

---

### Séquence 5 — La réunion qui se rappelle à vous · 35 s · ≥ 9 plans

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

### Séquence 6 — Une direction, un salon · 40 s · ≥ 10 plans

**À l'image** : un serveur, et trois salons qui en partent — Salon général,
Direction, DRH. Montrer un message écrit à la Direction qui **n'apparaît
pas** dans la DRH. Puis l'onglet **« Salons »** de l'administration, avec
**« Annuaire du serveur »**, **« Ont accès »**, **« Ajouter »**.

**Narration** : « Un seul serveur, plusieurs salons cloisonnés. Ce qui se
dit à la Direction ne parvient pas à la DRH — historiques séparés, codes
séparés, annuaires séparés. L'administrateur compose chaque salon depuis
l'annuaire, avant même que ses membres s'y connectent. »

**Nuance à ne pas écraser** : affecter quelqu'un à un salon ne lui en ouvre
pas la porte. Il lui faut aussi le code de ce salon. Si la séquence doit
choisir, montrez le cloisonnement plutôt que l'affectation — c'est le
message le plus fort.

---

### Séquence 7 — Ce que l'administrateur voit · 30 s · ≥ 8 plans

**À l'image** : l'écran E et ses **quatre** onglets. Le registre des
appareils avec **« Étiquette »** et **« Fonction »**, l'historique
recherchable, **« Rétention des messages (jours) »**, et
**« Verrouiller »**.

**Narration** : « L'administrateur dispose du registre des appareils, de
l'historique complet — recherchable et exportable — et de la durée de
conservation. Il peut verrouiller le salon : plus aucun appareil nouveau
n'entre, même avec le bon code. »

---

### Séquence 8 — S'envoyer un fichier à soi-même · 30 s · ≥ 8 plans

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

**Clore sur** : le logo, et une phrase unique. « Hnaya — votre messagerie
reste chez vous. »

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
| Anatomie des commandes | Les treize composants de la §5.0 |
| Interface mobile | `chat-module/mobile/index.html`, port 4803 |
| Logo, toutes tailles | `public/icons/icon.ico` |
| Écrans peuplés sans données réelles | `chat-module/tools/demo.mjs` |
| Textes exacts, 3 langues | `locales/{fr,en,ar}.json`, section `Chat` — 264 clés chacune |

Capturez en 1920×1080, thème sombre, langue française d'abord ; les
versions arabe et anglaise se déclinent ensuite depuis le même découpage,
en tenant compte du sens de lecture pour l'arabe.

**Contrôle avant livraison** — trois questions, dans cet ordre :

1. Chaque écran reconstitué porte-t-il **toutes** les commandes de la §5 ?
2. Chaque séquence atteint-elle son **nombre minimal de plans** (§6) ?
3. Chaque texte affiché existe-t-il dans `locales/fr.json` ?

Une réponse négative à l'une des trois se corrige avant montage.

---

## 11. Où vit ce dossier

```
docs\MESSAGERIE-TUTORIEL-VIDEO.md   ← ce document
docs\MESSAGERIE-GUIDE.md            ← le guide d'utilisation
docs\PRODUIT.md                     ← la fiche produit, pour le ton et les arguments
locales\                            ← les textes de l'interface, 3 langues
components\Chat*.tsx                ← les treize composants de l'interface
public\icons\icon.ico               ← le logo, 7 tailles de 16 à 256
chat-module\mobile\                 ← l'interface téléphone
chat-module\tools\demo.mjs          ← le jeu de démonstration
```

Le dossier à confier à Claude Design est `C:\Users\pc\browser` ; tous les
chemins ci-dessus en sont relatifs. Les documents Markdown suffisent à
écrire le scénario ; **les composants `components\Chat*.tsx` sont
indispensables** dès qu'il s'agit de reconstituer un écran.
