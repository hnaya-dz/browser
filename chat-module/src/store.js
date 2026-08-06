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
      (id, roomId, groupId, sender, text, ts, deviceFp, signature, signatureValid, type, extra, media, replyTo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
      msg.type === "invite" ? "invite" : "message",
      msg.extra ? JSON.stringify(msg.extra) : null,
      msg.media ? JSON.stringify(msg.media) : null,
      msg.replyTo ? String(msg.replyTo) : null,
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
  };
}

/** Empreintes des pièces jointes encore citées par un message — sert au
 *  ménage des fichiers orphelins après la purge de rétention
 *  (voir purgeOrphans dans src/media.js). */
export function listReferencedMedia() {
  const rows = ensureDb().prepare("SELECT media FROM messages WHERE media IS NOT NULL").all();
  const set = new Set();
  for (const r of rows) {
    const m = safeJson(r.media, null);
    if (m?.sha256) set.add(String(m.sha256));
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
    d.prepare(`UPDATE devices SET lastSeen = ?, lastNickname = ?, nicknames = ?,
               hostname = COALESCE(?, hostname), platform = COALESCE(?, platform),
               lastIp = COALESCE(?, lastIp) WHERE fingerprint = ?`)
      .run(now, nickname || null, JSON.stringify(nicknames),
           hostname || null, platform || null, ip || null, fingerprint);
  } else {
    d.prepare(`INSERT INTO devices
      (fingerprint, publicKeySpki, firstSeen, lastSeen, lastNickname, nicknames, hostname, platform, lastIp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(fingerprint, publicKeySpki, now, now, nickname || null,
           JSON.stringify(nickname ? [nickname] : []), hostname || null, platform || null, ip || null);
  }
}

/** Fonction de la personne (DRH, DGA…) — affichée dans l'annuaire. */
export function setDeviceRole(fingerprint, role) {
  ensureDb().prepare("UPDATE devices SET role = ? WHERE fingerprint = ?")
    .run(role ? String(role).slice(0, 40) : null, String(fingerprint));
}

/** Annuaire d'un salon : qui est inscrit, sous quel nom, avec quelle
 *  fonction. La présence (en ligne) est ajoutée par le serveur, qui seul
 *  connaît les connexions ouvertes. */
export function listRoster(roomId) {
  return ensureDb().prepare(
    `SELECT dev.fingerprint, dev.lastNickname, dev.role, dev.label, dev.lastSeen
     FROM devices dev
     JOIN room_members m ON m.fingerprint = dev.fingerprint
     WHERE m.roomId = ?
     ORDER BY dev.lastNickname COLLATE NOCASE ASC`,
  ).all(String(roomId));
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

/** Nombre total d'appareils connus de CETTE machine serveur — sert au
 *  plafond de licence (maxDevices). Tous salons confondus : la licence
 *  couvre l'organisation, pas un salon. */
export function countDevices() {
  return ensureDb().prepare("SELECT COUNT(*) AS n FROM devices").get().n;
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
