// ═══════════════════════════════════════════════════════════════
// Jeu de démonstration — un salon garni, en une commande
// ═══════════════════════════════════════════════════════════════
// À QUOI CELA SERT
//   Illustrer le guide, enregistrer un tutoriel vidéo, faire une
//   démonstration devant un partenaire. Toutes ces tâches demandent un
//   salon VIVANT — plusieurs personnes en ligne, une demande de validation
//   en attente, un vote dépouillé, une réunion à venir, une conversation
//   privée non lue. Le monter à la main avant chaque capture est pénible,
//   et le monter avec de vraies données est exclu.
//
// ⚠️ CE FICHIER NE PART JAMAIS CHEZ UN CLIENT.
//   Il vit dans tools/, exclu du paquet livré comme l'émetteur de licences
//   (voir la configuration electron-builder). Un jeu de démonstration
//   embarqué dans un produit installé serait au mieux embarrassant, au
//   pire pris pour de vraies données.
//
// ⚠️ IL N'ÉCRIT QUE DANS SON PROPRE RÉPERTOIRE.
//   Par défaut <tmp>/hnaya-demo. Il ne touche NI aux données de
//   l'application installée (%APPDATA%\hnaya-dz-browser\chat-data), NI à
//   celles du serveur permanent (%ProgramData%\Hnaya Chat Server), NI au
//   répertoire du module. --data permet d'en choisir un autre ; --reset
//   efface le répertoire de démonstration AVANT de le regarnir, et refuse
//   de le faire s'il ne porte pas la marque d'un jeu de démonstration.
//
// USAGE
//   node tools/demo.mjs             monte le salon et le laisse tourner
//   node tools/demo.mjs --reset     repart d'un salon vierge
//   node tools/demo.mjs --pin 123456 --port 4802
//   Ctrl+C                          arrête tout proprement
//
// Les noms sont FICTIFS et neutres. Ne jamais y mettre un nom, une adresse
// ou un code rencontré en test réel : ce sont ces valeurs-là qui finissent
// par se retrouver dans une capture d'écran envoyée à un partenaire.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";

const MINUTE = 60000;
const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const ici = path.dirname(fileURLToPath(import.meta.url));

// ── Arguments ──────────────────────────────────────────────────────────
function args(argv) {
  const a = { pin: "246810", adminPin: "135790", port: 4802, httpPort: 4803 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--data") a.data = argv[++i];
    else if (argv[i] === "--pin") a.pin = argv[++i];
    else if (argv[i] === "--admin-pin") a.adminPin = argv[++i];
    else if (argv[i] === "--port") a.port = Number(argv[++i]);
    else if (argv[i] === "--http-port") a.httpPort = Number(argv[++i]);
    else if (argv[i] === "--reset") a.reset = true;
    else if (argv[i] === "--help" || argv[i] === "-h") a.help = true;
  }
  return a;
}

const o = args(process.argv.slice(2));
if (o.help) {
  console.log(`Jeu de démonstration de la messagerie Hnaya

  --data <dossier>    répertoire de démonstration (défaut : <tmp>/hnaya-demo)
  --pin 246810        code d'accès du salon
  --admin-pin 135790  code administrateur
  --port 4802         port du salon
  --http-port 4803    port de la page mobile
  --reset             efface le répertoire de démonstration avant de garnir
  --help              cette aide`);
  process.exit(0);
}

const DATA = o.data ? path.resolve(o.data) : path.join(os.tmpdir(), "hnaya-demo");
const MARQUE = path.join(DATA, ".demonstration-hnaya");

// ── Garde-fou : ne jamais effacer un répertoire qui n'est pas le nôtre ──
// Le marqueur est écrit à la création. --reset refuse d'effacer un dossier
// existant qui ne le porte pas : c'est ce qui empêche un --data mal tapé
// d'emporter les données réelles de quelqu'un.
if (o.reset && fs.existsSync(DATA)) {
  if (!fs.existsSync(MARQUE)) {
    console.error(`Refus d'effacer ${DATA} : ce répertoire ne porte pas la marque
d'un jeu de démonstration (.demonstration-hnaya). Si c'est bien un dossier
jetable, supprimez-le vous-même ; s'il contient de vraies données, vous
venez d'éviter une mauvaise surprise.`);
    process.exit(1);
  }
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log("• répertoire de démonstration effacé");
}
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(MARQUE, "Jeu de démonstration Hnaya — répertoire jetable.\n");

