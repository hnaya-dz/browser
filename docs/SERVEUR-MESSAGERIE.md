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

> ⚠️ **Node 22.5 est un plancher dur, pas une recommandation.** Le stockage
> repose sur `node:sqlite` (`DatabaseSync`), apparu en 22.5 et **sans
> repli** dans le code. Sur Node 18 ou 20 — encore courants sur Debian 12 —
> le service démarre puis s'arrête sur une erreur de module introuvable,
> peu explicite. Vérifiez avant d'installer :
>
> ```bash
> node --version
> ```

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
`-NodeExe` si `node` n'est pas dans le `PATH` du compte SYSTEM,
`-TaskName` (défaut `HnayaChatServer`).

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
sh service/install-linux.sh "Salon Direction" 482017
```

Le second argument est le code d'accès à six chiffres ; s'il est omis, un
code est généré. Le script crée le compte, le répertoire de données,
l'unité `hnaya-chat.service`, puis l'active et la démarre.

```bash
systemctl status hnaya-chat
```

> ⚠️ **Deux défauts connus du script Linux, à corriger avant toute
> livraison à un partenaire :**
>
> 1. **Le script ne place pas la licence.** Il configure le nom, le
>    répertoire de données et le code d'accès — jamais le fichier
>    `.hnaya-lic`. Déposez-le manuellement (§5) **avant** le premier
>    démarrage, sinon le service refuse de servir.
> 2. **La version de Node n'est pas vérifiée.** Le script contrôle que
>    `node` existe dans le `PATH`, jamais qu'il est en 22.5 ou plus, alors
>    que son propre en-tête annonce « Node.js 22+ ». Faites le contrôle du
>    §2 vous-même.

---

## 5. Mise en place de la licence

Le serveur permanent est réservé aux organisations disposant d'une licence
Hnaya DZ. **Le mode poste — un salon créé depuis le navigateur — reste
libre et sans licence.**

Deux façons de la fournir, au choix :

- déposer le fichier sous le nom exact **`licence.hnaya-lic`** dans le
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

Cette fiche décrit un module **déjà autonome**. Ce qui manque relève de
l'emballage, non de l'architecture :

1. **Un livrable séparé.** Aujourd'hui ces 705 Ko ne voyagent que dans
   l'installateur du navigateur (102,7 Mo). Il faut une archive autonome,
   déposable par un service informatique.
2. **Corriger les deux défauts du §4** — licence non placée, version de
   Node non vérifiée. Ils cassent la première installation.
3. **Décider du moteur Node** : exiger Node 22.5+ chez le client — voie
   immédiate, raisonnable face à un service informatique — ou produire un
   exécutable autonome par plateforme, plus confortable mais qui ajoute une
   étape de compilation.
