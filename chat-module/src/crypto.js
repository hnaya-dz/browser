// ═══════════════════════════════════════════════════════════════
// Chiffrement léger basé sur le PIN de session
// ═══════════════════════════════════════════════════════════════
// ⚠️ Ce n'est PAS un chiffrement de bout en bout façon Signal — c'est un
// chiffrement symétrique de tout le canal WebSocket, dérivé d'un secret
// partagé (le PIN affiché par l'hôte). Objectif MVP : empêcher qu'un tiers
// qui écoute passivement le wifi (ou qui découvre le salon via mDNS/UDP)
// puisse lire les messages sans connaître le PIN. Ce n'est pas une preuve
// de sécurité de niveau messagerie professionnelle — voir README.md.
//
// N'utilise QUE le module natif "crypto" de Node — aucune dépendance
// externe, donc aucun risque de compilation native lors du packaging.

import crypto from "node:crypto";

// Sel fixe : le secret réel vient entièrement du PIN, pas du sel.
// Un sel fixe est acceptable ici car chaque session utilise un PIN
// généré aléatoirement (voir generatePin ci-dessous).
const SALT = "hnaya-chat-lan-v1";

/**
 * Dérive une clé AES-256 à partir du PIN de session (scrypt : coûteux à
 * bruteforcer, standard et déjà présent dans Node — zéro dépendance).
 */
export function deriveKeyFromPin(pin) {
  return crypto.scryptSync(String(pin), SALT, 32);
}

/**
 * Chiffre un objet JS en AES-256-GCM et retourne une chaîne base64
 * prête à envoyer sur le WebSocket : [iv(12)][authTag(16)][ciphertext].
 */
export function encryptPayload(key, plaintextObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(plaintextObj), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Déchiffre une chaîne base64 produite par encryptPayload().
 * Lève une exception si la clé (donc le PIN) est incorrecte —
 * c'est voulu : un mauvais PIN doit rendre les messages illisibles,
 * pas planter le serveur.
 */
export function decryptPayload(key, b64) {
  const raw = Buffer.from(b64, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

/**
 * Génère un PIN à 6 chiffres pour une nouvelle session — affiché par
 * l'hôte, à communiquer oralement/manuellement aux autres participants.
 * ⚠️ Ne jamais transmettre le PIN via le beacon de découverte (discovery.js)
 * — seule l'existence du salon doit être annoncée sur le réseau, jamais
 * le secret qui protège son contenu.
 */
export function generatePin() {
  return String(crypto.randomInt(100000, 999999));
}
