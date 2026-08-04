// ═══════════════════════════════════════════════════════════════
// Test du serveur permanent (étape D) — node test/serve.test.mjs
// Vérifie sur de VRAIS processus : barrière de licence (absente et
// contrefaite), PIN stable entre redémarrages, --pin persisté, --pin
// invalide refusé, arrêt propre sur SIGTERM.
// (ports 14842/14843 libres requis)
//
// ⚠️ Le serveur permanent est le tier PAYANT : serve.js exige une licence
// signée Ed25519 (src/licence.js). La clé privée vit hors dépôt, chez
// Hnaya DZ — ce test émet donc une licence temporaire dans son propre
// répertoire de données quand la clé est là, et IGNORE explicitement
// (code de sortie 77) les scénarios qui en dépendent quand elle ne l'est
// pas. Les deux scénarios de barrière, eux, tournent TOUJOURS : ils
// n'ont besoin d'aucune clé et sont ceux qui protègent la recette.
// ═══════════════════════════════════════════════════════════════
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-serve-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Les répertoires de travail contiennent des LICENCES : une vraie, signée
// par la clé de production, et une contrefaçon. Aucune n'a de raison de
// survivre au test — sans ce nettoyage, chaque exécution en abandonnait
// une exploitable dans %TEMP%, et elles s'accumulaient. Branché sur
// "exit" pour couvrir aussi les sorties par assertion ou par le SKIP.
const tempDirs = [dataDir];
process.on("exit", () => {
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* déjà parti */ }
  }
});

// Lance serve.js, attend la ligne de PIN, retourne { pin, admin, stop() }.
// Si le processus meurt avant (licence refusée, PIN invalide), retourne
// { exitCode, out } — on résout sur "close" et non "exit" pour ne pas
// perdre la fin de la sortie standard sur un arrêt immédiat.
function launch(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVE, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Pas de PIN affiché — sortie :\n" + out)); }, 8000);
    const onData = (d) => {
      out += d.toString();
      const m = out.match(/PIN d'accès \(stable\) : (\d{6}) — PIN admin : (\d{6})/u);
      if (m) {
        clearTimeout(timer);
        resolve({
          pin: m[1],
          admin: m[2],
          stop: () => new Promise((res) => { child.on("exit", res); child.kill("SIGTERM"); }),
          exited: new Promise((res) => child.on("exit", (code) => res(code))),
        });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => { clearTimeout(timer); resolve({ exitCode: code, out }); });
  });
}

const PORTS = ["--ws-port", "14842", "--http-port", "14843"];

// ── 0) La barrière de licence tient (aucune clé requise) ───────────────
// Ces deux scénarios sont le filet de sécurité de la fonctionnalité
// payante : ils tournent sur TOUTE machine, y compris celles qui ne
// peuvent pas signer de licence.
const sansLicence = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-serve-nolic-"));
tempDirs.push(sansLicence);
const b1 = await launch(["--data", sansLicence, ...PORTS]);
assert.equal(b1.exitCode, 1, "sans licence : refus de démarrer");
assert.match(b1.out, /Licence introuvable/u, "sans licence : message explicite");
assert.doesNotMatch(b1.out, /PIN d'accès/u, "sans licence : aucun salon ouvert");

const contrefaite = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-serve-faux-"));
tempDirs.push(contrefaite);
fs.writeFileSync(path.join(contrefaite, "licence.hnaya-lic"), JSON.stringify({
  payload: {
    format: LICENCE_FORMAT,
    version: LICENCE_VERSION,
    id: "0000000000000000",
    org: "Organisation pirate",
    issued: new Date().toISOString(),
    expires: new Date(Date.now() + 365 * 86400000).toISOString(),
    maxDevices: 100000,
  },
  signature: randomBytes(64).toString("base64"),
}), "utf8");
const b2 = await launch(["--data", contrefaite, ...PORTS]);
assert.equal(b2.exitCode, 1, "licence contrefaite : refus de démarrer");
assert.match(b2.out, /Signature invalide/u, "licence contrefaite : signature rejetée");

// ── Licence temporaire pour la suite ───────────────────────────────────
const KEY_PATH = process.env.HNAYA_LICENCE_KEY
  || path.join(os.homedir(), "Documents", "HNAYA", "hnaya-licences", "licence-signing-key.pem");

if (!fs.existsSync(KEY_PATH)) {
  console.log(`⏭️  serve.test.mjs : 2 scénarios de licence PASSÉS, 3 scénarios de PIN IGNORÉS
Clé de signature absente (${KEY_PATH}).
Le serveur permanent est un tier payant : les scénarios de PIN ont besoin
d'une licence valide, impossible à fabriquer sans la clé privée de Hnaya DZ
(conservée hors dépôt — voir tools/make-licence.mjs). Ce n'est PAS une
régression. Pour les dérouler : machine disposant de la clé, ou
HNAYA_LICENCE_KEY=<chemin vers la clé>.`);
  process.exit(77); // convention : 77 = suite (partiellement) ignorée — voir test/run-all.mjs
}

// Licence jetable, écrite dans le dataDir du test uniquement — même
// format que celles émises par tools/make-licence.mjs à chaque vente.
// ⚠️ Elle est SIGNÉE PAR LA VRAIE CLÉ : c'est une licence authentique,
// pas une imitation. Deux précautions en conséquence :
//   • échéance au lendemain, pas dans un an — une copie oubliée cesse
//     très vite d'ouvrir quoi que ce soit ;
//   • le répertoire est effacé en fin de test (voir nettoyer()).
// Sans cela, chaque exécution abandonnait dans %TEMP% une licence
// parfaitement exploitable du tier payant.
const payload = {
  format: LICENCE_FORMAT,
  version: LICENCE_VERSION,
  id: randomBytes(8).toString("hex"),
  org: "Test automatisé",
  issued: new Date().toISOString(),
  expires: new Date(Date.now() + 86400000).toISOString(),
  maxDevices: 50,
};
const signature = cryptoSign(
  null,
  canonicalPayload(payload),
  createPrivateKey(fs.readFileSync(KEY_PATH, "utf8")),
).toString("base64");
fs.writeFileSync(
  path.join(dataDir, "licence.hnaya-lic"),
  JSON.stringify({ payload, signature }, null, 2) + "\n",
  "utf8",
);

// 1) Premier démarrage avec --pin explicite
const s1 = await launch(["--name", "Salon Test D", "--pin", "654321", "--data", dataDir, ...PORTS]);
assert.equal(s1.pin, "654321", "PIN fourni utilisé");
await s1.stop();
await sleep(300);

// 2) Redémarrage SANS --pin → le PIN persiste (le point clé du mode serveur)
const s2 = await launch(["--data", dataDir, ...PORTS]);
assert.equal(s2.pin, "654321", "PIN stable entre redémarrages");
assert.equal(s2.admin, s1.admin, "PIN admin stable aussi");
await s2.stop();
await sleep(300);

// 3) PIN invalide → refus explicite, code de sortie 1
const s3 = await launch(["--pin", "abc", "--data", dataDir, ...PORTS]);
assert.equal(s3.exitCode, 1, "PIN non numérique refusé");
assert.match(s3.out, /6 chiffres/u, "message d'erreur explicite");

console.log("✅ serve.test.mjs : 5 scénarios PASSÉS (2 de licence, 3 de PIN)");
process.exit(0);
