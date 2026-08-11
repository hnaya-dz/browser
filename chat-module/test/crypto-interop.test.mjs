// Test d'interopérabilité : le bundle navigateur (mobile/vendor/) et le
// crypto Node (src/crypto.js) doivent produire des clés identiques et se
// déchiffrer mutuellement — c'est ce qui permet à un téléphone (page
// mobile) de parler au salon hébergé par un poste. À relancer après toute
// reconstruction du bundle : node test/crypto-interop.test.mjs
import assert from "node:assert";
import * as nodeCrypto from "../src/crypto.js";
import * as browserCrypto from "../mobile/vendor/crypto-bundle.js";

const pin = "483920";
const nodeKey = nodeCrypto.deriveKeyFromPin(pin);
const browserKey = await browserCrypto.deriveKeyFromPin(pin);

// 1. Même PIN → même clé scrypt
assert.strictEqual(
  Buffer.from(browserKey).toString("hex"),
  nodeKey.toString("hex"),
  "Clés scrypt différentes — paramètres N/r/p ou sel divergents"
);

// 2. Node chiffre → navigateur déchiffre
const msg = { v: 1, type: "message", text: "Interop تجربة é€", groupId: "all" };
const fromNode = nodeCrypto.encryptPayload(nodeKey, msg);
assert.deepStrictEqual(browserCrypto.decryptPayload(browserKey, fromNode), msg,
  "Le navigateur ne déchiffre pas une trame Node");

// 3. Navigateur chiffre → Node déchiffre
const fromBrowser = browserCrypto.encryptPayload(browserKey, msg);
assert.deepStrictEqual(nodeCrypto.decryptPayload(nodeKey, fromBrowser), msg,
  "Node ne déchiffre pas une trame navigateur");

// 4. Mauvais PIN → échec de déchiffrement (les deux sens)
const wrongKey = await browserCrypto.deriveKeyFromPin("000000");
assert.throws(() => browserCrypto.decryptPayload(wrongKey, fromNode),
  undefined, "Un mauvais PIN devrait faire échouer le déchiffrement");

// ═══ Identité Ed25519 (étape D) — mêmes exigences d'interopérabilité ═══
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPrivateKey, sign as nodeSign } from "node:crypto";
import {
  loadOrCreateIdentity, verifyMessage as nodeVerify,
  fingerprintFromRawPublicKey, rawFromSpkiBase64, signablePayload,
  demandeSeal, decisionSeal, meetingSeal, meetingUpdateSeal,
} from "../src/identity.js";

const core = { id: "msg_interop1", from: "Téléphone-Test", text: "توقيع interop é€", ts: 1789000000000 };

// 5. Signature navigateur → vérifiée par le serveur Node + même empreinte
const browserId = browserCrypto.identityFromPrivate(Buffer.alloc(32, 7).toString("base64"));
const browserSig = browserId.signMessage(core);
assert.strictEqual(nodeVerify(core, browserSig, browserId.publicKeySpki), true,
  "Node ne vérifie pas une signature navigateur");
assert.strictEqual(
  fingerprintFromRawPublicKey(rawFromSpkiBase64(browserId.publicKeySpki)),
  browserId.fingerprint,
  "Empreintes divergentes navigateur/serveur pour la même clé");

// 6. Bit-à-bit : même graine → Node et navigateur produisent la MÊME
// signature (Ed25519 est déterministe — toute divergence = bug d'encodage)
const seed = Buffer.alloc(32, 7);
const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
const nodePriv = createPrivateKey({ key: pkcs8, type: "pkcs8", format: "der" });
const nodeSig = nodeSign(null, Buffer.from(signablePayload(core), "utf8"), nodePriv).toString("base64");
assert.strictEqual(nodeSig, browserSig, "Signatures Node/navigateur différentes pour la même graine");

