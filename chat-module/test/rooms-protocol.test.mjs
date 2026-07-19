// ═══════════════════════════════════════════════════════════════
// Test D.2 : salons distincts, réouverture, blocage, invitations,
// PIN admin modifiable — sur de VRAIS serveurs et connexions.
// Lancer : node test/rooms-protocol.test.mjs  (ports isolés 14832/14833 — aucune collision avec un salon réel)
// ═══════════════════════════════════════════════════════════════
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore } from "../src/store.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const hostData = tmp("hnaya-d2-host-");
const aliceData = tmp("hnaya-d2-alice-");
const bobData = tmp("hnaya-d2-bob-");

// ── 1. Salon neuf : PINs distincts, choisis ────────────────────────────
let host = startHost({ sessionName: "Département X", adminPin: "777777", dataDir: hostData, wsPort: 14832, httpPort: 14833 });
assert.match(host.pin, /^\d{6}$/);
assert.equal(host.adminPin, "777777", "PIN admin CHOISI à la création");
assert.ok(host.roomId, "roomId exposé");
const roomX = host.roomId;
const pinX = host.pin;

const aliceInbox = [];
const aliceAdmin = [];
let alice = joinSession({
  address: "127.0.0.1", wsPort: 14832, pin: pinX, userId: "Alice", dataDir: aliceData,
  onMessage: (m) => aliceInbox.push(m), onAdminResult: (r) => aliceAdmin.push(r),
});
await sleep(700);
alice.send("Note interne du département X");
await sleep(400);

// ── 2. « Créer » = salon NEUF (historique vierge, autres PINs) ─────────
alice.close();
await host.stop();
await sleep(150);
host = startHost({ sessionName: "Service Y", dataDir: hostData, wsPort: 14832, httpPort: 14833 });
assert.notEqual(host.roomId, roomX, "salon neuf = identité neuve");
assert.notEqual(host.pin, pinX, "PIN d'accès neuf");
const inboxY = [];
let carol = joinSession({
  address: "127.0.0.1", wsPort: 14832, pin: host.pin, userId: "Carol", dataDir: tmp("hnaya-d2-carol-"),
  onMessage: (m) => inboxY.push(m),
});
await sleep(700);
assert.equal(inboxY.length, 0, "historique VIERGE dans le nouveau salon");
carol.close();
await host.stop();
await sleep(150);

// ── 3. Réouverture explicite : même PIN, historique restitué ───────────
host = startHost({ roomId: roomX, dataDir: hostData, wsPort: 14832, httpPort: 14833 });
assert.equal(host.pin, pinX, "réouverture : même PIN d'accès");
assert.equal(host.adminPin, "777777", "même PIN admin");
aliceInbox.length = 0;
alice = joinSession({
  address: "127.0.0.1", wsPort: 14832, pin: pinX, userId: "Alice", dataDir: aliceData,
  onMessage: (m) => aliceInbox.push(m), onAdminResult: (r) => aliceAdmin.push(r),
});
await sleep(700);
assert.equal(aliceInbox.length, 1, "backlog du salon réouvert");
assert.equal(aliceInbox[0].text, "Note interne du département X");

// ── 4. Invitations : à tous (persistée) puis ciblée (directe) ──────────
const bobInbox = [];
let bob = joinSession({
  address: "127.0.0.1", wsPort: 14832, pin: pinX, userId: "Bob", dataDir: bobData,
  onMessage: (m) => bobInbox.push(m),
});
await sleep(700);

alice.sendInvite({ room: { name: "Service Y", address: "192.168.1.50", pin: "111222" } });
await sleep(500);
const bcast = bobInbox.find((m) => m.type === "invite");
assert.ok(bcast, "invitation à tous reçue par Bob");
assert.equal(bcast.extra.name, "Service Y");
assert.equal(bcast.extra.pin, "111222", "PIN du salon invité transmis");

alice.sendInvite({ to: "Bob", room: { name: "Cellule discrète", address: "192.168.1.51", pin: "333444" } });
await sleep(500);
const targeted = bobInbox.find((m) => m.type === "invite" && m.extra?.name === "Cellule discrète");
assert.ok(targeted, "invitation ciblée reçue par Bob");
assert.equal(targeted.targeted, true);
assert.ok(!aliceInbox.some((m) => m.type === "invite" && m.extra?.name === "Cellule discrète"),
  "l'invitation ciblée n'est pas diffusée aux autres");

// Un nouveau venu voit l'invitation « à tous » dans le backlog, PAS la ciblée
const lateInbox = [];
const dave = joinSession({
  address: "127.0.0.1", wsPort: 14832, pin: pinX, userId: "Dave", dataDir: tmp("hnaya-d2-dave-"),
  onMessage: (m) => lateInbox.push(m),
});
await sleep(700);
assert.ok(lateInbox.some((m) => m.type === "invite" && m.extra?.name === "Service Y"),
  "invitation à tous persistée (backlog)");
