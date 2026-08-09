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

// Coordonnées de renouvellement — affichées dans TOUS les avertissements
// d'échéance, sur le poste comme sur le mobile. Un client dont la licence
// arrive à terme doit savoir qui appeler sans chercher.
export const CONTACT_HNAYA = { tel: "+213558303030", email: "contact@hnaya.dz" };
export const CONTACT_TEXTE = `Hnaya DZ — ${CONTACT_HNAYA.tel} — ${CONTACT_HNAYA.email}`;

// ── Ce qui se passe à l'échéance ───────────────────────────────────────
// Une licence expirée n'éteint PAS le serveur : elle le fait taire.
//
//   active   │ échéance non atteinte           │ tout fonctionne
//   grace    │ 0 à 29 jours après l'échéance   │ tout fonctionne + avertissement
//   readonly │ 30 jours après l'échéance       │ lecture seule : plus d'envoi
//
// Trois raisons de ne jamais couper le serveur :
//  1. L'historique d'une administration est un document de travail. Le
//     retenir en otage pour une facture n'est pas défendable, et serait
//     probablement contraire aux règles d'archivage du client.
//  2. Le serveur tourne en tâche SYSTEM sur une machine sans écran : un
//     refus de démarrage est invisible, personne ne saurait pourquoi la
//     messagerie a disparu.
//  3. Le mode lecture seule est PARLANT. L'utilisateur voit le bandeau,
//     ne peut plus écrire, et sait qui appeler — c'est ce qui déclenche
//     le renouvellement, pas une panne muette.
export const GRACE_DAYS = 30;

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
 * Ne lève JAMAIS. Retourne :
 *   { ok: false, error }                      fichier illisible, incomplet,
 *                                             ou signature invalide
 *   { ok: true, licence, daysLeft, mode,      signature valide ; `mode` dit
 *     graceDaysLeft?, notice? }               ce que le serveur a le droit
 *                                             de faire (voir GRACE_DAYS)
 *
 * ⚠️ `ok` signifie « signée par Hnaya DZ », PAS « en cours de validité ».
 * Une licence échue reste `ok` — c'est `mode` qui devient "grace" puis
 * "readonly". Tout appelant qui décide d'une AUTORISATION doit lire `mode` ;
 * se contenter de `ok` rendrait l'échéance de nouveau inopposable.
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
  const echeance = dateFr(expiresTs);

  if (daysLeft >= 0) {
    // Préavis dans le dernier mois : l'avertissement doit arriver AVANT la
    // coupure, pas le jour où elle tombe.
    const notice = daysLeft <= GRACE_DAYS
      ? `Licence Hnaya « ${p.org} » : échéance le ${echeance}, dans ${daysLeft} jour(s). Pensez au renouvellement — ${CONTACT_TEXTE}`
      : null;
    return { ok: true, licence: p, daysLeft, mode: "active", notice };
  }

  // Au-delà de l'échéance : jours de dépassement, et non « jours restants ».
  const depasse = -daysLeft;
  if (depasse < GRACE_DAYS) {
    const reste = GRACE_DAYS - depasse;
    return {
      ok: true, licence: p, daysLeft, mode: "grace", graceDaysLeft: reste,
      notice: `Licence Hnaya « ${p.org} » expirée le ${echeance}. L'envoi de messages sera suspendu dans ${reste} jour(s) ; l'historique restera consultable. Renouvellement : ${CONTACT_TEXTE}`,
    };
  }
  return {
    ok: true, licence: p, daysLeft, mode: "readonly", graceDaysLeft: 0, expired: true,
    notice: `Licence Hnaya « ${p.org} » expirée le ${echeance}. L'envoi de messages est suspendu ; l'historique reste consultable et rien n'a été effacé. Renouvellement : ${CONTACT_TEXTE}`,
  };
}

function dateFr(ts) {
  return new Date(ts).toLocaleDateString("fr-FR");
}
