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
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

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

// ═══════════════════════════════════════════════════════════════
// Identité d'appareil Ed25519 — pendant navigateur de src/identity.js
// ═══════════════════════════════════════════════════════════════
// ⚠️ INTEROPÉRABILITÉ OBLIGATOIRE avec Node (src/identity.js) :
//   - contenu signé : JSON.stringify([id, from, text, ts]) — ordre FIXE
//   - clé publique échangée au format spki DER base64 (préfixe ASN.1
//     de 12 octets + clé brute de 32 octets)
//   - signature : Ed25519 RFC 8032 (déterministe), 64 octets, base64
// Vérifié par test/crypto-interop.test.mjs — à relancer après toute
// modification, puis reconstruire le bundle (commande en tête de fichier).

const SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

// ⚠️ DOIT rester octet pour octet identique à signablePayload dans
// src/identity.js — sinon l'hôte rejette les signatures du téléphone.
// Étape E : l'empreinte de la pièce jointe est ajoutée en 5e position
// UNIQUEMENT quand il y en a une, de sorte qu'un message sans pièce
// jointe signe exactement les mêmes octets qu'auparavant.
// Étape G — citation. Quand elle existe, l'emplacement du média est
// TOUJOURS écrit, vide au besoin : sans cela la citation occuperait le
// rang de mediaSha et un message à pièce jointe pourrait être rejoué en
// message citant, avec la même signature valide.
// ⚠️ Les champs optionnels occupent des RANGS FIXES ; dès qu'un rang sert,
// les précédents sont écrits, vides au besoin. Deux champs ne doivent
// jamais pouvoir partager un rang, sinon un message se rejoue en un autre
// avec la même signature valide.
// Rangs : 5 = mediaSha, 6 = replyTo, 7 = voteSha.
function signablePayload({ id, from, text, ts, mediaSha, replyTo, voteSha }) {
  const core = [String(id), String(from), String(text), Number(ts)];
  const optionnels = [mediaSha, replyTo, voteSha];
  let dernier = -1;
  optionnels.forEach((v, i) => { if (v) dernier = i; });
  for (let i = 0; i <= dernier; i++) core.push(optionnels[i] ? String(optionnels[i]) : "");
  return new TextEncoder().encode(JSON.stringify(core));
}

/** Recharge une identité depuis sa clé privée (32 octets base64, stockée
 *  en localStorage — elle ne quitte JAMAIS l'appareil). */
export function identityFromPrivate(privateKeyB64) {
  const priv = b64decode(privateKeyB64);
  if (priv.length !== 32) throw new Error("Clé privée Ed25519 invalide");
  const pub = ed25519.getPublicKey(priv);
  const spki = new Uint8Array(SPKI_PREFIX.length + 32);
  spki.set(SPKI_PREFIX, 0);
  spki.set(pub, SPKI_PREFIX.length);
  return {
    privateKeyB64,
    publicKeySpki: b64encode(spki),
    // Même empreinte que côté serveur : sha256(clé brute) tronqué à 16 hex
    fingerprint: Array.from(sha256(pub).subarray(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(""),
    signMessage(msg) {
      return b64encode(ed25519.sign(signablePayload(msg), priv));
    },
  };
}

/** Génère une identité neuve (première visite de la page sur cet appareil). */
export function generateIdentity() {
  const priv = crypto.getRandomValues(new Uint8Array(32));
  return identityFromPrivate(b64encode(priv));
}

/** Vérification (symétrie avec Node — utilisée par les tests d'interop). */
export function verifyMessage(msg, signatureB64, publicKeySpkiB64) {
  try {
    const spki = b64decode(publicKeySpkiB64);
    if (spki.length !== SPKI_PREFIX.length + 32) return false;
    return ed25519.verify(b64decode(signatureB64), signablePayload(msg), spki.subarray(SPKI_PREFIX.length));
  } catch {
    return false;
  }
}
