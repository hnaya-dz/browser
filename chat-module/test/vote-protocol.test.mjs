// ═══════════════════════════════════════════════════════════════
// Étape H — vote de bout en bout : le scénario réel
// ═══════════════════════════════════════════════════════════════
// « Si l'un valide et deux émettent des réserves, comment saurais-je qui
// a apposé quoi ? » — c'est exactement ce que ce test déroule, dans les
// deux modes, en vérifiant aussi ce que le mode non nominatif doit
// RENDRE IMPOSSIBLE.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore } from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-vote-proto-"));
const PORT = 14882, HTTP = 14883, PIN = "314159";

const host = startHost({ sessionName: "Direction", pin: PIN, adminPin: "271828",
  dataDir, wsPort: PORT, httpPort: HTTP });
await dodo(600);

const depouillements = [];
const refus = [];
const messages = [];
const brancher = async (nom, principal = false) => {
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom,
    dataDir: path.join(dataDir, "id-" + nom), groups: ["all"],
    onMessage: (m) => { if (principal) messages.push(m); },
    onPresence: () => {},
    onVoteTally: (t) => { if (principal) depouillements.push(t); },
    onVoteRefused: (r) => refus.push({ nom, ...r }),
  });
  await new Promise((r) => c.raw.on("open", r));
  return c;
};

const directeur = await brancher("Directeur", true);
const karim = await brancher("Karim");
const amina = await brancher("Amina");
const youcef = await brancher("Youcef");
await dodo(500);

const OPTIONS = ["Valider", "Refuser", "Réserves"];

// ── 1. Vote NOMINATIF ────────────────────────────────────────────────
const v1 = directeur.openVote({ question: "Budget 2027", options: OPTIONS, nominatif: true });
await dodo(600);
const msgVote = messages.find((m) => m.id === v1);
assert.ok(msgVote, "le vote apparaît dans le fil comme un message");
assert.equal(msgVote.type, "vote", "il conserve son type (sinon les réponses seraient refusées)");
assert.equal(msgVote.signatureValid, true, "sa définition est signée et vérifiée");
assert.deepEqual(msgVote.extra.options, OPTIONS, "les options sont portées par le message");

karim.answerVote({ voteId: v1, choice: 0 });
await dodo(300);
amina.answerVote({ voteId: v1, choice: 2, comment: "Réserves sur la ligne 4" });
await dodo(300);
youcef.answerVote({ voteId: v1, choice: 2 });
await dodo(600);

const d1 = depouillements[depouillements.length - 1];
assert.equal(d1.voteId, v1);
assert.deepEqual(d1.decompte, { 0: 1, 2: 2 }, "1 validation, 2 réserves");
assert.equal(d1.detail.length, 3, "le détail nominatif dit qui a apposé quoi");
assert.equal(d1.detail.find((x) => x.sender === "Amina").comment, "Réserves sur la ligne 4");
assert.equal(d1.voters.length, 3, "trois personnes ont répondu");

// Révision en nominatif : la dernière prévaut
amina.answerVote({ voteId: v1, choice: 0 });
await dodo(600);
const d1b = depouillements[depouillements.length - 1];
assert.deepEqual(d1b.decompte, { 0: 2, 2: 1 }, "la révision remplace la réponse précédente");
assert.equal(d1b.voters.length, 3, "et n'ajoute pas un votant");

// ── 2. Vote NON NOMINATIF ────────────────────────────────────────────
const v2 = directeur.openVote({ question: "Huis clos", options: OPTIONS, nominatif: false });
await dodo(600);
karim.answerVote({ voteId: v2, choice: 0 });
await dodo(300);
amina.answerVote({ voteId: v2, choice: 2 });
await dodo(600);

const d2 = depouillements[depouillements.length - 1];
assert.equal(d2.voteId, v2);
assert.deepEqual(d2.decompte, { 0: 1, 2: 1 }, "le décompte fonctionne");
assert.equal(d2.detail.length, 0, "AUCUN détail nominatif n'est diffusé");
assert.equal(d2.voters.length, 2, "mais on sait qui a répondu — donc qui manque");

// L'urne est close : une seconde réponse est refusée, et on le DIT.
karim.answerVote({ voteId: v2, choice: 1 });
await dodo(700);
assert.ok(refus.some((r) => r.nom === "Karim" && r.voteId === v2),
  "un second vote non nominatif doit être refusé explicitement");
const d2b = depouillements[depouillements.length - 1];
assert.deepEqual(d2b.decompte, { 0: 1, 2: 1 }, "le décompte n'a pas bougé");

// ── 3. Ce que l'hôte doit refuser ────────────────────────────────────
karim.answerVote({ voteId: "vote_inexistant", choice: 0 });
await dodo(400);
karim.answerVote({ voteId: v1, choice: 99 });   // hors des options
await dodo(500);
const dFinal = depouillements[depouillements.length - 1];
assert.deepEqual(dFinal.decompte, { 0: 1, 2: 1 },
  "ni un vote inexistant ni une option hors liste ne doivent compter");

directeur.close(); karim.close(); amina.close(); youcef.close();
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ vote-protocol.test.mjs : 17 assertions PASSÉES (nominatif, non nominatif, refus)");
process.exit(0);
