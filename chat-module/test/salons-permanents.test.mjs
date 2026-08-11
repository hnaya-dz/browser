// ═══════════════════════════════════════════════════════════════
// Serveur permanent multi-salons — un service, et rien qui se mélange
// Lancer : node test/salons-permanents.test.mjs   (ports 14852/14853)
// ═══════════════════════════════════════════════════════════════
// Sur de VRAIS processus, comme serve.test.mjs : ce qui est éprouvé ici,
// c'est le redémarrage — le moment où un service se reprend tout seul, la
// nuit, sans personne pour constater qu'il s'est trompé de salon.
//
// ⚠️ CE QUE CE TEST PROTÈGE VRAIMENT.
// Les salons se retrouvent par leur NOM, jamais par leur rang. Par rang,
// retirer « Direction » du milieu de la liste ferait rouvrir la DRH sur
// l'historique de la Direction : deux services qui échangent leurs
// archives, sans une ligne dans le journal. C'est le scénario que le
// dernier cas déroule explicitement.
//
// Comme serve.test.mjs, ce fichier a besoin de la clé de signature des
// licences (hors dépôt) et s'IGNORE proprement (code 77) sans elle.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createPrivateKey, randomBytes, sign as cryptoSign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPayload, LICENCE_FORMAT, LICENCE_VERSION } from "../src/licence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE = path.join(__dirname, "..", "src", "serve.js");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-multisrv-"));
const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const PORTS = ["--ws-port", "14852", "--http-port", "14853"];

