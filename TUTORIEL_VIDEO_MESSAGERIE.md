# Messagerie locale Hnaya — dossier de production du tutoriel vidéo

**À l'usage de Claude Design.** Ce document n'est pas un guide
d'utilisation : c'est le dossier de tournage. Le guide, lui, est
[GUIDE_MESSAGERIE.md](GUIDE_MESSAGERIE.md) — il dit *ce que fait* le
produit ; celui-ci dit *ce qu'il faut montrer, dans quel ordre, et avec
quels mots*.

Tout ce qui suit — libellés, couleurs, chemins — est relevé dans le code,
pas reconstitué de mémoire. Si une divergence apparaît à l'écran, c'est le
produit qui fait foi : signalez-la plutôt que de l'aligner sur ce document.

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

**Langues** : français, arabe, anglais. **L'arabe est en écriture de droite
à gauche** — l'interface bascule entièrement, y compris l'alignement des
messages et la position des boutons. Une version arabe qui garderait la
mise en page latine serait perçue comme un placage.

**Durée visée** : trois à quatre minutes pour la vidéo complète, ou une
série de capsules d'une minute par thème (voir §6).

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

**Logo** : le fennec à la loupe, `public/icons/icon.ico` — sept tailles de
16 à 256 px. Pour une animation, partez du 256.

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

---

## 5. Ce qui ne doit JAMAIS apparaître à l'image

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
cela : `chat-module/tools/demo.mjs`. Il écrit dans un répertoire dédié et
ne touche à aucune donnée réelle.

---

## 6. Découpage — sept séquences

Chacune se tient seule : elles peuvent devenir sept capsules d'une minute,
ou s'enchaîner en une vidéo unique. La durée indiquée est celle du montage
final, narration comprise.

---

### Séquence 1 — « Vos messages ne sortent pas d'ici » · 30 s

**À l'image** : un plan d'étage ou un immeuble stylisé, trois bureaux, un
trait vert qui relie les postes entre eux. Le trait ne franchit jamais les
murs du bâtiment. Au-dehors, rien.

**Narration** : « Les échanges de votre organisation restent sur votre
réseau. Pas de serveur distant. Pas de compte à créer. Rien qui transite
par Internet. »

**À éviter** : la tentation du cadenas. Ce qui protège ici, c'est
l'absence de sortie, pas un symbole apposé.

---

### Séquence 2 — Ouvrir un salon en trente secondes · 25 s

**À l'image** : capture réelle du dock. Bouton **Créer un salon**, saisie
d'un nom, apparition du code d'accès à six chiffres.

**Narration** : « Un salon s'ouvre en trente secondes depuis le
navigateur. Le code à six chiffres est ce que vous communiquez à vos
collègues — c'est lui, et lui seul, qui donne l'accès. »

**Point à faire passer** : le code n'est pas un mot de passe de compte,
c'est la clé du salon. Il chiffre les échanges.

---

### Séquence 3 — Le téléphone, sans installer d'application · 30 s

**À l'image** : un QR code à l'écran du poste, un téléphone qui le scanne,
la page mobile qui s'ouvre. Montrer le champ **Salon** quand le serveur en
sert plusieurs, puis le pseudo et le code.

**Narration** : « Les téléphones rejoignent le même salon par une simple
page web, sur le wifi de l'établissement. Aucune application à installer,
aucun magasin d'applications. »

**Exactitude** : la page mobile est servie sur le port 4803 par défaut. Ne
montrez pas d'URL réelle relevée sur une machine — `http://192.168.1.10:4803`
convient.

---

### Séquence 4 — Qualifier un message · 40 s

Le cœur de l'argument institutionnel. Un message n'est pas qu'un texte :
il porte une **étiquette** — Pour info, Avis, Validation, Approbation — et
peut désigner **un destinataire précis**.

**À l'image** : un message étiqueté « Validation », adressé au Directeur.
Sa carte, dans le fil. Puis la décision du Directeur : Validé, avec son
nom et l'heure, inscrits sous la demande.

**Narration** : « Une demande de validation n'est pas un message parmi
d'autres. Elle désigne qui doit se prononcer, et la décision reste attachée
à la demande — signée, datée, sans confusion possible sur son auteur. »

