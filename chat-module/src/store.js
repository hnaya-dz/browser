// ═══════════════════════════════════════════════════════════════
// Persistance SQLite — étape D (successeur de db.js, API compatible)
// ═══════════════════════════════════════════════════════════════
// db.js (JSON à plat) documentait lui-même son remplacement : « remplacer
// ce fichier par une vraie base (SQLite) sans changer la signature des
// fonctions exportées ». C'est fait ici via node:sqlite — le SQLite
// INTÉGRÉ à Node (≥ 22.5, présent dans Electron 35 / Node 22.16, vérifié).
// Zéro dépendance native, zéro compilation : l'invariant « pure JS » du
// module est préservé.
//
// Nouveautés étape D par rapport à db.js :
//   • registre des appareils (empreinte Ed25519 ↔ pseudos, machine, IP,
//     étiquette posée par l'admin) — voir identity.js pour le principe ;
//   • messages signés (signature + validité stockées, exportables) ;
//   • configuration persistante (rétention, PIN stable du mode serveur…) ;
//   • recherche admin (date / auteur / appareil / mot-clé).
//
// ⚠️ Rétention : 90 jours par défaut (configurable, 0 = illimitée) —
// cohérent avec la philosophie confidentialité du projet : pas de
// rétention indéfinie sans décision explicite de l'admin.

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_RETENTION_DAYS = 90;
const NICKNAME_HISTORY_MAX = 20;

let db = null;

// ── Ouverture / schéma ─────────────────────────────────────────────────────
// Lazy par défaut (répertoire du module, comme db.js) ; le mode serveur
// permanent passera son propre dataDir via initStore() AVANT tout accès.
// Répertoire effectivement utilisé — les pièces jointes doivent atterrir
// à côté de la base, y compris quand l'appelant n'a rien précisé.
let currentDataDir = DEFAULT_DATA_DIR;
export function getDataDir() { return currentDataDir; }

