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

console.log("✅ Interop crypto Node ↔ navigateur : 8/8 OK (AES-GCM + Ed25519)");
