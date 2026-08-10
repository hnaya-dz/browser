// ═══════════════════════════════════════════════════════════════
// Étape K — demande qualifiée, destinataire désigné, décision signée
// ═══════════════════════════════════════════════════════════════
// Le besoin, tel qu'il a été formulé : un chargé de projet demande au
// Directeur de valider un rapport. Les autres membres de l'équipe doivent
// savoir s'il a validé ou non, et il ne doit y avoir AUCUNE confusion sur
// la personne qui valide.
//
// Trois propriétés à tenir, et ce sont elles que ce fichier verrouille :
//   1. l'étiquette et le destinataire sont SIGNÉS — donc ni requalifiables
//      ni redirigeables après coup ;
//   2. seul le destinataire désigné peut se prononcer ;
//   3. l'issue est PUBLIQUE dans le fil, y compris pour qui arrive après.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore, listDecisions } from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-demande-"));
const PORT = 14932, HTTP = 14933, PIN = "334455";

const host = startHost({
  sessionName: "Marketing", pin: PIN, adminPin: "998877",
  dataDir, wsPort: PORT, httpPort: HTTP,
});
await dodo(600);

const brancher = async (nom, dossier, sac) => {
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom,
    dataDir: path.join(dataDir, dossier), groups: ["all"],
    onMessage: (m) => sac.messages.push(m),
    onPresence: () => {},
    onRoster: (r) => { sac.moi = r.me; sac.gens = r.people; },
    onDecisions: (d) => sac.decisions.push(d),
    onDecisionRefused: (r) => sac.refus.push(r),
  });
  await new Promise((r) => c.raw.on("open", r));
  return c;
};
const sac = () => ({ messages: [], decisions: [], refus: [], moi: null, gens: [] });

const sCharge = sac(), sDirecteur = sac(), sCollegue = sac();
const charge = await brancher("Karim", "id-charge", sCharge);
const directeur = await brancher("Directeur", "id-dir", sDirecteur);
const collegue = await brancher("Leila", "id-col", sCollegue);
await dodo(700);
charge.requestRoster();
await dodo(700);

const fpDirecteur = sCharge.gens.find((p) => p.name === "Directeur").fingerprint;
const fpCollegue = sCharge.gens.find((p) => p.name === "Leila").fingerprint;

// ── 1. Une demande de validation adressée au Directeur, dans le SALON ──
// Elle n'est pas envoyée en privé : c'est justement pour que l'équipe
// suive l'issue. Désigner quelqu'un n'est pas lui écrire en particulier.
charge.send("Rapport trimestriel — merci de valider", "all", null, null,
  { tag: "validation", destinataire: fpDirecteur });
await dodo(800);

const chezLeila = sCollegue.messages.find((m) => m.text.startsWith("Rapport trimestriel"));
assert.ok(chezLeila, "la demande doit être visible de toute l'équipe");
assert.equal(chezLeila.tag, "validation", "l'étiquette doit survivre au relais");
assert.equal(chezLeila.destinataire, fpDirecteur, "le destinataire désigné doit être visible");
assert.equal(chezLeila.signatureValid, true,
  "une demande dont la signature ne couvre pas l'étiquette serait sans valeur");
const idDemande = chezLeila.id;

// ── 2. Un tiers ne peut pas valider à la place du Directeur ────────────
collegue.decider({ messageId: idDemande, issue: "valide" });
await dodo(800);
assert.equal(listDecisions(idDemande).length, 0,
  "seul le destinataire désigné décide — sinon « qui a validé » n'a plus de réponse");
assert.equal(sCollegue.refus.at(-1)?.reason, "pas-destinataire",
  "le refus doit être expliqué, sinon on croit à une panne");

// ── 3. Le Directeur valide : toute l'équipe l'apprend ──────────────────
directeur.decider({ messageId: idDemande, issue: "valide", comment: "Accord, sous réserve du budget." });
await dodo(900);

