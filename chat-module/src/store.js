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
export function initStore(dataDir = DEFAULT_DATA_DIR) {
  if (db) return db;
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
  `);
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
      (id, groupId, sender, text, ts, deviceFp, signature, signatureValid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      String(msg.id),
      String(msg.groupId || "all"),
      String(msg.from),
      String(msg.text),
      Number(msg.ts),
      msg.deviceFp || null,
      msg.signature || null,
      msg.signatureValid ? 1 : 0,
    );
  // inserted=false ⇒ id déjà en base (doublon/rejeu) — le serveur s'en sert
  // pour ne pas rediffuser
  return { ...msg, inserted: Number(res.changes) > 0 };
}

export function getMessagesSince(groupId, sinceTs = 0) {
  return ensureDb()
    .prepare("SELECT * FROM messages WHERE groupId = ? AND ts > ? ORDER BY ts ASC")
    .all(String(groupId), Number(sinceTs))
    .map(rowToMessage);
}

export function purgeOldMessages() {
  const days = Number(getConfig("retention_days", DEFAULT_RETENTION_DAYS));
  if (days <= 0) return countMessages(); // 0 = rétention illimitée
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  ensureDb().prepare("DELETE FROM messages WHERE ts < ?").run(cutoff);
  return countMessages();
}

function countMessages() {
  return Number(ensureDb().prepare("SELECT COUNT(*) AS n FROM messages").get().n);
}

function rowToMessage(r) {
  return {
    id: r.id,
    groupId: r.groupId,
    from: r.sender,
    text: r.text,
    ts: Number(r.ts),
    deviceFp: r.deviceFp || null,
    signature: r.signature || null,
    signatureValid: !!r.signatureValid,
  };
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

export function setDeviceLabel(fingerprint, label) {
  ensureDb().prepare("UPDATE devices SET label = ? WHERE fingerprint = ?")
    .run(label || null, fingerprint);
}

export function listDevices() {
  return ensureDb().prepare("SELECT * FROM devices ORDER BY lastSeen DESC").all()
    .map((r) => ({ ...r, nicknames: safeJson(r.nicknames, []) }));
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
export function searchMessages({ groupId, deviceFp, from, q, fromTs, toTs, limit = 500 } = {}) {
  const where = [];
  const params = [];
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

// ── Configuration persistante ──────────────────────────────────────────────
export function getConfig(key, defaultValue = null) {
  const r = ensureDb().prepare("SELECT value FROM config WHERE key = ?").get(key);
  return r ? r.value : defaultValue;
}

export function setConfig(key, value) {
  ensureDb().prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, String(value));
}
