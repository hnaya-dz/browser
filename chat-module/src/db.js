// ═══════════════════════════════════════════════════════════════
// Persistance — fichier JSON (MVP), pas de SQLite pour l'instant
// ═══════════════════════════════════════════════════════════════
// ⚠️ Choix volontaire pour ce squelette : un store JSON à plat évite toute
// dépendance native (better-sqlite3/sqlite3 nécessitent une compilation
// C++ qui peut casser `yarn dist` sur certaines machines/CI). Pour un
// usage familial/PME avec un volume de messages modeste, c'est largement
// suffisant. Si le volume grandit, remplacer ce fichier par une vraie
// base (SQLite) sans changer la signature des fonctions exportées —
// le reste du module ne dépend que de cette API.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

// Purge automatique — cohérent avec la philosophie confidentialité du
// projet (pas de rétention indéfinie par défaut). Ajustable selon le
// contexte de déploiement (famille / PME / administration).
const RETENTION_DAYS = 30;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, "[]");
}

function readAll() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8"));
  } catch {
    // fichier corrompu (coupure pendant écriture, etc.) — on repart propre
    // plutôt que de faire planter le serveur de chat
    return [];
  }
}

function writeAll(messages) {
  ensureStore();
  // Écriture atomique : fichier temporaire puis renommage. Évite un
  // fichier messages.json à moitié écrit si l'app est fermée brutalement
  // pendant la sauvegarde.
  const tmp = MESSAGES_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(messages));
  fs.renameSync(tmp, MESSAGES_FILE);
}

export function saveMessage(msg) {
  const all = readAll();
  all.push(msg);
  writeAll(all);
  return msg;
}

export function getMessagesSince(groupId, sinceTs = 0) {
  return readAll().filter((m) => m.groupId === groupId && m.ts > sinceTs);
}

export function purgeOldMessages() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const kept = readAll().filter((m) => m.ts >= cutoff);
  writeAll(kept);
  return kept.length;
}
