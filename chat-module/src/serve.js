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
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startHost } from "./server.js";
import { initStore, getConfig, setConfig, closeStore, getRoom } from "./store.js";
import { verifyLicence, CONTACT_TEXTE } from "./licence.js";

const MODULE_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

// ── Licence (tier premium) ─────────────────────────────────────────────
// Le salon PERMANENT est la prestation payante ; le mode poste (salon
// éphémère depuis le navigateur) reste libre et ne passe jamais par ici.
// Vérification 100 % hors-ligne — voir src/licence.js.
function requireLicence(licencePath, dataDir) {
  const chemin = licencePath || path.join(dataDir || MODULE_DATA_DIR, "licence.hnaya-lic");
  let contenu;
  try {
    contenu = readFileSync(chemin, "utf8");
  } catch {
    throw new Error(`Licence introuvable (${chemin}).
Le serveur permanent est réservé aux organisations disposant d'une licence
Hnaya DZ. Placez le fichier .hnaya-lic remis à l'installation dans le
répertoire de données, ou indiquez son chemin avec --licence.
Le mode poste (salon créé depuis le navigateur) reste libre et sans licence.
${CONTACT_TEXTE}`);
  }
  const res = verifyLicence(contenu);
  // Refus UNIQUEMENT sur une licence illisible, incomplète ou mal signée.
  // Une licence ÉCHUE démarre : elle passe en lecture seule (voir
  // licence.js). Refuser de démarrer rendrait l'historique du client
  // inaccessible et la panne muette — la tâche tourne sans écran.
  if (!res.ok) throw new Error(`Licence refusée : ${res.error}\n${CONTACT_TEXTE}`);
  console.log(`[hnaya-serve] Licence « ${res.licence.org} » — ${res.licence.maxDevices} appareils, échéance ${new Date(Date.parse(res.licence.expires)).toLocaleDateString("fr-FR")}`);
  if (res.notice) console.warn(`[hnaya-serve] ⚠️ ${res.notice}`);
  return res;
}

// ── Surveillance de l'échéance pendant que le serveur tourne ───────────
// Le défaut corrigé ici : la licence n'était lue qu'AU DÉMARRAGE. Une
// tâche planifiée démarrée une fois pouvait tourner des mois après
// l'échéance sans que rien ne s'y oppose — une licence de 6 mois n'était
// opposable qu'à celui qui redémarrait son serveur.
//
// Le fichier est RELU à chaque contrôle, pas seulement réévalué : le
// client qui renouvelle dépose le nouveau .hnaya-lic par-dessus et
// retrouve l'écriture à l'heure suivante, sans redémarrer un service
// auquel il n'a peut-être pas accès.
const CONTROLE_LICENCE_MS = 60 * 60 * 1000; // toutes les heures

function surveillerLicence({ chemin, initial, onChange }) {
  let etat = initial;
  const relire = () => {
    let res;
    try { res = verifyLicence(readFileSync(chemin, "utf8")); }
    catch { return; } // fichier momentanément absent : on garde le dernier état connu
    // Une licence devenue illisible ou mal signée ne DÉGRADE rien en cours
    // de route : on conserve le dernier état valide. Sinon un fichier
    // à moitié réécrit pendant un renouvellement couperait le salon.
    if (!res.ok) return;
    const avant = etat.mode;
    etat = res;
    if (res.mode !== avant) {
      console.warn(`[hnaya-serve] ⚠️ Licence : ${avant} → ${res.mode}. ${res.notice || ""}`);
      onChange(res);
    }
  };
  const timer = setInterval(relire, CONTROLE_LICENCE_MS);
  timer.unref?.(); // ne retient pas le process
  return { etat: () => etat, relire, stop: () => clearInterval(timer) };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") args.name = argv[++i];
    else if (argv[i] === "--pin") args.pin = argv[++i];
    else if (argv[i] === "--admin-pin") args.adminPin = argv[++i];
    else if (argv[i] === "--data") args.data = argv[++i];
    else if (argv[i] === "--licence") args.licence = argv[++i];
    else if (argv[i] === "--ws-port") args.wsPort = Number(argv[++i]);
    else if (argv[i] === "--http-port") args.httpPort = Number(argv[++i]);
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
  }
  return args;
}

