// ═══════════════════════════════════════════════════════════════
// Étape R — décaler ou annuler une réunion
// ═══════════════════════════════════════════════════════════════
// « En pratique en entreprise, les réunions sont assez souvent décalées ou
// annulées. » C'est le besoin, et il se heurte à une contrainte : l'heure
// d'une réunion est SCELLÉE dans sa signature. On ne modifie donc jamais
// la convocation d'origine — on publie une mise à jour, signée elle aussi,
// qui la remplace. L'annonce initiale reste dans l'historique, et l'on
// peut établir qui a déplacé quoi, et quand.
//
// Trois propriétés à tenir :
//   1. seul l'ORGANISATEUR décale ou annule ;
//   2. la mise à jour est signée — une annulation non prouvée ferait
//      manquer une réunion qui a bien lieu ;
//   3. l'épinglage suit : une réunion annulée quitte le haut du salon, une
//      réunion décalée y reste jusqu'à sa NOUVELLE heure de fin.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore, listMeetings, getMessage } from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-maj-"));
const PORT = 14982, HTTP = 14983, PIN = "606162";
const MINUTE = 60000;

const host = startHost({
  sessionName: "Direction", pin: PIN, adminPin: "737475",
  dataDir, wsPort: PORT, httpPort: HTTP,
});
await dodo(600);

const sac = () => ({ messages: [], majs: [], refus: [] });
const brancher = async (nom, dossier, s, pairing) => {
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom, pairing,
    dataDir: path.join(dataDir, dossier), groups: ["all"],
    onMessage: (m) => s.messages.push(m), onPresence: () => {},
    onRoster: () => {},
    onMeetingUpdated: (u) => s.majs.push(u),
    onMeetingUpdateRefused: (r) => s.refus.push(r),
  });
  await new Promise((r) => c.raw.on("open", r));
  return c;
};

const sOrg = sac(), sEquipe = sac();
const organisateur = await brancher("Directeur", "id-org", sOrg);
const equipe = await brancher("Karim", "id-equipe", sEquipe);
await dodo(700);

const debut = Date.now() + 90 * MINUTE;
organisateur.openMeeting({ title: "Conseil", startsAt: debut, durationMin: 60, location: "Salle 1" });
await dodo(800);
const reunion = sEquipe.messages.find((m) => m.type === "meeting");
assert.ok(reunion, "la réunion est annoncée");

// ── 1. Un TIERS ne peut ni décaler ni annuler ──────────────────────────
// Sinon n'importe qui ferait manquer une réunion à tout un service.
equipe.updateMeeting({ messageId: reunion.id, action: "cancelled" });
await dodo(800);
assert.equal(getMessage(reunion.id, host.roomId).meetingStatus, null,
  "seul l'organisateur décale ou annule");
assert.equal(sEquipe.refus.at(-1)?.reason, "pas-organisateur",
  "le refus doit être motivé, sinon on croit à une panne");

// ── 2. L'organisateur DÉCALE : tout le fil l'apprend ───────────────────
const nouveau = Date.now() + 26 * 60 * MINUTE;   // le lendemain
organisateur.updateMeeting({
  messageId: reunion.id, action: "moved",
  startsAt: nouveau, durationMin: 90, reason: "Salle indisponible",
});
await dodo(900);

const vu = sEquipe.majs.at(-1);
assert.ok(vu, "le report doit être diffusé au fil entier");
assert.equal(vu.status, "moved");
assert.equal(vu.startsAt, nouveau, "la nouvelle heure est relayée telle quelle");
assert.equal(vu.durationMin, 90);
assert.equal(vu.par, "Directeur", "qui a déplacé doit être porté");
assert.equal(vu.reason, "Salle indisponible");

// ── 3. La convocation d'ORIGINE n'est pas réécrite ─────────────────────
// Son heure est scellée : la modifier romprait la preuve. On note à côté.
const enBase = getMessage(reunion.id, host.roomId);
assert.equal(enBase.extra.startsAt, debut,
  "l'heure annoncée reste intacte dans l'historique");
assert.equal(enBase.signatureValid, true, "et sa signature tient toujours");
assert.equal(enBase.meetingStatus, "moved");
assert.equal(enBase.meetingNewStart, nouveau);
assert.equal(enBase.meetingUpdatedBy, "Directeur");

// ── 4. L'épinglage suit la NOUVELLE heure ──────────────────────────────
// Une réunion repoussée à demain ne doit pas disparaître ce soir.
assert.equal(listMeetings(host.roomId, ["all"]).length, 1,
  "une réunion décalée reste épinglée");
assert.equal(listMeetings(host.roomId, ["all"], debut + 2 * 60 * MINUTE).length, 1,
  "y compris passée son heure d'origine");
assert.equal(listMeetings(host.roomId, ["all"], nouveau + 91 * MINUTE).length, 0,
  "et elle en sort après sa nouvelle heure de fin");

// ── 5. L'organisateur ANNULE ───────────────────────────────────────────
organisateur.updateMeeting({ messageId: reunion.id, action: "cancelled", reason: "Reporté sine die" });
await dodo(900);
assert.equal(getMessage(reunion.id, host.roomId).meetingStatus, "cancelled");
assert.equal(listMeetings(host.roomId, ["all"]).length, 0,
  "une réunion annulée quitte le haut du salon");
assert.ok(getMessage(reunion.id, host.roomId).extra.title,
  "mais elle reste dans l'historique, avec son objet");

// ── 6. Une durée hors bornes est REFUSÉE, pas corrigée ─────────────────
// Même règle que l'annonce : la corriger casserait le sceau, et le report
// serait rejeté en silence.
organisateur.updateMeeting({
  messageId: reunion.id, action: "moved", startsAt: Date.now() + 60 * MINUTE, durationMin: 2,
});
await dodo(800);
assert.equal(getMessage(reunion.id, host.roomId).meetingStatus, "cancelled",
  "une durée hors bornes ne doit pas passer, même en report");

// ── 7. Un second appareil de l'organisateur en a le droit ──────────────
// On compare des PERSONNES : le Directeur doit pouvoir décaler depuis son
// téléphone appairé comme depuis son poste.
organisateur.openMeeting({ title: "Point hebdo", startsAt: Date.now() + 3 * 60 * MINUTE, durationMin: 30 });
await dodo(800);
const hebdo = sOrg.messages.find((m) => m.type === "meeting" && m.extra?.title === "Point hebdo");
assert.ok(hebdo, "la seconde réunion est annoncée");

const jeton = organisateur.makePairingToken();
const sMobile = sac();
const mobile = await brancher("Directeur", "id-org-mobile", sMobile, jeton);
await dodo(1200);
mobile.updateMeeting({ messageId: hebdo.id, action: "cancelled", reason: "Depuis le téléphone" });
await dodo(900);
assert.equal(getMessage(hebdo.id, host.roomId).meetingStatus, "cancelled",
  "le téléphone appairé de l'organisateur peut annuler");

organisateur.close(); equipe.close(); mobile.close();
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ reunion-maj.test.mjs : 20 assertions PASSÉES (report et annulation signés, origine intacte, épinglage suivi)");
process.exit(0);
