// ═══════════════════════════════════════════════════════════════
// Étape I — une place de licence doit pouvoir être RENDUE
// ═══════════════════════════════════════════════════════════════
// Le défaut : une place était consommée à vie. Poste réinstallé, téléphone
// remplacé, identité régénérée — chaque fois une empreinte nouvelle, jamais
// libérée. Un client à 50 places butait sur le plafond bien avant d'avoir
// 50 utilisateurs, et l'admin n'avait aucun moyen d'y remédier.
//
// Deux exigences opposées à tenir ensemble :
//   • la place doit être réellement rendue (sinon rien n'est réglé) ;
//   • la fiche, la clé publique et les messages doivent être conservés
//     (sinon on perd l'auditabilité de l'historique pour gagner une place).
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import {
  closeStore, countDevices, listDevices, getDevice, getMessagesSince,
} from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-lic-places-"));
const PORT = 14912, HTTP = 14913, PIN = "778001";

// Plafond volontairement minuscule : deux places, trois appareils.
const host = startHost({
  sessionName: "Petite direction", pin: PIN, adminPin: "111333",
  dataDir, wsPort: PORT, httpPort: HTTP, maxDevices: 2,
});
await dodo(600);

const resultats = [];
const brancher = (nom, dossier) => joinSession({
  address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom,
  dataDir: path.join(dataDir, dossier), groups: ["all"],
  onMessage: () => {}, onPresence: () => {},
  onAdminResult: (r) => resultats.push(r),
});
const ouvrir = async (nom, dossier) => {
  const c = brancher(nom, dossier);
  await new Promise((r) => c.raw.on("open", r));
  return c;
};

// ── 1. Les deux places se remplissent ──────────────────────────────────
const un = await ouvrir("Nacib", "id-1");
const deux = await ouvrir("Amina", "id-2");
await dodo(700);
assert.equal(countDevices(), 2, "deux appareils occupent les deux places");

// L'appareil n°1 laisse une trace dans l'historique : c'est elle qu'on
// devra retrouver intacte après son retrait.
un.send("Compte rendu du 3 mars", "all");
await dodo(500);

// ── 2. Le troisième est refusé, plafond atteint ────────────────────────
let refus = null;
const trois = brancher("Karim", "id-3");
trois.raw.on("close", (code) => { refus = code; });
await dodo(900);
assert.equal(refus, 4006, "le plafond doit refuser un appareil de plus (code 4006)");

// ── 3. Un appareil CONNECTÉ ne se retire pas ───────────────────────────
// Sa place serait reprise à sa prochaine connexion : l'admin croirait
// l'avoir libérée. Pour écarter quelqu'un, c'est « bloquer ».
// L'administration passe par une connexion DÉJÀ comptée (le plafond est
// atteint : aucun poste supplémentaire ne pourrait entrer pour administrer).
const fpUn = listDevices(host.roomId).find((d) => d.lastNickname === "Nacib").fingerprint;
deux.sendAdmin({ adminPin: "111333", action: "retire-device", fingerprint: fpUn });
await dodo(700);
assert.equal(countDevices(), 2,
  "un appareil connecté ne doit pas pouvoir être retiré : sa place reviendrait aussitôt");
assert.ok(!getDevice(fpUn).retiredAt, "et il ne doit pas être marqué retiré");
assert.equal(resultats.at(-1)?.error, "device-online",
  "le refus doit être motivé, pour que l'admin sache quoi faire à la place");

// ── 4. Il part, sa place est rendue ────────────────────────────────────
un.close();
await dodo(500);
deux.sendAdmin({ adminPin: "111333", action: "retire-device", fingerprint: fpUn });
await dodo(600);
assert.equal(resultats.at(-1)?.ok, true, "le retrait doit aboutir une fois l'appareil parti");
assert.equal(resultats.at(-1)?.data?.places?.occupees, 1,
  "l'admin doit voir immédiatement la place rendue");
assert.equal(countDevices(), 1, "la place doit être réellement libérée");

// ── 5. Mais rien n'est effacé ──────────────────────────────────────────
const fiche = getDevice(fpUn);
assert.ok(fiche, "la fiche de l'appareil retiré est conservée");
assert.ok(fiche.publicKeySpki,
  "sa clé publique aussi : sans elle, l'historique ne serait plus vérifiable");
assert.ok(fiche.retiredAt, "et il est marqué retiré, pas supprimé");
assert.ok(listDevices(host.roomId).some((d) => d.fingerprint === fpUn),
  "il reste visible dans le registre de l'admin");
const historique = getMessagesSince("all", 0, host.roomId);
assert.ok(historique.some((m) => m.text === "Compte rendu du 3 mars"),
  "ses messages restent dans l'historique");

// ── 6. La place libérée profite à un nouvel appareil ───────────────────
let refus2 = null;
const quatre = brancher("Karim", "id-4");
quatre.raw.on("close", (code) => { refus2 = code; });
await new Promise((r) => { quatre.raw.on("open", r); setTimeout(r, 1500); });
await dodo(700);
assert.equal(refus2, null, "avec une place libre, le nouvel appareil doit entrer");
assert.equal(countDevices(), 2, "il occupe la place rendue");

// ── 7. L'appareil retiré qui REVIENT reprend une place ─────────────────
// Sinon on aurait inventé une porte dérobée : retirer un appareil pour le
// faire rentrer gratuitement, plafond atteint ou non.
let refus3 = null;
const retour = brancher("Nacib", "id-1"); // même répertoire = même identité
retour.raw.on("close", (code) => { refus3 = code; });
await dodo(1000);
assert.equal(refus3, 4006,
  "un appareil retiré n'est pas un passe-droit : il est traité comme un nouveau");

// ── 8. Reprendre la place est refusé quand le plafond est plein ────────
deux.sendAdmin({ adminPin: "111333", action: "restore-device", fingerprint: fpUn });
await dodo(600);
assert.equal(resultats.at(-1)?.error, "licence-device-limit",
  "reprendre une place ne doit pas pouvoir dépasser le plafond");
assert.equal(countDevices(), 2, "le compte reste au plafond");

deux.close(); quatre.close();
try { trois.close(); } catch {}
try { retour.close(); } catch {}
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ licence-places.test.mjs : 13 assertions PASSÉES (place rendue, fiche et historique conservés, pas de passe-droit au retour)");
process.exit(0);
