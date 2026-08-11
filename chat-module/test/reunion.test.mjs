// ═══════════════════════════════════════════════════════════════
// Étape P — réunion annoncée
// ═══════════════════════════════════════════════════════════════
// Une réunion EST un message : même table, même historique, même
// signature. Ce qui la distingue tient en deux points, et ce sont eux que
// ce fichier verrouille :
//
//  1. Son heure et sa durée sont SCELLÉES dans la signature. Une réunion
//     déplaçable après coup ne vaudrait pas mieux qu'un message libre, et
//     le fichier .ics exporté porterait une heure que personne n'a
//     annoncée.
//  2. Elle est ÉPINGLÉE tant qu'elle n'est pas terminée. Passée son heure
//     de fin, elle redevient un message d'historique comme un autre —
//     sinon le haut du salon se remplirait de réunions périmées.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore, listMeetings } from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-reunion-"));
const PORT = 14972, HTTP = 14973, PIN = "909192";
const MINUTE = 60000;

const host = startHost({
  sessionName: "Direction", pin: PIN, adminPin: "939495",
  dataDir, wsPort: PORT, httpPort: HTTP,
});
await dodo(600);

const sac = () => ({ messages: [] });
const brancher = async (nom, dossier, s, lastSeenTs = 0) => {
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom, lastSeenTs,
    dataDir: path.join(dataDir, dossier), groups: ["all"],
    onMessage: (m) => s.messages.push(m), onPresence: () => {},
  });
  await new Promise((r) => c.raw.on("open", r));
  return c;
};

const sOrg = sac(), sEquipe = sac();
const organisateur = await brancher("Directeur", "id-org", sOrg);
const equipe = await brancher("Karim", "id-equipe", sEquipe);
await dodo(700);

// ── 1. Une réunion annoncée arrive à tous, signée ──────────────────────
const debut = Date.now() + 90 * MINUTE;
organisateur.openMeeting({
  title: "Conseil de direction", startsAt: debut, durationMin: 45,
  location: "Salle 2", text: "Ordre du jour joint",
});
await dodo(800);

const vue = sEquipe.messages.find((m) => m.type === "meeting");
assert.ok(vue, "la réunion doit parvenir à toute l'équipe");
assert.equal(vue.extra.title, "Conseil de direction");
assert.equal(vue.extra.startsAt, debut, "l'heure annoncée doit être relayée telle quelle");
assert.equal(vue.extra.durationMin, 45);
assert.equal(vue.extra.location, "Salle 2");
assert.equal(vue.signatureValid, true,
  "une convocation non signée n'engage personne — elle ne doit jamais être épinglée");

// ── 2. Elle est épinglable tant qu'elle n'est pas terminée ─────────────
const aVenir = listMeetings(host.roomId, ["all"]);
assert.equal(aVenir.length, 1, "une réunion à venir est épinglée");
assert.equal(aVenir[0].id, vue.id);

// ── 3. Terminée, elle cesse de l'être ──────────────────────────────────
// On interroge « comme si » on était après la fin : la réunion reste dans
// l'historique, mais quitte le haut du salon.
const apresLaFin = listMeetings(host.roomId, ["all"], debut + 46 * MINUTE);
assert.equal(apresLaFin.length, 0,
  "passée son heure de fin, une réunion ne doit plus occuper le haut du salon");
// Pendant qu'elle a lieu, en revanche, elle reste épinglée.
assert.equal(listMeetings(host.roomId, ["all"], debut + 10 * MINUTE).length, 1,
  "une réunion EN COURS reste épinglée");

// ── 4. Une réunion antidatée est refusée ───────────────────────────────
// Rien à annoncer sur une réunion d'hier : l'épingler serait absurde, et
// l'accepter ouvrirait la porte à des convocations rétroactives.
organisateur.openMeeting({ title: "Reunion d hier", startsAt: Date.now() - 3 * 3600000, durationMin: 30 });
await dodo(800);
assert.equal(listMeetings(host.roomId, ["all"]).length, 1,
  "une réunion dans le passé ne doit pas être enregistrée");

// ── 5. Un titre vide est refusé ────────────────────────────────────────
organisateur.openMeeting({ title: "   ", startsAt: Date.now() + 60 * MINUTE, durationMin: 30 });
await dodo(700);
assert.equal(listMeetings(host.roomId, ["all"]).length, 1,
  "une réunion sans titre n'annonce rien");

