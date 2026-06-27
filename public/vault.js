// public/vault.js
// ══════════════════════════════════════════════════════════════════
// Gestionnaire de mots de passe — Architecture Hybride Option C
//
// FONCTIONNEMENT :
//   1. safeStorage (DPAPI Windows / Keychain macOS) chiffre la clé AES
//   2. La clé AES chiffre le vault (AES-256-GCM)
//   3. Le vault = fichier JSON chiffré dans userData/vault.enc
//
// AUCUNE inscription, AUCUN serveur, AUCUNE donnée transmise.
//
// ⚠️ NE PAS MODIFIER :
//   - L'algorithme AES-256-GCM (authentifié — détecte toute altération)
//   - Le stockage de la clé via safeStorage (jamais en clair sur disque)
//   - IV unique par opération (crypto.randomBytes(12))
//   - Buffer.fill(0) après usage de la clé (effacement mémoire)
// ══════════════════════════════════════════════════════════════════

import { app, safeStorage } from "electron";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const VAULT_PATH    = () => join(app.getPath("userData"), "vault.enc");
const KEY_PATH      = () => join(app.getPath("userData"), "vault.key");
const ALGO          = "aes-256-gcm";
const KEY_LENGTH    = 32; // 256 bits
const IV_LENGTH     = 12; // 96 bits — recommandé pour GCM
const TAG_LENGTH    = 16; // 128 bits authTag

// ── Clé AES ─────────────────────────────────────────────────────────────────

// Charger ou créer la clé AES, protégée par safeStorage
function loadOrCreateKey() {
  const keyPath = KEY_PATH();

  if (existsSync(keyPath)) {
    // Lire la clé chiffrée par safeStorage et la déchiffrer
    const encrypted = readFileSync(keyPath);
    return safeStorage.decryptString(encrypted);
  }

  // Première utilisation — générer une clé aléatoire
  const rawKey = randomBytes(KEY_LENGTH).toString("hex"); // 64 hex chars = 32 bytes
  const encrypted = safeStorage.encryptString(rawKey);
  writeFileSync(keyPath, encrypted);
  return rawKey;
}

// Obtenir la clé AES en Buffer (effacer après usage)
function getKey() {
  const hexKey = loadOrCreateKey();
  return Buffer.from(hexKey, "hex");
}

// ── Chiffrement / Déchiffrement ──────────────────────────────────────────────

function encrypt(plaintext, keyBuf) {
  const iv  = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, keyBuf, iv, { authTagLength: TAG_LENGTH });
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv:      iv.toString("hex"),
    data:    enc.toString("hex"),
    authTag: tag.toString("hex"),
  };
}

function decrypt(payload, keyBuf) {
  const iv      = Buffer.from(payload.iv,      "hex");
  const data    = Buffer.from(payload.data,    "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const decipher = createDecipheriv(ALGO, keyBuf, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

// ── Opérations sur le vault ─────────────────────────────────────────────────

// Lire et déchiffrer le vault entier
export function vaultRead() {
  const vaultPath = VAULT_PATH();
  if (!existsSync(vaultPath)) return [];

  const keyBuf = getKey();
  try {
    const raw     = readFileSync(vaultPath, "utf8");
    const payload = JSON.parse(raw);
    const plain   = decrypt(payload, keyBuf);
    return JSON.parse(plain);
  } catch (e) {
    console.error("[vault] Erreur de lecture :", e.message);
    return [];
  } finally {
    keyBuf.fill(0); // ✅ effacer la clé de la mémoire
  }
}

// Chiffrer et écrire le vault entier
export function vaultWrite(entries) {
  const keyBuf = getKey();
  try {
    const plain   = JSON.stringify(entries);
    const payload = encrypt(plain, keyBuf);
    const meta    = { version: 1, ...payload };
    writeFileSync(VAULT_PATH(), JSON.stringify(meta, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("[vault] Erreur d'écriture :", e.message);
    return false;
  } finally {
    keyBuf.fill(0); // ✅ effacer la clé de la mémoire
  }
}

// Ajouter ou mettre à jour une entrée
export function vaultUpsert(entry) {
  const entries = vaultRead();
  const idx = entries.findIndex(e => e.id === entry.id);
  if (idx >= 0) entries[idx] = entry;
  else entries.push({ ...entry, id: randomBytes(8).toString("hex"), createdAt: Date.now() });
  return vaultWrite(entries);
}

// Supprimer une entrée par id
export function vaultDelete(id) {
  const entries = vaultRead().filter(e => e.id !== id);
  return vaultWrite(entries);
}

// Trouver les entrées correspondant à un domaine
export function vaultFindByDomain(domain) {
  return vaultRead().filter(e => {
    try {
      const host = new URL(e.url || "").hostname.replace("www.", "");
      return host === domain || domain.endsWith("." + host);
    } catch { return false; }
  });
}

// Vérifier si safeStorage est disponible sur cette machine
export function vaultIsAvailable() {
  return safeStorage.isEncryptionAvailable();
}
