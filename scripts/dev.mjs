// Lanceur de développement.
//
// Il remplace le montage « concurrently + wait-on » qui portait un défaut
// silencieux : le port était écrit en dur à trois endroits (next dev, wait-on,
// electron). Dès que le 3000 était occupé — par un serveur oublié, par une
// autre session de travail — `next dev` se décalait tout seul sur le port
// suivant, tandis que wait-on voyait le 3000 « déjà prêt » et lançait Electron
// dessus. La fenêtre affichait alors l'application d'à côté, ou un build
// vieux de plusieurs jours, sans le moindre avertissement.
//
// Ici le port est choisi une fois, vérifié libre, et le même est transmis aux
// trois. Si l'on ne peut pas garantir qu'il est à nous, on s'arrête au lieu
// de se brancher sur l'inconnu.
//
// Usage :  yarn dev            port libre à partir de 3000
//          yarn dev --port 3010
//          PORT=3010 yarn dev

import { spawn } from "node:child_process";
import net from "node:net";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

const PREMIER_PORT = 3000;
const DERNIER_PORT = 3020;

function argPort() {
  const i = process.argv.indexOf("--port");
  const v = i !== -1 ? process.argv[i + 1] : process.env.PORT;
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`✗ Port invalide : ${v}`);
    process.exit(1);
  }
  return n;
}

// Un port n'est retenu que si l'on parvient à l'écouter soi-même. Interroger
// l'occupant ne suffirait pas : un serveur du même projet répondrait
// correctement tout en servant un autre état du code.
//
// ⚠️ Il faut essayer les deux familles d'adresses. Windows laisse cohabiter
// une écoute sur 0.0.0.0 et une écoute sur :: ; or Next se lie à ::. Tester
// le seul 0.0.0.0 déclarait donc libre un port occupé — et le lanceur
// rejouait le défaut qu'il devait supprimer.
function ecoutable(port, adresse) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    try { s.listen({ port, host: adresse, ipv6Only: false }); } catch { resolve(false); }
  });
}

async function libre(port) {
  return (await ecoutable(port, "::")) && (await ecoutable(port, "0.0.0.0"));
}

async function choisirPort() {
  const demande = argPort();
  if (demande !== null) {
    if (await libre(demande)) return demande;
    console.error(`✗ Le port ${demande} est déjà occupé.`);
    console.error("  Un autre serveur tourne dessus — peut-être une autre session de travail.");
    console.error("  Choisissez-en un autre :  yarn dev --port 3010");
    process.exit(1);
  }
  for (let p = PREMIER_PORT; p <= DERNIER_PORT; p++) {
    if (await libre(p)) return p;
  }
  console.error(`✗ Aucun port libre entre ${PREMIER_PORT} et ${DERNIER_PORT}.`);
  process.exit(1);
}

function attendre(port, delaiMs = 180000) {
  const limite = Date.now() + delaiMs;
  return new Promise((resolve, reject) => {
    const essai = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => {
        if (Date.now() > limite) reject(new Error("Next n'a pas répondu à temps."));
        else setTimeout(essai, 400);
      });
    };
    essai();
  });
}

const enfants = new Set();
let onFerme = false;

function fermer(code) {
  if (onFerme) return;
  onFerme = true;
  for (const e of enfants) { try { e.kill(); } catch {} }
  process.exit(code);
}
process.on("SIGINT", () => fermer(0));
process.on("SIGTERM", () => fermer(0));

// Développement et application installée partagent le même profil (voir la
// note en tête de public/electron.js). La base SQLite tolère plusieurs
// processus, mais les ports du salon sont fixes par machine : la seconde
// instance ne pourra pas héberger, et l'on croira que « créer un salon ne
// marche pas ». Autant le dire avant.
for (const p of [4802, 4803]) {
  if (!(await libre(p))) {
    console.log(`⚠ Le port ${p} est occupé : une autre instance de Hnaya héberge déjà un salon.`);
    console.log("  Fermez l'application installée avant de créer un salon ici,");
    console.log("  sinon la création échouera sans explication.\n");
    break;
  }
}

const port = await choisirPort();
const url = `http://localhost:${port}`;
if (port !== PREMIER_PORT) console.log(`ℹ Port ${PREMIER_PORT} occupé — on prend le ${port}.`);
console.log(`▸ Next  ${url}`);

const next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "-p", String(port)], {
  cwd: RACINE, stdio: "inherit",
});
enfants.add(next);
// `|| 1` et non `?? 1` : Next signale certaines erreurs de démarrage en
// sortant avec 0. Un échec doit rester un échec pour l'appelant.
next.on("exit", (c) => { if (!onFerme) { console.error("✗ Next s'est arrêté."); fermer(c || 1); } });

try {
  await attendre(port);
} catch (e) {
  console.error(`✗ ${e.message}`);
  fermer(1);
}

console.log("▸ Electron");
// L'URL passe par l'environnement : la fenêtre ne peut plus se tromper de
// serveur, même si un autre écoute à côté.
const electron = spawn(require("electron"), [join(RACINE, "public", "electron.js")], {
  cwd: RACINE, stdio: "inherit",
  env: { ...process.env, HNAYA_DEV_URL: url },
});
enfants.add(electron);
electron.on("exit", (c) => fermer(c ?? 0));