// ── 6. Une durée hors bornes est REFUSÉE, pas corrigée ─────────────────
// ⚠️ Le piège que ce test a révélé : la durée fait partie du sceau signé.
// Une première version la ramenait dans ses bornes côté serveur — ce qui
// produisait un sceau différent de celui signé par le client, donc un
// rejet silencieux, sans que rien n'explique pourquoi la réunion ne
// partait jamais. Un serveur ne réécrit JAMAIS ce qui est signé : il
// accepte ou il refuse.
organisateur.openMeeting({ title: "Duree absurde", startsAt: Date.now() + 30 * MINUTE, durationMin: -5 });
await dodo(800);
assert.equal(listMeetings(host.roomId, ["all"]).length, 1,
  "une durée négative doit être refusée, pas corrigée en douce");
organisateur.openMeeting({ title: "Trois jours", startsAt: Date.now() + 30 * MINUTE, durationMin: 3 * 24 * 60 });
await dodo(800);
assert.equal(listMeetings(host.roomId, ["all"]).length, 1,
  "une durée de plusieurs jours doit l'être aussi");
// Et une durée valide passe, elle.
organisateur.openMeeting({ title: "Point rapide", startsAt: Date.now() + 30 * MINUTE, durationMin: 15 });
await dodo(800);
assert.equal(listMeetings(host.roomId, ["all"]).length, 2,
  "une durée dans les bornes est acceptée");

// ── 7. Un arrivant retrouve la réunion épinglée ────────────────────────
// Elle voyage avec les messages : contrairement au dépouillement ou aux
// décisions, aucun rejeu particulier n'est nécessaire — mais encore
// faut-il que le type survive à l'enregistrement.
const sTardif = sac();
const tardif = await brancher("Leila", "id-tardif", sTardif);
await dodo(1200);
const chezElle = sTardif.messages.find((m) => m.type === "meeting" && m.extra?.title === "Conseil de direction");
assert.ok(chezElle, "un arrivant doit recevoir la réunion dans son rattrapage");
assert.equal(chezElle.extra.startsAt, debut, "avec son heure intacte");


// ── 8. Quitter le salon et revenir NE DOIT PAS dépingler ───────────────
// Constaté en test réel, et l'utilisateur a fait le lien avant moi : une
// réunion annoncée hier est plus ancienne que le point de reprise, donc
// absente du rattrapage. Elle disparaissait de l'épinglage au retour — et
// comme c'est son arrivée qui programme le rappel, le rappel partait avec.
let recuAuRetour = [];
const revenant = joinSession({
  address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: "Karim",
  dataDir: path.join(dataDir, "id-equipe"), groups: ["all"],
  lastSeenTs: Date.now() + 60000,   // « j'ai déjà tout lu »
  onMessage: (m) => recuAuRetour.push(m), onPresence: () => {},
});
await new Promise((r) => revenant.raw.on("open", r));
await dodo(1400);
const rejouee = recuAuRetour.find((m) => m.type === "meeting" && m.extra?.title === "Conseil de direction");
assert.ok(rejouee, "une réunion à venir doit être rejouée même sans rattrapage de messages");
assert.equal(rejouee.extra.startsAt, debut, "avec son heure intacte");
assert.ok(rejouee.backlog, "marquée comme rattrapage : elle ne doit ni sonner ni compter");
// SEULES les réunions à venir repassent : les deux acceptées, et rien de
// plus. Le haut du salon ne doit pas se remplir de convocations périmées
// ni de celles que l'hôte a refusées.
const reunionsRejouees = recuAuRetour.filter((m) => m.type === "meeting");
assert.equal(reunionsRejouees.length, 2,
  "exactement les deux réunions à venir, pas les refusées ni les terminées");
assert.deepEqual(new Set(reunionsRejouees.map((m) => m.extra.title)),
  new Set(["Conseil de direction", "Point rapide"]));
revenant.close();
await dodo(300);

organisateur.close(); equipe.close(); tardif.close();
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ reunion.test.mjs : 19 assertions PASSÉES (heure scellée, épinglage borné dans le temps, refus des antidatées et des durées hors bornes)");
process.exit(0);
