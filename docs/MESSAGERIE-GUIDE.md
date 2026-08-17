# Messagerie locale Hnaya — guide d'utilisation

Ce guide s'adresse aux **utilisateurs et aux responsables informatiques**
d'un service qui déploie la messagerie locale de Hnaya DZ Browser. Il
décrit ce que fait le produit, comment s'en servir, et — tout aussi
important — **ce qu'il ne fait pas**.

Pour l'architecture interne et les choix techniques, voir
`chat-module/README.md` et `DEV-INVARIANTS.md`, qui s'adressent aux
développeurs.

---

## 1. Le principe en trois phrases

La messagerie fonctionne **sur votre réseau interne**. Aucun message,
aucune pièce jointe, aucune donnée d'annuaire ne sort vers Internet — il
n'y a ni compte, ni serveur d'éditeur, ni sauvegarde distante.

Les échanges sont **chiffrés avec une clé dérivée du code du salon**.
Quelqu'un qui écouterait le réseau sans connaître ce code ne lit rien.

Chaque appareil possède une **identité cryptographique** créée à sa
première utilisation. Les messages, les votes et les validations sont
**signés** : on peut prouver qui a écrit quoi.

> **Ce que cela n'est pas.** Le chiffrement porte sur le transport, pas de
> bout en bout : la machine qui héberge le salon détient l'historique en
> clair. C'est un choix assumé — c'est ce qui permet à un administrateur de
> chercher dans l'historique et de l'exporter, obligations courantes dans
> une administration.

---

## 2. Deux façons de faire tourner un salon

### Le mode poste — pour essayer, ou pour un groupe de travail

N'importe quel poste crée un salon depuis le navigateur. Le salon vit tant
que le navigateur est ouvert. **Gratuit, sans licence.**

1. Ouvrez la messagerie (l'icône en forme de bulle, dans la barre
   d'adresse ou sur l'accueil).
2. Saisissez votre pseudo, nommez le salon, cliquez **Créer un salon**.
3. Deux codes apparaissent : le **code d'accès** à communiquer aux
   participants, et le **code administrateur**, à garder pour vous.

Les autres postes du réseau voient le salon apparaître automatiquement et
n'ont qu'à saisir le code d'accès.

### Le mode serveur permanent — pour un service

Le salon tourne sur une machine toujours allumée, **même sans session
ouverte**, et survit aux redémarrages. C'est la prestation sous licence.
Voir la section 13.

#### Plusieurs salons sur un seul serveur

Un même serveur sert plusieurs salons — Salon général, Direction, DRH —
derrière **une seule adresse** :

```
node src/serve.js --rooms "Salon général,Direction,DRH" --data /var/lib/hnaya
```

Un service à installer, une base à sauvegarder, un annuaire commun, une
seule règle de pare-feu. Chaque salon garde en revanche **son propre code
d'accès** : c'est ce code qui chiffre les échanges, deux salons ne peuvent
donc pas le partager sans cesser d'être cloisonnés.

À la connexion, les postes et les téléphones voient la liste et
choisissent. Le premier salon nommé est le **salon principal** : c'est
celui qu'on rejoint par défaut, et le seul depuis lequel on peut composer
les autres (section 14).

> Au redémarrage, les salons se retrouvent par leur **nom**. Retirer un nom
> de la liste ferme ce salon sans jamais le supprimer : son historique
> revient intact si vous le redemandez plus tard.

---

## 3. Rejoindre depuis un téléphone

La messagerie n'a pas d'application mobile : le téléphone ouvre une **page
web servie par la machine hôte**, sur le réseau interne.

- **Inviter quelqu'un** : bouton *Inviter un téléphone*. La personne
  scanne le QR et choisit son pseudo.
- **Ajouter son propre téléphone** : bouton *Ajouter mon mobile*. Le QR
  contient en plus un **jeton d'appairage signé** par votre poste, ce qui
  rattache le téléphone à **votre** personne.

> **Pourquoi l'appairage compte.** Sans lui, votre téléphone serait une
> personne distincte : deux entrées à votre nom dans l'annuaire, deux voix
> dans un vote, et une validation demandée sur votre poste que vous ne
> pourriez pas signer depuis votre téléphone.

