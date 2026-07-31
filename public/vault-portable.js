// public/vault-portable.js
// ══════════════════════════════════════════════════════════════════
// Sauvegarde TRANSPORTABLE du coffre-fort
//
// POURQUOI CE MODULE :
//   Le coffre quotidien (vault.js) est scellé par Windows. La chaîne est
//   vault.enc ← clé AES dans vault.key ← clé OSCrypt dans « Local State »
//   ← DPAPI, lié au compte Windows DE CE POSTE. Un fichier ainsi protégé
//   ne peut donc pas être relu sur une autre machine, ni après une
//   réinstallation de Windows — même en se reconnectant avec le même
//   compte Microsoft.
//
//   Ici la clé vient d'une PHRASE SECRÈTE choisie par l'utilisateur. Le
//   fichier ne dépend plus d'aucun secret de la machine : il se relit
//   partout, à condition de connaître la phrase.
//
// ⚠️ NE PAS MODIFIER :
//   - scrypt pour dériver la clé (lent à dessein : freine les essais
//     exhaustifs sur une phrase faible)
//   - sel ET vecteur d'initialisation aléatoires à chaque export
//   - AES-256-GCM : authentifié, toute altération du fichier est détectée
//   - Aucune dépendance à Electron : ce module doit rester testable seul
// ══════════════════════════════════════════════════════════════════

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const FORMAT = "hnaya-vault-portable";
const VERSION = 1;
const ALGO = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;

// Paramètres scrypt. N=2^15 tient sous la seconde sur une machine de
// bureau modeste tout en rendant une attaque par dictionnaire coûteuse.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Longueur minimale de la phrase secrète. En dessous, la dérivation la
// plus lente ne sauve rien : c'est la phrase elle-même qui cède.
export const MIN_PASSPHRASE = 8;

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase.normalize("NFKC"), salt, KEY_LENGTH, SCRYPT);
}

// Chiffre les entrées avec une clé dérivée de la phrase secrète.
// Retourne le contenu du fichier (chaîne JSON) prêt à être écrit.
export function exportPortable(entries, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`Phrase secrète trop courte (${MIN_PASSPHRASE} caractères minimum)`);
  }
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);
  try {
    const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
    const plain = JSON.stringify(entries);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const envelope = {
      format: FORMAT,
      version: VERSION,
      kdf: "scrypt",
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      data: enc.toString("base64"),
      count: entries.length,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(envelope, null, 2);
  } finally {
    key.fill(0); // effacer la clé de la mémoire
  }
}

// Relit un fichier produit par exportPortable.
// Lève une erreur explicite si la phrase est fausse ou le fichier altéré.
export function importPortable(fileContent, passphrase) {
  let envelope;
  try {
    envelope = JSON.parse(fileContent);
  } catch {
    throw new Error("Fichier illisible : ce n'est pas une sauvegarde Hnaya");
  }
  if (!envelope || envelope.format !== FORMAT) {
    throw new Error("Ce fichier n'est pas une sauvegarde de mots de passe Hnaya");
  }
  if (envelope.version > VERSION) {
    throw new Error("Sauvegarde créée par une version plus récente de Hnaya");
  }
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  const data = Buffer.from(envelope.data, "base64");

  // On relit les paramètres du fichier plutôt que les constantes : une
  // sauvegarde ancienne doit rester lisible si ces valeurs évoluent.
  const key = scryptSync(passphrase.normalize("NFKC"), salt, KEY_LENGTH, {
    N: envelope.N || SCRYPT.N,
    r: envelope.r || SCRYPT.r,
    p: envelope.p || SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  try {
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    const entries = JSON.parse(dec.toString("utf8"));
    if (!Array.isArray(entries)) throw new Error("contenu inattendu");
    return entries;
  } catch {
    // GCM ne distingue pas « mauvaise clé » de « fichier modifié » : les
    // deux cas échouent sur la vérification d'authenticité.
    throw new Error("Phrase secrète incorrecte, ou fichier endommagé");
  } finally {
    key.fill(0);
  }
}
