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
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startHost } from "./server.js";
import { startRoomsHost } from "./rooms-host.js";
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

// ── État lisible de l'extérieur ──────────────────────────────────────────
// Le serveur permanent tient SA base, dans SON répertoire (un service,
// souvent sous un autre compte). Le navigateur, lui, lit la base du profil
// utilisateur : les salons du serveur n'apparaissaient donc nulle part dans
// « ouvrir un salon de ce poste », et l'on cherchait en vain un salon
// pourtant bien vivant. Constaté en usage réel : « je ne le retrouve pas ».
// Plutôt que de faire ouvrir une seconde base au navigateur — verrous
// croisés, droits d'accès, WAL d'un autre processus —, le serveur dépose
// ici ce qu'il faut pour les NOMMER. Un simple fichier, lisible partout,
// Windows comme Linux.
// ⚠️ Aucun code d'accès dans ce fichier : il ouvrirait les salons à qui
// sait lire un répertoire de données.
function publierEtat(dataDir, etat) {
  try {
    writeFileSync(
      path.join(dataDir || MODULE_DATA_DIR, "salon-actif.json"),
      JSON.stringify({ ...etat, depuis: Date.now() }, null, 2),
      "utf8",
    );
  } catch (err) {
    // Non bloquant : un serveur qui tourne vaut mieux qu'un serveur qui
    // refuse de démarrer faute d'avoir pu écrire un fichier d'agrément.
    console.warn(`[hnaya-serve] État non publié (${err.message}).`);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") args.name = argv[++i];
    // Plusieurs salons derrière une SEULE écoute (voir rooms-host.js).
    // Répétable, et accepte aussi une liste séparée par des virgules :
    //   --room "Salon global" --room Direction --room DRH
    //   --rooms "Salon global,Direction,DRH"
    else if (argv[i] === "--room" || argv[i] === "--rooms") {
      const brut = String(argv[++i] || "");
      args.rooms = [...(args.rooms || []), ...brut.split(",").map((s) => s.trim()).filter(Boolean)];
    }
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

export function startPermanentServer({ name, pin, data, adminPin, wsPort, httpPort, licence, rooms = null } = {}) {
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

  // ── Plusieurs salons, un seul service ─────────────────────────────────
  // Salon global, Direction, DRH… derrière une seule écoute, une seule
  // base, un seul décompte d'appareils. Sans --room, rien ne change :
  // salon unique, exactement comme avant.
  //
  // ⚠️ Le rapprochement au redémarrage se fait par NOM, pas par rang.
  // Par rang, retirer un salon du milieu de la liste décalerait tous les
  // suivants : la Direction rouvrirait sur l'historique de la DRH. Un nom
  // inconnu ouvre un salon NEUF ; un salon connu mais non demandé reste
  // fermé, jamais supprimé. Renommer revient donc à créer — c'est voulu :
  // mieux vaut un salon vide qu'un historique interverti.
  const multiSalons = Array.isArray(rooms) && rooms.length > 0;
  if (multiSalons) {
    let connus = [];
    try { connus = JSON.parse(getConfig("salons_permanents", "[]")) || []; } catch { connus = []; }
    // Le salon historique de cette installation reste le principal s'il
    // porte le nom demandé en premier — continuité de l'existant.
    if (roomId && !connus.some((s) => s.roomId === roomId)) {
      const r = getRoom(roomId);
      if (r) connus.unshift({ roomId: r.roomId, name: r.name });
    }
    const demandes = rooms.map((nom, i) => {
      const connu = connus.find((s) => s.name === nom);
      return {
        name: nom,
        roomId: connu?.roomId,
        // Le --pin fourni ne vaut que pour le PREMIER salon : imposer le
        // même code partout supprimerait le cloisonnement, puisque le code
        // est aussi la clé de chiffrement du salon.
        pin: i === 0 && pin !== undefined ? String(pin) : undefined,
        adminPin: i === 0 ? adminPin : undefined,
      };
    });

    let hoteMulti = null;
    const veilleMulti = surveillerLicence({
      chemin: cheminLicence,
      initial: verdict,
      onChange: () => { try { hoteMulti?.notifyLicence(); } catch { /* déjà arrêté */ } },
    });

    hoteMulti = startRoomsHost({
      salons: demandes, dataDir, wsPort: wsPort || undefined, httpPort: httpPort || undefined,
      maxDevices: lic.maxDevices,
      licenceState: () => {
        const e = veilleMulti.etat();
        return { mode: e.mode, notice: e.notice };
      },
      onError: (lisible) => {
        console.error(`[hnaya-serve] ${lisible}`);
        process.exit(1);
      },
    });

    const ouverts = hoteMulti.rooms;
    // ⚠️ LE REGISTRE S'ACCUMULE — il ne se remplace pas.
    // N'y consigner que les salons OUVERTS effaçait du registre celui
    // qu'on avait écarté d'un démarrage : redemandé plus tard, son nom
    // n'était plus connu, un salon NEUF s'ouvrait, et l'historique de la
    // direction concernée restait sur le disque sans plus rien pour le
    // désigner. Un service relancé une nuit sans « --room Direction »
    // suffisait à faire repartir la Direction de zéro le lendemain.
    // Défaut trouvé par salons-permanents.test.mjs, pas en relecture.
    const registre = [...connus];
    for (const s of ouverts) {
      const i = registre.findIndex((x) => x.name === s.name);
      if (i === -1) registre.push({ roomId: s.roomId, name: s.name });
      else registre[i] = { roomId: s.roomId, name: s.name };
    }
    setConfig("salons_permanents", JSON.stringify(registre));
    setConfig("current_room_id", ouverts[0].roomId);
    publierEtat(dataDir, {
      roomId: ouverts[0].roomId, name: ouverts[0].name,
      wsPort: hoteMulti.wsPort, httpPort: hoteMulti.httpPort,
      salons: ouverts,
    });

    console.log(`[hnaya-serve] ${ouverts.length} salons permanents sur le port ${hoteMulti.wsPort}`);
    console.log(`[hnaya-serve] Données : ${dataDir || "(répertoire du module)"}`);
    console.log(`[hnaya-serve] Mobiles : http://<ip>:${hoteMulti.httpPort} — le salon se choisit sur la page.`);
    for (const s of ouverts) {
      const h = hoteMulti.get(s.roomId);
      console.log(`[hnaya-serve]   « ${s.name} » — code ${h.pin} — admin ${h.adminPin}`);
    }
    if (verdict.mode === "readonly") {
      console.warn("[hnaya-serve] ⚠️ LECTURE SEULE : licence échue depuis plus de 30 jours.");
    }

    const arret = (signal) => {
      console.log(`[hnaya-serve] ${signal} reçu — arrêt propre.`);
      veilleMulti.stop();
      Promise.resolve(hoteMulti.stop()).catch(() => {}).finally(() => {
        closeStore();
        process.exit(0);
      });
    };
    process.on("SIGINT", () => arret("SIGINT"));
    process.on("SIGTERM", () => arret("SIGTERM"));
    return hoteMulti;
  }

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

  // ── État lisible de l'extérieur ────────────────────────────────────────
  // Le serveur permanent tient SA base, dans SON répertoire (un service,
  // souvent sous un autre compte). Le navigateur, lui, lit la base du
  // profil utilisateur : le salon permanent n'apparaissait donc nulle part
  // dans « ouvrir un salon de ce poste », et l'on cherchait en vain un
  // salon pourtant bien vivant. Constaté en usage réel après installation
  // d'un serveur : « je ne le retrouve pas ».
  // Plutôt que de faire ouvrir une seconde base au navigateur — verrous
  // croisés, droits d'accès, WAL d'un autre processus —, le serveur dépose
  // ici ce qu'il faut pour le NOMMER. Un simple fichier, lisible partout,
  // Windows comme Linux.
  // ⚠️ Aucun PIN dans ce fichier : il donnerait l'accès au salon à qui sait
  // lire un répertoire de données.
  publierEtat(dataDir, {
    roomId: host.roomId, name: sessionName,
    wsPort: host.wsPort, httpPort: host.httpPort,
  });

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
  --room "Direction"  ouvre PLUSIEURS salons derrière une seule écoute.
                      Répétable, ou liste séparée par des virgules :
                        --room "Salon global" --room Direction --room DRH
                        --rooms "Salon global,Direction,DRH"
                      Un seul service, une seule base, un seul annuaire,
                      un seul plafond d'appareils. Le premier salon est le
                      principal. Au redémarrage, les salons se retrouvent
                      par leur NOM : un nom inconnu ouvre un salon neuf,
                      un salon connu mais non demandé reste fermé (jamais
                      supprimé). --pin et --admin-pin ne valent que pour
                      le salon principal : chaque salon a SON code, qui
                      est aussi sa clé de chiffrement.
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
