// ═══════════════════════════════════════════════════════════════
// Étape H — stockage des votes : ce que la base sait, et ce qu'elle
// ne doit PAS savoir
// ═══════════════════════════════════════════════════════════════
// Le mode non nominatif ne tient qu'à une chose : le lien personne →
// choix ne doit exister NULLE PART en base. Ce test l'inspecte
// directement en SQL, sans passer par les fonctions d'accès — une
// fonction peut cacher le lien, la table non.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initStore, closeStore, saveVoteChoice, getVoteTally, hasVoted } from "../src/store.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-vote-store-"));
initStore(dataDir);

// ── 1. Vote NOMINATIF : on sait qui a voté quoi ──────────────────────
const V1 = "vote_nominatif";
assert.equal(saveVoteChoice({ voteId: V1, choice: 0, fingerprint: "fp_karim", sender: "Karim", nominatif: true, ts: 1 }), true);
assert.equal(saveVoteChoice({ voteId: V1, choice: 2, comment: "ligne 4", fingerprint: "fp_amina", sender: "Amina", nominatif: true, ts: 2 }), true);
assert.equal(saveVoteChoice({ voteId: V1, choice: 2, fingerprint: "fp_youcef", sender: "Youcef", nominatif: true, ts: 3 }), true);

let t = getVoteTally(V1);
assert.deepEqual(t.decompte, { 0: 1, 2: 2 }, "décompte nominatif");
assert.equal(t.detail.length, 3, "le détail nominatif est disponible");
assert.equal(t.detail.find((d) => d.sender === "Amina").comment, "ligne 4",
  "le commentaire d'une réserve est conservé");

// Révision : la dernière prévaut, sans doublon
assert.equal(saveVoteChoice({ voteId: V1, choice: 0, fingerprint: "fp_amina", sender: "Amina", nominatif: true, ts: 4 }), true);
t = getVoteTally(V1);
assert.deepEqual(t.decompte, { 0: 2, 2: 1 }, "la révision remplace, elle n'ajoute pas");
assert.equal(t.total, 3, "toujours trois votants après révision");

// ── 2. Vote NON NOMINATIF : la base ignore qui a voté quoi ───────────
const V2 = "vote_non_nominatif";
assert.equal(saveVoteChoice({ voteId: V2, choice: 0, fingerprint: "fp_karim", sender: "Karim", nominatif: false, ts: 10 }), true);
assert.equal(saveVoteChoice({ voteId: V2, choice: 1, fingerprint: "fp_amina", sender: "Amina", nominatif: false, ts: 11 }), true);

t = getVoteTally(V2);
assert.deepEqual(t.decompte, { 0: 1, 1: 1 }, "le décompte fonctionne quand même");
assert.equal(t.detail.length, 0, "AUCUN détail nominatif n'est exposé");
assert.equal(t.voters.length, 2, "mais on sait QUI a répondu (pour relancer les absents)");

// LE contrôle : inspection SQL directe, sans passer par nos fonctions.
const db = new DatabaseSync(path.join(dataDir, "hnaya-chat.db"));
const brutes = db.prepare("SELECT * FROM vote_choices WHERE voteId = ?").all(V2);
assert.equal(brutes.length, 2, "les deux choix sont bien stockés");
for (const r of brutes) {
  assert.equal(r.fingerprint, null, "une empreinte a fuité dans un choix non nominatif");
  assert.equal(r.sender, null, "un pseudo a fuité dans un choix non nominatif");
}
// Et la table de participation, elle, porte bien l'identité — sans choix.
const participants = db.prepare("SELECT * FROM vote_voters WHERE voteId = ?").all(V2);
assert.equal(participants.length, 2);
assert.ok(participants.every((p) => p.fingerprint && !("choice" in p)),
  "vote_voters ne doit contenir aucun choix");
db.close();

// ── 3. Non nominatif : le vote est DÉFINITIF ─────────────────────────
assert.equal(hasVoted(V2, "fp_karim"), true, "la participation est enregistrée");
assert.equal(
  saveVoteChoice({ voteId: V2, choice: 1, fingerprint: "fp_karim", sender: "Karim", nominatif: false, ts: 12 }),
  false,
  "un second vote non nominatif doit être refusé (sinon on bourre l'urne)",
);
t = getVoteTally(V2);
assert.deepEqual(t.decompte, { 0: 1, 1: 1 }, "le décompte n'a pas bougé après la tentative");

closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ vote-store.test.mjs : 16 assertions PASSÉES (nominatif, non nominatif, urne close)");
process.exit(0);
