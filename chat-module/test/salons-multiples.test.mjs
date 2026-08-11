// ═══════════════════════════════════════════════════════════════
// Plusieurs salons derrière UNE écoute — cloisonnement et licence
// Lancer : node test/salons-multiples.test.mjs
// ═══════════════════════════════════════════════════════════════
// Un salon = une paire de ports, jusqu'ici. « Salon global, Direction,
// DRH » sur une machine demandait donc trois services, trois bases, trois
// règles de pare-feu et trois adresses mobiles. Avec une conséquence que
// rien ne signalait : countDevices() compte PAR BASE, donc trois bases
// donnaient trois plafonds indépendants — une licence de 50 postes en
// autorisait 150.
//
// Ce test vérifie les deux promesses de la façade multi-salons :
//   1. le cloisonnement — ce qui se dit à la Direction ne parvient pas
//      à la DRH, alors que les deux passent par le MÊME port ;
//   2. le plafond d'appareils, désormais compté UNE SEULE FOIS pour
//      l'ensemble des salons.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startRoomsHost, cheminSalon } from "../src/rooms-host.js";
import { joinSession } from "../src/client.js";
import { closeStore } from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const PORT = 14892, HTTP = 14893;
const dataDir = tmp("hnaya-salons-");

// UNE base pour les trois salons : c'est ce qui donne l'annuaire commun
// et le décompte unique. maxDevices volontairement bas pour éprouver le
// plafond à travers les salons.
const hote = startRoomsHost({
  salons: [
    { name: "Salon global", pin: "111111", adminPin: "999999" },
    { name: "Direction", pin: "222222", adminPin: "888888" },
    { name: "DRH", pin: "333333", adminPin: "777777" },
  ],
  dataDir, wsPort: PORT, httpPort: HTTP, maxDevices: 2,
});
await dodo(600);

try {
  const salons = hote.rooms;
  assert.equal(salons.length, 3, "trois salons derrière une seule écoute");
  const global = salons[0], direction = salons[1], drh = salons[2];

  // ── 1. Un seul port pour les trois ──────────────────────────────────
  assert.equal(hote.wsPort, PORT, "un port unique, quel que soit le nombre de salons");
  assert.notEqual(direction.roomId, drh.roomId);

  const recus = { direction: [], drh: [] };
  const brancher = (salon, code, nom, sac) => {
    const c = joinSession({
      address: "127.0.0.1", wsPort: PORT, roomId: salon.roomId, pin: code, userId: nom,
      dataDir: path.join(dataDir, "id-" + nom), groups: ["all"],
      onMessage: (m) => { if (!m.backlog) sac.push(m); },
      onPresence: () => {},
    });
    return new Promise((r) => c.raw.on("open", () => r(c)));
  };

  const amina = await brancher(direction, "222222", "Amina", recus.direction);
  const karim = await brancher(drh, "333333", "Karim", recus.drh);
  await dodo(600);

  // ── 2. LE CLOISONNEMENT ─────────────────────────────────────────────
  // Même port, même processus, même base : rien ne doit passer d'un salon
  // à l'autre. C'est la promesse sur laquelle repose tout le reste.
  amina.send("Arbitrage budgétaire de jeudi");
  karim.send("Dossier de titularisation");
  await dodo(700);

  assert.ok(recus.direction.some((m) => m.text === "Arbitrage budgétaire de jeudi"),
    "la Direction reçoit ce qui se dit à la Direction");
  assert.ok(recus.drh.some((m) => m.text === "Dossier de titularisation"),
    "la DRH reçoit ce qui se dit à la DRH");
  assert.equal(recus.drh.some((m) => m.text === "Arbitrage budgétaire de jeudi"), false,
    "⚠️ la DRH ne doit RIEN recevoir de la Direction");
  assert.equal(recus.direction.some((m) => m.text === "Dossier de titularisation"), false,
    "⚠️ la Direction ne doit RIEN recevoir de la DRH");

  // La présence aussi est cloisonnée : la DRH ne doit pas apprendre qui
  // siège à la Direction.
  const presenceDrh = [];
  const observateur = joinSession({
    address: "127.0.0.1", wsPort: PORT, roomId: drh.roomId, pin: "333333", userId: "Karim",
    dataDir: path.join(dataDir, "id-Karim"), groups: ["all"],
    onMessage: () => {}, onPresence: (l) => presenceDrh.push(l),
  });
  await new Promise((r) => observateur.raw.on("open", r));
  await dodo(500);
  const vus = presenceDrh.flat();
  assert.equal(vus.includes("Amina"), false, "la présence ne franchit pas la cloison");
  observateur.close?.();

  // ── 3. LE PLAFOND DE LICENCE, COMPTÉ UNE FOIS ───────────────────────
  // Amina et Karim occupent les 2 places. Un TROISIÈME appareil doit être
  // refusé même s'il se présente sur un salon encore vide — c'est
  // précisément ce qui n'arrivait pas quand chaque salon avait sa base.
  const troisieme = joinSession({
    address: "127.0.0.1", wsPort: PORT, roomId: global.roomId, pin: "111111", userId: "Youcef",
    dataDir: path.join(dataDir, "id-Youcef"), groups: ["all"],
    onMessage: () => {}, onPresence: () => {},
  });
  const sortie = await new Promise((r) => {
    troisieme.raw.on("close", (code) => r({ ferme: true, code }));
    setTimeout(() => r({ ferme: false }), 2500);
  });
  assert.equal(sortie.ferme, true,
    "le 3e appareil est refusé : le plafond vaut pour TOUS les salons réunis");

  // ── 4. Le chemin désigne le salon ───────────────────────────────────
  assert.equal(cheminSalon(drh.roomId), `/r/${encodeURIComponent(drh.roomId)}`);

  // Chemin inconnu → refermé. Sonder au hasard n'apprend rien.
  const inconnu = new WebSocket(`ws://127.0.0.1:${PORT}/r/salon-inexistant`);
  const refus = await new Promise((r) => {
    inconnu.on("error", () => r("refus"));
    inconnu.on("open", () => r("ouvert"));
    setTimeout(() => r("silence"), 2000);
  });
  assert.notEqual(refus, "ouvert", "un chemin inconnu ne doit pas s'ouvrir");
  try { inconnu.close(); } catch {}

  // ── 5. Compatibilité : « / » mène au salon principal ────────────────
  // Un poste d'une version antérieure ignore les chemins. Il doit
  // continuer de fonctionner, sur le salon principal.
  const recusGlobal = [];
  const ancien = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: "111111", userId: "Amina",
    dataDir: path.join(dataDir, "id-Amina"), groups: ["all"],
    onMessage: (m) => { if (!m.backlog) recusGlobal.push(m); },
    onPresence: () => {},
  });
  await new Promise((r) => ancien.raw.on("open", r));
  await dodo(500);
  ancien.send("Note de service");
  await dodo(600);
  assert.ok(recusGlobal.some((m) => m.text === "Note de service"),
    "sans roomId, on atterrit sur le salon principal — les clients existants continuent de marcher");
  assert.equal(recus.direction.some((m) => m.text === "Note de service"), false,
    "et le salon principal reste cloisonné des autres");

  amina.close?.(); karim.close?.(); ancien.close?.();
  console.log("✅ salons-multiples : cloisonnement tenu, plafond compté une seule fois");
} finally {
  await hote.stop();
  closeStore();
}
