// ═══════════════════════════════════════════════════════════════
// Test d'intégration du protocole v2 signé (étape D)
// Lancer : node test/signed-protocol.test.mjs   (ports 4802/4803 libres)
// ═══════════════════════════════════════════════════════════════
// Couvre, sur un VRAI serveur et de VRAIES connexions WebSocket :
//   1. client v2 : message signé relayé avec signatureValid=true + empreinte
//   2. registre des appareils alimenté (pseudo, hostname, clé publique)
//   3. client v1 (0.3.1, sans identité) : accepté, message « non signé »
//   4. anti-rejeu : un id déjà vu n'est pas rediffusé
//   5. EADDRINUSE : second hôte → erreur lisible via onError, pas de crash
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { deriveKeyFromPin, encryptPayload, decryptPayload } from "../src/crypto.js";
import { closeStore, listDevices, searchMessages } from "../src/store.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const PIN = "424242";
const hostDataDir = tmp("hnaya-host-");
const clientDataDir = tmp("hnaya-cli-");

const errors = [];
const host = startHost({ sessionName: "Test D", pin: PIN, dataDir: hostDataDir, wsPort: 14812, httpPort: 14813, onError: (m) => errors.push(m) });

try {
  // ── 1+2 : client v2 signé ──
  const received = [];
  const alice = joinSession({
    address: "127.0.0.1", wsPort: 14812, pin: PIN, userId: "Alice",
    dataDir: clientDataDir,
    onMessage: (m) => received.push(m),
  });
  await sleep(700); // join + backlog

  alice.send("Premier message signé — hnaya.dz");
  await sleep(500);

  assert.equal(received.length, 1, "message relayé au client v2");
  assert.equal(received[0].signatureValid, true, "signature vérifiée par le serveur");
  assert.match(received[0].deviceFp, /^[0-9a-f]{16}$/, "empreinte d'appareil jointe");
  assert.equal(received[0].from, "Alice");

  const devices = listDevices();
  assert.equal(devices.length, 1, "un appareil au registre");
  assert.equal(devices[0].lastNickname, "Alice");
  assert.equal(devices[0].hostname, os.hostname(), "nom de machine enregistré");
  assert.equal(devices[0].fingerprint, received[0].deviceFp, "même empreinte registre/message");

  const stored = searchMessages({ q: "signé" });
  assert.equal(stored.length, 1, "message en base");
  assert.equal(stored[0].signatureValid, true);
  assert.ok(stored[0].signature, "signature brute conservée (audit)");

  // ── 3 : client v1 historique (0.3.1) — sans identité ──
  const key = deriveKeyFromPin(PIN);
  const legacy = new WebSocket("ws://127.0.0.1:14812");
  const legacyReceived = [];
  legacy.on("message", (raw) => { try { legacyReceived.push(decryptPayload(key, raw.toString())); } catch {} });
  await new Promise((res) => legacy.on("open", res));
  legacy.send(encryptPayload(key, { v: 1, type: "join", userId: "VieuxPoste", groups: ["all"], lastSeenTs: 0 }));
  await sleep(400);
  legacy.send(encryptPayload(key, { v: 1, type: "message", text: "Message ancien protocole", groupId: "all" }));
  await sleep(500);

  const legacyMsg = received.find((m) => m.from === "VieuxPoste");
  assert.ok(legacyMsg, "message v1 relayé aux clients v2");
  assert.equal(legacyMsg.signatureValid, false, "marqué non signé");
  assert.equal(legacyMsg.deviceFp, null, "aucune empreinte pour un client v1");
  const legacyBacklog = legacyReceived.find((p) => p.type === "backlog");
  assert.equal(legacyBacklog.messages.length, 1, "client v1 reçoit le backlog depuis SQLite");

  // ── 4 : anti-rejeu ──
  // Rejouer tel quel le premier message d'Alice depuis SA connexion v2 :
  // signature valide, mais id déjà en base → ni réenregistré ni rediffusé.
  const countBefore = received.length;
  const replayed = { id: stored[0].id, text: stored[0].text, ts: stored[0].ts, signature: stored[0].signature };
  alice.raw.send(encryptPayload(key, { v: 2, type: "message", groupId: "all", ...replayed }));
  await sleep(500);
  assert.equal(received.length, countBefore, "id déjà vu : non rediffusé");

  // ── 5 : EADDRINUSE lisible ──
  const dup = startHost({ sessionName: "Doublon", pin: PIN, wsPort: 14812, httpPort: 14813, onError: (m) => errors.push(m) });
  await sleep(400);
  assert.equal(errors.length, 1, "erreur remontée via onError");
  assert.match(errors[0], /14812.*déjà/u, "message lisible mentionnant le port");
  try { dup.stop(); } catch {}

  alice.close();
  legacy.close();
  console.log("✅ signed-protocol.test.mjs : 5 scénarios PASSÉS");
} finally {
  host.stop();
  closeStore();
  await sleep(200);
  process.exit(0);
}