Le jeton **expire en quelques minutes** et ne sert **qu'une fois**. Il ne
suffit d'ailleurs pas : le code du salon reste exigé, et le QR ne le
contient jamais. Tout rattachement est horodaté et attribué dans le
registre de l'administrateur.

> **Limite du canal mobile.** La page doit **rester ouverte** pour recevoir
> les messages. Les notifications d'écran verrouillé sont hors de portée :
> la page est servie en `http` sur une adresse privée, ce qui interdit les
> mécanismes de notification des navigateurs. Le téléphone est un
> complément, pas le canal principal.

---

## 4. Écrire et joindre

- **Message simple** : saisissez et envoyez.
- **Répondre** : le bouton *Répondre* sous un message. La citation est
  couverte par la signature — un « je valide » ne peut pas être déplacé
  sous une autre demande.
- **Pièce jointe** : le trombone. Images, PDF, Word, Excel, PowerPoint,
  OpenDocument, texte, CSV, ZIP, et fichiers audio.
- **Message vocal** : voir la section suivante.

**Limites** : 25 Mo par fichier ; 200 Mo et 60 fichiers par heure et par
appareil. Ces plafonds protègent la machine hôte, qui est souvent un poste
ordinaire.

---

## 5. Les messages vocaux

Dicter est souvent plus rapide qu'écrire, et cela passe mieux ce qu'un
texte rend mal : une nuance, une réserve, une consigne à plusieurs volets.
Sur le terrain — un chantier, un magasin, une tournée — c'est parfois le
seul mode praticable.

### Depuis un poste

Le bouton **microphone**, à gauche de la zone de saisie. On enregistre, on
arrête, et l'aperçu affiche un **lecteur** : on se réécoute avant
d'envoyer, et l'on renonce d'un clic si l'enregistrement est raté. Un
vocal parti ne se rattrape pas.

Le message part ensuite comme pièce jointe et s'écoute d'un clic chez le
destinataire.

### Depuis un téléphone

Le bouton **🎤** ouvre le **magnétophone du téléphone**, pas un
enregistreur maison. On enregistre avec l'application que l'on connaît
déjà, on valide, et le fichier est joint — avec le même **lecteur** que
sur le poste pour se réécouter avant l'envoi.

> **Pourquoi ce détour, et pourquoi il est préférable.** La page mobile est
> servie en `http` sur une adresse privée : le navigateur refuse alors
> l'accès au microphone, comme il refuse la biométrie et les
> notifications. Déléguer au magnétophone du système contourne la
> limitation — et donne au passage une meilleure qualité d'enregistrement,
> la gestion du bruit et de la pause, et une interface que l'utilisateur
> maîtrise déjà.

### Les formats

Passent tels quels : **WebM, OGG, MP3, M4A, WAV** — ce que produisent les
magnétophones d'Android et d'iOS.

Tout autre format — FLAC, AIFF, un conteneur AAC inhabituel — est
**converti automatiquement** par le navigateur, sans aucun logiciel à
installer. Auparavant ces fichiers étaient simplement refusés.

> **Ce qu'il faut savoir sur la conversion.** Elle passe par une lecture en
> temps réel : convertir un enregistrement de trois minutes prend environ
> trois minutes, et une barre de progression le montre. Les formats de la
> liste ci-dessus n'y passent pas et partent instantanément — dans l'usage
> courant, la conversion ne se déclenche jamais.

### Ce que la voix garde de la messagerie écrite

Un message vocal est **signé comme n'importe quel autre**, et l'empreinte
du fichier entre dans le périmètre signé. On peut donc établir qui a dicté
quoi, et l'enregistrement ne peut pas être remplacé après coup sans que la
signature s'en trouve rompue. Une consigne orale devient opposable au même
titre qu'un écrit.

La voix se combine aussi au reste : on peut **citer** un message vocal et
**l'étiqueter** *Pour info* ou *Validation* — une consigne dictée peut donc
appeler une validation signée en retour.

> L'accusé de lecture dit que le message a été **affiché**, pas qu'il a été
> **écouté**. Personne ne peut prouver qu'un enregistrement a réellement
> été entendu, et le guide ne le laissera pas croire.

