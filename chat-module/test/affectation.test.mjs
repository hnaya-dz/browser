// ═══════════════════════════════════════════════════════════════
// Affectation depuis le salon principal — composer sans ouvrir
// Lancer : node test/affectation.test.mjs
// ═══════════════════════════════════════════════════════════════
// Constituer un salon AVANT que quiconque s'y connecte suppose de voir des
// personnes qui n'y sont pas encore, donc de franchir le cloisonnement du
// registre. Ce franchissement est confié au seul salon PRINCIPAL.
//
// ⚠️ CE QUE CE TEST DOIT ÉTABLIR AVANT TOUT : AFFECTER N'EST PAS OUVRIR.
// La clé de chiffrement d'un salon dérive de SON code d'accès. Inscrire
// une empreinte dans la composition de la DRH ne doit donc rien donner à
// qui ne détient pas le code de la DRH. Sans cette propriété, l'admin du
// salon principal deviendrait l'admin de tout — et l'arbitrage qui lui
// confie l'affectation ne tiendrait plus.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startRoomsHost } from "../src/rooms-host.js";
import { joinSession } from "../src/client.js";
import { closeStore, isRoomMember } from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-affect-"));
const PORT = 14902, HTTP = 14903;

const hote = startRoomsHost({
  salons: [
    { name: "Salon global", pin: "111111", adminPin: "999999" },
    { name: "Direction", pin: "222222", adminPin: "888888" },
    { name: "DRH", pin: "333333", adminPin: "777777" },
  ],
  dataDir, wsPort: PORT, httpPort: HTTP,
});
await dodo(600);

