// ═══════════════════════════════════════════════════════════════
// Étape N — accusé de lecture, par PERSONNE
// ═══════════════════════════════════════════════════════════════
// Retenu PLUTÔT qu'une réaction « pouce levé ». Une réaction aurait donné
// un second moyen de dire « d'accord » — non signé, non imputable — à côté
// de la décision signée de l'étape K. Quelqu'un aurait fini par soutenir
// « mais j'avais mis un pouce » face à une demande d'approbation restée
// sans décision. « Vu par » ne se confond avec aucune validation.
//
// Le type `read` existait dans le protocole depuis longtemps : diffusé,
// mais ni enregistré ni affiché par personne. Ce fichier verrouille ce
// qu'il fait désormais.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore, listReads } from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-lecture-"));
const PORT = 14962, HTTP = 14963, PIN = "838485";

const host = startHost({
  sessionName: "Direction", pin: PIN, adminPin: "868788",
  dataDir, wsPort: PORT, httpPort: HTTP,
});
await dodo(600);

const sac = () => ({ messages: [], reads: [], moi: null });
const brancher = async (nom, dossier, s, pairing, lastSeenTs = 0) => {
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom, lastSeenTs,
    dataDir: path.join(dataDir, dossier), groups: ["all"], pairing,
    onMessage: (m) => s.messages.push(m), onPresence: () => {},
    onRoster: (r) => { s.moi = r.me; },
    onReads: (r) => s.reads.push(r),
  });
  await new Promise((r) => c.raw.on("open", r));
  return c;
};

const sAuteur = sac(), sLeila = sac(), sKarim = sac();
const auteur = await brancher("Nacib", "id-auteur", sAuteur);
const leila = await brancher("Leila", "id-leila", sLeila);
const karim = await brancher("Karim", "id-karim", sKarim);
await dodo(700);
auteur.requestRoster();
await dodo(600);

auteur.send("Note de service", "all");
await dodo(700);
const msg = sLeila.messages.find((m) => m.text === "Note de service");
assert.ok(msg, "le message arrive");

// ── 1. Une lecture est enregistrée et diffusée ─────────────────────────
leila.markRead(msg.id, "all");
await dodo(800);
const apresLeila = listReads(msg.id);
assert.equal(apresLeila.length, 1, "la lecture doit être ENREGISTRÉE, pas seulement diffusée");
assert.equal(apresLeila[0].sender, "Leila", "le nom du lecteur est porté");
assert.ok(sAuteur.reads.at(-1), "l'expéditeur doit être averti");
assert.equal(sAuteur.reads.at(-1).messageId, msg.id);

// ── 2. Relire ne repousse pas l'horodatage ─────────────────────────────
// Sinon « vu il y a 2 s » resterait vrai indéfiniment tant que le fil est
// ouvert, et l'accusé ne dirait plus quand la personne a lu.
const premierTs = apresLeila[0].ts;
await dodo(400);
leila.markRead(msg.id, "all");
await dodo(700);
assert.equal(listReads(msg.id)[0].ts, premierTs,
  "c'est la PREMIÈRE lecture qui compte, pas la dernière");

// ── 3. On n'accuse pas réception de ses propres messages ───────────────
auteur.markRead(msg.id, "all");
await dodo(700);
assert.equal(listReads(msg.id).length, 1,
  "« vu par moi-même » n'apprend rien et gonflerait la liste");

// ── 4. Deux lecteurs, deux lignes ──────────────────────────────────────
karim.markRead(msg.id, "all");
await dodo(800);
assert.equal(listReads(msg.id).length, 2);
assert.deepEqual(new Set(listReads(msg.id).map((r) => r.sender)), new Set(["Leila", "Karim"]));

// ── 5. Une personne à deux appareils ne compte qu'une lecture ──────────
// Lire depuis son poste puis son téléphone ne fait pas deux lecteurs.
const jeton = leila.makePairingToken();
const sMobile = sac();
const mobile = await brancher("Leila", "id-leila-mobile", sMobile, jeton);
await dodo(900);
const msgSurMobile = sMobile.messages.find((m) => m.text === "Note de service");
assert.ok(msgSurMobile, "le téléphone rattrape le message");
mobile.markRead(msgSurMobile.id, "all");
await dodo(800);
assert.equal(listReads(msg.id).length, 2,
  "le second appareil de Leila ne doit pas ajouter un lecteur");

// ── 6. Un message inconnu du salon n'est pas accusé ────────────────────
leila.markRead("msg_inexistant", "all");
await dodo(600);
assert.equal(listReads("msg_inexistant").length, 0,
  "accuser réception d'un message d'ailleurs en révélerait l'existence");

// ── 7. À la reconnexion, l'expéditeur RETROUVE qui a lu ────────────────
// Sans rejeu, fermer le dock effaçait tout et l'expéditeur ne savait plus
// jamais qui l'avait lu — la fonction n'aurait servi à rien.
let auRetour = null;
const revenant = joinSession({
  address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: "Nacib",
  dataDir: path.join(dataDir, "id-auteur"), groups: ["all"],
  lastSeenTs: Date.now() + 60000,   // « j'ai déjà tout lu »
  onMessage: () => {}, onPresence: () => {},
  onReads: (r) => { if (r.messageId === msg.id) auRetour = r; },
});
await new Promise((r) => revenant.raw.on("open", r));
await dodo(1600);
assert.ok(auRetour, "les accusés de SES messages doivent être rejoués à la connexion");
assert.equal(auRetour.reads.length, 2, "avec la liste complète des lecteurs");
revenant.close();

auteur.close(); leila.close(); karim.close(); mobile.close();
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ lecture.test.mjs : 13 assertions PASSÉES (persisté, une lecture par personne, rejoué à la connexion)");
process.exit(0);