**Limite** : 25 Mo, soit largement plus d'une heure de parole aux débits
usuels. La durée n'est pas bornée autrement.

---

## 6. Conversations privées

Depuis l'**Annuaire**, cliquez sur une personne pour ouvrir un fil privé.
Aucun code à partager, aucun salon à créer.

Un fil privé n'est lisible que par ses deux participants — le cloisonnement
est appliqué par la machine hôte, pas seulement à l'affichage.

Quand un message privé vous attend, un **bandeau rouge nommant
l'expéditeur** apparaît au-dessus de la zone de saisie, et le compte
s'affiche sur l'icône de messagerie.

---

## 7. L'annuaire

Chaque personne y figure avec :

- son **pseudo** ;
- sa **fonction** dans l'organisation (DRH, DGA…), attribuée par
  l'administrateur — c'est elle qui permet de trouver « le DRH » sans
  connaître son nom ;
- sa **présence** ;
- son **avatar** : ses initiales sur une couleur stable, ou sa photo.

**Déposer sa photo** : bouton *Ma photo*, en tête de l'annuaire. Le fichier
choisi ne part jamais tel quel — il est recadré au carré, réduit et
réencodé, ce qui supprime au passage les métadonnées EXIF, notamment la
position GPS de la prise de vue.

---

## 8. Accusés de lecture

Sous **vos propres** messages s'affiche « Vu par … », avec le nom de chaque
lecteur et l'heure au survol.

Un accusé n'est émis que pour ce qui est **réellement à l'écran** : panneau
ouvert, fil affiché, fenêtre au premier plan. Une personne équipée d'un
téléphone appairé compte pour **un** lecteur.

> Cette fonction indique à un supérieur l'heure exacte à laquelle un
> collaborateur l'a lu. Si votre organisation le juge inopportun, un
> interrupteur par salon peut être ajouté — dites-le.

---

## 9. Qualifier un envoi : pour info, avis, validation, approbation

C'est le cœur de l'usage institutionnel.

Au-dessus de la zone de saisie, quatre étiquettes disent **la nature de
l'envoi**, donc ce que le destinataire doit en faire :

| Étiquette | Ce qu'elle signifie |
|---|---|
| **Pour info** | Aucune réponse attendue |
| **Avis** | Un avis est demandé |
| **Validation** | Une décision formelle est attendue |
| **Approbation** | Un accord hiérarchique est attendu |

Sauf pour *Pour info*, vous pouvez **désigner la personne** dont vous
attendez la réponse. Elle seule pourra alors se prononcer, et sa décision
sera **publique dans le fil** : toute l'équipe voit qui a validé, refusé ou
émis des réserves, et quand.

**Exemple type.** Un chargé de projet joint un rapport, coche *Validation*
et désigne le Directeur. L'équipe suit la demande dans le fil du service ;
seul le Directeur peut trancher ; sa décision s'affiche sous la demande,
avec son nom et l'heure.

Trois issues : **Validé**, **Refusé**, **Réserves**, avec un commentaire
facultatif. On peut revenir sur sa position : la dernière prévaut, et une
personne ne compte que pour une décision même depuis deux appareils.

> **Ce qui rend cela opposable.** L'étiquette et le destinataire sont
> couverts par la signature. On ne peut ni requalifier après coup un
> « pour info » en « approbation », ni rediriger une demande vers
> quelqu'un d'autre. Et lorsque la demande porte une pièce jointe,
> l'empreinte du fichier est elle aussi signée : valider le rapport, c'est
> valider **ces octets-là**, pas un fichier du même nom.

---

## 10. Soumettre au vote

Pour consulter plusieurs personnes à la fois : bouton **Vote**. Trois
options par défaut — Valider, Refuser, Réserves — modifiables.

Le vote est **nominatif par défaut**. Il peut être rendu non nominatif à
l'émission : le décompte reste exact et l'on sait toujours **qui a
répondu**, sans savoir **quoi**. Ce mode est définitif — un bulletin déposé
ne se reprend pas, faute de quoi il faudrait conserver le lien que ce mode
promet de ne pas garder.

Une personne équipée d'un téléphone appairé pèse **une seule voix**.

---

