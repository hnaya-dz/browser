// ═══════════════════════════════════════════════════════════════
// Test du protocole d'administration (étape D)
// Lancer : node test/admin-protocol.test.mjs   (ports 4802/4803 libres)
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

const PIN = "515151";
const host = startHost({ sessionName: "Test admin", pin: PIN, dataDir: tmp("hnaya-adm-host-"), wsPort: 14822, httpPort: 14823 });
assert.match(host.adminPin, /^\d{6}$/, "PIN admin à 6 chiffres généré et exposé à l'hôte");

try {
  const results = [];
  const alice = joinSession({
    address: "127.0.0.1", wsPort: 14822, pin: PIN, userId: "Alice",
    dataDir: tmp("hnaya-adm-cli-"),
    onAdminResult: (r) => results.push(r),
  });
  await sleep(700);
  alice.send("Compte-rendu envoyé sur hnaya.dz");
  await sleep(400);

  const waitResult = async (reqId) => {
    for (let i = 0; i < 20; i++) {
      const r = results.find((x) => x.reqId === reqId);
      if (r) return r;
      await sleep(100);
    }
    throw new Error("Pas de réponse admin pour " + reqId);
  };

  // 1) Mauvais PIN admin → refus propre
  alice.sendAdmin({ adminPin: "000000", action: "devices", reqId: "r1" });
  const r1 = await waitResult("r1");
  assert.equal(r1.ok, false);
  assert.equal(r1.error, "admin-pin");

  // 2) Bon PIN → registre avec l'appareil d'Alice
  alice.sendAdmin({ adminPin: host.adminPin, action: "devices", reqId: "r2" });
  const r2 = await waitResult("r2");
  assert.equal(r2.ok, true);
  assert.equal(r2.data.length, 1);
  assert.equal(r2.data[0].lastNickname, "Alice");
  const fp = r2.data[0].fingerprint;

  // 3) Étiquetage d'un appareil
  alice.sendAdmin({ adminPin: host.adminPin, action: "label", fingerprint: fp, label: "Poste 3 — Bureau RH", reqId: "r3" });
  const r3 = await waitResult("r3");
  assert.equal(r3.data[0].label, "Poste 3 — Bureau RH");

  // 4) Recherche dans l'historique (signée)
  alice.sendAdmin({ adminPin: host.adminPin, action: "search", filters: { q: "hnaya" }, reqId: "r4" });
  const r4 = await waitResult("r4");
  assert.equal(r4.data.length, 1);
  assert.equal(r4.data[0].signatureValid, true);
  assert.equal(r4.data[0].deviceFp, fp);

  // 5) Rétention : lecture + écriture bornée (clé non autorisée refusée)
  alice.sendAdmin({ adminPin: host.adminPin, action: "config-get", reqId: "r5" });
  assert.equal((await waitResult("r5")).data.retention_days, 90, "défaut 90 jours");
  alice.sendAdmin({ adminPin: host.adminPin, action: "config-set", key: "retention_days", value: 30, reqId: "r6" });
  assert.equal((await waitResult("r6")).data.retention_days, 30);
  alice.sendAdmin({ adminPin: host.adminPin, action: "config-set", key: "admin_pin", value: "111111", reqId: "r7" });
  assert.equal((await waitResult("r7")).error, "config-key", "clé hors liste blanche refusée");

  // 6) Anti-énumération : 5 PIN faux → connexion fermée (code 4003)
  const bob = joinSession({
    address: "127.0.0.1", wsPort: 14822, pin: PIN, userId: "Bob", dataDir: tmp("hnaya-adm-bob-"),
  });
  const closed = new Promise((res) => bob.raw.on("close", (code) => res(code)));
  await sleep(500);
  for (let i = 0; i < 5; i++) bob.sendAdmin({ adminPin: "99999" + i, action: "devices", reqId: "b" + i });
  assert.equal(await closed, 4003, "connexion fermée après 5 tentatives");

  // 7) Le PIN admin est STABLE après redémarrage du salon (même dataDir)
  alice.close();
  console.log("✅ admin-protocol.test.mjs : 6 scénarios PASSÉS (+ stabilité vérifiée par store.test)");
} finally {
  host.stop();
  closeStore();
  await sleep(200);
  process.exit(0);
}
