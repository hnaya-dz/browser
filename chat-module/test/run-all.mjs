// ═══════════════════════════════════════════════════════════════
// Lanceur de toutes les suites — node test/run-all.mjs (ou `yarn test`)
// ═══════════════════════════════════════════════════════════════
// Les suites étaient lancées à la main, une par une, d'après la liste du
// README : serve.test.mjs a pu rester cassé sans que personne le voie.
// Ce lanceur découvre TOUT fichier *.test.mjs du répertoire (une nouvelle
// suite est donc prise en compte sans rien déclarer) et les exécute en
// SÉRIE — plusieurs suites ouvrent de vrais ports et de vraies bases.
//
// Codes de sortie attendus des suites :
//   0  = passée
//   77 = ignorée volontairement (prérequis absent — p. ex. la clé privée
//        de signature des licences, hors dépôt, pour serve.test.mjs).
//        Signalée dans le bilan, mais ne fait PAS échouer l'ensemble.
//   *  = échec
//
// Le lanceur sort en 1 dès qu'une suite échoue ou dépasse le délai.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 120000; // une suite qui pend ne doit pas bloquer indéfiniment

const suites = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

if (suites.length === 0) {
  console.error("Aucune suite *.test.mjs trouvée dans", __dirname);
  process.exit(1);
}

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
    const timer = setTimeout(() => {
      console.error(`\n[run-all] ⏱️ ${file} dépasse ${TIMEOUT_MS / 1000} s — arrêt forcé.`);
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve(signal ? `signal ${signal}` : code);
    });
  });
}

const results = [];
for (const file of suites) {
  console.log(`\n═══ ${file} ═══`);
  const code = await run(file);
  results.push({ file, code });
}

console.log("\n═══ Bilan ═══");
let echecs = 0;
let ignorees = 0;
for (const { file, code } of results) {
  if (code === 0) console.log(`  ✅ ${file}`);
  else if (code === 77) { ignorees++; console.log(`  ⏭️  ${file} (ignorée — prérequis absent)`); }
  else { echecs++; console.log(`  ❌ ${file} (sortie ${code})`); }
}
console.log(`${results.length - echecs - ignorees} passée(s), ${ignorees} ignorée(s), ${echecs} en échec.`);
process.exit(echecs > 0 ? 1 : 0);