const vueLeila = sCollegue.decisions.at(-1);
assert.ok(vueLeila, "l'issue doit être diffusée au fil entier, pas au seul demandeur");
assert.equal(vueLeila.messageId, idDemande);
assert.equal(vueLeila.decisions.length, 1);
assert.equal(vueLeila.decisions[0].issue, "valide");
assert.equal(vueLeila.decisions[0].sender, "Directeur", "le nom de qui valide doit être porté");
assert.equal(vueLeila.decisions[0].fingerprint, fpDirecteur,
  "l'empreinte aussi : un pseudo seul ne lève pas l'ambiguïté");
assert.equal(vueLeila.decisions[0].comment, "Accord, sous réserve du budget.");
assert.ok(sCharge.decisions.at(-1), "le demandeur aussi, évidemment");

// ── 4. Se rétracter remplace, ne cumule pas ────────────────────────────
directeur.decider({ messageId: idDemande, issue: "reserve", comment: "Finalement, des réserves." });
await dodo(800);
const apres = listDecisions(idDemande);
assert.equal(apres.length, 1, "une personne pèse UNE décision, la dernière");
assert.equal(apres[0].issue, "reserve", "sa dernière position prévaut");

// ── 5. « Pour info » n'attend aucune réponse ───────────────────────────
charge.send("Compte rendu de la réunion", "all", null, null, { tag: "info" });
await dodo(700);
const info = sCollegue.messages.find((m) => m.text === "Compte rendu de la réunion");
assert.equal(info.tag, "info");
assert.equal(info.destinataire, null, "une note d'information ne désigne personne");
collegue.decider({ messageId: info.id, issue: "valide" });
await dodo(700);
assert.equal(listDecisions(info.id).length, 0,
  "accepter une décision sur un « pour info » fabriquerait une approbation que personne n'a demandée");

// ── 6. Sans destinataire, chacun peut se prononcer ─────────────────────
// L'avis collectif reste possible : c'est la DÉSIGNATION qui restreint.
charge.send("Quel prestataire retenir ?", "all", null, null, { tag: "avis" });
await dodo(700);
const avis = sCollegue.messages.find((m) => m.text === "Quel prestataire retenir ?");
collegue.decider({ messageId: avis.id, issue: "reserve", comment: "Le devis est incomplet." });
directeur.decider({ messageId: avis.id, issue: "valide" });
await dodo(900);
const surAvis = listDecisions(avis.id);
assert.equal(surAvis.length, 2, "sans destinataire désigné, chacun se prononce");
assert.deepEqual(new Set(surAvis.map((d) => d.sender)), new Set(["Leila", "Directeur"]));

// ── 7. Un arrivant voit les issues DÉJÀ prises ─────────────────────────
// Même piège que le dépouillement des votes : une décision ne voyage pas
// avec les messages. Sans rejeu à la connexion, un nouveau venu verrait
// « Validation demandée au Directeur » sans jamais savoir qu'il a répondu.
const sTardif = sac();
const tardif = await brancher("Sofiane", "id-tardif", sTardif);
await dodo(1600);
const rejouees = sTardif.decisions.find((d) => d.messageId === idDemande);
assert.ok(rejouees, "un arrivant doit recevoir l'issue des demandes en cours");
assert.equal(rejouees.decisions[0].issue, "reserve",
  "et l'issue COURANTE, pas la première prise");

// ── 8. Une reconnexion aussi ───────────────────────────────────────────
let auRetour = null;
const revenant = joinSession({
  address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: "Leila",
  dataDir: path.join(dataDir, "id-col"), groups: ["all"],
  lastSeenTs: Date.now() + 60000,   // « j'ai déjà tout lu »
  onMessage: () => {}, onPresence: () => {},
  onDecisions: (d) => { if (d.messageId === idDemande) auRetour = d; },
});
await new Promise((r) => revenant.raw.on("open", r));
await dodo(1600);
assert.ok(auRetour,
  "une reconnexion ne redemande que les messages récents : l'issue doit être rejouée quand même");
revenant.close();

charge.close(); directeur.close(); collegue.close(); tardif.close();
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ demande.test.mjs : 22 assertions PASSÉES (étiquette signée, destinataire opposable, issue publique et rejouée)");
process.exit(0);