// ── Les personnes, fictives ────────────────────────────────────────────
// Une direction, deux chargés de projet, une responsable. Assez pour
// montrer une demande adressée, un vote à plusieurs voix et un fil privé.
const GENS = [
  { nom: "Direction", dossier: "dir", role: "Directeur" },
  { nom: "Amel Bensalah", dossier: "amel", role: "Chargée de projet" },
  { nom: "Yacine Meddour", dossier: "yacine", role: "Chargé de projet" },
  { nom: "Nadia Cherif", dossier: "nadia", role: "Responsable financière" },
];

// ── Une pièce jointe crédible, fabriquée sur place ─────────────────────
// Un PDF minimal mais VALIDE : il s'ouvre réellement, ce qui compte pour
// une capture — un fichier qui refuse de s'ouvrir devant un partenaire est
// pire que pas de pièce jointe du tout.
function pdfDemo(titre) {
  const contenu = `BT /F1 18 Tf 60 760 Td (${titre}) Tj ET`;
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
      + "/Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${contenu.length} >>\nstream\n${contenu}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objets.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`
    + offsets.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("")
    + `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// ═══════════════════════════════════════════════════════════════════════
console.log(`\nJeu de démonstration Hnaya — montage en cours…`);
console.log(`• données : ${DATA}`);

const host = startHost({
  sessionName: "Direction générale", pin: o.pin, adminPin: o.adminPin,
  dataDir: DATA, wsPort: o.port, httpPort: o.httpPort,
});
await dodo(700);

// ── Connexion des personnes ────────────────────────────────────────────
const clients = {};
const recu = {};
const annuaires = {};   // pseudo -> dernier annuaire reçu
for (const g of GENS) {
  recu[g.nom] = [];
  const c = joinSession({
    address: "127.0.0.1", wsPort: o.port, pin: o.pin, userId: g.nom,
    dataDir: path.join(DATA, "id-" + g.dossier), groups: ["all"],
    onMessage: (m) => recu[g.nom].push(m),
    onPresence: () => {},
    onRoster: (r) => { annuaires[g.nom] = r; },
  });
  await new Promise((r) => c.raw.on("open", r));
  clients[g.nom] = c;
  await dodo(250);
}
await dodo(600);
// Un seul annuaire suffit : il porte l'empreinte de chacun, dont on a
// besoin pour adresser une demande et pour composer un fil privé.
clients["Amel Bensalah"].requestRoster();
await dodo(800);
console.log(`• ${GENS.length} personnes connectées`);

const vuParAmel = annuaires["Amel Bensalah"];
const empreinteDe = (nom) => vuParAmel?.people?.find((p) => p.name === nom)?.fingerprint || null;

// ── L'échange ──────────────────────────────────────────────────────────
const D = clients["Direction"], A = clients["Amel Bensalah"];
const Y = clients["Yacine Meddour"], N = clients["Nadia Cherif"];

A.send("Bonjour à toutes et à tous. La synthèse du trimestre est prête.", "all");
await dodo(400);
Y.send("Merci Amel. Je regarde ça ce matin.", "all");
await dodo(500);

// Une pièce jointe réelle, puis une demande de validation qui porte dessus.
const pdf = pdfDemo("Rapport trimestriel - synthese");
const up = await A.uploadMedia({ kind: "file", mime: "application/pdf", buffer: pdf, thumb: null });
await dodo(400);

// Empreinte de la Direction — nécessaire pour lui ADRESSER la demande.
const fpDirection = empreinteDe("Direction");

// 1) Une demande de validation EN ATTENTE — l'état le plus parlant :
//    on voit à qui elle est adressée et que rien n'a encore été décidé.
A.send("Rapport trimestriel — merci de valider avant vendredi.", "all",
  { kind: "file", mime: "application/pdf", sha256: up.sha256, size: up.size,
    thumb: null, name: "Rapport trimestriel.pdf" },
  null,
  fpDirection ? { tag: "validation", destinataire: fpDirection } : { tag: "validation" });
await dodo(700);

// 2) Une demande d'AVIS déjà tranchée par deux personnes — l'état
//    « décidé », avec les noms et les commentaires.
Y.send("Quel prestataire retenir pour la maintenance ?", "all", null, null, { tag: "avis" });
await dodo(700);
const avis = recu["Nadia Cherif"].find((m) => m.text?.startsWith("Quel prestataire"));
if (avis) {
  N.decider({ messageId: avis.id, issue: "reserve", comment: "Le devis est incomplet." });
  await dodo(400);
  D.decider({ messageId: avis.id, issue: "valide", comment: "Accord sur le second." });
  await dodo(500);
}

// 3) Un vote dépouillé — trois voix sur trois options.
const idVote = D.openVote({
  question: "Budget prévisionnel 2027 : adoption en l'état ?",
  options: ["Valider", "Refuser", "Réserves"], nominatif: true,
});
await dodo(700);
A.answerVote({ voteId: idVote, choice: 0 });
await dodo(200);
Y.answerVote({ voteId: idVote, choice: 0 });
await dodo(200);
N.answerVote({ voteId: idVote, choice: 2, comment: "Sous réserve du poste 62." });
await dodo(600);

// 4) Une réunion à venir — épinglée, avec compte à rebours.
D.openMeeting({
  title: "Conseil de direction", startsAt: Date.now() + 42 * MINUTE,
  durationMin: 60, location: "Salle du conseil",
  text: "Ordre du jour : budget 2027, maintenance, calendrier des congés.",
});
await dodo(600);

// 5) Une note d'information — pour montrer l'étiquette qui n'attend rien.
N.send("Rappel : les états de frais sont à déposer avant le 25.", "all", null, null, { tag: "info" });
await dodo(500);

// 6) Des accusés de lecture sur le message d'Amel.
const premier = recu["Yacine Meddour"].find((m) => m.text?.startsWith("Bonjour à toutes"));
if (premier) {
  Y.markRead(premier.id, "all");
  await dodo(200);
  N.markRead(premier.id, "all");
  await dodo(400);
}

// 7) Une conversation privée NON LUE — le bandeau rouge est l'un des
//    éléments les plus démonstratifs de l'interface.
const fpAmel = vuParAmel?.me || null;
if (fpDirection && fpAmel) {
  // Identifiant d'un fil privé : empreintes triées, donc les deux côtés le
  // calculent à l'identique sans se concerter (voir src/direct.js).
  const fil = "dm:" + [fpDirection.toLowerCase(), fpAmel.toLowerCase()].sort().join("+");
  D.send("Amel, pouvez-vous préparer une note d'une page pour le conseil ?", fil);
  await dodo(500);
}

// ═══════════════════════════════════════════════════════════════════════
const ip = Object.values(os.networkInterfaces()).flat()
  .find((i) => i && i.family === "IPv4" && !i.internal)?.address || "127.0.0.1";

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Salon « Direction générale » — prêt pour capture

  Code d'accès ........ ${o.pin}
  Code administrateur . ${o.adminPin}
  Page mobile ......... http://${ip}:${o.httpPort}
  Depuis le navigateur  le salon apparaît dans la liste, ou
                        « Rejoindre par IP » : 127.0.0.1

  Le salon contient :
   · une demande de VALIDATION en attente, adressée à la Direction,
     avec un PDF joint
   · une demande d'AVIS déjà tranchée, deux positions signées
   · un VOTE dépouillé, trois voix
   · une RÉUNION dans 42 minutes, épinglée
   · une note POUR INFO
   · des accusés de lecture
   · un message PRIVÉ non lu pour Amel Bensalah

  Ctrl+C pour tout arrêter. Les données restent dans
  ${DATA}
  et se suppriment avec --reset au prochain lancement.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// Les personnes restent CONNECTÉES : sans cela l'annuaire les afficherait
// hors ligne, et une capture d'un salon vide n'illustre rien.
const arret = async () => {
  console.log("\n• arrêt du jeu de démonstration…");
  for (const c of Object.values(clients)) { try { c.close(); } catch { /* déjà fermé */ } }
  await dodo(300);
  try { await host.stop(); } catch { /* déjà arrêté */ }
  process.exit(0);
};
process.on("SIGINT", arret);
process.on("SIGTERM", arret);
