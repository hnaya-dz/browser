// ═══════════════════════════════════════════════════════════════
// Crypto navigateur pour la page mobile — SOURCE du bundle
// ═══════════════════════════════════════════════════════════════
// La page mobile est servie en http:// sur le LAN (pas de TLS possible sur
// une IP privée) → crypto.subtle est INDISPONIBLE (réservé aux contextes
// sécurisés). On utilise donc les implémentations pures JS auditées de
// noble (@noble/hashes, @noble/ciphers), bundlées en un seul fichier.
//
// ⚠️ COMPATIBILITÉ BIT-À-BIT avec src/crypto.js (Node) obligatoire :
//   - scrypt(pin, "hnaya-chat-lan-v1", 32) — paramètres par défaut de
//     Node : N=16384, r=8, p=1 (à répliquer explicitement ici)
//   - AES-256-GCM, format de trame base64 : [iv(12)][authTag(16)][ct]
//     (noble produit/attend ct||tag accolés → réarrangement ci-dessous)
// Toute modification ici doit être vérifiée par le test d'interopérabilité
// (voir README) puis suivie d'une reconstruction du bundle :
//   npx esbuild mobile/crypto-src.mjs --bundle --format=esm --minify
//     --outfile=mobile/vendor/crypto-bundle.js
//
// crypto.getRandomValues (utilisé pour l'IV) reste disponible même sur
// origine non sécurisée — seul crypto.subtle est restreint.

import { scryptAsync } from "@noble/hashes/scrypt.js";
import { gcm } from "@noble/ciphers/aes.js";

const SALT = "hnaya-chat-lan-v1"; // même sel fixe que src/crypto.js

function b64encode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Async (contrairement à Node) : scrypt pur JS ~100-300 ms sur mobile —
 *  on ne bloque pas l'UI pendant la dérivation. */
export async function deriveKeyFromPin(pin) {
  return scryptAsync(String(pin), SALT, { N: 16384, r: 8, p: 1, dkLen: 32 });
}

export function encryptPayload(key, plaintextObj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(plaintextObj));
  const sealed = gcm(key, iv).encrypt(plaintext); // noble : [ct][tag(16)]
  const ct = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const raw = new Uint8Array(12 + 16 + ct.length); // trame Hnaya : [iv][tag][ct]
  raw.set(iv, 0);
  raw.set(tag, 12);
  raw.set(ct, 28);
  return b64encode(raw);
}

export function decryptPayload(key, b64) {
  const raw = b64decode(b64);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const sealed = new Uint8Array(ct.length + 16); // noble attend [ct][tag]
  sealed.set(ct, 0);
  sealed.set(tag, ct.length);
  const plaintext = gcm(key, iv).decrypt(sealed); // jette si PIN incorrect
  return JSON.parse(new TextDecoder().decode(plaintext));
}