try {
  const salons = hote.rooms;
  const global = salons[0], direction = salons[1], drh = salons[2];
  const reponses = [];
  const brancher = async (salon, code, nom) => {
    const c = joinSession({
      address: "127.0.0.1", wsPort: PORT, roomId: salon.roomId, pin: code, userId: nom,
      dataDir: path.join(dataDir, "id-" + nom), groups: ["all"],
      onMessage: () => {}, onPresence: () => {},
      onAdminResult: (r) => reponses.push(r),
    });
    await new Promise((r) => c.raw.on("open", r));
    return c;
  };
  const attendre = async (reqId) => {
    for (let i = 0; i < 25; i++) {
      const r = reponses.find((x) => x.reqId === reqId);
      if (r) return r;
      await dodo(100);
    }
    throw new Error("Pas de réponse admin pour " + reqId);
  };

  // Amina se présente au salon d'entrée : c'est ce qui la fait exister
  // pour le serveur. On n'affecte que des personnes déjà connues — une
  // identité, ici, est une clé, pas un nom dans une liste.
  const amina = await brancher(global, "111111", "Amina");
  await dodo(500);

  // ── 1. L'annuaire du SERVEUR, vu du salon principal ─────────────────
  amina.sendAdmin({ adminPin: "999999", action: "annuaire-serveur", reqId: "a1" });
  const a1 = await attendre("a1");
  assert.equal(a1.ok, true, "le salon principal accède à l'annuaire complet");
  const fpAmina = a1.data[0].fingerprint;

  amina.sendAdmin({ adminPin: "999999", action: "salons", reqId: "a2" });
  assert.equal((await attendre("a2")).data.length, 3, "il voit les salons servis");

  // ── 2. Affectation à un salon où elle n'a JAMAIS mis les pieds ──────
  assert.equal(isRoomMember(drh.roomId, fpAmina), false, "elle n'est pas encore de la DRH");
  amina.sendAdmin({ adminPin: "999999", action: "affecter", roomId: drh.roomId, fingerprint: fpAmina, present: true, reqId: "a3" });
  const a3 = await attendre("a3");
  assert.equal(a3.ok, true);
  assert.equal(isRoomMember(drh.roomId, fpAmina), true, "elle est inscrite avant toute connexion");
  assert.ok(a3.data.some((m) => m.fingerprint === fpAmina), "la composition la montre");

  // ── 3. ⚠️ AFFECTER N'OUVRE RIEN ─────────────────────────────────────
  // Membre de la DRH, mais avec le code du salon global : la clé ne
  // correspond pas, rien n'est déchiffrable, la connexion ne tient pas.
  const intrus = joinSession({
    address: "127.0.0.1", wsPort: PORT, roomId: drh.roomId, pin: "111111", userId: "Amina",
    dataDir: path.join(dataDir, "id-Amina"), groups: ["all"],
    onMessage: () => {}, onPresence: () => {},
  });
  const issue = await new Promise((r) => {
    intrus.raw.on("close", () => r("refuse"));
    setTimeout(() => r("tenu"), 3000);
  });
  assert.equal(issue, "refuse",
    "⚠️ l'appartenance ne remplace pas le code du salon : sans lui, rien ne s'ouvre");

  // Témoin positif — sans lui, l'assertion ci-dessus ne prouverait rien :
  // un refus peut venir de mille causes. AVEC le bon code, la même
  // personne entre. C'est donc bien la clé, et elle seule, qui a bloqué.
  const legitime = joinSession({
    address: "127.0.0.1", wsPort: PORT, roomId: drh.roomId, pin: "333333", userId: "Amina",
    dataDir: path.join(dataDir, "id-Amina"), groups: ["all"],
    onMessage: () => {}, onPresence: () => {},
  });
  const tenue = await new Promise((r) => {
    legitime.raw.on("close", () => r("refuse"));
    setTimeout(() => r("tenu"), 2500);
  });
  assert.equal(tenue, "tenu", "avec le code de la DRH, la connexion tient");
  legitime.close?.();

  // ── 4. Un admin de SERVICE n'a pas ce pouvoir ───────────────────────
  const karim = await brancher(direction, "222222", "Karim");
  await dodo(400);
  karim.sendAdmin({ adminPin: "888888", action: "annuaire-serveur", reqId: "b1" });
  const b1 = await attendre("b1");
  assert.equal(b1.ok, false, "l'admin d'un service ne voit pas l'annuaire du serveur");
  assert.equal(b1.error, "reserve-salon-principal");

  karim.sendAdmin({ adminPin: "888888", action: "affecter", roomId: drh.roomId, fingerprint: fpAmina, present: false, reqId: "b2" });
  assert.equal((await attendre("b2")).ok, false, "et il ne compose pas la DRH");
  assert.equal(isRoomMember(drh.roomId, fpAmina), true, "la composition est intacte après son refus");

  // ── 5. Un champ absent ne retire personne ───────────────────────────
  // Même règle que pour la fonction : l'absence n'est pas un ordre.
  amina.sendAdmin({ adminPin: "999999", action: "affecter", roomId: drh.roomId, fingerprint: fpAmina, reqId: "a4" });
  assert.equal((await attendre("a4")).error, "champ-absent");
  assert.equal(isRoomMember(drh.roomId, fpAmina), true, "rien n'a bougé");

  // Salon étranger et appareil inconnu : refusés proprement.
  amina.sendAdmin({ adminPin: "999999", action: "affecter", roomId: "salon-d-ailleurs", fingerprint: fpAmina, present: true, reqId: "a5" });
  assert.equal((await attendre("a5")).error, "salon-inconnu");
  amina.sendAdmin({ adminPin: "999999", action: "affecter", roomId: drh.roomId, fingerprint: "empreinte-inventee", present: true, reqId: "a6" });
  assert.equal((await attendre("a6")).error, "appareil-inconnu");

  // ── 6. Le retrait ôte l'accès, jamais la parole ─────────────────────
  amina.sendAdmin({ adminPin: "999999", action: "affecter", roomId: drh.roomId, fingerprint: fpAmina, present: false, reqId: "a7" });
  const a7 = await attendre("a7");
  assert.equal(a7.ok, true);
  assert.equal(isRoomMember(drh.roomId, fpAmina), false, "retirée de la composition");
  // Son appareil reste au registre : on retire quelqu'un d'un salon, on
  // n'efface pas son existence ni ce qu'il a écrit ailleurs.
  amina.sendAdmin({ adminPin: "999999", action: "annuaire-serveur", reqId: "a8" });
  assert.ok((await attendre("a8")).data.some((d) => d.fingerprint === fpAmina),
    "l'appareil demeure connu du serveur après un retrait");

  amina.close?.(); karim.close?.();
  console.log("✅ affectation : composer depuis le salon principal, sans jamais ouvrir les autres");
} finally {
  await hote.stop();
  closeStore();
}
