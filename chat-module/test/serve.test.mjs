// ═══════════════════════════════════════════════════════════════
// Test du serveur permanent (étape D) — node test/serve.test.mjs
// Vérifie sur de VRAIS processus : PIN stable entre redémarrages,
// --pin persisté, --pin invalide refusé, arrêt propre sur SIGTERM.
// (ports 4802/4803 libres requis)
// ═══════════════════════════════════════════════════════════════
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE = path.join(__dirname, "..", "src", "serve.js");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-serve-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lance serve.js, attend la ligne de PIN, retourne { pin, admin, stop() }
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
    child.on("exit", (code) => { clearTimeout(timer); resolve({ exitCode: code, out }); });
  });
}

// 1) Premier démarrage avec --pin explicite
const s1 = await launch(["--name", "Salon Test D", "--pin", "654321", "--data", dataDir]);
assert.equal(s1.pin, "654321", "PIN fourni utilisé");
await s1.stop();
await sleep(300);

// 2) Redémarrage SANS --pin → le PIN persiste (le point clé du mode serveur)
const s2 = await launch(["--data", dataDir]);
assert.equal(s2.pin, "654321", "PIN stable entre redémarrages");
assert.equal(s2.admin, s1.admin, "PIN admin stable aussi");
await s2.stop();
await sleep(300);

// 3) PIN invalide → refus explicite, code de sortie 1
const s3 = await launch(["--pin", "abc", "--data", dataDir]);
assert.equal(s3.exitCode, 1, "PIN non numérique refusé");
assert.match(s3.out, /6 chiffres/u, "message d'erreur explicite");

console.log("✅ serve.test.mjs : 3 scénarios PASSÉS");
process.exit(0);
