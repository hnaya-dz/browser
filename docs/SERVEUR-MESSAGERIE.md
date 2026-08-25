# Hnaya — Serveur de messagerie

**Fiche d'installation et d'exploitation.** Destinée au service
informatique du client et à l'équipe qui prépare la distribution.

Toutes les valeurs de ce document sont relevées dans le code
(`chat-module/`), pas reconstituées.

---

## 1. Ce que c'est, et ce que ce n'est pas

Le serveur de messagerie Hnaya est un **service Node autonome**. Il
n'embarque **pas le navigateur** : les entreprises n'installent pas un
navigateur sur un serveur, et ce n'est pas nécessaire.

| Fait | Valeur |
|---|---|
| Taille du module | **705 Ko** |
| Dépendance d'exécution | **une seule** — `ws` |
| Dépendance native à compiler | **aucune** |
| Références à Electron | **aucune** |
| Point d'entrée | `src/serve.js` |

Le navigateur Hnaya reste le **client**. Il n'est requis sur aucun poste
pour que le serveur fonctionne : un téléphone sur le wifi interne suffit à
rejoindre un salon, par une simple page web.

### Ce que le serveur change réellement

Sans serveur, un salon vit **dans le navigateur de celui qui l'héberge**.
Sa machine s'éteint, le salon devient injoignable.

> **L'historique n'est pas perdu pour autant.** Il est écrit dans un
> fichier SQLite sur la machine hôte (`hnaya-chat.db`, journalisation WAL).
> À la réouverture du poste, le salon se rouvre avec tout son historique —
> le navigateur propose **« Rouvrir un salon de ce poste »**. Seule une
> suppression explicite détruit les données, et elle est confirmée par un
> avertissement sans ambiguïté : *« Supprimer définitivement ce salon et
> tout son historique ? »*

Ce que le serveur apporte est donc la **disponibilité**, pas la survie des
données : le salon reste joignable la nuit, le week-end, et quand la
personne qui l'avait ouvert est absente ou a quitté l'organisation. S'y
ajoutent plusieurs salons derrière une seule adresse, un annuaire commun,
une seule base à sauvegarder, et la composition d'un salon avant l'arrivée
de ses membres.

---

## 2. Prérequis

| Élément | Exigence |
|---|---|
| **Node.js** | **22.5 ou plus** — impératif, voir l'encadré |
| Système | Windows (tâche planifiée) ou Linux (`systemd`) |
| Port `4802/tcp` | WebSocket — les clients s'y connectent |
| Port `4803/tcp` | page mobile servie sur le réseau interne |
| Licence | fichier `.hnaya-lic` remis par Hnaya DZ |

### Pourquoi Node, et pourquoi cette version

Le serveur Hnaya est écrit pour **Node.js**, le moteur d'exécution qui fait
tourner l'immense majorité des services d'entreprise. Il n'est pas fourni
avec le module : c'est un composant système, qui reçoit ses correctifs de
sécurité par vos canaux habituels — `apt`, `dnf`, votre politique de mise à
jour Windows. Vous gardez ainsi la maîtrise des mises à jour du moteur,
comme pour n'importe quel autre service de votre parc.

**La version 22.5 est un plancher dur, pas une recommandation.** Le
stockage repose sur `node:sqlite`, la base de données intégrée à Node, qui
n'existe qu'à partir de cette version — et le code n'a **aucun repli**. Sur
Node 18 ou 20, encore livrés par défaut sur Debian 12, le service
s'installerait puis s'arrêterait au démarrage sur une erreur peu lisible.

Les scripts d'installation refusent désormais d'aller plus loin dans ce
cas, avec la marche à suivre.

**Vérifier la version en place :**

```bash
node --version
```

**Installer ou mettre à jour Node.js :**