assert.ok(!lateInbox.some((m) => m.extra?.name === "Cellule discrète"),
  "invitation ciblée JAMAIS persistée");
dave.close();

// ── 5. Blocage : expulsion immédiate + refus au retour + déblocage ─────
alice.sendAdmin({ adminPin: "777777", action: "devices", reqId: "d1" });
await sleep(400);
const devices = aliceAdmin.find((r) => r.reqId === "d1").data;
const bobFp = devices.find((d) => d.lastNickname === "Bob").fingerprint;

const bobClosed = new Promise((res) => bob.raw.on("close", (code) => res(code)));
alice.sendAdmin({ adminPin: "777777", action: "ban", fingerprint: bobFp, reqId: "d2" });
assert.equal(await bobClosed, 4004, "Bob expulsé immédiatement (code 4004)");
await sleep(300);
assert.equal(aliceAdmin.find((r) => r.reqId === "d2").data.bans.length, 1, "blocage enregistré");

bob = joinSession({ address: "127.0.0.1", wsPort: 14832, pin: pinX, userId: "Bob", dataDir: bobData });
const bobRetry = await new Promise((res) => bob.raw.on("close", (code) => res(code)));
assert.equal(bobRetry, 4004, "retour refusé tant que bloqué");

alice.sendAdmin({ adminPin: "777777", action: "unban", fingerprint: bobFp, reqId: "d3" });
await sleep(300);
bob = joinSession({
  address: "127.0.0.1", wsPort: 14832, pin: pinX, userId: "Bob", dataDir: bobData,
  onMessage: () => {},
});
await new Promise((res) => bob.raw.on("open", res));
await sleep(500);
assert.ok(bob.raw.readyState === 1, "débloqué : Bob revient");

// ── 6. PIN admin modifiable par l'admin authentifié ────────────────────
alice.sendAdmin({ adminPin: "777777", action: "set-admin-pin", newPin: "123123", reqId: "d4" });
await sleep(300);
assert.equal(aliceAdmin.find((r) => r.reqId === "d4").data.changed, true);
alice.sendAdmin({ adminPin: "777777", action: "devices", reqId: "d5" });
await sleep(300);
assert.equal(aliceAdmin.find((r) => r.reqId === "d5").error, "admin-pin", "ancien PIN refusé");
alice.sendAdmin({ adminPin: "123123", action: "devices", reqId: "d6" });
await sleep(300);
assert.equal(aliceAdmin.find((r) => r.reqId === "d6").ok, true, "nouveau PIN accepté");

// ── 7. Verrou : membres connus OK, nouveaux refusés (4005) ─────────────
alice.sendAdmin({ adminPin: "123123", action: "set-locked", locked: true, reqId: "d7" });
await sleep(300);
assert.equal(aliceAdmin.find((r) => r.reqId === "d7").data.locked, true, "salon verrouillé");

// Bob est déjà membre → il peut se reconnecter malgré le verrou
bob.close();
await sleep(300);
bob = joinSession({
  address: "127.0.0.1", wsPort: 14832, pin: pinX, userId: "Bob", dataDir: bobData,
  onMessage: () => {},
});
await new Promise((res) => bob.raw.on("open", res));
await sleep(500);
assert.equal(bob.raw.readyState, 1, "membre connu : accès maintenu malgré le verrou");

// Un appareil JAMAIS vu → refus 4005 même avec le bon PIN
const intrus = joinSession({
  address: "127.0.0.1", wsPort: 14832, pin: pinX, userId: "Nouveau", dataDir: tmp("hnaya-d2-new-"),
});
assert.equal(await new Promise((res) => intrus.raw.on("close", (code) => res(code))), 4005,
  "nouvel appareil refusé sur salon verrouillé (bon PIN insuffisant)");

// Déverrouillage → le nouvel appareil entre
alice.sendAdmin({ adminPin: "123123", action: "set-locked", locked: false, reqId: "d8" });
await sleep(300);
const nouveau = joinSession({
  address: "127.0.0.1", wsPort: 14832, pin: pinX, userId: "Nouveau", dataDir: tmp("hnaya-d2-new2-"),
  onMessage: () => {},
});
await new Promise((res) => nouveau.raw.on("open", res));
await sleep(500);
assert.equal(nouveau.raw.readyState, 1, "déverrouillé : nouvel appareil accepté");
nouveau.close();

alice.close();
bob.close();
host.stop();
closeStore();
console.log("✅ rooms-protocol.test.mjs : 7 scénarios D.2 PASSÉS (verrou inclus)");
await sleep(200);
process.exit(0);
