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
  randomBytes,
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
// Étape G — citation : le message cité fait partie de ce qui est attesté.
// Sans cela, on pourrait déplacer un « je valide » signé sous une autre
// demande — exactement ce qu'une administration ne peut pas se permettre.
//
// ⚠️ La citation N'EST PAS simplement ajoutée à la suite : elle occuperait
// alors le même rang que mediaSha, et un message signé portant une pièce
// jointe pourrait être rejoué comme un message citant (mêmes octets, donc
// même signature valide). Quand une citation existe, l'emplacement du
// média est donc TOUJOURS présent, vide s'il n'y a pas de pièce jointe.
// Un message sans citation signe exactement les mêmes octets qu'avant.
// Étape H — vote : l'empreinte de la DÉFINITION du vote (ses options et
// son mode) est signée elle aussi. Sans cela, on pourrait contester après
// coup les choix réellement proposés, ou prétendre qu'un vote nominatif
// ne l'était pas — ce qui viderait la traçabilité de son sens.
//
// ⚠️ RÈGLE GÉNÉRALE, à respecter pour tout champ ajouté ensuite : les
// champs optionnels occupent des RANGS FIXES. Dès qu'un rang est utilisé,
// tous ceux qui le précèdent sont écrits, vides au besoin. Sans cette
// règle, deux champs différents partageraient un rang et un message
// pourrait être rejoué en un autre AVEC LA MÊME SIGNATURE VALIDE.
// Étape K — demande qualifiée : l'étiquette (pour info, avis, validation,
// approbation) et le DESTINATAIRE désigné sont signés eux aussi. Une
// étiquette non signée se requalifierait après coup — transformer un
// « pour info » en « approbation », ou retirer l'étiquette d'une demande
// pour prétendre n'avoir jamais rien demandé. Le destinataire est dans le
// même sceau : sans lui, on pourrait rediriger une demande de validation
// vers quelqu'un d'autre après signature.
//
// Rangs : 5 = mediaSha, 6 = replyTo, 7 = voteSha, 8 = demandeSha.
export function signablePayload({ id, from, text, ts, mediaSha, replyTo, voteSha, demandeSha }) {
  const core = [String(id), String(from), String(text), Number(ts)];
  const optionnels = [mediaSha, replyTo, voteSha, demandeSha];
  let dernier = -1;
  optionnels.forEach((v, i) => { if (v) dernier = i; });
  for (let i = 0; i <= dernier; i++) core.push(optionnels[i] ? String(optionnels[i]) : "");
  return JSON.stringify(core);
}

// ── Étape H — attestations de vote ─────────────────────────────────────────
// Le rang 7 (voteSha) sert à DEUX choses : sceller la définition d'un vote,
// et sceller une réponse. Les deux sont donc PRÉFIXÉES, sinon une réponse
// pourrait être rejouée comme une définition (ou l'inverse) dès lors que
// les chaînes coïncideraient. Ne jamais retirer ces préfixes.
export function voteDefinitionSeal(options, nominatif) {
  const canonique = JSON.stringify([options.map(String), !!nominatif]);
  return "def:" + createHash("sha256").update(canonique).digest("hex").slice(0, 32);
}

export function voteAnswerSeal(voteId, choice) {
  return "ans:" + String(voteId) + ":" + Number(choice);
}

// ── Étape K — attestations de demande qualifiée ────────────────────────────
// Même règle que pour le vote : le rang 8 sert à DEUX choses — sceller la
// demande, et sceller la décision qui y répond. Les deux sont préfixées,
// sinon une décision pourrait être rejouée comme une demande.
//
// ⚠️ Ne JAMAIS retirer le destinataire du sceau de la demande. C'est lui
// qui rend la réponse imputable : « le Directeur a validé » ne vaut que si
// personne ne peut prétendre après coup que la demande lui était adressée.
export function demandeSeal(tag, destinataire) {
  const canonique = JSON.stringify([String(tag), String(destinataire || "")]);
  return "dem:" + createHash("sha256").update(canonique).digest("hex").slice(0, 32);
}

// La décision porte sur un message PRÉCIS et une issue PRÉCISE. L'identifiant
// du message y figure en clair : déplacer un « validé » sous une autre
// demande casse la signature.
export function decisionSeal(messageId, issue) {
  return "dec:" + String(messageId) + ":" + String(issue);
}