export function initStore(dataDir = DEFAULT_DATA_DIR) {
  if (db) return db;
  currentDataDir = dataDir;
  fs.mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(path.join(dataDir, "hnaya-chat.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id             TEXT PRIMARY KEY,
      groupId        TEXT NOT NULL,
      sender         TEXT NOT NULL,
      text           TEXT NOT NULL,
      ts             INTEGER NOT NULL,
      deviceFp       TEXT,
      signature      TEXT,
      signatureValid INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_messages_group_ts ON messages(groupId, ts);
    CREATE TABLE IF NOT EXISTS devices (
      fingerprint   TEXT PRIMARY KEY,
      publicKeySpki TEXT NOT NULL,
      firstSeen     INTEGER NOT NULL,
      lastSeen      INTEGER NOT NULL,
      lastNickname  TEXT,
      nicknames     TEXT NOT NULL DEFAULT '[]',
      hostname      TEXT,
      platform      TEXT,
      lastIp        TEXT,
      label         TEXT
    );
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      roomId    TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      roomPin   TEXT,
      adminPin  TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      lastUsed  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bans (
      roomId      TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      bannedAt    INTEGER NOT NULL,
      PRIMARY KEY (roomId, fingerprint)
    );
    CREATE TABLE IF NOT EXISTS room_members (
      roomId      TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      firstJoin   INTEGER NOT NULL,
      lastJoin    INTEGER NOT NULL,
      PRIMARY KEY (roomId, fingerprint)
    );

    -- ── Étape H — votes ────────────────────────────────────────────
    -- DEUX tables, et c'est tout l'enjeu du mode non nominatif : le
    -- CHOIX d'un côté, la PARTICIPATION de l'autre, sans jointure
    -- possible entre les deux. En mode non nominatif, vote_choices ne
    -- porte ni empreinte ni pseudo : la base ne sait donc pas qui a
    -- voté quoi, tout en sachant qui a voté — ce qui suffit à compter
    -- les voix ET à relancer les absents.
    --
    -- ⚠️ Ne JAMAIS ajouter d'empreinte à vote_choices pour « faciliter »
    -- la révision en mode non nominatif : cela rétablirait précisément
    -- le lien que ce mode promet de ne pas conserver.
    CREATE TABLE IF NOT EXISTS vote_choices (
      voteId      TEXT NOT NULL,
      choice      INTEGER NOT NULL,
      comment     TEXT,
      ts          INTEGER NOT NULL,
      fingerprint TEXT,          -- renseigné en mode nominatif SEULEMENT
      sender      TEXT           -- idem
    );
    CREATE INDEX IF NOT EXISTS idx_vote_choices ON vote_choices(voteId);

    -- Qui a répondu, sans son choix. Sert aux absents et empêche un
    -- second vote — y compris en mode non nominatif, où c'est la seule
    -- trace de participation.
    CREATE TABLE IF NOT EXISTS vote_voters (
      voteId      TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      sender      TEXT,
      ts          INTEGER NOT NULL,
      PRIMARY KEY (voteId, fingerprint)
    );
  `);
  // Verrou de salon (D.2) : composition figée par l'admin — les appareils
  // déjà membres circulent librement, aucun nouvel appareil n'entre
  if (!db.prepare("PRAGMA table_info(rooms)").all().some((c) => c.name === "locked")) {
    db.exec("ALTER TABLE rooms ADD COLUMN locked INTEGER NOT NULL DEFAULT 0");
  }

  // ── Migration D.2 : salons distincts ──────────────────────────────────
  // Les bases antérieures avaient UN salon implicite (config admin_pin /
  // room_pin / session_name, messages sans roomId). On matérialise cet
  // existant en salon « default » réouvrable — rien n'est perdu, et les
  // colonnes/valeurs par défaut gardent l'API compatible.
  const msgCols = db.prepare("PRAGMA table_info(messages)").all().map((c) => c.name);
  if (!msgCols.includes("roomId")) {
    db.exec("ALTER TABLE messages ADD COLUMN roomId TEXT NOT NULL DEFAULT 'default'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_room_group_ts ON messages(roomId, groupId, ts)");
  }
  // type = "message" | "invite" (carte d'invitation persistée) ;
  // extra = charge JSON du type (ex. coordonnées du salon invité)
  if (!msgCols.includes("type") && !db.prepare("PRAGMA table_info(messages)").all().some((c) => c.name === "type")) {
    db.exec("ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'message'");
    db.exec("ALTER TABLE messages ADD COLUMN extra TEXT");
  }
  // ── Migration F : annuaire ────────────────────────────────────────────
  // `role` = fonction dans l'organisation (DRH, DGA…), attribuée par
  // l'admin. Distincte de `label`, qui sert à nommer l'APPAREIL
  // (« portable de l'accueil ») — ici on décrit la PERSONNE.
  if (!db.prepare("PRAGMA table_info(devices)").all().some((c) => c.name === "role")) {
    db.exec("ALTER TABLE devices ADD COLUMN role TEXT");
  }

  // ── Étape I — retirer un appareil sans effacer sa trace ───────────────
  // Une place de licence était consommée À VIE : poste réinstallé, téléphone
  // changé, identité régénérée — chaque fois une empreinte nouvelle, jamais
  // libérée. Un client à 50 places butait sur le plafond bien avant d'avoir
  // 50 utilisateurs.
  //
  // On MARQUE l'appareil retiré au lieu de supprimer sa ligne. Supprimer
  // ferait disparaître sa clé publique, seul exemplaire conservé : les
  // messages déjà reçus gardent leur verdict de signature enregistré, mais
  // plus rien ne permettrait de le recontrôler. Pour une administration,
  // c'est l'auditabilité de l'historique qu'on perdrait pour gagner une
  // place. Le marquage libère la place ET garde la preuve.
  if (!db.prepare("PRAGMA table_info(devices)").all().some((c) => c.name === "retiredAt")) {
    db.exec("ALTER TABLE devices ADD COLUMN retiredAt INTEGER");
  }

  // ── Étape L — une PERSONNE, plusieurs appareils ───────────────────────
  // L'identité est la clé de l'appareil, et « Ajouter mon mobile » en crée
  // une seconde : la même personne comptait donc deux fiches. L'annuaire
  // l'affichait deux fois, et le vote comme les décisions devaient la
  // reconnaître « par empreinte OU par pseudo » — un contournement qui
  // tombe en défaut dès que deux personnes partagent un prénom.
  //
  // `personId` regroupe les appareils. Migration sans perte : chaque fiche
  // existante devient sa propre personne, de sorte que rien ne change tant
  // que personne n'appaire quoi que ce soit.
  if (!db.prepare("PRAGMA table_info(devices)").all().some((c) => c.name === "personId")) {
    db.exec("ALTER TABLE devices ADD COLUMN personId TEXT");
    db.exec("ALTER TABLE devices ADD COLUMN pairedAt INTEGER");
    db.exec("ALTER TABLE devices ADD COLUMN pairedBy TEXT");
    db.exec("UPDATE devices SET personId = fingerprint WHERE personId IS NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_devices_person ON devices(personId)");
  }

  // ── Étape N — accusé de lecture ───────────────────────────────────────
  // Choisi PLUTÔT qu'une réaction « pouce levé ». Une réaction aurait
  // introduit un second moyen de dire « d'accord », non signé et non
  // imputable, à côté de la décision signée de l'étape K : dans un mois,
  // quelqu'un aurait soutenu « mais j'avais mis un pouce » face à une
  // demande d'approbation restée sans décision. « Vu par » ne se confond
  // avec aucune validation.
  //
  // Persisté, et non seulement diffusé : sans cela, fermer le dock effaçait
  // tout, et l'expéditeur ne savait plus jamais qui avait lu.
  //
  // Une ligne par PERSONNE, pas par appareil : lire depuis son poste puis
  // son téléphone ne doit pas compter deux lecteurs.
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_reads (
      messageId TEXT NOT NULL,
      personId  TEXT NOT NULL,
      sender    TEXT,
      ts        INTEGER NOT NULL,
      PRIMARY KEY (messageId, personId)
    );
    CREATE INDEX IF NOT EXISTS idx_reads_msg ON message_reads(messageId);
  `);

  // ── Étape M — photo de profil, par PERSONNE ───────────────────────────
  // Sur la personne et non sur l'appareil : depuis l'appairage, quelqu'un
  // qui a un téléphone n'a plus qu'une entrée d'annuaire, et il serait
  // absurde de lui demander de déposer sa photo deux fois.
  //
  // On ne stocke que l'EMPREINTE du fichier, pas l'image : les octets
  // vivent dans le magasin de pièces jointes existant, et l'annuaire reste
  // léger. Une image en clair dans chaque réponse d'annuaire ferait passer
  // plusieurs centaines de kilooctets à chaque changement de présence.
  db.exec(`
    CREATE TABLE IF NOT EXISTS persons (
      personId  TEXT PRIMARY KEY,
      avatarSha TEXT,
      updatedAt INTEGER NOT NULL
    );
  `);

  // ── Étape K — demande qualifiée ───────────────────────────────────────
  // `tag` dit la NATURE de l'envoi (info, avis, validation, approbation) et
  // `destinataire` DÉSIGNE nommément qui doit répondre. Les deux sont
  // couverts par la signature (voir demandeSeal dans identity.js) : une
  // étiquette requalifiable après coup, ou un destinataire modifiable, ne
  // vaudrait rien dans un circuit d'approbation.
  if (!db.prepare("PRAGMA table_info(messages)").all().some((c) => c.name === "tag")) {
    db.exec("ALTER TABLE messages ADD COLUMN tag TEXT");
    db.exec("ALTER TABLE messages ADD COLUMN destinataire TEXT");
  }
  db.exec(`
    -- L'ISSUE d'une demande. Table distincte des messages : une décision
    -- n'est pas un message du fil, elle qualifie un message existant.
    --
    -- UNE ligne par personne et par demande, la dernière écrasant la
    -- précédente : l'état courant est ce qui compte (« a-t-il validé ? »),
    -- et l'on veut pouvoir se rétracter. Le nom ET l'empreinte sont
    -- conservés — l'exigence est qu'il n'y ait aucune confusion sur QUI a
    -- validé, ce qu'un pseudo seul ne garantit pas.
    --
    -- ⚠️ Rien à voir avec un vote : un vote compte des voix et peut être
    -- non nominatif ; une décision est toujours imputable, et c'est
    -- justement son objet. Ne pas fusionner les deux tables.
    CREATE TABLE IF NOT EXISTS message_decisions (
      messageId   TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      sender      TEXT,
      issue       TEXT NOT NULL,
      comment     TEXT,
      ts          INTEGER NOT NULL,
      signature   TEXT,
      PRIMARY KEY (messageId, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_msg ON message_decisions(messageId);
  `);

  // ── Migration E : pièces jointes ──────────────────────────────────────
  // `media` = métadonnées JSON (empreinte, type, dimensions, vignette).
  // Le fichier lui-même vit sous dataDir/media/ — voir src/media.js.
  if (!db.prepare("PRAGMA table_info(messages)").all().some((c) => c.name === "media")) {
    db.exec("ALTER TABLE messages ADD COLUMN media TEXT");
  }

  // Étape G — citation : identifiant du message auquel celui-ci répond.
  // Volontairement SANS clé étrangère : la purge de rétention efface les
  // anciens messages, et une contrainte ferait alors échouer la purge ou
  // supprimerait en cascade des réponses qu'il faut conserver. Une
  // citation dont la cible a disparu s'affiche simplement « message
  // supprimé » — voir le rendu du dock.
  if (!db.prepare("PRAGMA table_info(messages)").all().some((c) => c.name === "replyTo")) {
    db.exec("ALTER TABLE messages ADD COLUMN replyTo TEXT");
  }

  const legacyAdminPin = db.prepare("SELECT value FROM config WHERE key = 'admin_pin'").get()?.value;
  const hasDefault = db.prepare("SELECT roomId FROM rooms WHERE roomId = 'default'").get();
  if (legacyAdminPin && !hasDefault) {
    const now = Date.now();
    db.prepare("INSERT INTO rooms (roomId, name, roomPin, adminPin, createdAt, lastUsed) VALUES (?, ?, ?, ?, ?, ?)")
      .run("default",
           db.prepare("SELECT value FROM config WHERE key = 'session_name'").get()?.value || "Salon",
           db.prepare("SELECT value FROM config WHERE key = 'room_pin'").get()?.value || null,
           legacyAdminPin, now, now);
  }
  return db;
}

function ensureDb() {
  return db || initStore();
}

// Ferme la base (tests, arrêt propre du serveur permanent)
export function closeStore() {
  if (db) {
    try { db.close(); } catch {}
    db = null;
  }
}

// ── API historique — signatures IDENTIQUES à db.js ─────────────────────────
export function saveMessage(msg) {
  const res = ensureDb()
    .prepare(`INSERT OR IGNORE INTO messages
      (id, roomId, groupId, sender, text, ts, deviceFp, signature, signatureValid, type, extra, media, replyTo, tag, destinataire)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      String(msg.id),
      String(msg.roomId || "default"),
      String(msg.groupId || "all"),
      String(msg.from),
      String(msg.text),
      Number(msg.ts),
      msg.deviceFp || null,
      msg.signature || null,
      msg.signatureValid ? 1 : 0,
      // ⚠️ Liste blanche : tout type inconnu retombe sur "message". Ne pas
      // oublier d'y ajouter un nouveau type — un vote enregistré comme
      // simple message perdrait sa nature, et l'hôte refuserait ensuite
      // TOUTES les réponses (il vérifie que la cible est bien un vote).
      ["invite", "vote"].includes(msg.type) ? msg.type : "message",
      msg.extra ? JSON.stringify(msg.extra) : null,
      msg.media ? JSON.stringify(msg.media) : null,
      msg.replyTo ? String(msg.replyTo) : null,
      msg.tag ? String(msg.tag) : null,
      msg.destinataire ? String(msg.destinataire) : null,
    );
  // inserted=false ⇒ id déjà en base (doublon/rejeu) — le serveur s'en sert
  // pour ne pas rediffuser
  return { ...msg, inserted: Number(res.changes) > 0 };
}

export function getMessagesSince(groupId, sinceTs = 0, roomId = "default") {
  return ensureDb()
    .prepare("SELECT * FROM messages WHERE roomId = ? AND groupId = ? AND ts > ? ORDER BY ts ASC")
    .all(String(roomId), String(groupId), Number(sinceTs))
    .map(rowToMessage);
}

export function purgeOldMessages() {
  const days = Number(getConfig("retention_days", DEFAULT_RETENTION_DAYS));
  if (days <= 0) return countMessages(); // 0 = rétention illimitée
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  ensureDb().prepare("DELETE FROM messages WHERE ts < ?").run(cutoff);
  return countMessages();
}

/** Le message cité existe-t-il DANS CE SALON ? Le contrôle est cantonné au
 *  salon à dessein : accepter une citation vers un message d'ailleurs
 *  révélerait son existence — et son identifiant — à quelqu'un qui n'y a
 *  pas accès. */
export function messageExists(id, roomId = "default") {
  return !!ensureDb()
    .prepare("SELECT 1 FROM messages WHERE id = ? AND roomId = ? LIMIT 1")
    .get(String(id), String(roomId));
}

/** Relit UN message de CE salon — sert au vote, qui doit vérifier que la
 *  cible existe ici avant d'accepter une réponse. */
export function getMessage(id, roomId = "default") {
  const r = ensureDb()
    .prepare("SELECT * FROM messages WHERE id = ? AND roomId = ? LIMIT 1")
    .get(String(id), String(roomId));
  return r ? rowToMessage(r) : null;
}

/** Les votes d'un salon, du plus récent au plus ancien.
 *
 *  ⚠️ Indépendant de `lastSeenTs`. Un client qui se RECONNECTE ne redemande
 *  que les messages postérieurs à sa dernière lecture : le vote n'est donc
 *  pas rejoué, et il restait affiché à zéro jusqu'à ce que quelqu'un vote.
 *  Les dépouillements doivent être envoyés pour TOUS les votes visibles,
 *  pas seulement pour ceux du rattrapage. */
export function listVotes(roomId = "default", groupIds = ["all"], limite = 50) {
  if (!groupIds.length) return [];
  const trous = groupIds.map(() => "?").join(",");
  return ensureDb()
    .prepare(`SELECT * FROM messages
               WHERE roomId = ? AND type = 'vote' AND groupId IN (${trous})
               ORDER BY ts DESC LIMIT ?`)
    .all(String(roomId), ...groupIds.map(String), Number(limite))
    .map(rowToMessage);
}

// ── Étape H — votes ────────────────────────────────────────────────────

/** Cette personne a-t-elle déjà répondu à ce vote ? Se lit toujours dans
 *  vote_voters, jamais dans les choix : c'est la seule table qui porte
 *  l'identité en mode non nominatif. */
/** Toutes les empreintes de la personne à qui appartient cet appareil.
 *  Un appareil non appairé se retrouve seul dans sa propre liste. */
export function empreintesDeLaPersonne(fingerprint) {
  const fps = devicesOfPerson(personIdOf(fingerprint));
  return fps.length ? fps : [String(fingerprint)];
}

/**
 * Retrouve la PERSONNE qui a déjà répondu à ce vote.
 *
 * ⚠️ Une voix par PERSONNE, pas par appareil. « Ajouter mon mobile » fait
 * rejoindre le téléphone avec sa PROPRE clé : sans ce rapprochement, une
 * personne équipée d'un téléphone pesait DEUX voix dans une validation.
 * Constaté en test réel.
 *
 * Étape L — le critère principal est désormais l'APPAIRAGE : tous les
 * appareils rattachés à la même personne sont une seule voix, prouvé par
 * signature. Le rapprochement par pseudo reste en second filet pour les
 * appareils pas encore appairés — il est faillible (deux collègues peuvent
 * porter le même prénom, et un pseudo se change), et il pourra disparaître
 * quand l'appairage sera la norme. Il n'élargit jamais le droit de vote :
 * il ne fait que réunir des lignes.
 */
export function findVoter(voteId, fingerprint, sender) {
  const fps = empreintesDeLaPersonne(fingerprint);
  const trous = fps.map(() => "?").join(",");
  return ensureDb().prepare(
    `SELECT * FROM vote_voters
      WHERE voteId = ? AND (fingerprint IN (${trous}) OR (sender <> '' AND sender = ?))
      LIMIT 1`,
  ).get(String(voteId), ...fps, String(sender || ""));
}

export function hasVoted(voteId, fingerprint, sender) {
  return !!findVoter(voteId, fingerprint, sender);
}

/**
 * Enregistre une réponse.
 * - Mode NOMINATIF : le choix porte l'identité ; une nouvelle réponse
 *   remplace la précédente (la dernière prévaut).
 * - Mode NON NOMINATIF : le choix est anonyme et DÉFINITIF. Le rendre
 *   révisable supposerait de retrouver la réponse antérieure de cette
 *   personne, donc de conserver le lien que ce mode exclut. Un bulletin
 *   déposé ne se reprend pas.
 * Retourne false si la réponse est refusée (second vote non nominatif).
 */
export function saveVoteChoice({ voteId, choice, comment, fingerprint, sender, nominatif, ts }) {
  const db = ensureDb();
  const quand = Number(ts) || Date.now();
  const nom = String(sender || "");
  // La personne, pas l'appareil : on la retrouve par son empreinte OU son
  // pseudo, de sorte qu'un second appareil remplace son vote au lieu d'en
  // ajouter un.
  const dejaLa = findVoter(voteId, fingerprint, nom);
  if (dejaLa && !nominatif) return false;

  if (nominatif) {
    // Effacer le choix PRÉCÉDENT DE CETTE PERSONNE, quel que soit
    // l'appareil depuis lequel il avait été émis — tous ses appareils
    // appairés comptent pour un.
    const fps = empreintesDeLaPersonne(fingerprint);
    const trous = fps.map(() => "?").join(",");
    db.prepare(`DELETE FROM vote_choices
                 WHERE voteId = ? AND (fingerprint IN (${trous}) OR (sender <> '' AND sender = ?))`)
      .run(String(voteId), ...fps, nom);
    db.prepare(`INSERT INTO vote_choices (voteId, choice, comment, ts, fingerprint, sender)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(String(voteId), Number(choice), comment ? String(comment) : null, quand,
           String(fingerprint), nom);
  } else {
    db.prepare(`INSERT INTO vote_choices (voteId, choice, comment, ts, fingerprint, sender)
                VALUES (?, ?, ?, ?, NULL, NULL)`)
      .run(String(voteId), Number(choice), comment ? String(comment) : null, quand);
  }

  // Une SEULE ligne de participation par personne : sinon « 3 ont répondu »
  // compterait des appareils, et « en attente » deviendrait faux.
  if (dejaLa) {
    db.prepare("UPDATE vote_voters SET fingerprint = ?, sender = ?, ts = ? WHERE voteId = ? AND fingerprint = ?")
      .run(String(fingerprint), nom, quand, String(voteId), dejaLa.fingerprint);
  } else {
    db.prepare("INSERT INTO vote_voters (voteId, fingerprint, sender, ts) VALUES (?, ?, ?, ?)")
      .run(String(voteId), String(fingerprint), nom, quand);
  }
  return true;
}

/** Dépouillement : décompte par option, et le détail nominatif seulement
 *  quand le vote l'est. `voters` liste qui a répondu dans les deux modes —
 *  c'est ce qui permet de relancer les absents sans trahir les choix. */
export function getVoteTally(voteId) {
  const db = ensureDb();
  const lignes = db.prepare("SELECT choice, comment, ts, fingerprint, sender FROM vote_choices WHERE voteId = ? ORDER BY ts ASC")
    .all(String(voteId));
  const decompte = {};
  for (const l of lignes) decompte[l.choice] = (decompte[l.choice] || 0) + 1;
  const voters = db.prepare("SELECT fingerprint, sender, ts FROM vote_voters WHERE voteId = ? ORDER BY ts ASC")
    .all(String(voteId));
  return {
    decompte,
    total: lignes.length,
    voters,
    detail: lignes.filter((l) => l.fingerprint)
      .map((l) => ({ sender: l.sender, fingerprint: l.fingerprint, choice: l.choice, comment: l.comment, ts: l.ts })),
  };
}

function countMessages() {
  return Number(ensureDb().prepare("SELECT COUNT(*) AS n FROM messages").get().n);
}

function rowToMessage(r) {
  return {
    id: r.id,
    roomId: r.roomId,
    groupId: r.groupId,
    from: r.sender,
    text: r.text,
    ts: Number(r.ts),
    deviceFp: r.deviceFp || null,
    signature: r.signature || null,
    signatureValid: !!r.signatureValid,
    type: r.type || "message",
    extra: r.extra ? safeJson(r.extra, null) : null,
    media: r.media ? safeJson(r.media, null) : null,
    replyTo: r.replyTo || null,
    tag: r.tag || null,
    destinataire: r.destinataire || null,
  };
}

// ── Étape K — décisions sur une demande qualifiée ──────────────────────────
/** Enregistre (ou remplace) la décision d'UNE personne sur UNE demande.
 *  Le remplacement est voulu : on doit pouvoir se rétracter, et c'est
 *  l'état courant qui répond à « a-t-il validé ? ». */
export function saveDecision({ messageId, fingerprint, sender, issue, comment, ts, signature }) {
  // Étape L — une personne, une décision. Sans ce ménage, quelqu'un qui
  // valide depuis son poste puis se ravise depuis son téléphone laisserait
  // DEUX positions contradictoires sur la même demande, chacune signée.
  // On efface celles de ses autres appareils avant d'écrire la nouvelle.
  const autres = empreintesDeLaPersonne(fingerprint).filter((f) => f !== String(fingerprint));
  if (autres.length) {
    const trous = autres.map(() => "?").join(",");
    ensureDb().prepare(
      `DELETE FROM message_decisions WHERE messageId = ? AND fingerprint IN (${trous})`,
    ).run(String(messageId), ...autres);
  }
  ensureDb().prepare(
    `INSERT INTO message_decisions (messageId, fingerprint, sender, issue, comment, ts, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(messageId, fingerprint) DO UPDATE SET
       sender = excluded.sender, issue = excluded.issue, comment = excluded.comment,
       ts = excluded.ts, signature = excluded.signature`,
  ).run(String(messageId), String(fingerprint), sender || null, String(issue),
        comment || null, Number(ts), signature || null);
}

/** Décisions prises sur une demande, la plus récente d'abord. */
export function listDecisions(messageId) {
  return ensureDb().prepare(
    `SELECT messageId, fingerprint, sender, issue, comment, ts
     FROM message_decisions WHERE messageId = ? ORDER BY ts DESC`,
  ).all(String(messageId)).map((r) => ({ ...r, ts: Number(r.ts) }));
}

/** Les demandes d'un salon, dans les fils demandés. Sert à rejouer leurs
 *  décisions à l'arrivée d'un client — même leçon que le dépouillement des
 *  votes : une décision ne voyage PAS avec les messages, donc un arrivant
 *  (ou une reconnexion, qui ne redemande que les messages récents) verrait
 *  une demande de validation sans son issue. */
export function listDemandes(roomId, groupIds) {
  const groupes = (groupIds || []).map(String);
  if (!groupes.length) return [];
  const trous = groupes.map(() => "?").join(",");
  return ensureDb().prepare(
    `SELECT id, groupId FROM messages
     WHERE roomId = ? AND tag IS NOT NULL AND groupId IN (${trous})`,
  ).all(String(roomId), ...groupes);
}

/** Empreintes des pièces jointes encore citées par un message — sert au
 *  ménage des fichiers orphelins après la purge de rétention
 *  (voir purgeOrphans dans src/media.js). */
export function listReferencedMedia() {
  const d = ensureDb();
  const rows = d.prepare("SELECT media FROM messages WHERE media IS NOT NULL").all();
  const set = new Set();
  for (const r of rows) {
    const m = safeJson(r.media, null);
    if (m?.sha256) set.add(String(m.sha256));
  }
  // ⚠️ Étape M — les photos de profil vivent dans le même magasin de
  // fichiers mais ne sont référencées par AUCUN message. Sans cette
  // seconde source, le ménage des orphelins les effacerait à la première
  // purge, et tout le monde perdrait sa photo sans explication.
  for (const r of d.prepare("SELECT avatarSha FROM persons WHERE avatarSha IS NOT NULL").all()) {
    set.add(String(r.avatarSha));
  }
  return set;
}

// ── Registre des appareils (étape D) ───────────────────────────────────────
// Appelé à chaque join réussi : crée ou met à jour la fiche de l'appareil.
// L'étiquette (label) n'est JAMAIS écrasée ici — elle appartient à l'admin.
export function upsertDeviceSeen({ fingerprint, publicKeySpki, nickname, hostname, platform, ip }) {
  const now = Date.now();
  const d = ensureDb();
  const existing = d.prepare("SELECT nicknames FROM devices WHERE fingerprint = ?").get(fingerprint);
  if (existing) {
    let nicknames = [];
    try { nicknames = JSON.parse(existing.nicknames); } catch {}
    if (nickname && !nicknames.includes(nickname)) {
      nicknames.push(nickname);
      if (nicknames.length > NICKNAME_HISTORY_MAX) nicknames = nicknames.slice(-NICKNAME_HISTORY_MAX);
    }
    // retiredAt remis à NULL : un appareil retiré qui revient reprend du
    // service, donc une place. Le contrôle de plafond a déjà eu lieu au
    // join (server.js) — il traite un appareil retiré comme un nouveau.
    d.prepare(`UPDATE devices SET lastSeen = ?, lastNickname = ?, nicknames = ?,
               hostname = COALESCE(?, hostname), platform = COALESCE(?, platform),
               lastIp = COALESCE(?, lastIp), retiredAt = NULL WHERE fingerprint = ?`)
      .run(now, nickname || null, JSON.stringify(nicknames),
           hostname || null, platform || null, ip || null, fingerprint);
  } else {
    // Étape L — un appareil neuf est sa propre personne jusqu'à preuve du
    // contraire. Le rattachement à une personne existante est un acte
    // séparé et PROUVÉ (voir linkDeviceToPerson).
    d.prepare(`INSERT INTO devices
      (fingerprint, publicKeySpki, firstSeen, lastSeen, lastNickname, nicknames, hostname, platform, lastIp, personId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(fingerprint, publicKeySpki, now, now, nickname || null,
           JSON.stringify(nickname ? [nickname] : []), hostname || null, platform || null, ip || null,
           fingerprint);
  }
}

/** Fonction de la personne (DRH, DGA…) — affichée dans l'annuaire. */
export function setDeviceRole(fingerprint, role) {
  ensureDb().prepare("UPDATE devices SET role = ? WHERE fingerprint = ?")
    .run(role ? String(role).slice(0, 40) : null, String(fingerprint));
}

/** Annuaire d'un salon : qui est inscrit, sous quel nom, avec quelle
 *  fonction. La présence (en ligne) est ajoutée par le serveur, qui seul
 *  connaît les connexions ouvertes.
 *
 *  Étape L — UNE ligne par PERSONNE, pas par appareil. Quelqu'un qui a
 *  appairé son téléphone y figurait deux fois ; avec des avatars, on aurait
 *  vu le même visage en double. On garde l'appareil vu le plus récemment
 *  comme représentant (son empreinte sert d'adresse pour les fils privés)
 *  et on expose la liste complète de ses appareils. */
export function listRoster(roomId) {
  const rows = ensureDb().prepare(
    `SELECT dev.fingerprint, dev.lastNickname, dev.role, dev.label, dev.lastSeen,
            dev.personId, p.avatarSha
     FROM devices dev
     JOIN room_members m ON m.fingerprint = dev.fingerprint
     LEFT JOIN persons p ON p.personId = dev.personId
     WHERE m.roomId = ?
     ORDER BY dev.lastSeen DESC`,
  ).all(String(roomId));

  const parPersonne = new Map();
  for (const r of rows) {
    const pid = r.personId || r.fingerprint;
    const deja = parPersonne.get(pid);
    if (!deja) {
      parPersonne.set(pid, { ...r, personId: pid, appareils: [r.fingerprint] });
    } else {
      deja.appareils.push(r.fingerprint);
      // Le nom et la fonction viennent de l'appareil le plus récent, déjà
      // retenu par l'ordre du SELECT ; on complète seulement les trous, un
      // téléphone n'ayant souvent ni étiquette ni fonction renseignée.
      deja.role = deja.role || r.role;
      deja.label = deja.label || r.label;
      deja.lastNickname = deja.lastNickname || r.lastNickname;
      deja.avatarSha = deja.avatarSha || r.avatarSha;
    }
  }
  return [...parPersonne.values()]
    .sort((a, b) => String(a.lastNickname || "").localeCompare(String(b.lastNickname || "")));
}

// ── Étape L — appairage ────────────────────────────────────────────────────
/** La personne à laquelle appartient cet appareil. Repli sur l'empreinte :
 *  un appareil non migré est sa propre personne. */
export function personIdOf(fingerprint) {
  const r = ensureDb().prepare("SELECT personId FROM devices WHERE fingerprint = ?")
    .get(String(fingerprint));
  return r?.personId || String(fingerprint);
}

/** Rattache un appareil à une personne existante. `pairedBy` garde
 *  l'empreinte de l'appareil qui a signé le jeton : si un rattachement est
 *  contesté, on sait lequel l'a autorisé. */
export function linkDeviceToPerson(fingerprint, personId, pairedBy) {
  ensureDb().prepare(
    "UPDATE devices SET personId = ?, pairedAt = ?, pairedBy = ? WHERE fingerprint = ?",
  ).run(String(personId), Date.now(), String(pairedBy || ""), String(fingerprint));
}

// ── Étape N — accusés de lecture ───────────────────────────────────────────
/** Note qu'une personne a lu ce message. Idempotent : la PREMIÈRE lecture
 *  est celle qui compte, on ne la repousse pas à chaque coup d'œil — sinon
 *  l'horodatage afficherait « vu il y a 2 s » indéfiniment tant que le fil
 *  reste ouvert. */
export function saveRead({ messageId, personId, sender, ts }) {
  ensureDb().prepare(
    `INSERT OR IGNORE INTO message_reads (messageId, personId, sender, ts)
     VALUES (?, ?, ?, ?)`,
  ).run(String(messageId), String(personId), sender || null, Number(ts) || Date.now());
}

/** Qui a lu ce message, du plus ancien au plus récent. */
export function listReads(messageId) {
  return ensureDb().prepare(
    "SELECT personId, sender, ts FROM message_reads WHERE messageId = ? ORDER BY ts ASC",
  ).all(String(messageId)).map((r) => ({ ...r, ts: Number(r.ts) }));
}

/** Accusés portant sur les messages ENVOYÉS par cette personne, dans les
 *  fils demandés. Sert à les rejouer à la connexion : seul l'expéditeur a
 *  besoin de savoir qui l'a lu, et lui rejouer tout le salon serait à la
 *  fois inutile et indiscret. Borné aux messages récents — un historique
 *  de six mois n'a pas à repasser sur le réseau à chaque connexion. */
export function readsForMyMessages(roomId, groupIds, empreintes, limite = 100) {
  const groupes = (groupIds || []).map(String);
  const fps = (empreintes || []).map(String);
  if (!groupes.length || !fps.length) return [];
  const tg = groupes.map(() => "?").join(",");
  const tf = fps.map(() => "?").join(",");
  const messages = ensureDb().prepare(
    `SELECT id FROM messages
      WHERE roomId = ? AND groupId IN (${tg}) AND deviceFp IN (${tf})
      ORDER BY ts DESC LIMIT ?`,
  ).all(String(roomId), ...groupes, ...fps, Number(limite));
  return messages
    .map((m) => ({ messageId: m.id, reads: listReads(m.id) }))
    .filter((e) => e.reads.length);
}

// ── Étape M — photo de profil ──────────────────────────────────────────────
/** Dépose (ou retire, avec sha null) la photo d'une personne. L'appelant a
 *  déjà téléversé les octets dans le magasin de pièces jointes. */
export function setPersonAvatar(personId, avatarSha) {
  ensureDb().prepare(
    `INSERT INTO persons (personId, avatarSha, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(personId) DO UPDATE SET avatarSha = excluded.avatarSha,
                                         updatedAt = excluded.updatedAt`,
  ).run(String(personId), avatarSha ? String(avatarSha) : null, Date.now());
}

export function getPersonAvatar(personId) {
  const r = ensureDb().prepare("SELECT avatarSha FROM persons WHERE personId = ?")
    .get(String(personId));
  return r?.avatarSha || null;
}

/** Toutes les empreintes d'une personne — sert à savoir si elle est en
 *  ligne (l'un quelconque de ses appareils suffit). */
export function devicesOfPerson(personId) {
  return ensureDb().prepare("SELECT fingerprint FROM devices WHERE personId = ?")
    .all(String(personId)).map((r) => r.fingerprint);
}

/** Fils privés auxquels cet appareil participe, dans ce salon. Sert à lui
 *  rendre son historique privé à la reconnexion : il n'a pas à connaître
 *  d'avance les fils dans lesquels on lui a écrit pendant son absence. */
export function listDirectThreads(roomId, fingerprint) {
  const fp = String(fingerprint || "").toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(fp)) return [];
  const rows = ensureDb().prepare(
    `SELECT DISTINCT groupId FROM messages
     WHERE roomId = ? AND groupId LIKE 'dm:%' AND groupId LIKE ?`,
  ).all(String(roomId), `%${fp}%`);
  return rows.map((r) => r.groupId);
}

export function setDeviceLabel(fingerprint, label) {
  ensureDb().prepare("UPDATE devices SET label = ? WHERE fingerprint = ?")
    .run(label || null, fingerprint);
}

/** Registre des appareils. Avec roomId : UNIQUEMENT ceux qui ont rejoint
 *  CE salon — l'admin d'une direction ne découvre pas les appareils des
 *  autres salons hébergés sur la même machine (le cloisonnement doit
 *  valoir aussi pour le registre, pas seulement pour l'historique). */
export function listDevices(roomId) {
  const d = ensureDb();
  const rows = roomId
    ? d.prepare(`SELECT dev.* FROM devices dev
                 JOIN room_members m ON m.fingerprint = dev.fingerprint
                 WHERE m.roomId = ? ORDER BY dev.lastSeen DESC`).all(String(roomId))
    : d.prepare("SELECT * FROM devices ORDER BY lastSeen DESC").all();
  return rows.map((r) => ({ ...r, nicknames: safeJson(r.nicknames, []) }));
}

/** Nombre d'appareils OCCUPANT une place de licence sur cette machine.
 *  Tous salons confondus : la licence couvre l'organisation, pas un salon.
 *  Les appareils retirés par l'admin sont exclus — c'est tout l'objet du
 *  retrait (voir retireDevice). */
export function countDevices() {
  return ensureDb().prepare("SELECT COUNT(*) AS n FROM devices WHERE retiredAt IS NULL").get().n;
}

/** Libère la place de licence de cet appareil. Sa fiche, sa clé publique et
 *  ses messages sont conservés : il devient simplement « retiré ».
 *  S'il se reconnecte, il reprend une place comme un appareil neuf (et se
 *  heurtera au plafond si celui-ci est atteint) — c'est le comportement
 *  voulu : on retire un appareil qui ne sert plus, pas un appareil actif. */
export function retireDevice(fingerprint) {
  ensureDb().prepare("UPDATE devices SET retiredAt = ? WHERE fingerprint = ? AND retiredAt IS NULL")
    .run(Date.now(), String(fingerprint));
}

/** Annule un retrait (l'admin s'est trompé d'appareil). Reprend une place. */
export function restoreDevice(fingerprint) {
  ensureDb().prepare("UPDATE devices SET retiredAt = NULL WHERE fingerprint = ?")
    .run(String(fingerprint));
}

export function getDevice(fingerprint) {
  const r = ensureDb().prepare("SELECT * FROM devices WHERE fingerprint = ?").get(fingerprint);
  return r ? { ...r, nicknames: safeJson(r.nicknames, []) } : null;
}

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// ── Recherche admin ────────────────────────────────────────────────────────
// Tous les critères sont optionnels et cumulables. `q` cherche dans le
// texte ET le pseudo (LIKE, insensible à la casse pour l'ASCII).
export function searchMessages({ roomId, groupId, deviceFp, from, q, fromTs, toTs, limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (roomId) { where.push("roomId = ?"); params.push(roomId); }
  if (groupId) { where.push("groupId = ?"); params.push(groupId); }
  if (deviceFp) { where.push("deviceFp = ?"); params.push(deviceFp); }
  if (from) { where.push("sender = ?"); params.push(from); }
  if (q) { where.push("(text LIKE ? OR sender LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  if (fromTs) { where.push("ts >= ?"); params.push(Number(fromTs)); }
  if (toTs) { where.push("ts <= ?"); params.push(Number(toTs)); }
  const sql = `SELECT * FROM messages ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY ts DESC LIMIT ?`;
  params.push(Math.min(Number(limit) || 500, 5000));
  return ensureDb().prepare(sql).all(...params).map(rowToMessage);
}

// ── Salons (D.2 : plusieurs salons cloisonnés par machine) ─────────────────
// « Créer » = toujours un salon NEUF (historique vierge, PINs propres) ;
// la continuité passe par la réouverture explicite d'un salon existant.
export function createRoom({ name, roomPin = null, adminPin }) {
  const roomId = crypto.randomUUID();
  const now = Date.now();
  ensureDb().prepare(
    "INSERT INTO rooms (roomId, name, roomPin, adminPin, createdAt, lastUsed) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(roomId, String(name), roomPin, String(adminPin), now, now);
  return getRoom(roomId);
}

export function getRoom(roomId) {
  return ensureDb().prepare("SELECT * FROM rooms WHERE roomId = ?").get(String(roomId)) || null;
}

/** Réouverture : met à jour lastUsed (tri de la liste « Rouvrir ») et
 *  permet de renommer au passage. */
export function touchRoom(roomId, { name } = {}) {
  const d = ensureDb();
  if (name) d.prepare("UPDATE rooms SET name = ?, lastUsed = ? WHERE roomId = ?").run(String(name), Date.now(), String(roomId));
  else d.prepare("UPDATE rooms SET lastUsed = ? WHERE roomId = ?").run(Date.now(), String(roomId));
  return getRoom(roomId);
}

export function listRooms() {
  return ensureDb().prepare("SELECT roomId, name, createdAt, lastUsed FROM rooms ORDER BY lastUsed DESC").all();
}

export function setRoomAdminPin(roomId, adminPin) {
  ensureDb().prepare("UPDATE rooms SET adminPin = ? WHERE roomId = ?").run(String(adminPin), String(roomId));
}

export function setRoomPin(roomId, roomPin) {
  ensureDb().prepare("UPDATE rooms SET roomPin = ? WHERE roomId = ?").run(roomPin, String(roomId));
}

/** Suppression DÉFINITIVE d'un salon : historique, appartenances et
 *  blocages compris. Réservée au poste qui détient la base (l'UI exige
 *  une confirmation et refuse le salon actuellement hébergé). */
export function deleteRoom(roomId) {
  const d = ensureDb();
  d.prepare("DELETE FROM messages WHERE roomId = ?").run(String(roomId));
  d.prepare("DELETE FROM bans WHERE roomId = ?").run(String(roomId));
  d.prepare("DELETE FROM room_members WHERE roomId = ?").run(String(roomId));
  d.prepare("DELETE FROM rooms WHERE roomId = ?").run(String(roomId));
}

// ── Appartenance et verrou (D.2) ───────────────────────────────────────────
// L'appartenance est enregistrée à chaque join réussi d'un client signé.
// C'est la référence du VERROU : salon verrouillé = seuls les appareils
// déjà membres entrent. Cycle d'usage : créer → tout le monde rejoint →
// verrouiller. Un PIN qui fuite ne suffit alors plus à entrer.
export function addRoomMember(roomId, fingerprint) {
  const now = Date.now();
  ensureDb().prepare(`INSERT INTO room_members (roomId, fingerprint, firstJoin, lastJoin)
    VALUES (?, ?, ?, ?) ON CONFLICT(roomId, fingerprint) DO UPDATE SET lastJoin = excluded.lastJoin`)
    .run(String(roomId), String(fingerprint), now, now);
}

export function isRoomMember(roomId, fingerprint) {
  return !!ensureDb().prepare("SELECT 1 FROM room_members WHERE roomId = ? AND fingerprint = ?")
    .get(String(roomId), String(fingerprint));
}

export function setRoomLocked(roomId, locked) {
  ensureDb().prepare("UPDATE rooms SET locked = ? WHERE roomId = ?")
    .run(locked ? 1 : 0, String(roomId));
}

// ── Blocages (par salon, par empreinte d'appareil) ─────────────────────────
// ⚠️ Ne concerne que les clients signés (0.4.0+) : un client v1 n'a pas
// d'empreinte. Un appareil qui régénère son identité échappe au blocage —
// c'est un verrou administratif, pas une muraille (l'exclusion absolue
// passe par la re-création du salon avec un nouveau PIN).
export function banDevice(roomId, fingerprint) {
  ensureDb().prepare("INSERT OR IGNORE INTO bans (roomId, fingerprint, bannedAt) VALUES (?, ?, ?)")
    .run(String(roomId), String(fingerprint), Date.now());
}

export function unbanDevice(roomId, fingerprint) {
  ensureDb().prepare("DELETE FROM bans WHERE roomId = ? AND fingerprint = ?")
    .run(String(roomId), String(fingerprint));
}

export function isBanned(roomId, fingerprint) {
  return !!ensureDb().prepare("SELECT 1 FROM bans WHERE roomId = ? AND fingerprint = ?")
    .get(String(roomId), String(fingerprint));
}

export function listBans(roomId) {
  return ensureDb().prepare("SELECT fingerprint, bannedAt FROM bans WHERE roomId = ?").all(String(roomId));
}

// ── Configuration persistante ──────────────────────────────────────────────
export function getConfig(key, defaultValue = null) {
  const r = ensureDb().prepare("SELECT value FROM config WHERE key = ?").get(key);
  return r ? r.value : defaultValue;
}

export function setConfig(key, value) {
  ensureDb().prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, String(value));
}
