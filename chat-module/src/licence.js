// ═══════════════════════════════════════════════════════════════
// Licence hors-ligne du serveur permanent (tier premium, étape D)
// ═══════════════════════════════════════════════════════════════
// Le mode POSTE (salon éphémère créé depuis le navigateur) reste libre.
// Le mode SERVEUR PERMANENT (serve.js) exige un fichier de licence signé
// par Hnaya DZ. La vérification est 100 % locale — aucun serveur
// d'activation, aucune connexion : cohérent avec « vos données chez vous ».
//
// Format du fichier .hnaya-lic (JSON) :
//   { payload: { format, id, org, issued, expires, maxDevices },
//     signature: <base64> }
// La signature Ed25519 couvre le payload CANONIQUE (clés triées) — le même
// algorithme que l'identité des appareils (identity.js), via node:crypto,
// donc AUCUNE dépendance ajoutée.
//
// ⚠️ La clé privée de signature n'est PAS dans ce dépôt. Elle est conservée
// par Hnaya DZ (Documents/HNAYA/hnaya-licences/) et utilisée par
// tools/make-licence.mjs à chaque vente. Ne jamais la committer.

import { createPublicKey, verify as cryptoVerify } from "node:crypto";

export const LICENCE_FORMAT = "hnaya-chat-server-licence";
export const LICENCE_VERSION = 1;

// Clé publique de Hnaya DZ (SPKI DER, base64) — remplacée uniquement si la
// clé privée est compromise (les licences déjà émises devront être réémises).
export const HNAYA_PUBLIC_KEY_B64 =
  "MCowBQYDK2VwAyEAKybRz3TydKACcysCjLa7RDtzf2S4Rm2qBsNeV17Edig=";

// Sérialisation canonique : mêmes données → mêmes octets, quel que soit
// l'ordre d'écriture des clés. Indispensable pour une signature stable.
export function canonicalPayload(payload) {
  const sorted = {};
  for (const k of Object.keys(payload).sort()) sorted[k] = payload[k];
  return Buffer.from(JSON.stringify(sorted), "utf8");
}

function publicKeyFromB64(b64) {
  return createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" });
}

/**
 * Vérifie un fichier de licence (contenu texte).
 * Ne lève JAMAIS : retourne toujours { ok, error?, licence?, daysLeft? }
 * avec un message d'erreur en français destiné à l'écran/au journal.
 * `now` et `publicKeyB64` ne servent qu'aux tests.
 */
export function verifyLicence(fileContent, { now = Date.now(), publicKeyB64 = HNAYA_PUBLIC_KEY_B64 } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(String(fileContent));
  } catch {
    return { ok: false, error: "Fichier illisible : ce n'est pas une licence Hnaya" };
  }
  const p = parsed?.payload;
  if (!p || parsed.signature === undefined || p.format !== LICENCE_FORMAT) {
    return { ok: false, error: "Ce fichier n'est pas une licence de serveur Hnaya" };
  }
  if ((p.version || 1) > LICENCE_VERSION) {
    return { ok: false, error: "Licence émise pour une version plus récente de Hnaya" };
  }
  for (const field of ["id", "org", "issued", "expires", "maxDevices"]) {
    if (p[field] === undefined || p[field] === null || p[field] === "") {
      return { ok: false, error: `Licence incomplète (champ « ${field} » manquant)` };
    }
  }
  let valid = false;
  try {
    valid = cryptoVerify(
      null, // Ed25519 : l'algorithme de hachage est intrinsèque
      canonicalPayload(p),
      publicKeyFromB64(publicKeyB64),
      Buffer.from(parsed.signature, "base64"),
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    return { ok: false, error: "Signature invalide : licence altérée ou non émise par Hnaya DZ" };
  }
  const expiresTs = Date.parse(p.expires);
  if (!Number.isFinite(expiresTs)) {
    return { ok: false, error: "Licence incomplète (échéance illisible)" };
  }
  const daysLeft = Math.floor((expiresTs - now) / 86400000);
  if (daysLeft < 0) {
    return { ok: false, expired: true, licence: p, error: `Licence expirée depuis le ${new Date(expiresTs).toLocaleDateString("fr-FR")} — contactez Hnaya DZ pour la renouveler` };
  }
  return { ok: true, licence: p, daysLeft };
}
