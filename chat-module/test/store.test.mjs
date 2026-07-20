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
  createRoom, getRoom, touchRoom, listRooms, setRoomAdminPin, deleteRoom,
  banDevice, unbanDevice, isBanned, listBans,
  addRoomMember, isRoomMember, setRoomLocked,
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

// 6) D.2 — salons distincts : cloisonnement des messages
const rA = createRoom({ name: "Département X", roomPin: "111111", adminPin: "222222" });
const rB = createRoom({ name: "Service Y", adminPin: "333333" });
saveMessage({ id: "ra1", roomId: rA.roomId, groupId: "all", from: "Karim", text: "réservé à X", ts: now });
saveMessage({ id: "rb1", roomId: rB.roomId, groupId: "all", from: "Karim", text: "réservé à Y", ts: now });
assert.equal(getMessagesSince("all", 0, rA.roomId).length, 1, "X ne voit que X");
assert.equal(getMessagesSince("all", 0, rA.roomId)[0].text, "réservé à X");
assert.equal(searchMessages({ roomId: rB.roomId }).length, 1, "recherche admin cloisonnée");
assert.equal(getMessagesSince("all", 0).length, 2, "salon default intact (messages historiques)");
assert.equal(getRoom(rA.roomId).roomPin, "111111", "PIN d'accès persisté");
touchRoom(rB.roomId, { name: "Service Y bis" });
assert.equal(listRooms()[0].name, "Service Y bis", "réouverture : lastUsed trie + renommage");
setRoomAdminPin(rA.roomId, "999999");
assert.equal(getRoom(rA.roomId).adminPin, "999999", "PIN admin modifiable");

// 7) D.2 — blocages par salon
banDevice(rA.roomId, "aabbccdd11223344");
assert.equal(isBanned(rA.roomId, "aabbccdd11223344"), true, "banni dans X");
assert.equal(isBanned(rB.roomId, "aabbccdd11223344"), false, "pas banni dans Y (cloisonné)");
assert.equal(listBans(rA.roomId).length, 1);
unbanDevice(rA.roomId, "aabbccdd11223344");
assert.equal(isBanned(rA.roomId, "aabbccdd11223344"), false, "déblocage effectif");

// 7-bis) D.2 — suppression définitive d'un salon : le salon, son
// historique, ses appartenances et ses blocages disparaissent ; les
// AUTRES salons sont intacts (cloisonnement respecté jusqu'au bout)
const rDel = createRoom({ name: "Salon éphémère", adminPin: "888888" });
saveMessage({ id: "del1", roomId: rDel.roomId, groupId: "all", from: "X", text: "à effacer", ts: now });
addRoomMember(rDel.roomId, "ffee001122334455");
banDevice(rDel.roomId, "aabbccdd11223344");
setRoomLocked(rDel.roomId, true);
assert.equal(getRoom(rDel.roomId).locked, 1, "verrou posé (contrôle avant suppression)");
assert.equal(isRoomMember(rDel.roomId, "ffee001122334455"), true);

const roomsBefore = listRooms().length;
deleteRoom(rDel.roomId);
assert.equal(getRoom(rDel.roomId), null, "salon supprimé");
assert.equal(listRooms().length, roomsBefore - 1, "un seul salon retiré");
assert.equal(searchMessages({ roomId: rDel.roomId }).length, 0, "historique effacé");
assert.equal(listBans(rDel.roomId).length, 0, "blocages effacés");
assert.equal(isRoomMember(rDel.roomId, "ffee001122334455"), false, "appartenances effacées");
// Les autres salons n'ont pas bougé
assert.equal(searchMessages({ roomId: rA.roomId }).length, 1, "salon X intact après suppression de Y");
assert.equal(getRoom(rA.roomId).adminPin, "999999", "PINs du salon X intacts");

// 8) D.2 — migration : une base héritée (config seule) devient un salon
// « default » réouvrable
import fs2 from "node:fs";
const legacyDir = fs2.mkdtempSync(path.join(os.tmpdir(), "hnaya-legacy-"));
closeStore();
initStore(legacyDir);
setConfig("admin_pin", "424242");
setConfig("session_name", "Ancien salon");
closeStore();
initStore(legacyDir); // ré-ouverture → migration
const migrated = getRoom("default");
assert.ok(migrated, "salon default créé depuis l'héritage");
assert.equal(migrated.adminPin, "424242");
assert.equal(migrated.name, "Ancien salon");

closeStore();
console.log("✅ store.test.mjs : 9 groupes d'assertions PASSÉS (" + dir + ")");
