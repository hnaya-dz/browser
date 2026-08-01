// ═══════════════════════════════════════════════════════════════
// Identité d'appareil — Ed25519 (étape D : traçabilité pour l'admin)
// ═══════════════════════════════════════════════════════════════
// Principe : pseudo LIBRE en surface, identité cryptographique stable en
// dessous. Chaque appareil génère UNE FOIS une paire de clés Ed25519 ;
// chaque message est signé. L'admin peut étiqueter une empreinte
// (« poste 3, bureau RH ») : les changements de pseudo ne cachent pas le
// détenteur, et la signature prouve que le message n'a pas été altéré
// (non-répudiation — argument d'audit pour les administrations).
//
// ⚠️ La clé PRIVÉE ne quitte jamais l'appareil et n'est JAMAIS envoyée
// sur le réseau. Seules circulent : clé publique (spki base64),
// empreinte (sha256 tronqué) et signatures.
//
// ⚠️ Zéro dépendance externe : node:crypto supporte Ed25519 nativement.
// Le pendant navigateur (page mobile) vit dans mobile/crypto-src.mjs
// (@noble/curves) — les deux implémentations DOIVENT rester
// interopérables : test obligatoire dans test/identity-interop.test.mjs.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ── Canonicalisation du contenu signé ──────────────────────────────────────
// Tableau JSON à ordre FIXE — même forme côté navigateur. Ne jamais signer
// un objet (l'ordre des clés n'est pas garanti entre implémentations).
// ⚠️ Sérialisation POSITIONNELLE (tableau, pas objet) : l'ordre des clés
// d'un objet ne peut donc pas faire diverger signataire et vérificateur.
//
// Étape E — pièces jointes : l'empreinte du média est ajoutée en 5e
// position UNIQUEMENT quand il y en a une. Un message sans pièce jointe
// produit donc exactement les mêmes octets qu'avant (compatibilité totale
// avec les clients et les historiques antérieurs), et une pièce jointe ne
// peut plus être substituée après coup sans casser la signature — sans
// cela, la signature ne couvrait que le texte.
export function signablePayload({ id, from, text, ts, mediaSha }) {
  const core = [String(id), String(from), String(text), Number(ts)];
  if (mediaSha) core.push(String(mediaSha));
  return JSON.stringify(core);
}

// ── Empreinte d'appareil ───────────────────────────────────────────────────
// sha256 de la clé publique BRUTE (32 octets), tronqué à 16 hex — court,
// affichable dans le panneau admin, collision improbable à cette échelle.
export function fingerprintFromRawPublicKey(rawPub32) {
  return createHash("sha256").update(rawPub32).digest("hex").slice(0, 16);
}

// spki DER = préfixe ASN.1 fixe de 12 octets + clé brute de 32 octets
const SPKI_PREFIX_LEN = 12;
export function rawFromSpkiBase64(spkiB64) {
  const der = Buffer.from(spkiB64, "base64");
  if (der.length !== SPKI_PREFIX_LEN + 32) throw new Error("Clé publique Ed25519 invalide");
  return der.subarray(SPKI_PREFIX_LEN);
}

// ── Chargement / création de l'identité locale ─────────────────────────────
// Stockée dans <dataDir>/identity.json. La création est atomique (tmp +
// rename) pour ne jamais laisser une identité à moitié écrite.
export function loadOrCreateIdentity(dataDir) {
  const file = path.join(dataDir, "identity.json");
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved.privateKeyPkcs8 && saved.publicKeySpki) {
      return hydrate(saved);
    }
  } catch {
    // absent ou corrompu → on (re)génère ; l'ancienne identité est perdue
    // mais l'appareil en obtient simplement une nouvelle (l'admin verra
    // un « nouvel appareil », comportement voulu et sans casse)
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const saved = {
    version: 1,
    createdAt: Date.now(),
    privateKeyPkcs8: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeySpki: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(saved, null, 2));
  fs.renameSync(tmp, file);
  return hydrate(saved);
}

function hydrate(saved) {
  const privateKey = createPrivateKey({
    key: Buffer.from(saved.privateKeyPkcs8, "base64"),
    type: "pkcs8",
    format: "der",
  });
  const publicKeySpki = saved.publicKeySpki;
  const rawPub = rawFromSpkiBase64(publicKeySpki);
  return {
    publicKeySpki,
    fingerprint: fingerprintFromRawPublicKey(rawPub),
    // Signe un message ({id, from, text, ts}) → signature base64
    signMessage(msg) {
      return cryptoSign(null, Buffer.from(signablePayload(msg), "utf8"), privateKey).toString("base64");
    },
  };
}

// ── Vérification côté serveur ──────────────────────────────────────────────
// Retourne true si la signature correspond au message ET à la clé publique
// annoncée. Toute erreur (clé malformée, etc.) vaut false — jamais de throw
// sur des données venues du réseau.
export function verifyMessage(msg, signatureB64, publicKeySpkiB64) {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeySpkiB64, "base64"),
      type: "spki",
      format: "der",
    });
    return cryptoVerify(
      null,
      Buffer.from(signablePayload(msg), "utf8"),
      publicKey,
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}