## 11. Annoncer une réunion

Bouton **Réunion** : objet, date et heure, durée, lieu.

La réunion s'**épingle en tête du fil** avec un compte à rebours, jusqu'à
son heure de fin — une réunion en cours reste épinglée, c'est là qu'elle
sert le plus. Ensuite elle redescend dans l'historique.

**Rappel** : une notification Windows apparaît **quinze minutes avant**,
même si le navigateur est en arrière-plan.

**Ajouter à mon agenda** : le bouton produit un fichier `.ics` standard,
qu'Outlook, Thunderbird ou Google Agenda savent ouvrir. Aucun compte,
aucune connexion, aucune configuration. Le fichier est déposé dans
**Documents\Hnaya\Agenda** : si aucune application d'agenda ne s'ouvre —
cela arrive sur les Windows dont Courrier et Calendrier a été retiré — le
fichier reste là, à portée, et un lien vous y conduit.

> Un `.ics` dit « ajoutez ceci à votre agenda » ; il ne synchronise pas.

### Décaler ou annuler

Une réunion se déplace et s'annule — c'est le quotidien d'un service.
**L'organisateur seul** dispose des boutons **Décaler** et **Annuler**, et
il les garde depuis n'importe lequel de ses appareils appairés.

Ce qui avait été convoqué **reste lisible** : la carte affiche la nouvelle
heure, barre l'ancienne, et indique qui a décidé du changement et quand.
Effacer la convocation d'origine priverait le fil de sa trace.

Les rappels suivent : celui de l'ancienne heure est annulé, un nouveau est
programmé. Une réunion annulée ne propose plus d'être ajoutée à un agenda
— on n'inscrit pas un rendez-vous qui n'aura pas lieu.

Passé l'horaire, les boutons disparaissent : pour reprogrammer, annoncez
une nouvelle réunion. L'ancienne demeure dans le fil, avec le fait qu'elle
n'a pas eu lieu.

---

## 12. Être averti

- **Signal sonore** : deux timbres distincts, l'un pour le salon, l'autre —
  plus insistant — pour un message privé. Interrupteur dans la barre
  d'actions, actif par défaut, mémorisé par appareil.
- **Centre de notifications** : l'icône en forme de cloche, dans la barre
  d'adresse et sur l'accueil. On y retrouve ce qui demande une suite : une
  demande qui vous est adressée, une réunion à venir, une licence qui
  arrive à échéance. Les messages ordinaires du salon n'y figurent pas —
  ce serait un second fil illisible.

---

## 13. Le serveur permanent et sa licence

### Installer

Section *Serveur permanent* de l'écran d'accueil de la messagerie :

1. Choisissez le fichier de licence `.hnaya-lic` remis par Hnaya DZ.
2. Fixez le code d'accès du salon et, si vous le souhaitez, le code
   administrateur.
3. Validez l'élévation de privilèges demandée par Windows.

Une tâche planifiée « Au démarrage » est créée. Le salon tourne dès
l'allumage de la machine, **sans qu'une session soit ouverte**.

### Ce que contient une licence

Un organisme, une échéance, un nombre d'**appareils**. La vérification est
entièrement locale : aucune activation, aucun appel à un serveur.

### À l'échéance

| Période | Ce qui se passe |
|---|---|
| Dernier mois avant l'échéance | Avertissement, tout fonctionne |
| 30 jours après l'échéance | Avertissement, tout fonctionne encore |
| Au-delà | **Envoi suspendu**, historique consultable |

Rien n'est jamais effacé, et le serveur ne s'arrête pas : un historique de
service est un document de travail. Déposer un nouveau fichier de licence
rétablit l'écriture **dans l'heure**, sans redémarrer quoi que ce soit.

### Places d'appareils

Un poste réinstallé ou un téléphone remplacé occupait autrefois une place
pour toujours. L'administrateur peut désormais **libérer la place** d'un
appareil qui n'existe plus, depuis le registre. La fiche et les messages
sont conservés ; seule la place est rendue.

Cette action ne s'applique qu'à un appareil **déconnecté** : pour écarter
une personne, c'est *Bloquer*.

**Renouvellement : Hnaya DZ — +213558303030 — contact@hnaya.dz**

