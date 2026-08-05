// ═══════════════════════════════════════════════════════════════
// Une personne, plusieurs connexions — non-régression
// ═══════════════════════════════════════════════════════════════
// « Ajouter mon mobile » fait rejoindre le téléphone sous LE MÊME pseudo
// que le poste (paramètre ?u= du QR : c'est tout l'intérêt, ne pas avoir
// à inventer un second nom). La table des clients de l'hôte était indexée
// par pseudo : la connexion du téléphone écrasait celle du poste, qui
// restait ouverte mais sortait de toute rediffusion.
//
// Le symptôme rapporté était « mon message parti du téléphone n'apparaît
// pas sur mon PC ». Le défaut réel était bien plus large : le poste
// devenait sourd à TOUT, y compris aux messages des autres, et le restait
// après le départ du téléphone (dont la fermeture supprimait l'entrée).
//
// Ce test verrouille les quatre propriétés qui doivent tenir.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore } from "../src/store.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-multiconn-"));
const PORT = 14852, HTTP = 14853, PIN = "161803";

const host = startHost({
  sessionName: "Salon multi-connexion", pin: PIN, adminPin: "987654",
  dataDir, wsPort: PORT, httpPort: HTTP,
});
await sleep(600);

const brancher = (userId, sousDossier) => {
  const recus = [];
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId,
    dataDir: path.join(dataDir, sousDossier), groups: ["all"],
    onMessage: (m) => recus.push(m), onPresence: () => {},
  });
  return { c, recus, recu: (t) => recus.some((m) => m.text === t) };
};

// 1) Le poste et un collègue rejoignent
const poste = brancher("Nacib", "id-poste");
await new Promise((r) => poste.c.raw.on("open", r));
const collegue = brancher("Karim", "id-collegue");
await new Promise((r) => collegue.c.raw.on("open", r));
await sleep(400);

collegue.c.send("avant le mobile", "all");
await sleep(500);
assert.ok(poste.recu("avant le mobile"), "le poste reçoit avant l'ajout du mobile");

// 2) Le mobile rejoint sous LE MÊME pseudo
const mobile = brancher("Nacib", "id-mobile");
await new Promise((r) => mobile.c.raw.on("open", r));
await sleep(500);
assert.equal(poste.c.raw.readyState, 1, "le poste est toujours connecté");

// 3) Ce que l'utilisateur voyait : son propre message depuis le téléphone
mobile.c.send("depuis mon telephone", "all");
await sleep(600);
assert.ok(collegue.recu("depuis mon telephone"), "le collègue reçoit le message du mobile");
assert.ok(poste.recu("depuis mon telephone"),
  "LE POSTE reçoit le message de son propre mobile (sens du fil préservé)");

// 4) Le défaut réel, plus large : le poste n'était plus servi du tout
collegue.c.send("apres l ajout", "all");
await sleep(600);
assert.ok(poste.recu("apres l ajout"), "le poste reçoit encore les messages des autres");

// 5) La présence compte des PERSONNES, pas des connexions
const presences = [];
const sonde = joinSession({
  address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: "Sonde",
  dataDir: path.join(dataDir, "id-sonde"), groups: ["all"],
  onMessage: () => {}, onPresence: (p) => presences.push(p),
});
await new Promise((r) => sonde.raw.on("open", r));
await sleep(600);
const derniere = presences[presences.length - 1] || [];
assert.ok(derniere.includes("Nacib") && derniere.includes("Karim"),
  "l'annuaire liste les deux personnes : " + JSON.stringify(derniere));
assert.equal(derniere.filter((n) => n === "Nacib").length, 1,
  "une personne sur deux appareils n'apparaît qu'une fois");

// 6) Le départ du téléphone ne doit pas emporter le poste
mobile.c.close();
await sleep(600);
collegue.c.send("apres depart du mobile", "all");
await sleep(600);
assert.ok(poste.recu("apres depart du mobile"),
  "le poste survit à la déconnexion du téléphone");

poste.c.close(); collegue.c.close(); sonde.close();
await sleep(200);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ multi-connexion.test.mjs : 7 assertions PASSÉES (poste + mobile sous le même pseudo)");
process.exit(0);