// ── Étape P — réunion annoncée ─────────────────────────────────────────────
// Même rang 8, troisième préfixe. L'heure et la durée sont SCELLÉES : une
// réunion dont on pourrait déplacer l'horaire après signature ne vaudrait
// pas mieux qu'un message libre, et le fichier .ics exporté porterait une
// heure que personne n'a réellement annoncée.
export function meetingSeal(titre, debutMs, dureeMin) {
  const canonique = JSON.stringify([String(titre), Number(debutMs), Number(dureeMin)]);
  return "mtg:" + createHash("sha256").update(canonique).digest("hex").slice(0, 32);
}

// ── Étape R — décaler ou annuler une réunion ───────────────────────────
// En entreprise, une réunion se déplace ou tombe plus souvent qu'elle ne
// se tient telle qu'annoncée. Mais l'heure est SCELLÉE : on ne modifie
// donc jamais la convocation d'origine — on publie une mise à jour, signée
// elle aussi, qui la remplace. L'annonce initiale reste dans l'historique,
// et l'on peut établir qui a déplacé quoi, et quand.
//
// Quatrième préfixe du rang 8, après dem:, dec: et mtg:. La nouvelle heure
// entre dans le sceau : une mise à jour n'est pas plus modifiable que ce
// qu'elle remplace.
export function meetingUpdateSeal(meetingId, action, debutMs, dureeMin) {
  const canonique = JSON.stringify([
    String(meetingId), String(action), Number(debutMs) || 0, Number(dureeMin) || 0,
  ]);
  return "mup:" + createHash("sha256").update(canonique).digest("hex").slice(0, 32);
}

// ── Étape L — jeton d'appairage d'un second appareil ───────────────────────
// « Ajouter mon mobile » ne transportait que le pseudo : le téléphone
// arrivait avec sa propre clé, donc une seconde fiche, donc un doublon
// partout — annuaire, vote, décisions.
//
// Le rattachement doit être PROUVÉ, jamais déclaré : sans preuve, n'importe
// qui se déclarerait second appareil du Directeur et validerait à sa place.
// L'appareil déjà connu signe donc un jeton court, à usage unique, que le
// nouveau présente à l'arrivée. L'hôte vérifie cette signature avec la clé
// publique qu'il détient déjà.
//
// ⚠️ Forme distincte de celle d'un message, et c'est délibéré. Un message
// signe [id, from, text, ts] où ts est un NOMBRE ; un jeton signe
// ["pair", fp, exp, nonce] où le nonce est une CHAÎNE hexadécimale. Les
// octets ne peuvent donc jamais coïncider, et un jeton d'appairage ne peut
// pas être rejoué comme un message signé — ni l'inverse.
export function pairingPayload({ fp, exp, nonce }) {
  return JSON.stringify(["pair", String(fp), Number(exp), String(nonce)]);
}

/** Vérifie un jeton présenté au join. Ne lève jamais : retourne un booléen.
 *  L'expiration et l'unicité du nonce sont contrôlées par l'appelant —
 *  seule la signature se vérifie ici. */
export function verifyPairing(token, publicKeySpkiB64) {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeySpkiB64, "base64"), type: "spki", format: "der",
    });
    return cryptoVerify(
      null,
      Buffer.from(pairingPayload(token), "utf8"),
      publicKey,
      Buffer.from(token.sig, "base64"),
    );
  } catch {
    return false;
  }
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
    /** Étape L — jeton d'appairage à présenter par un SECOND appareil.
     *  Court (quelques minutes) et à usage unique : le QR qui le porte peut
     *  être photographié par-dessus l'épaule. Il ne suffit d'ailleurs pas —
     *  il faut aussi le PIN du salon, que le QR ne contient jamais. */
    makePairingToken(dureeMs = 5 * 60 * 1000) {
      const token = {
        fp: fingerprintFromRawPublicKey(rawPub),
        exp: Date.now() + dureeMs,
        nonce: randomBytes(8).toString("hex"),
      };
      token.sig = cryptoSign(null, Buffer.from(pairingPayload(token), "utf8"), privateKey).toString("base64");
      return token;
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