// 7. Signature Node (identité de poste) → vérifiée par le navigateur
const nodeId = loadOrCreateIdentity(fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-interop-")));
assert.strictEqual(browserCrypto.verifyMessage(core, nodeId.signMessage(core), nodeId.publicKeySpki), true,
  "Le navigateur ne vérifie pas une signature Node");

// 8. Altération → rejet des deux côtés
const tampered = { ...core, text: "texte modifié" };
assert.strictEqual(nodeVerify(tampered, browserSig, browserId.publicKeySpki), false);
assert.strictEqual(browserCrypto.verifyMessage(tampered, nodeId.signMessage(core), nodeId.publicKeySpki), false);

// 9. Étape G — une CITATION doit signer les mêmes octets des deux côtés.
// Sans cette vérification, l'hôte rejetterait silencieusement toutes les
// réponses envoyées depuis un téléphone : elles arriveraient marquées non
// signées, sans que rien ne l'explique.
const avecCitation = { ...core, replyTo: "msg_cite_42" };
assert.strictEqual(
  nodeSign(null, Buffer.from(signablePayload(avecCitation), "utf8"), nodePriv).toString("base64"),
  browserId.signMessage(avecCitation),
  "Citation : signatures Node/navigateur différentes",
);
// Et avec une pièce jointe EN PLUS, les deux emplacements coexistant.
const citationEtMedia = { ...core, mediaSha: "sha_media_1", replyTo: "msg_cite_42" };
assert.strictEqual(
  nodeSign(null, Buffer.from(signablePayload(citationEtMedia), "utf8"), nodePriv).toString("base64"),
  browserId.signMessage(citationEtMedia),
  "Citation + média : signatures Node/navigateur différentes",
);
// La substitution que la forme positionnelle doit empêcher : un message à
// pièce jointe ne doit pas pouvoir être relu comme un message citant.
assert.notStrictEqual(
  browserId.signMessage({ ...core, mediaSha: "X" }),
  browserId.signMessage({ ...core, replyTo: "X" }),
  "Un média peut être rejoué en citation : la forme signée est ambiguë",
);

// 10. Étapes H et K — la RÈGLE DES RANGS. Les champs optionnels occupent
// des rangs fixes (5 mediaSha, 6 replyTo, 7 voteSha, 8 demandeSha) et tout
// rang précédent est écrit, vide au besoin. C'est ce qui interdit qu'un
// message se rejoue en un autre avec la même signature valide. Chaque
// combinaison doit produire une forme DISTINCTE, et identique des deux
// côtés. Toute combinaison d'un nouveau rang doit être ajoutée ici.
const combinaisons = [
  ["rien",              {}],
  ["media",             { mediaSha: "X" }],
  ["citation",          { replyTo: "X" }],
  ["vote",              { voteSha: "X" }],
  ["demande",           { demandeSha: "X" }],
  ["media+citation",    { mediaSha: "X", replyTo: "X" }],
  ["media+vote",        { mediaSha: "X", voteSha: "X" }],
  ["media+demande",     { mediaSha: "X", demandeSha: "X" }],
  ["citation+vote",     { replyTo: "X", voteSha: "X" }],
  ["citation+demande",  { replyTo: "X", demandeSha: "X" }],
  ["vote+demande",      { voteSha: "X", demandeSha: "X" }],
  ["media+citation+vote", { mediaSha: "X", replyTo: "X", voteSha: "X" }],
  ["les quatre",        { mediaSha: "X", replyTo: "X", voteSha: "X", demandeSha: "X" }],
];
const formes = new Map();
for (const [nom, champs] of combinaisons) {
  const msg = { ...core, ...champs };
  const forme = signablePayload(msg);
  assert.ok(!formes.has(forme),
    `Collision de rangs : « ${nom} » signe les mêmes octets que « ${formes.get(forme)} »`);
  formes.set(forme, nom);
  assert.strictEqual(
    nodeSign(null, Buffer.from(forme, "utf8"), nodePriv).toString("base64"),
    browserId.signMessage(msg),
    `Signatures Node/navigateur différentes pour « ${nom} »`,
  );
}
// Compatibilité : la forme sans champ optionnel n'a pas bougé.
assert.strictEqual(signablePayload(core),
  JSON.stringify([core.id, core.from, core.text, core.ts]),
  "La forme de base a changé — tout l'historique deviendrait invérifiable");

// 11. Étape K — les sceaux de demande et de décision, identiques des deux
// côtés. Le préfixe est ce qui empêche qu'une décision soit rejouée en
// demande : les deux occupent le rang 8.
assert.strictEqual(demandeSeal("validation", "abcdef0123456789"),
  browserCrypto.demandeSeal("validation", "abcdef0123456789"),
  "Sceau de demande : Node et navigateur divergent");
assert.strictEqual(decisionSeal("msg_7", "valide"),
  browserCrypto.decisionSeal("msg_7", "valide"),
  "Sceau de décision : Node et navigateur divergent");
// Le DESTINATAIRE fait partie du sceau : rediriger une demande signée vers
// quelqu'un d'autre doit casser la signature, sinon « le Directeur a
// validé » ne prouve rien.
assert.notStrictEqual(demandeSeal("validation", "aaaa"), demandeSeal("validation", "bbbb"),
  "Le destinataire ne compte pas dans le sceau : une demande serait redirigeable");
// Et l'étiquette aussi : un « pour info » ne doit pas pouvoir devenir une
// « approbation » sans nouvelle signature.
assert.notStrictEqual(demandeSeal("info", "aaaa"), demandeSeal("approbation", "aaaa"),
  "L'étiquette ne compte pas dans le sceau : elle serait requalifiable");
// Une décision ne doit pas pouvoir se faire passer pour une demande.
assert.ok(demandeSeal("validation", "x").startsWith("dem:"));
assert.ok(decisionSeal("msg_1", "valide").startsWith("dec:"));

// Étape P — la réunion partage le rang 8, d'où un TROISIÈME préfixe.
assert.strictEqual(meetingSeal("Conseil", 1800000000000, 60),
  browserCrypto.meetingSeal("Conseil", 1800000000000, 60),
  "Sceau de réunion : Node et navigateur divergent");
assert.ok(meetingSeal("Conseil", 1, 1).startsWith("mtg:"));
// L'HEURE fait partie du sceau : déplacer une réunion signée doit casser
// la signature, sinon le .ics exporté porterait une heure jamais annoncée.
assert.notStrictEqual(meetingSeal("Conseil", 1800000000000, 60),
  meetingSeal("Conseil", 1800003600000, 60),
  "L'heure ne compte pas dans le sceau : la réunion serait déplaçable");
assert.notStrictEqual(meetingSeal("Conseil", 1800000000000, 60),
  meetingSeal("Conseil", 1800000000000, 90),
  "La durée ne compte pas dans le sceau");


// Étape R — quatrième préfixe du rang 8 : décaler ou annuler.
assert.strictEqual(meetingUpdateSeal("mtg_1", "moved", 1800000000000, 45),
  browserCrypto.meetingUpdateSeal("mtg_1", "moved", 1800000000000, 45),
  "Sceau de mise a jour : Node et navigateur divergent");
assert.ok(meetingUpdateSeal("mtg_1", "cancelled", 0, 0).startsWith("mup:"));
// Annuler et decaler ne doivent pas produire le meme sceau : sans cela,
// une annulation signee serait rejouable en report.
assert.notStrictEqual(meetingUpdateSeal("mtg_1", "cancelled", 0, 0),
  meetingUpdateSeal("mtg_1", "moved", 0, 0),
  "Annulation et report partagent un sceau : l un se rejoue en l autre");
// La NOUVELLE heure est scellee : un report signe n est pas redeplaçable.
assert.notStrictEqual(meetingUpdateSeal("mtg_1", "moved", 1800000000000, 45),
  meetingUpdateSeal("mtg_1", "moved", 1800003600000, 45),
  "La nouvelle heure ne compte pas dans le sceau");

console.log("✅ Interop crypto Node ↔ navigateur : 35/35 OK (AES-GCM + Ed25519 + rangs signés + sceaux demande/décision/réunion)");