| Système | Où | Comment |
|---|---|---|
| Windows Server | [nodejs.org/en/download](https://nodejs.org/en/download) | installateur `.msi`, version **LTS** |
| Debian, Ubuntu | [github.com/nodesource/distributions](https://github.com/nodesource/distributions) | dépôt `apt` officiel Node |
| RHEL, Rocky, Alma | [github.com/nodesource/distributions](https://github.com/nodesource/distributions) | dépôt `dnf` |
| Autres | [nodejs.org/en/download](https://nodejs.org/en/download) | archives officielles |

Prenez la version **LTS** : elle est au-delà de 22.5 et bénéficie du suivi
de sécurité le plus long. L'installation ne demande aucune configuration —
Node s'ajoute au `PATH`, et c'est tout ce dont le service a besoin.

> Sous Windows, la tâche planifiée s'exécute sous le compte **SYSTEM**. Si
> Node a été installé pour un utilisateur seulement, SYSTEM ne le trouvera
> pas : installez-le pour toute la machine, ou passez le chemin complet au
> script avec `-NodeExe`.

Les deux ports doivent être ouverts **sur le réseau interne uniquement**.
Le produit n'a aucun usage exposé à Internet, et l'exposer contredirait sa
raison d'être.

---

## 3. Installation sous Windows

Le module s'installe en **tâche planifiée exécutée par SYSTEM au
démarrage**, avec redémarrage automatique (3 tentatives, une minute
d'intervalle).

Depuis une invite PowerShell **administrateur**, dans le dossier du
module :

```bash
powershell -ExecutionPolicy Bypass -File service\install-windows.ps1 -Name "Salon Direction" -DataDir "C:\ProgramData\Hnaya\chat"
```

Paramètres : `-Name` (nom du salon), `-DataDir` (répertoire de données),
`-Licence` (chemin du `.hnaya-lic` — facultatif si un seul est déposé à
côté du module), `-NodeExe` si `node` n'est pas dans le `PATH` du compte
SYSTEM, `-TaskName` (défaut `HnayaChatServer`).

Vérifier, puis désinstaller le cas échéant :

```bash
Get-ScheduledTask -TaskName HnayaChatServer
```

```bash
Unregister-ScheduledTask -TaskName HnayaChatServer
```

---

## 4. Installation sous Linux

Le module s'installe en service `systemd`, sous un **compte système sans
shell** (`hnaya-chat`), avec les données dans `/var/lib/hnaya-chat`.

En root :

```bash
sh service/install-linux.sh "Salon Direction" 482017 ./votre-licence.hnaya-lic
```

Le second argument est le code d'accès à six chiffres ; s'il est omis, un
code est généré. Le troisième est la licence — **facultatif si un seul
fichier `.hnaya-lic` est déposé à côté du module**, auquel cas le script le
trouve seul. Le script crée le compte, le répertoire de données,
l'unité `hnaya-chat.service`, puis l'active et la démarre.

```bash
systemctl status hnaya-chat
```

> **Les deux défauts signalés ici sont corrigés depuis le 18/08/2026 :**
>
> 1. ~~Le script ne place pas la licence.~~ **Corrigé** : il la cherche
>    **avant de toucher au système**, la copie dans le répertoire de
>    données sous le nom attendu, et refuse tout net si elle manque plutôt
>    que de laisser une installation à moitié faite.
> 2. ~~La version de Node n'est pas vérifiée.~~ **Corrigé** : les deux
>    scripts refusent une version antérieure à 22.5 et indiquent où
>    télécharger Node.

---

## 5. Mise en place de la licence

Le serveur permanent est réservé aux organisations disposant d'une licence
Hnaya DZ. **Le mode poste — un salon créé depuis le navigateur — reste
libre et sans licence.**

Deux façons de la fournir, au choix :

- **laisser le programme d'installation s'en charger** : déposez le
  `.hnaya-lic` à côté du module avant de lancer le script, il le copie au
  bon endroit avec les bons droits ;
- ou le déposer soi-même sous le nom exact **`licence.hnaya-lic`** dans le
  répertoire de données (`/var/lib/hnaya-chat/licence.hnaya-lic`, ou le
  `-DataDir` choisi sous Windows) ;
- ou indiquer son chemin au démarrage : `--licence /chemin/vers/le.hnaya-lic`.

**Comportement selon l'état de la licence** — à connaître avant d'alarmer
un client :

| État | Conséquence |
|---|---|
| Valide | fonctionnement normal |
| Échéance proche | avis de renouvellement affiché, rien n'est bloqué |
| Échue depuis moins de 30 jours | **période de grâce** : tout continue de fonctionner |
| Échue depuis plus de 30 jours | **lecture seule** — l'historique reste consultable |
| Illisible, incomplète ou mal signée | le serveur **refuse de démarrer** |

Une licence échue n'efface jamais rien et ne ferme jamais l'accès à
l'historique.

La licence fixe aussi un **plafond d'appareils**, compté **une seule fois
pour l'ensemble des salons du serveur**. Une place se libère depuis
l'administration lorsqu'un poste est remplacé (« Libérer la place »).

Licence et renouvellement : **+213 558 303 030** · **contact@hnaya.dz**

---

## 6. Options de démarrage

`src/serve.js` accepte :

| Option | Rôle |
|---|---|
| `--name <nom>` | nom du salon principal |
| `--room <nom>` (répétable) | salons supplémentaires servis par la même instance |
| `--pin <6 chiffres>` | code d'accès ; généré si absent |
| `--admin-pin <6 chiffres>` | code d'administration ; généré si absent |
| `--data <répertoire>` | répertoire de données |
| `--licence <fichier>` | licence hors du répertoire de données |
| `--ws-port <port>` | défaut **4802** |
| `--http-port <port>` | défaut **4803** |

Une seule instance par machine : les deux ports sont fixes par défaut, et
plusieurs salons se servent **derrière la même adresse**, pas en
multipliant les instances. C'est aussi ce qui fait que le plafond de la
licence est compté une fois.

---

## 7. Sauvegarde

Le répertoire de données contient **tout** ce qui doit être sauvegardé :

| Fichier | Contenu | Perte en cas d'absence |
|---|---|---|
| `hnaya-chat.db` | messages, appareils, salons, annuaire | tout l'historique |
| `identity.json` | identité cryptographique du serveur | les clients ne reconnaissent plus le serveur |
| `licence.hnaya-lic` | la licence | le serveur refuse de servir |
| `media/` | pièces jointes et messages vocaux | les fichiers échangés |
| `salon-actif.json` | état publié des salons servis | régénéré, sans conséquence |

**Sauvegardez le service arrêté.** La base est en mode WAL : à chaud,
copier le seul `.db` sans ses fichiers `-wal` et `-shm` donne une sauvegarde
tronquée des écritures les plus récentes.

```bash
systemctl stop hnaya-chat && tar czf hnaya-chat-$(date +%F).tar.gz -C /var/lib hnaya-chat && systemctl start hnaya-chat
```

Restaurer, c'est remettre le répertoire en place, rendre la propriété au
compte de service, puis redémarrer.

---

## 8. Notes d'exploitation

**Le code d'accès apparaît en clair dans les journaux du service** —
`journalctl -u hnaya-chat` sous Linux, `server.log` sous Windows. C'est
d'ailleurs ainsi que le script d'installation invite à le relire. Traitez
donc l'accès aux journaux comme équivalent à l'accès au salon : sur un
serveur partagé, restreignez-le.

**Les codes à six chiffres sont générés cryptographiquement** et le serveur
ferme la connexion après cinq tentatives d'administration erronées. Le
modèle de menace est le réseau interne : pour atteindre un salon, il faut
déjà s'y trouver.

**Le code d'accès est aussi la clé de chiffrement du transport.** Deux
salons ayant des codes différents sont réellement cloisonnés : le
cloisonnement n'est pas un filtrage applicatif.

---

## 9. Ce qui reste à faire pour la distribution

Les trois points de cette liste sont **traités** depuis le 18/08/2026.

1. ~~Un livrable séparé manque.~~ **Fait.** `yarn pack:serveur` produit
   deux archives dans `dist/` :

   | Archive | Taille | Pour |
   |---|---|---|
   | `hnaya-serveur-<version>.zip` | ~206 Ko | serveur Windows |
   | `hnaya-serveur-<version>.tar.gz` | ~181 Ko | serveur Linux |

   Elles contiennent `src/`, `mobile/`, `service/`, `package.json`,
   `README.md` et la seule dépendance `ws` — 41 fichiers. Elles
   **excluent** `data/` (bases d'essai), `test/` et `tools/`, qui contient
   l'outil d'émission des licences. Un contrôle refuse de construire si un
   `.hnaya-lic`, un `.pem` ou une base de données s'y glissait.

   `node scripts/pack-serveur.mjs --lister` montre le contenu sans rien
   écrire.

2. ~~La licence n'est pas placée par `install-linux.sh`.~~ **Corrigé** —
   voir §4. Les deux scripts, Windows et Linux, la placent désormais.

3. ~~Décider du moteur Node.~~ **Décidé** : le client installe **Node
   22.5+** (§2). Le moteur n'est pas embarqué — ses correctifs de sécurité
   restent à la charge du système du client, et non de Hnaya DZ. Le choix
   n'est pas irréversible : produire un exécutable autonome pour un client
   qui interdit l'installation d'un moteur d'exécution ne demanderait
   aucune réécriture du code.

### Ce qui a été vérifié sur l'archive livrée

Archive extraite dans un dossier neuf, puis :

- les dépendances se résolvent — `node src/serve.js --help` répond ;
- sans licence, le serveur **refuse proprement**, en indiquant le chemin
  attendu et le contact ;
- avec une licence valide, il **démarre** : salon ouvert, port WebSocket et
  port mobile en écoute, page mobile en HTTP 200 ;
- aucune fuite : ni `.hnaya-lic`, ni `.pem`, ni base d'essai dans l'une ou
  l'autre archive.