// La licence est authentique (vraie clé) : on ne la laisse pas traîner.
process.on("exit", () => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const KEY_PATH = process.env.HNAYA_LICENCE_KEY
  || path.join(os.homedir(), "Documents", "HNAYA", "hnaya-licences", "licence-signing-key.pem");
if (!fs.existsSync(KEY_PATH)) {
  console.log(`⏭️  salons-permanents.test.mjs IGNORÉ — clé de signature absente (${KEY_PATH}).
Le serveur permanent est le tier payant : sans la clé privée de Hnaya DZ,
aucune licence valide ne peut être fabriquée. Ce n'est PAS une régression.`);
  process.exit(77);
}

const payload = {
  format: LICENCE_FORMAT, version: LICENCE_VERSION,
  id: randomBytes(8).toString("hex"), org: "Test automatisé",
  issued: new Date().toISOString(),
  expires: new Date(Date.now() + 86400000).toISOString(), // demain
  maxDevices: 50,
};
fs.writeFileSync(path.join(dataDir, "licence.hnaya-lic"), JSON.stringify({
  payload,
  signature: cryptoSign(null, canonicalPayload(payload),
    createPrivateKey(fs.readFileSync(KEY_PATH, "utf8"))).toString("base64"),
}, null, 2) + "\n", "utf8");

/** Démarre serve.js, attend l'annonce des salons, renvoie ce qu'il a ouvert. */
function lancer(args) {
  return new Promise((resolve, reject) => {
    const enfant = spawn(process.execPath, [SERVE, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let sortie = "";
    const minuteur = setTimeout(() => {
      enfant.kill();
      reject(new Error("Aucune annonce de salons — sortie :\n" + sortie));
    }, 12000);
    const surDonnees = (d) => {
      sortie += d.toString();
      // Les salons sont annoncés un par un ; on attend la ligne qui donne
      // leur nombre, puis on laisse le temps aux lignes de détail.
      const total = sortie.match(/(\d+) salons permanents sur le port (\d+)/u);
      if (!total) return;
      const salons = [...sortie.matchAll(/« (.+?) » — code (\d{6}) — admin (\d{6})/gu)]
        .map((m) => ({ nom: m[1], code: m[2], admin: m[3] }));
      if (salons.length < Number(total[1])) return;
      clearTimeout(minuteur);
      resolve({
        salons, port: Number(total[2]), sortie,
        arreter: () => new Promise((res) => { enfant.on("exit", res); enfant.kill("SIGTERM"); }),
      });
    };
    enfant.stdout.on("data", surDonnees);
    enfant.stderr.on("data", surDonnees);
    enfant.on("close", (code) => { clearTimeout(minuteur); resolve({ exitCode: code, sortie }); });
  });
}

const etatPublie = () => JSON.parse(fs.readFileSync(path.join(dataDir, "salon-actif.json"), "utf8"));

// ── 1) Trois salons, une seule écoute ───────────────────────────────────
const s1 = await lancer(["--room", "Salon global", "--room", "Direction", "--room", "DRH",
  "--data", dataDir, ...PORTS]);
assert.equal(s1.salons.length, 3, "trois salons ouverts");
assert.equal(s1.port, 14852, "un seul port pour les trois");
assert.deepEqual(s1.salons.map((s) => s.nom), ["Salon global", "Direction", "DRH"]);

// Chaque salon a SON code : un code commun supprimerait le cloisonnement,
// puisque le code est aussi la clé de chiffrement du salon.
const codes = new Set(s1.salons.map((s) => s.code));
assert.equal(codes.size, 3, "chaque salon a son propre code d'accès");

const etat1 = etatPublie();
assert.equal(etat1.salons.length, 3, "l'état publié nomme les trois salons");
assert.equal(etat1.salons[0].name, "Salon global", "le premier salon est le principal");
assert.equal(JSON.stringify(etat1).includes(s1.salons[0].code), false,
  "⚠️ aucun code d'accès dans le fichier d'état");
const idsInitiaux = Object.fromEntries(etat1.salons.map((s) => [s.name, s.roomId]));
await s1.arreter();
await dodo(500);

// ── 2) Redémarrage : mêmes salons, mêmes codes, mêmes historiques ───────
const s2 = await lancer(["--room", "Salon global", "--room", "Direction", "--room", "DRH",
  "--data", dataDir, ...PORTS]);
assert.deepEqual(s2.salons.map((s) => s.code), s1.salons.map((s) => s.code),
  "les codes d'accès survivent au redémarrage");
const ids2 = Object.fromEntries(etatPublie().salons.map((s) => [s.name, s.roomId]));
assert.deepEqual(ids2, idsInitiaux, "chaque salon retrouve SON identifiant, donc son historique");
await s2.arreter();
await dodo(500);

// ── 3) LE CŒUR DU TEST — on retire un salon du MILIEU ───────────────────
// Par rang, la DRH hériterait ici de l'historique de la Direction. Par
// nom, elle retrouve le sien. C'est toute la différence entre un service
// qui se reprend et un service qui mélange les archives de deux
// directions sans le dire.
const s3 = await lancer(["--room", "Salon global", "--room", "DRH", "--data", dataDir, ...PORTS]);
assert.equal(s3.salons.length, 2, "deux salons demandés, deux salons ouverts");
const ids3 = Object.fromEntries(etatPublie().salons.map((s) => [s.name, s.roomId]));
assert.equal(ids3["DRH"], idsInitiaux["DRH"],
  "⚠️ la DRH garde SON identifiant malgré le retrait du salon qui la précédait");
assert.equal(ids3["Salon global"], idsInitiaux["Salon global"]);
assert.equal(ids3["Direction"], undefined, "le salon non demandé reste fermé");
// Fermé, mais JAMAIS supprimé : son historique doit pouvoir revenir.
await s3.arreter();
await dodo(500);

const s4 = await lancer(["--room", "Salon global", "--room", "Direction", "--room", "DRH",
  "--data", dataDir, ...PORTS]);
const ids4 = Object.fromEntries(etatPublie().salons.map((s) => [s.name, s.roomId]));
assert.deepEqual(ids4, idsInitiaux,
  "un salon refermé puis redemandé revient avec son identifiant — rien n'a été détruit");
await s4.arreter();

console.log("✅ salons-permanents : 3 salons sur un port, retrouvés par leur NOM, rien de mélangé");
process.exit(0);
