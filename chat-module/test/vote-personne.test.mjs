// ═══════════════════════════════════════════════════════════════
// Étape H — une voix par PERSONNE, et un arrivant qui voit le score
// ═══════════════════════════════════════════════════════════════
// Deux défauts trouvés en test terrain, tous deux invisibles en local :
//
//  1. Le dépouillement n'était rediffusé qu'à chaque réponse. Quelqu'un
//     qui rejoignait APRÈS les votes voyait tout à zéro, jusqu'à ce qu'un
//     retardataire vote.
//
//  2. Le décompte se faisait par APPAREIL. « Ajouter mon mobile » fait
//     rejoindre le téléphone sous le même pseudo mais avec sa propre clé :
//     une personne équipée d'un téléphone pesait donc DEUX voix dans une
//     validation. Rédhibitoire pour un circuit d'approbation.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore } from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-vote-pers-"));
const PORT = 14892, HTTP = 14893, PIN = "192837";
const OPTIONS = ["Valider", "Refuser", "Réserves"];

const host = startHost({ sessionName: "Finances", pin: PIN, adminPin: "111222",
  dataDir, wsPort: PORT, httpPort: HTTP });
await dodo(600);

const brancher = async (nom, dossier, capter = {}) => {
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom,
    dataDir: path.join(dataDir, dossier), groups: ["all"],
    onMessage: (m) => capter.msg?.(m), onPresence: () => {},
    onVoteTally: (t) => capter.tally?.(t),
  });
  await new Promise((r) => c.raw.on("open", r));
  return c;
};

const poste = await brancher("Nacib", "id-poste");
const amina = await brancher("Amina", "id-amina");
await dodo(500);

const voteId = poste.openVote({ question: "Budget 2027", options: OPTIONS, nominatif: true });
await dodo(700);
poste.answerVote({ voteId, choice: 0 });   // Nacib valide, depuis son poste
await dodo(400);
amina.answerVote({ voteId, choice: 2 });   // Amina émet des réserves
await dodo(700);

// ── 1. Un arrivant voit les votes DÉJÀ exprimés ──────────────────────
let recuALaConnexion = null;
const mobile = await brancher("Nacib", "id-mobile", {
  tally: (t) => { if (!recuALaConnexion) recuALaConnexion = t; },
});
await dodo(1800);
assert.ok(recuALaConnexion, "un arrivant doit recevoir le dépouillement en cours");
assert.deepEqual(recuALaConnexion.decompte, { 0: 1, 2: 1 },
  "il doit voir le score réel, pas un vote à zéro");

// ── 2. Le même Nacib vote depuis son mobile : il REMPLACE sa voix ────
let dernier = null;
const sonde = await brancher("Sonde", "id-sonde", { tally: (t) => { dernier = t; } });
await dodo(600);
mobile.answerVote({ voteId, choice: 2 });
await dodo(1200);

assert.ok(dernier, "le dépouillement doit être rediffusé");
const voixDeNacib = dernier.detail.filter((d) => d.sender === "Nacib");
assert.equal(voixDeNacib.length, 1,
  `Nacib pèse ${voixDeNacib.length} voix — une personne à deux appareils ne doit en peser qu'une`);
assert.equal(voixDeNacib[0].choice, 2, "sa dernière réponse prévaut");
assert.equal(Object.values(dernier.decompte).reduce((a, b) => a + b, 0), 2,
  "deux personnes, donc deux voix au total");
assert.equal(dernier.voters.length, 2,
  "« ont répondu » compte des personnes, pas des appareils — sinon « en attente » ment");

// ── 3. Une RECONNEXION voit aussi le score ───────────────────────────
// Cas laissé passer par le premier correctif : un client qui revient ne
// redemande que les messages postérieurs à sa dernière lecture, donc le
// vote n'est PAS rejoué — et son dépouillement ne l'était pas non plus.
// C'est ce que vivait un mobile qui se reconnecte.
let auRetour = null;
const revenant = joinSession({
  address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: "Amina",
  dataDir: path.join(dataDir, "id-amina"), groups: ["all"],
  lastSeenTs: Date.now() + 60000,   // « j'ai déjà tout lu »
  onMessage: () => {}, onPresence: () => {},
  onVoteTally: (t) => { if (!auRetour) auRetour = t; },
});
await new Promise((r) => revenant.raw.on("open", r));
await dodo(1800);
assert.ok(auRetour,
  "une reconnexion doit recevoir le dépouillement, même sans rattrapage de messages");
assert.equal(Object.values(auRetour.decompte).reduce((a, b) => a + b, 0), 2,
  "elle doit voir le score réel, pas un vote à zéro");
revenant.close();

poste.close(); amina.close(); mobile.close(); sonde.close();
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ vote-personne.test.mjs : 8 assertions PASSÉES (une voix par personne, score à l'arrivée et au retour)");
process.exit(0);
