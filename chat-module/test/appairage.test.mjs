// ═══════════════════════════════════════════════════════════════
// Étape L — une PERSONNE, plusieurs appareils
// ═══════════════════════════════════════════════════════════════
// L'identité est la clé de l'appareil, et « Ajouter mon mobile » en crée
// une seconde : la même personne comptait deux fiches. L'annuaire
// l'affichait deux fois, et le vote comme les décisions devaient la
// reconnaître « par empreinte OU par pseudo » — un rapprochement qui tombe
// en défaut dès que deux collègues partagent un prénom.
//
// Le rattachement doit être PROUVÉ. Sans preuve, n'importe qui se
// déclarerait second appareil du Directeur et validerait à sa place — ce
// qui viderait de sens tout le circuit d'approbation de l'étape K.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import {
  closeStore, listRoster, personIdOf, devicesOfPerson, listDecisions,
} from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-pair-"));
const PORT = 14942, HTTP = 14943, PIN = "515253";

const host = startHost({
  sessionName: "Direction", pin: PIN, adminPin: "606162",
  dataDir, wsPort: PORT, httpPort: HTTP,
});
await dodo(600);

const sac = () => ({ messages: [], roster: [], moi: null, paires: [], decisions: [] });
const brancher = async (nom, dossier, s, pairing) => {
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom,
    dataDir: path.join(dataDir, dossier), groups: ["all"], pairing,
    onMessage: (m) => s.messages.push(m), onPresence: () => {},
    onRoster: (r) => { s.roster = r.people; s.moi = r.me; },
    onDevicePaired: (p) => s.paires.push(p),
    onDecisions: (d) => s.decisions.push(d),
  });
  await new Promise((r) => c.raw.on("open", r));
  return c;
};

const sPoste = sac(), sAutre = sac();
const poste = await brancher("Directeur", "id-poste", sPoste);
const collegue = await brancher("Karim", "id-karim", sAutre);
await dodo(700);
poste.requestRoster();
await dodo(600);
assert.equal(sPoste.roster.length, 2, "deux personnes au départ");
const fpPoste = sPoste.moi;

// ── 1. Un appareil qui arrive SANS jeton reste une personne à part ─────
const sSansJeton = sac();
const intrus = await brancher("Directeur", "id-intrus", sSansJeton);
await dodo(800);
poste.requestRoster();
await dodo(600);
assert.equal(sPoste.roster.length, 3,
  "sans preuve, un homonyme est une personne distincte — pas un second appareil");

// ── 2. Un jeton FORGÉ ne rattache rien ─────────────────────────────────
// C'est l'attaque qui compte : se déclarer second appareil du Directeur.
const faux = { fp: fpPoste, exp: Date.now() + 60000, nonce: "deadbeefdeadbeef",
               sig: Buffer.from("nimportequoi").toString("base64") };
const sFaux = sac();
const faussaire = await brancher("Directeur", "id-faux", sFaux, faux);
await dodo(900);
assert.equal(devicesOfPerson(personIdOf(fpPoste)).length, 1,
  "une signature invalide ne doit rattacher aucun appareil au Directeur");
faussaire.close();
await dodo(300);

// ── 3. Le VRAI jeton, signé par le poste, rattache le téléphone ────────
const jeton = poste.makePairingToken();
const sMobile = sac();
const mobile = await brancher("Directeur", "id-mobile", sMobile, jeton);
await dodo(900);

const personneDuPoste = personIdOf(fpPoste);
const appareils = devicesOfPerson(personneDuPoste);
assert.equal(appareils.length, 2, "le poste et le téléphone forment une seule personne");
assert.ok(appareils.includes(fpPoste));
assert.ok(sPoste.paires.length >= 1,
  "l'appareil qui a autorisé doit être prévenu : détecter vaut mieux que rien");

// ── 4. L'annuaire n'affiche plus qu'une entrée pour cette personne ─────
// Cinq appareils ont rejoint : poste, Karim, l'homonyme, le faussaire, le
// téléphone. Sans appairage l'annuaire en montrerait cinq. Le poste et le
// téléphone n'en font qu'un, donc quatre.
poste.requestRoster();
await dodo(700);
assert.equal(sPoste.roster.length, 4,
  "les deux appareils appairés ne comptent que pour une entrée");
const laPersonne = sPoste.roster.find((p) => p.isMe);
assert.ok(laPersonne, "on doit se reconnaître dans l'annuaire");
// `isMe` se juge sur la personne, pas sur l'appareil : le Directeur doit se
// reconnaître qu'il regarde depuis son poste ou depuis son téléphone.
mobile.requestRoster();
await dodo(700);
assert.ok(sMobile.roster.find((p) => p.isMe),
  "depuis le téléphone appairé aussi, on doit se reconnaître");

// ── 5. Le jeton ne sert qu'UNE fois ────────────────────────────────────
const sRejeu = sac();
const rejeu = await brancher("Directeur", "id-rejeu", sRejeu, jeton);
await dodo(900);
assert.equal(devicesOfPerson(personneDuPoste).length, 2,
  "rejouer un jeton déjà servi ne doit rattacher personne de plus");
rejeu.close();
await dodo(300);

// ── 6. Un jeton PÉRIMÉ ne rattache rien ────────────────────────────────
const perime = poste.makePairingToken(-1000); // déjà expiré
const sPerime = sac();
const tardif = await brancher("Directeur", "id-perime", sPerime, perime);
await dodo(900);
assert.equal(devicesOfPerson(personneDuPoste).length, 2,
  "un jeton expiré ne doit rattacher personne");
tardif.close();
await dodo(300);

// ── 7. Une demande adressée au POSTE se répond depuis le TÉLÉPHONE ─────
// C'est le bénéfice concret : le Directeur désigné sur son poste doit
// pouvoir valider depuis son téléphone. Avant l'appairage, l'hôte lui
// aurait refusé sa propre demande.
collegue.send("Rapport a valider", "all", null, null,
  { tag: "validation", destinataire: fpPoste });
await dodo(900);
const demande = sMobile.messages.find((m) => m.text === "Rapport a valider");
assert.ok(demande, "la demande arrive sur le téléphone aussi");
assert.equal(demande.destinataire, fpPoste, "elle désigne l'empreinte du poste");

mobile.decider({ messageId: demande.id, issue: "valide" });
await dodo(900);
const prises = listDecisions(demande.id);
assert.equal(prises.length, 1, "le téléphone appairé peut répondre pour sa personne");
assert.equal(prises[0].issue, "valide");

// ── 8. Une personne, UNE décision, même depuis deux appareils ──────────
poste.decider({ messageId: demande.id, issue: "reserve" });
await dodo(900);
const apres = listDecisions(demande.id);
assert.equal(apres.length, 1,
  "se raviser depuis l'autre appareil REMPLACE : deux positions signées et contradictoires seraient ingérables");
assert.equal(apres[0].issue, "reserve", "la dernière prévaut");

// ── 9. Un tiers reste refusé ───────────────────────────────────────────
collegue.decider({ messageId: demande.id, issue: "valide" });
await dodo(800);
assert.equal(listDecisions(demande.id).length, 1,
  "l'appairage n'ouvre le droit qu'aux appareils de la personne désignée");

poste.close(); collegue.close(); mobile.close(); intrus.close();
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ appairage.test.mjs : 16 assertions PASSÉES (jeton signé, usage unique, expiration, une personne une voix)");
process.exit(0);