export function startPermanentServer({ name, pin, data, adminPin, wsPort, httpPort, licence } = {}) {
  const dataDir = data ? path.resolve(data) : undefined;
  // La licence est contrôlée AVANT d'ouvrir quoi que ce soit (ni base, ni
  // port) : un serveur sans licence ne laisse aucune trace de démarrage.
  const verdict = requireLicence(licence, dataDir);
  const lic = verdict.licence;
  const cheminLicence = licence || path.join(dataDir || MODULE_DATA_DIR, "licence.hnaya-lic");
  initStore(dataDir);

  if (pin !== undefined && !/^\d{6}$/.test(String(pin))) {
    throw new Error("--pin doit être un code à 6 chiffres");
  }

  // D.2 — le salon permanent est ÉPINGLÉ : son roomId vit en config et
  // est réouvert à chaque démarrage (même PIN, même historique). Les
  // installations antérieures (salon implicite migré en « default »)
  // reprennent ce salon-là — continuité totale.
  let roomId = getConfig("current_room_id");
  if (!roomId && getRoom("default")) roomId = "default";

  // Le hôte n'existe pas encore quand la veille démarre, et la veille doit
  // pouvoir le prévenir : un porteur mutable les relie sans dépendance
  // circulaire à la construction.
  let hote = null;
  const veille = surveillerLicence({
    chemin: cheminLicence,
    initial: verdict,
    onChange: () => { try { hote?.notifyLicence(); } catch { /* hôte déjà arrêté */ } },
  });

  const host = startHost({
    sessionName: name ?? undefined,
    pin: pin !== undefined ? String(pin) : undefined,
    adminPin,
    roomId: roomId || undefined,
    dataDir,
    // Ports configurables : PLUSIEURS salons permanents sur une même
    // machine (un par direction) — chaque instance avec --data, --ws-port
    // et --http-port distincts
    wsPort: wsPort || undefined,
    httpPort: httpPort || undefined,
    // Plafond d'appareils de la licence — appliqué par server.js au join
    maxDevices: lic.maxDevices,
    // Réévalué à CHAQUE envoi : c'est ce qui rend l'échéance opposable
    // sans redémarrage (voir surveillerLicence).
    licenceState: () => {
      const e = veille.etat();
      return { mode: e.mode, notice: e.notice };
    },
    onError: (friendly) => {
      console.error(`[hnaya-serve] ${friendly}`);
      process.exit(1);
    },
  });
  hote = host;
  setConfig("current_room_id", host.roomId);
  const sessionName = getRoom(host.roomId).name;

  console.log(`[hnaya-serve] Salon permanent "${sessionName}"`);
  console.log(`[hnaya-serve] Données : ${dataDir || "(répertoire du module)"}`);
  console.log(`[hnaya-serve] PIN d'accès (stable) : ${host.pin} — PIN admin : ${host.adminPin}`);
  console.log(`[hnaya-serve] Postes : découverte automatique ou « Rejoindre par IP » ; mobiles : http://<ip>:${host.httpPort}`);
  if (verdict.mode === "readonly") {
    console.warn("[hnaya-serve] ⚠️ LECTURE SEULE : licence échue depuis plus de 30 jours. L'historique reste consultable, l'envoi est suspendu.");
  }

  const shutdown = (signal) => {
    console.log(`[hnaya-serve] ${signal} reçu — arrêt propre.`);
    veille.stop();
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
  --admin-pin 654321  PIN administrateur choisi (à la création uniquement)
  --ws-port 4802      port WebSocket (plusieurs salons par machine :
                      instances avec --data et ports distincts)
  --http-port 4803    port de la page mobile
  --data <dossier>    répertoire des données (base SQLite, identité)
  --licence <fichier> licence Hnaya DZ (.hnaya-lic ; défaut : dans --data)
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
