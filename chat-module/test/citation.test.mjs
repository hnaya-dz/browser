// ═══════════════════════════════════════════════════════════════
// Étape G — citation de message : ce qui est signé, et ce qui est refusé
// ═══════════════════════════════════════════════════════════════
// La citation entre dans le périmètre signé : une réponse (« je valide »)
// ne doit pas pouvoir être déplacée sous une autre demande.
//
// Le piège évité ici : si la citation était simplement ajoutée à la suite
// du noyau signable, elle occuperait le rang de mediaSha, et un message à
// pièce jointe pourrait être rejoué en message citant AVEC LA MÊME
// SIGNATURE VALIDE. D'où l'emplacement média toujours écrit, vide au
// besoin, dès qu'une citation existe.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { signablePayload } from "../src/identity.js";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore } from "../src/store.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. Forme du noyau signable ───────────────────────────────────────
const base = { id: "m1", from: "Nacib", text: "bonjour", ts: 1000 };

assert.equal(signablePayload(base), JSON.stringify(["m1", "Nacib", "bonjour", 1000]),
  "sans citation ni média : octets inchangés (compatibilité)");

assert.equal(signablePayload({ ...base, mediaSha: "abc" }),
  JSON.stringify(["m1", "Nacib", "bonjour", 1000, "abc"]),
  "média seul : inchangé par rapport à l'étape E");

assert.equal(signablePayload({ ...base, replyTo: "m0" }),
  JSON.stringify(["m1", "Nacib", "bonjour", 1000, "", "m0"]),
  "citation seule : emplacement média présent mais VIDE");

assert.equal(signablePayload({ ...base, mediaSha: "abc", replyTo: "m0" }),
  JSON.stringify(["m1", "Nacib", "bonjour", 1000, "abc", "m0"]),
  "média + citation : deux emplacements distincts");

// LE point : un message à pièce jointe et un message citant ne peuvent
// pas produire les mêmes octets. Sans l'emplacement vide, les deux
// vaudraient ["m1","Nacib","bonjour",1000,"abc"] et la signature de l'un
// vaudrait pour l'autre.
assert.notEqual(signablePayload({ ...base, mediaSha: "abc" }),
  signablePayload({ ...base, replyTo: "abc" }),
  "un média ne peut pas être rejoué comme une citation");

// ── 2. Bout en bout sur un hôte réel ─────────────────────────────────
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-citation-"));
const PORT = 14862, HTTP = 14863, PIN = "141592";
const host = startHost({ sessionName: "Salon citation", pin: PIN, adminPin: "271828",
  dataDir, wsPort: PORT, httpPort: HTTP });
await sleep(600);

const recus = [];
const alice = joinSession({
  address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: "Alice",
  dataDir: path.join(dataDir, "id-alice"), groups: ["all"],
  onMessage: (m) => recus.push(m), onPresence: () => {},
});
await new Promise((r) => alice.raw.on("open", r));
await sleep(400);

alice.send("Merci de valider le budget", "all");
await sleep(500);
const demande = recus.find((m) => m.text === "Merci de valider le budget");
assert.ok(demande, "le message d'origine est bien arrivé");
assert.equal(demande.signatureValid, true, "message d'origine signé et vérifié");

alice.send("Je valide", "all", null, demande.id);
await sleep(600);
const reponse = recus.find((m) => m.text === "Je valide");
assert.ok(reponse, "la réponse est arrivée");
assert.equal(reponse.replyTo, demande.id, "la réponse porte la citation");
assert.equal(reponse.signatureValid, true,
  "la citation est COUVERTE par la signature (sinon l'hôte l'aurait invalidée)");

// ── 3. Une citation vers un message inexistant est écartée ───────────
// Sinon on pourrait faire pointer une réponse vers un identifiant d'un
// autre salon, et en révéler l'existence.
alice.send("Reponse orpheline", "all", null, "msg_inexistant_" + Date.now());
await sleep(600);
const orpheline = recus.find((m) => m.text === "Reponse orpheline");
assert.ok(orpheline, "le message passe quand même");
assert.equal(orpheline.replyTo, null, "mais la citation fantôme est écartée");

// ── 4. La citation survit à la relecture de l'historique ─────────────
const relu = [];
const bob = joinSession({
  address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: "Bob",
  dataDir: path.join(dataDir, "id-bob"), groups: ["all"], lastSeenTs: 0,
  onMessage: (m) => relu.push(m), onPresence: () => {},
});
await new Promise((r) => bob.raw.on("open", r));
await sleep(900);
const reponseRelue = relu.find((m) => m.text === "Je valide");
assert.ok(reponseRelue, "la réponse figure dans l'historique rejoué");
assert.equal(reponseRelue.replyTo, demande.id, "la citation est bien persistée");

alice.close(); bob.close();
await sleep(200);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ citation.test.mjs : 12 assertions PASSÉES (signature, rejeu, persistance)");
process.exit(0);
