// public/chat-session.js
// ══════════════════════════════════════════════════════════════════
// Sessions de la Messagerie locale — « rester connecté sur ce PC »
// ══════════════════════════════════════════════════════════════════
// POURQUOI CE FICHIER EXISTE, séparé du gestionnaire de mots de passe :
//
// Un code de salon N'EST PAS un identifiant personnel. Le PIN d'accès est
// un secret PARTAGÉ par tout un service (comme une clé wifi) : le ranger
// dans « Mots de passe enregistrés », aux côtés des comptes personnels de
// l'utilisateur, mélange deux natures de secrets et brouille la lecture
// de sa propre liste. On garde donc les deux mondes séparés :
//
//   vault.enc         → identifiants de SITES WEB (personnels)
//   chat-session.enc  → sessions de salons (ce fichier)
//
// Ce que ce store retient, uniquement si l'utilisateur le demande
// explicitement (« Rester connecté à ce salon sur ce PC ») :
//   - le code d'accès d'un salon distant, pour ne pas le retaper ;
//   - éventuellement le code d'administration de ce même salon.
//
// ⚠️ L'HÔTE N'A RIEN À Y METTRE : les codes des salons qu'il héberge
// vivent déjà dans la base du module (table rooms) et lui sont restitués
// à chaque réouverture.
//
// Même protection que le coffre : clé AES scellée par safeStorage
// (DPAPI/Keychain), contenu en AES-256-GCM. Rien ne part sur le réseau.

import { app, safeStorage } from "electron";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";

const STORE_PATH = () => join(app.getPath("userData"), "chat-session.enc");
const KEY_PATH = () => join(app.getPath("userData"), "chat-session.key");
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey() {
  const keyPath = KEY_PATH();
  if (existsSync(keyPath)) {
    return Buffer.from(safeStorage.decryptString(readFileSync(keyPath)), "hex");
  }
  const rawKey = randomBytes(32).toString("hex");
  writeFileSync(keyPath, safeStorage.encryptString(rawKey));
  return Buffer.from(rawKey, "hex");
}

function readAll() {
  const file = STORE_PATH();
  if (!existsSync(file)) return {};
  let key;
  try {
    key = getKey();
    const raw = readFileSync(file);
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const data = raw.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"));
  } catch {
    // Fichier illisible (clé changée, disque corrompu) — on repart à vide
    // plutôt que d'empêcher l'ouverture de la messagerie
    return {};
  } finally {
    key?.fill(0);
  }
}

function writeAll(sessions) {
  let key;
  try {
    key = getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
    const body = Buffer.concat([
      cipher.update(JSON.stringify(sessions), "utf8"),
      cipher.final(),
    ]);
    writeFileSync(STORE_PATH(), Buffer.concat([iv, cipher.getAuthTag(), body]));
    return true;
  } catch {
    return false;
  } finally {
    key?.fill(0);
  }
}

/** Session d'un salon : { roomName, accessPin, adminPin, savedAt } ou null */
export function getChatSession(roomKey) {
  if (!roomKey) return null;
  return readAll()[String(roomKey)] || null;
}

/** Enregistre/complète une session. Les champs absents sont conservés. */
export function saveChatSession(roomKey, { roomName, accessPin, adminPin } = {}) {
  if (!roomKey) return false;
  const all = readAll();
  const prev = all[String(roomKey)] || {};
  all[String(roomKey)] = {
    roomName: roomName ?? prev.roomName ?? null,
    accessPin: accessPin ?? prev.accessPin ?? null,
    adminPin: adminPin ?? prev.adminPin ?? null,
    savedAt: Date.now(),
  };
  return writeAll(all);
}

/** Oublie une session (bouton « se déconnecter de ce salon »). */
export function forgetChatSession(roomKey) {
  const all = readAll();
  delete all[String(roomKey)];
  return writeAll(all);
}

/** Liste des salons « restés connectés » (sans les codes). */
export function listChatSessions() {
  return Object.entries(readAll()).map(([roomKey, s]) => ({
    roomKey,
    roomName: s.roomName || roomKey,
    hasAdminPin: !!s.adminPin,
    savedAt: s.savedAt || 0,
  }));
}

/** Efface tout (bouton « oublier toutes les sessions »). */
export function clearChatSessions() {
  try { if (existsSync(STORE_PATH())) unlinkSync(STORE_PATH()); return true; }
  catch { return false; }
}
