// public/favorites.js
// ══════════════════════════════════════════════════════════════════
// Gestionnaire de favoris et groupes d'onglets
// Même architecture que vault.js — AES-256-GCM + safeStorage
//
// Fichiers dans userData :
//   favorites.enc  → liste des favoris chiffrée
//   tabgroups.enc  → groupes d'onglets chiffrés
//   vault.key      → clé partagée avec le vault mots de passe
//
// ⚠️ La clé AES est partagée avec vault.js via vault.key
//    Ne pas créer une clé séparée — un seul fichier de clé
// ══════════════════════════════════════════════════════════════════

import { app, safeStorage } from "electron";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const FAVORITES_PATH  = () => join(app.getPath("userData"), "favorites.enc");
const TABGROUPS_PATH  = () => join(app.getPath("userData"), "tabgroups.enc");
const KEY_PATH        = () => join(app.getPath("userData"), "vault.key");
const ALGO      = "aes-256-gcm";
const KEY_LEN   = 32;
const IV_LEN    = 12;
const TAG_LEN   = 16;

// ── Clé AES partagée avec vault.js ───────────────────────────────
function loadOrCreateKey() {
  const keyPath = KEY_PATH();
  if (existsSync(keyPath)) {
    const encrypted = readFileSync(keyPath);
    return safeStorage.decryptString(encrypted);
  }
  const rawKey = randomBytes(KEY_LEN).toString("hex");
  const encrypted = safeStorage.encryptString(rawKey);
  writeFileSync(keyPath, encrypted);
  return rawKey;
}

function getKey() {
  return Buffer.from(loadOrCreateKey(), "hex");
}

// ── Chiffrement / Déchiffrement ──────────────────────────────────
function encrypt(plaintext, keyBuf) {
  const iv  = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, keyBuf, iv, { authTagLength: TAG_LEN });
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { version: 1, iv: iv.toString("hex"), data: enc.toString("hex"), authTag: tag.toString("hex") };
}

function decrypt(payload, keyBuf) {
  const iv      = Buffer.from(payload.iv,      "hex");
  const data    = Buffer.from(payload.data,    "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const decipher = createDecipheriv(ALGO, keyBuf, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function readEncrypted(filePath) {
  if (!existsSync(filePath)) return [];
  const keyBuf = getKey();
  try {
    const raw     = readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw);
    const plain   = decrypt(payload, keyBuf);
    return JSON.parse(plain);
  } catch { return []; }
  finally { keyBuf.fill(0); }
}

function writeEncrypted(filePath, data) {
  const keyBuf = getKey();
  try {
    const payload = encrypt(JSON.stringify(data), keyBuf);
    writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    return true;
  } catch { return false; }
  finally { keyBuf.fill(0); }
}

// ── API Favoris ──────────────────────────────────────────────────

export function favoritesRead() {
  return readEncrypted(FAVORITES_PATH());
}

export function favoritesWrite(entries) {
  return writeEncrypted(FAVORITES_PATH(), entries);
}

export function favoriteAdd({ url, title, favicon, folder = "Général" }) {
  const entries = favoritesRead();
  const exists  = entries.find(e => e.url === url);
  if (exists) return { ok: false, reason: "already_exists" };
  entries.unshift({
    id:        randomBytes(8).toString("hex"),
    url,
    title:     title || url,
    favicon:   favicon || null,
    folder,
    createdAt: Date.now(),
  });
  return { ok: favoritesWrite(entries) };
}

export function favoriteRemove(id) {
  const entries = favoritesRead().filter(e => e.id !== id);
  return { ok: favoritesWrite(entries) };
}

export function favoriteUpdate(id, updates) {
  const entries = favoritesRead().map(e => e.id === id ? { ...e, ...updates } : e);
  return { ok: favoritesWrite(entries) };
}

export function favoriteIsSaved(url) {
  return favoritesRead().some(e => e.url === url);
}

// ── API Groupes d'onglets ────────────────────────────────────────

export function tabGroupsRead() {
  return readEncrypted(TABGROUPS_PATH());
}

export function tabGroupSave({ name, tabs }) {
  const groups = tabGroupsRead();
  groups.unshift({
    id:        randomBytes(8).toString("hex"),
    name:      name || `Groupe ${new Date().toLocaleDateString()}`,
    tabs:      tabs.map(t => ({ url: t.url, title: t.title, favicon: t.faviconUrl || null })),
    createdAt: Date.now(),
  });
  return { ok: writeEncrypted(TABGROUPS_PATH(), groups) };
}

export function tabGroupDelete(id) {
  const groups = tabGroupsRead().filter(g => g.id !== id);
  return { ok: writeEncrypted(TABGROUPS_PATH(), groups) };
}

// ── Export / Import ─────────────────────────────────────────────

export function exportAll() {
  return {
    version:   1,
    exportedAt: Date.now(),
    favorites: favoritesRead(),
    tabGroups: tabGroupsRead(),
  };
}

export function importAll(data) {
  let ok = true;
  if (Array.isArray(data.favorites)) ok = ok && favoritesWrite(data.favorites);
  if (Array.isArray(data.tabGroups)) ok = ok && writeEncrypted(TABGROUPS_PATH(), data.tabGroups);
  return { ok };
}
