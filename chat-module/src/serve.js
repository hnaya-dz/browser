// ═══════════════════════════════════════════════════════════════
// Serveur permanent — étape D (déploiement entreprise / administration)
// ═══════════════════════════════════════════════════════════════
// Contrairement au salon éphémère créé depuis le dock (PIN aléatoire,
// vie liée au navigateur), CE point d'entrée fait tourner un salon
// PERMANENT sur une machine toujours allumée :
//   - PIN d'accès STABLE : fourni une fois (--pin) puis persisté en base,
//     réutilisé à chaque démarrage — les utilisateurs le gardent ;
//   - nom du salon persisté de la même façon (--name) ;
//   - données (historique, registre des appareils, config) dans un
//     répertoire dédié (--data), sauvegardable par l'IT ;
//   - arrêt propre sur SIGINT/SIGTERM (service Windows/systemd).
//
// Usage :
//   node src/serve.js [--name "Salon RH"] [--pin 123456] [--data /srv/hnaya-rh]
//
// Installation en service : voir service/install-windows.ps1 (tâche
// planifiée au démarrage) et service/hnaya-chat.service (systemd).
// Chaque DIRECTION d'une organisation lance SON instance sur SA machine
// (une seule instance par machine — ports 4802/4803 fixes) : le
// cloisonnement de l'information est physique, pas logiciel.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { startHost } from "./server.js";
import { initStore, getConfig, setConfig, closeStore } from "./store.js";
import { generatePin } from "./crypto.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") args.name = argv[++i];
    else if (argv[i] === "--pin") args.pin = argv[++i];
    else if (argv[i] === "--data") args.data = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
  }
  return args;
}

export function startPermanentServer({ name, pin, data } = {}) {
  const dataDir = data ? path.resolve(data) : undefined;
  initStore(dataDir);

  // PIN d'accès : priorité à l'argument (persisté pour les fois
  // suivantes), sinon celui déjà en base, sinon généré puis persisté.
  if (pin !== undefined && !/^\d{6}$/.test(String(pin))) {
    throw new Error("--pin doit être un code à 6 chiffres");
  }
  const roomPin = String(pin ?? getConfig("room_pin") ?? generatePin());
  setConfig("room_pin", roomPin);

  const sessionName = String(name ?? getConfig("session_name") ?? "Salon Hnaya");
  setConfig("session_name", sessionName);

  const host = startHost({
    sessionName,
    pin: roomPin,
    dataDir,
    onError: (friendly) => {
      console.error(`[hnaya-serve] ${friendly}`);
      process.exit(1);
    },
  });

  console.log(`[hnaya-serve] Salon permanent "${sessionName}"`);
  console.log(`[hnaya-serve] Données : ${dataDir || "(répertoire du module)"}`);
  console.log(`[hnaya-serve] PIN d'accès (stable) : ${host.pin} — PIN admin : ${host.adminPin}`);
  console.log(`[hnaya-serve] Postes : découverte automatique ou « Rejoindre par IP » ; mobiles : http://<ip>:${host.httpPort}`);

  const shutdown = (signal) => {
    console.log(`[hnaya-serve] ${signal} reçu — arrêt propre.`);
    try { host.stop(); } catch { /* déjà arrêté */ }
    closeStore();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return host;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Serveur permanent Hnaya Messagerie locale
Usage : node src/serve.js [options]
  --name "Salon RH"   nom du salon (persisté ; défaut : valeur précédente)
  --pin 123456        PIN d'accès à 6 chiffres (persisté ; défaut : valeur
                      précédente, générée au premier lancement)
  --data <dossier>    répertoire des données (base SQLite, identité)
  --help              cette aide`);
    process.exit(0);
  }
  try {
    startPermanentServer(args);
  } catch (err) {
    console.error(`[hnaya-serve] ${err.message}`);
    process.exit(1);
  }
}
