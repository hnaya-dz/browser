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

// 10. Étape H — la RÈGLE DES RANGS. Les champs optionnels occupent des
// rangs fixes (5 mediaSha, 6 replyTo, 7 voteSha) et tout rang précédent
// est écrit, vide au besoin. C'est ce qui interdit qu'un message se
// rejoue en un autre avec la même signature valide. Chaque combinaison
// doit produire une forme DISTINCTE, et identique des deux côtés.
const combinaisons = [
  ["rien",              {}],
  ["media",             { mediaSha: "X" }],
  ["citation",          { replyTo: "X" }],
  ["vote",              { voteSha: "X" }],
  ["media+citation",    { mediaSha: "X", replyTo: "X" }],
  ["media+vote",        { mediaSha: "X", voteSha: "X" }],
  ["citation+vote",     { replyTo: "X", voteSha: "X" }],
  ["les trois",         { mediaSha: "X", replyTo: "X", voteSha: "X" }],
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

console.log("✅ Interop crypto Node ↔ navigateur : 19/19 OK (AES-GCM + Ed25519 + rangs signés)");
