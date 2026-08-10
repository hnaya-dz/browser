// ═══════════════════════════════════════════════════════════════
// Étape J — distinguer le RATTRAPAGE du message vif
// ═══════════════════════════════════════════════════════════════
// Les messages manqués pendant une absence empruntent exactement le même
// chemin que ceux qui arrivent en direct : `onMessage` est appelé pour les
// deux. Tant que rien ne les distinguait, cela n'avait pas d'importance.
//
// Le signal sonore change la donne : rejoindre un salon après une journée
// d'absence ferait sonner une fois PAR message rattrapé. Trente messages,
// trente bips — de quoi faire couper le son définitivement, donc de quoi
// perdre la fonction entière.
//
// client.js marque donc le rattrapage. Ce test verrouille cette marque :
// c'est un détail d'une ligne, invisible à la relecture, et sa disparition
// ne casserait aucun autre test.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore } from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-backlog-"));
const PORT = 14922, HTTP = 14923, PIN = "606070";

const host = startHost({
  sessionName: "Direction", pin: PIN, adminPin: "121314",
  dataDir, wsPort: PORT, httpPort: HTTP,
});
await dodo(600);

const brancher = async (nom, dossier, recus, lastSeenTs = 0) => {
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom, lastSeenTs,
    dataDir: path.join(dataDir, dossier), groups: ["all"],
    onMessage: (m) => recus.push(m), onPresence: () => {},
  });
  await new Promise((r) => c.raw.on("open", r));
  return c;
};

// ── Trois messages déposés AVANT l'arrivée du destinataire ─────────────
const riens = [];
const nacib = await brancher("Nacib", "id-1", riens);
await dodo(400);
nacib.send("Premier", "all");
nacib.send("Deuxieme", "all");
nacib.send("Troisieme", "all");
await dodo(700);

// ── Amina arrive : elle rattrape ces trois-là ──────────────────────────
const chezAmina = [];
const amina = await brancher("Amina", "id-2", chezAmina);
await dodo(900);

const rattrapes = chezAmina.filter((m) => ["Premier", "Deuxieme", "Troisieme"].includes(m.text));
assert.equal(rattrapes.length, 3, "les trois messages manqués doivent être rattrapés");
for (const m of rattrapes) {
  assert.equal(m.backlog, true,
    `« ${m.text} » est rattrapé : sans la marque, il ferait sonner le poste à la connexion`);
}

// ── Puis un message VIF : il ne doit surtout pas porter la marque ──────
nacib.send("En direct", "all");
await dodo(700);
const vif = chezAmina.find((m) => m.text === "En direct");
assert.ok(vif, "le message direct doit arriver");
assert.ok(!vif.backlog,
  "un message vif marqué « rattrapage » serait silencieux — la fonction ne servirait plus à rien");

// ── La marque ne doit pas voyager sur le réseau ni être enregistrée ────
// Elle est posée côté client, à la livraison. Un second arrivant qui
// rattrape « En direct » doit le voir marqué, preuve que la marque décrit
// la LIVRAISON et non le message.
const chezKarim = [];
const karim = await brancher("Karim", "id-3", chezKarim);
await dodo(900);
const memeMessage = chezKarim.find((m) => m.text === "En direct");
assert.ok(memeMessage, "Karim rattrape le message");
assert.equal(memeMessage.backlog, true,
  "le même message est vif pour l'un et rattrapé pour l'autre : la marque décrit la livraison");

nacib.close(); amina.close(); karim.close();
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ backlog-marque.test.mjs : 8 assertions PASSÉES (rattrapage marqué, message vif intact)");
process.exit(0);