**Détail à ne pas rater** : la décision est **signée
cryptographiquement**. C'est ce qui la distingue d'un simple « ok » dans un
fil de discussion. Une pièce jointe — un rapport, un tableur — peut
accompagner la demande.

---

### Séquence 5 — La réunion qui se rappelle à vous · 35 s

**À l'image** : annonce d'une réunion, la pastille épinglée en tête du fil
avec son compte à rebours, puis la notification Windows quinze minutes
avant. Enchaîner sur **Décaler** : la nouvelle heure s'affiche, l'ancienne
reste barrée en dessous.

**Narration** : « La réunion s'épingle en tête du salon avec son compte à
rebours, et prévient chacun quinze minutes avant — même navigateur fermé.
Si elle se déplace, ce qui avait été convoqué reste lisible : on voit la
nouvelle heure, l'ancienne, et qui a décidé du changement. »

**Pourquoi c'est important** : dans une administration, la trace du report
vaut autant que le report.

---

### Séquence 6 — Une direction, un salon · 40 s

**À l'image** : un serveur, et trois salons qui en partent — Salon général,
Direction, DRH. Montrer un message écrit à la Direction qui **n'apparaît
pas** dans la DRH. Puis l'onglet **Salons** de l'administration, où l'on
compose l'accès depuis l'annuaire.

**Narration** : « Un seul serveur, plusieurs salons cloisonnés. Ce qui se
dit à la Direction ne parvient pas à la DRH — historiques séparés, codes
séparés, annuaires séparés. L'administrateur compose chaque salon depuis
l'annuaire, avant même que ses membres s'y connectent. »

**Nuance à ne pas écraser** : affecter quelqu'un à un salon ne lui en ouvre
pas la porte. Il lui faut aussi le code de ce salon. Si la séquence doit
choisir, montrez le cloisonnement plutôt que l'affectation — c'est le
message le plus fort.

---

### Séquence 7 — Ce que l'administrateur voit · 30 s

**À l'image** : le panneau d'administration, ses onglets. Registre des
appareils, historique consultable et exportable, durée de conservation,
verrou du salon.

**Narration** : « L'administrateur dispose du registre des appareils, de
l'historique complet — recherchable et exportable — et de la durée de
conservation. Il peut verrouiller le salon : plus aucun appareil nouveau
n'entre, même avec le bon code. »

**Clore sur** : le logo, et une phrase unique. « Hnaya — votre messagerie
reste chez vous. »

---

## 7. Où capturer les écrans

| Ce qu'il faut | Où le prendre |
|---|---|
| Interface poste (dock) | L'application, panneau latéral de messagerie |
| Interface mobile | `chat-module/mobile/index.html`, servie sur le port 4803 |
| Logo, toutes tailles | `public/icons/icon.ico` |
| Écrans peuplés sans données réelles | `chat-module/tools/demo.mjs` |
| Textes exacts, 3 langues | `locales/fr.json`, `locales/en.json`, `locales/ar.json`, section `Chat` |

Pour un rendu propre, capturez la fenêtre en 1920×1080, thème sombre,
langue française d'abord — les versions arabe et anglaise se déclinent
ensuite depuis le même découpage, en tenant compte du sens de lecture pour
l'arabe.

---

## 8. Ce qu'il ne faut pas promettre

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
  avant envoi.

---

## 9. Où vit ce dossier

```
C:\Users\pc\browser\TUTORIEL_VIDEO_MESSAGERIE.md   ← ce document
C:\Users\pc\browser\GUIDE_MESSAGERIE.md            ← le guide d'utilisation
C:\Users\pc\browser\locales\                       ← les textes, 3 langues
C:\Users\pc\browser\public\icons\                  ← le logo
C:\Users\pc\browser\chat-module\mobile\            ← l'interface téléphone
C:\Users\pc\browser\chat-module\tools\demo.mjs     ← le jeu de démonstration
```

Le dossier à confier à Claude Design est `C:\Users\pc\browser`. Les deux
documents Markdown suffisent à écrire le scénario ; les autres chemins
servent aux captures et aux vérifications de libellé.