---

## 14. Administration

Code administrateur exigé. Quatre onglets :

- **Registre des appareils** — machine, plateforme, adresse, pseudos
  utilisés, appairages. Permet de nommer un appareil, d'attribuer une
  fonction, de bloquer, et de libérer une place de licence.
- **Historique** — recherche par date, auteur, appareil ou mot-clé ; export
  JSON ou CSV.
- **Réglages** — durée de conservation (90 jours par défaut, 0 = illimitée),
  verrouillage du salon, changement du code administrateur.
- **Verrou** — une fois le salon verrouillé, plus aucun nouvel appareil
  n'entre, même avec le bon code. Les membres déjà inscrits circulent
  librement.
- **Salons** — composer l'accès des autres salons. Cet onglet n'apparaît
  que sur le **salon principal** d'un serveur qui en sert plusieurs.

### Composer un salon avant que ses membres s'y connectent

Trois façons de constituer un salon, et vous n'êtes tenu par aucune :

1. **Ouvert** — le code circule, qui l'a entre. Convient au salon général.
2. **Ouvert puis verrouillé** — les bonnes personnes entrent une fois, on
   verrouille. La composition se fait par l'usage.
3. **Composé d'avance** — l'onglet **Salons** permet de désigner les
   membres depuis l'annuaire, avant toute connexion. Le salon naît fermé.

Personne n'a besoin d'une invitation nominative. Il faut seulement s'être
présenté **une fois** : ici une identité est une clé cryptographique
portée par un appareil, pas un nom sur une liste. Le salon général reste
donc ouvert — c'est lui qui remplit l'annuaire — et les salons de service
se composent ensuite à partir de cet annuaire.

> **Affecter n'est pas ouvrir.** Le code d'accès d'un salon est aussi sa
> clé de chiffrement. Inscrire quelqu'un dans la composition de la DRH ne
> lui permet pas d'y lire une seule ligne sans le code de la DRH, que
> détient son administrateur. Deux pouvoirs distincts, volontairement.

Retirer quelqu'un lui ôte l'accès au prochain raccordement, sans toucher à
ce qu'il a écrit : un mouvement de personnel n'est pas une réécriture des
archives.

---

## 15. Limites connues

Elles sont dites ici plutôt que découvertes en usage.

- **Le téléphone doit garder la page ouverte.** Pas de notification écran
  verrouillé.
- **Le chiffrement n'est pas de bout en bout.** La machine hôte détient
  l'historique en clair — c'est ce qui rend possibles la recherche et
  l'export administratifs.
- **Un même réseau est nécessaire.** Rien ne traverse Internet, donc rien
  ne joint un collègue en télétravail sans VPN.
- **Un `.ics` ne synchronise pas** un agenda ; il l'alimente.
- **Un code d'accès qui circule** donne l'entrée à quiconque le connaît,
  jusqu'au verrouillage du salon. Le verrou est l'outil du quotidien ; le
  blocage, celui de l'exception.

---

## 16. En cas de difficulté

| Symptôme | Cause la plus fréquente |
|---|---|
| Le salon n'apparaît pas dans la liste | Pare-feu Windows : utilisez le bouton *Autoriser* proposé par l'application, ou *Rejoindre par IP* |
| Le téléphone n'ouvre pas la page | Téléphone sur un autre réseau (4G au lieu du wifi interne) |
| « Code incorrect » alors que le code est bon | Salon verrouillé, ou appareil bloqué |
| Plus aucun message ne part | Licence échue depuis plus de 30 jours — le bandeau l'indique |
| Un nouvel appareil est refusé | Plafond d'appareils atteint : libérez une place dans le registre |
| Le téléphone apparaît en double dans l'annuaire | Il a rejoint sans jeton d'appairage — refaites *Ajouter mon mobile* |
| Un vocal met longtemps à partir | Format hors liste : il est converti en temps réel. Enregistrez avec le magnétophone du téléphone, dont le format passe directement |
| Le bouton microphone ne fait rien sur le téléphone | Aucun magnétophone n'est installé, ou l'accès au stockage a été refusé |

---

*Hnaya DZ — messagerie locale. Vos données restent chez vous.*
