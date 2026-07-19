// ═══════════════════════════════════════════════════════════════
// Test du store SQLite (étape D) — lancer : node test/store.test.mjs
// À exécuter après TOUTE modification de src/store.js.
// ═══════════════════════════════════════════════════════════════
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initStore, closeStore, saveMessage, getMessagesSince, purgeOldMessages,
  upsertDeviceSeen, setDeviceLabel, listDevices, getDevice,
  searchMessages, getConfig, setConfig,
} from "../src/store.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-store-"));
initStore(dir);

const now = Date.now();

// 1) API compatible db.js : sauvegarde + backlog
saveMessage({ id: "m1", groupId: "all", from: "Karim", text: "Bonjour", ts: now - 5000 });
saveMessage({ id: "m2", groupId: "all", from: "Amina", text: "hnaya.dz متاح", ts: now - 3000,
              deviceFp: "aabbccdd11223344", signature: "c2ln", signatureValid: true });
saveMessage({ id: "m3", groupId: "rh", from: "Karim", text: "Réunion à 14h", ts: now - 1000 });
saveMessage({ id: "m2", groupId: "all", from: "Amina", text: "DOUBLON", ts: now }); // id déjà vu → ignoré

const backlog = getMessagesSince("all", 0);
assert.equal(backlog.length, 2, "backlog du groupe all");
assert.equal(backlog[1].text, "hnaya.dz متاح", "arabe intact + pas de doublon");
assert.equal(backlog[1].signatureValid, true, "signature marquée valide");
assert.equal(getMessagesSince("all", now - 4000).length, 1, "filtre sinceTs");

// 2) Rétention configurable (0 = illimitée)
setConfig("retention_days", "0");
assert.equal(purgeOldMessages(), 3, "rétention illimitée : rien purgé");
setConfig("retention_days", String(1 / 24 / 60)); // ≈ 1 minute pour le test
saveMessage({ id: "vieux", groupId: "all", from: "X", text: "ancien", ts: now - 10 * 60 * 1000 });
assert.equal(purgeOldMessages(), 3, "message plus vieux que la rétention purgé");

// 3) Registre des appareils : pseudos cumulés, étiquette admin préservée
upsertDeviceSeen({ fingerprint: "aabbccdd11223344", publicKeySpki: "cGs=", nickname: "Amina",
                   hostname: "PC-RH-03", platform: "win32", ip: "192.168.1.20" });
upsertDeviceSeen({ fingerprint: "aabbccdd11223344", publicKeySpki: "cGs=", nickname: "Mimi",
                   ip: "192.168.1.21" });
setDeviceLabel("aabbccdd11223344", "Poste 3 — Bureau RH");
upsertDeviceSeen({ fingerprint: "aabbccdd11223344", publicKeySpki: "cGs=", nickname: "Amina" });

const dev = getDevice("aabbccdd11223344");
assert.deepEqual(dev.nicknames, ["Amina", "Mimi"], "historique des pseudos sans doublon");
assert.equal(dev.label, "Poste 3 — Bureau RH", "étiquette admin jamais écrasée par un join");
assert.equal(dev.hostname, "PC-RH-03", "hostname conservé si absent au join suivant");
assert.equal(dev.lastIp, "192.168.1.21", "dernière IP connue");
assert.equal(listDevices().length, 1);

// 4) Recherche admin cumulable
assert.equal(searchMessages({ q: "hnaya" }).length, 1, "recherche mot-clé");
assert.equal(searchMessages({ from: "Karim" }).length, 2, "recherche par auteur");
assert.equal(searchMessages({ from: "Karim", groupId: "rh" }).length, 1, "critères cumulés");
assert.equal(searchMessages({ deviceFp: "aabbccdd11223344" }).length, 1, "recherche par appareil");
assert.equal(searchMessages({ toTs: now - 4000 }).length, 1, "borne temporelle");

// 5) La base survit à une réouverture (persistance réelle)
closeStore();
initStore(dir);
assert.equal(getMessagesSince("rh", 0).length, 1, "données présentes après réouverture");
assert.equal(getConfig("retention_days"), String(1 / 24 / 60), "config persistée");

closeStore();
console.log("✅ store.test.mjs : 5 groupes d'assertions PASSÉS (" + dir + ")");
