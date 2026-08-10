// ═══════════════════════════════════════════════════════════════
// Worker — pont entre Electron (main process) et le module de chat
// ═══════════════════════════════════════════════════════════════
// Ce fichier est lancé via `child_process.fork()` depuis electron.js,
// JAMAIS importé directement. Ça garantit que la dépendance "ws" reste
// entièrement isolée dans chat-module/node_modules — le navigateur
// principal n'a besoin d'aucune dépendance supplémentaire pour
// fonctionner, seul ce process séparé en a besoin, et seulement si
// l'utilisateur active la fonctionnalité.
//
// Communication avec le main process Electron : messages IPC natifs de
// Node fournis automatiquement par fork() — pas besoin de WebSocket ni
// de socket supplémentaire pour cette liaison locale.
//
// Commandes reçues (process.on("message")) :
//   { cmd: "start-host", sessionName }
//   { cmd: "stop-host" }
//   { cmd: "discover" }
//   { cmd: "join", address, wsPort, pin, userId, groups, lastSeenTs }
//   { cmd: "send-message", text, groupId, media, replyTo }
//   { cmd: "mark-read", messageId, groupId }
//   { cmd: "admin", adminPin, action, reqId, ... }   (étape D)
//   { cmd: "media-upload", reqId, path, kind, mime, thumb }   (étape E)
//   { cmd: "media-download", reqId, sha256, mime, outPath }   (étape E)
//   { cmd: "leave" }
//
// Événements envoyés (process.send) :
//   { event: "host-started", pin, adminPin, wsPort, httpPort, inviteUrl }
//   { event: "admin-result", result }               (étape D)
//   { event: "host-stopped" }
//   { event: "session-found", session }
//   { event: "joined" }
//   { event: "join-failed", reason }
//   { event: "message", message }
//   { event: "presence", online }
//   { event: "media-uploaded", reqId, sha256, size }  (étape E)
//   { event: "media-downloaded", reqId, path, size }  (étape E)
//   { event: "media-error", reqId, reason }           (étape E)
//   { event: "error", message }

import os from "node:os";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { startHost } from "./server.js";
import { discoverSessions, joinSession } from "./client.js";
import { initStore, listRooms, deleteRoom } from "./store.js";

// IP LAN du poste — pour composer l'URL d'invitation mobile du QR code.
// Plusieurs interfaces possibles (VirtualBox, VPN…) : on privilégie les
// plages domestiques/PME dans l'ordre où on les rencontre réellement en
// Algérie (box 192.168.x.x d'abord), sinon la première IPv4 non interne.
function getLanAddress() {
  const candidates = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) candidates.push(a.address);
    }
  }
  return candidates.find(ip => ip.startsWith("192.168."))
      || candidates.find(ip => ip.startsWith("10."))
      || candidates.find(ip => /^172\.(1[6-9]|2\d|3[01])\./.test(ip))
      || candidates[0]
      || null;
}

// ✅ Étape D — répertoire des données persistantes (base SQLite +
// identité Ed25519 de l'appareil). Electron le passe via l'environnement
// (userData/chat-data) ; en lancement autonome, défaut du module.
const DATA_DIR = process.env.HNAYA_CHAT_DATA || undefined;

// ══════════════════════════════════════════════════════════════════
// PLUSIEURS salons hébergés simultanément (D.4)
// ══════════════════════════════════════════════════════════════════
// Un poste n'hébergeait qu'un salon à la fois : impossible d'inviter les
// membres du salon A vers le salon B, puisque B était forcément fermé
// (retour terrain). Chaque salon prend donc sa propre paire de ports,
// dans la plage autorisée par le pare-feu (4802-4809 → 4 salons).
const PORT_BASE = 4802;
const MAX_ROOMS = 4; // paires (4802/4803) … (4808/4809)

const hostHandles = new Map(); // roomId -> handle renvoyé par startHost()

/** Première paire de ports libre : ni utilisée par nos salons, ni par un
 *  autre processus (un serveur permanent tourne peut-être déjà ici). */
async function findFreePortPair() {
  const net = await import("node:net");
  const used = new Set([...hostHandles.values()].map((h) => h.wsPort));
  const canBind = (port) => new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "0.0.0.0");
  });
  for (let i = 0; i < MAX_ROOMS; i++) {
    const ws = PORT_BASE + i * 2;
    if (used.has(ws)) continue;
    if (await canBind(ws) && await canBind(ws + 1)) return { wsPort: ws, httpPort: ws + 1 };
  }
  return null;
}

let hostHandle = null;      // dernier salon ouvert (compat interne)
let clientHandle = null;    // { send, markRead, close } si on a rejoint un salon
let stopDiscovery = null;   // fonction pour arrêter une découverte en cours

// ═══════════════════════════════════════════════════════════════
// Reconnexion après veille (retour terrain, deux postes)
// ═══════════════════════════════════════════════════════════════
// Aucun mécanisme ne détectait la reprise depuis la veille : seule la
// page mobile réagit à visibilitychange. Sur un poste, une connexion
// WebSocket restée « ouverte » du point de vue de l'objet JS peut être
// une prise zombie après une veille (le réseau — y compris le loopback
// de l'hôte vers son PROPRE salon — a été interrompu pendant la
// suspension), sans qu'aucun événement "close" ne se déclenche pour le
// signaler : ws.send() écrit dans le tampon local sans erreur, mais rien
// n'arrive jamais en face. Symptôme observé : les messages continuent
// de partir dans un sens sans qu'aucune erreur ne s'affiche.
// L'unique filet de sécurité était le battement de cœur (10 s), qui finit
// par détecter l'absence de pong — mais qui ne RECONNECTE jamais tout
// seul, il ne fait qu'afficher une erreur à l'utilisateur.
//
// lastJoinMsg mémorise les paramètres du dernier "join" explicite : au
// signal "network-resume" (envoyé par electron.js via powerMonitor), on
// referme la connexion existante — vivante ou zombie, peu importe — et on
// rejoint avec ces mêmes paramètres. Le serveur renvoie alors le backlog
// depuis lastSeenTs ; la déduplication par id côté interface (ChatPanel)
// absorbe sans dommage les messages déjà vus si l'horodatage est un peu
// périmé.
let lastJoinMsg = null;

process.on("message", (msg) => {
  try {
    handleCommand(msg);
  } catch (err) {
    process.send?.({ event: "error", message: err?.message || String(err) });
  }
});

/** Ouverture d'un salon : l'allocation de ports est asynchrone (sondage),
 *  d'où cette fonction séparée du switch synchrone. */
async function startHostAsync(msg) {
  // Ports imposés par l'environnement (dev/tests) sinon première paire libre
  const forcedWs = Number(process.env.HNAYA_CHAT_WS_PORT) || 0;
  const ports = forcedWs
    ? { wsPort: forcedWs, httpPort: Number(process.env.HNAYA_CHAT_HTTP_PORT) || forcedWs + 1 }
    : await findFreePortPair();
  if (!ports) {
    process.send?.({ event: "error", message: `Limite atteinte : ${MAX_ROOMS} salons ouverts simultanément sur ce poste.` });
    return;
  }
  const handle = startHost({
    // Nom transmis seulement s'il est fourni : une réouverture sans
    // nom (roomId seul) conserve le nom existant du salon
    sessionName: msg.sessionName || undefined,
    // D.2 : roomId → réouverture d'un salon existant ; adminPin →
    // PIN admin choisi par l'utilisateur à la création (optionnel)
    roomId: msg.roomId || undefined,
    adminPin: msg.adminPin || undefined,
    wsPort: ports.wsPort,
    httpPort: ports.httpPort,
    dataDir: DATA_DIR,
    // EADDRINUSE & co : le serveur ne crash plus — on remonte une
    // erreur lisible à l'UI et on retire le salon de la liste.
    onError: (friendly) => {
      if (handle?.roomId) hostHandles.delete(handle.roomId);
      if (hostHandle?.roomId === handle?.roomId) hostHandle = null;
      process.send?.({ event: "error", message: friendly });
    },
  });
  hostHandles.set(handle.roomId, handle);
  hostHandle = handle;
  // inviteUrl : ce que le QR du dock encode — null si aucune IP LAN
  // (poste hors réseau : salon local possible, accès mobile non)
  const lanIp = getLanAddress();
  process.send({
    event: "host-started",
    pin: handle.pin,
    adminPin: handle.adminPin,
    roomId: handle.roomId,
    sessionName: msg.sessionName || undefined,
    wsPort: handle.wsPort,
    httpPort: handle.httpPort,
    lanIp,
    inviteUrl: lanIp ? `http://${lanIp}:${handle.httpPort}` : null,
  });
}

function handleCommand(msg) {
  switch (msg.cmd) {
    case "start-host": {
      // Salon déjà ouvert ? On le renvoie tel quel plutôt que d'en ouvrir
      // un second exemplaire (clic sur « Revenir » ou double-clic).
      const already = msg.roomId && hostHandles.get(msg.roomId);
      if (already) {
        const lanIp = getLanAddress();
        process.send({
          event: "host-started", pin: already.pin, adminPin: already.adminPin,
          roomId: already.roomId, sessionName: msg.sessionName || undefined,
          wsPort: already.wsPort, httpPort: already.httpPort, lanIp,
          inviteUrl: lanIp ? `http://${lanIp}:${already.httpPort}` : null,
        });
        break;
      }
      startHostAsync(msg);
      break;
    }

    case "stop-host": {
      // roomId absent → on ferme le dernier salon ouvert (compat)
      const target = msg.roomId
        ? hostHandles.get(msg.roomId)
        : [...hostHandles.values()].pop();
      if (!target) { process.send({ event: "host-stopped", roomId: msg.roomId || null }); break; }
      try { target.stop(); } catch { /* déjà arrêté */ }
      hostHandles.delete(target.roomId);
      if (hostHandle?.roomId === target.roomId) hostHandle = null;
      process.send({ event: "host-stopped", roomId: target.roomId });
      break;
    }

    case "discover": {
      // Annule une découverte précédente si elle tournait encore.
      // try/catch de ceinture : si l'annulation échouait, il faut QUAND
      // MÊME installer la nouvelle écoute (sinon découverte morte).
      try { stopDiscovery?.(); } catch { /* déjà arrêtée */ }
      stopDiscovery = discoverSessions((session) => {
        process.send({ event: "session-found", session });
      }, msg.timeoutMs || 4000);
      break;
    }

    case "join": {
      // Mémorisé AVANT la tentative : même une connexion qui échoue traduit
      // une INTENTION de l'utilisateur d'être dans ce salon, que la
      // reprise après veille doit honorer.
      lastJoinMsg = msg;
      if (clientHandle) clientHandle.close(); // une seule connexion client à la fois
      const handle = joinSession({
        address: msg.address,
        wsPort: msg.wsPort,
        pin: msg.pin,
        userId: msg.userId,
        groups: msg.groups || ["all"],
        lastSeenTs: msg.lastSeenTs || 0,
        dataDir: DATA_DIR,
        onMessage: (message) => process.send({ event: "message", message }),
        onPresence: (online) => process.send({ event: "presence", online }),
        onAdminResult: (result) => process.send({ event: "admin-result", result }),
        onInviteSent: (r) => process.send({ event: "invite-sent", to: r.to, delivered: r.delivered }),
        // Étape F — annuaire du salon (pseudos, fonctions, présence)
        onRoster: (r) => process.send({ event: "roster", people: r.people, me: r.me }),
        // Étape H — le dépouillement se rafraîchit à chaque réponse ; le
        // refus signale un second bulletin en mode non nominatif, qu'il
        // faut dire à l'intéressé plutôt que d'ignorer.
        onVoteTally: (t) => process.send({
          event: "vote-tally", voteId: t.voteId,
          decompte: t.decompte, total: t.total, voters: t.voters, detail: t.detail,
        }),
        onVoteRefused: (r) => process.send({ event: "vote-refused", voteId: r.voteId, reason: r.reason }),
        // Étape I — état de la licence du serveur permanent
        // Étape K — issue d'une demande qualifiée, et refus motivé quand
        // quelqu'un tente de décider à la place du destinataire désigné
        onDecisions: (d) => process.send({
          event: "decisions", messageId: d.messageId, decisions: d.decisions,
        }),
        onDecisionRefused: (r) => process.send({
          event: "decision-refused", messageId: r.messageId, reason: r.reason,
        }),
        onLicenceNotice: (n) => process.send({
          event: "licence-notice", mode: n.mode, readOnly: !!n.readOnly,
          notice: n.notice || null, refused: n.refused || null,
        }),
      });
      clientHandle = handle;
      handle.raw.on("open", () => process.send({ event: "joined" }));
      handle.raw.on("close", (code, reason) => {
        // Si une nouvelle connexion a déjà remplacé celle-ci (re-join),
        // ce close appartient à l'ancienne — ne rien signaler.
        if (clientHandle !== handle) return;
        clientHandle = null;
        // Code 4001 = PIN incorrect (voir server.js) — distingue ce cas
        // d'une simple déconnexion réseau pour un message clair côté UI
        if (code === 4001) {
          process.send({ event: "join-failed", reason: "pin-incorrect" });
        } else if (code === 4004) {
          // D.2 — appareil bloqué par l'admin (au join OU expulsé en
          // pleine session) : message spécifique, pas un aléa réseau
          process.send({ event: "join-failed", reason: "banned" });
        } else if (code === 4005) {
          // D.2 — salon verrouillé : cet appareil n'était pas membre
          // avant le verrouillage
          process.send({ event: "join-failed", reason: "locked" });
        } else if (code === 4006) {
          // Étape D premium — plafond d'appareils de la licence atteint
          // sur un serveur permanent : l'admin doit libérer une place ou
          // étendre la licence, ce n'est pas un problème réseau
          process.send({ event: "join-failed", reason: "device-limit" });
        } else {
          // ✅ Déconnexion involontaire (hôte fermé, réseau perdu…) —
          // sans cet événement, l'UI resterait « connectée » et les
          // messages partiraient dans le vide, sans aucun retour.
          process.send({ event: "disconnected" });
        }
      });
      handle.raw.on("error", (err) => {
        process.send({ event: "error", message: err?.message || String(err) });
      });
      break;
    }

    case "send-message": {
      // Filet de sécurité : émettre "disconnected" si l'UI croit encore
      // être connectée alors que la connexion est morte — évite l'envoi
      // silencieux dans le vide.
      if (!clientHandle) { process.send({ event: "disconnected" }); break; }
      // ⚠️ `demande` doit être relayée : elle est SIGNÉE côté client, et
      // l'oublier ici la ferait disparaître silencieusement — le message
      // partirait en simple note alors que l'utilisateur a demandé une
      // validation. C'est exactement ce qui était arrivé à `replyTo`.
      clientHandle.send(msg.text, msg.groupId, msg.media || null, msg.replyTo || null,
        msg.demande || null);
      break;
    }

    // ── Étape K — décision sur une demande qualifiée ──────────────
    case "decider": {
      if (!clientHandle) { process.send({ event: "disconnected" }); break; }
      clientHandle.decider({ messageId: msg.messageId, issue: msg.issue, comment: msg.comment || "" });
      break;
    }

    // ── Étape H — votes ───────────────────────────────────────────
    case "open-vote": {
      if (!clientHandle) { process.send({ event: "disconnected" }); break; }
      clientHandle.openVote({
        question: msg.question, options: msg.options,
        nominatif: msg.nominatif !== false, groupId: msg.groupId,
      });
      break;
    }
    case "answer-vote": {
      if (!clientHandle) { process.send({ event: "disconnected" }); break; }
      clientHandle.answerVote({ voteId: msg.voteId, choice: msg.choice, comment: msg.comment || "" });
      break;
    }

    // ── Étape E — pièces jointes ──────────────────────────────────
    // Les octets ne traversent PAS l'IPC : le processus principal écrit
    // d'abord un fichier temporaire et ne transmet ici qu'un CHEMIN. Une
    // pièce jointe de 25 Mio sérialisée en JSON à travers fork() coûterait
    // bien plus cher que de la relire sur le disque.
    case "media-upload": {
      if (!clientHandle) { process.send({ event: "media-error", reqId: msg.reqId, reason: "disconnected" }); break; }
      (async () => {
        try {
          const buffer = readFileSync(msg.path);
          const res = await clientHandle.uploadMedia({
            kind: msg.kind, mime: msg.mime, buffer, thumb: msg.thumb || null,
          });
          process.send({ event: "media-uploaded", reqId: msg.reqId, sha256: res.sha256, size: res.size });
        } catch (e) {
          process.send({ event: "media-error", reqId: msg.reqId, reason: e?.message || "upload" });
        } finally {
          try { unlinkSync(msg.path); } catch { /* déjà retiré */ }
        }
      })();
      break;
    }

    case "media-download": {
      if (!clientHandle) { process.send({ event: "media-error", reqId: msg.reqId, reason: "disconnected" }); break; }
      (async () => {
        try {
          const buffer = await clientHandle.fetchMedia({ sha256: msg.sha256, mime: msg.mime });
          writeFileSync(msg.outPath, buffer);
          process.send({ event: "media-downloaded", reqId: msg.reqId, path: msg.outPath, size: buffer.length });
        } catch (e) {
          process.send({ event: "media-error", reqId: msg.reqId, reason: e?.message || "download" });
        }
      })();
      break;
    }

    case "roster": {
      clientHandle?.requestRoster();
      break;
    }

    case "mark-read": {
      clientHandle?.markRead(msg.messageId, msg.groupId);
      break;
    }

    case "list-rooms": {
      // Liste des salons hébergés par CE poste (écran « Rouvrir un salon »
      // et sélecteur du panneau d'invitation). lanIp accompagne la liste :
      // il permet de composer l'adresse d'invitation sans héberger.
      initStore(DATA_DIR);
      process.send({ event: "rooms", rooms: listRooms(), lanIp: getLanAddress() });
      break;
    }

    case "delete-room": {
      // Suppression définitive (D.2) — refusée pour le salon en cours
      // d'hébergement : il faut le fermer d'abord (l'UI l'empêche déjà,
      // ceinture serveur ici)
      if (hostHandles.has(msg.roomId)) {
        process.send({ event: "error", message: "Fermez le salon avant de le supprimer." });
        break;
      }
      initStore(DATA_DIR);
      deleteRoom(msg.roomId);
      process.send({ event: "rooms", rooms: listRooms() });
      break;
    }

    case "send-invite": {
      if (!clientHandle) { process.send({ event: "disconnected" }); break; }
      clientHandle.sendInvite({ to: msg.to || null, room: msg.room });
      break;
    }

    case "admin": {
      // Panneau admin du dock — passthrough vers le salon (le serveur
      // vérifie le PIN admin, la réponse revient par "admin-result")
      if (!clientHandle) { process.send({ event: "disconnected" }); break; }
      clientHandle.sendAdmin({
        adminPin: msg.adminPin,
        action: msg.action,
        reqId: msg.reqId,
        fingerprint: msg.fingerprint,
        label: msg.label,
        filters: msg.filters,
        key: msg.key,
        value: msg.value,
        newPin: msg.newPin,
        locked: msg.locked,
      });
      break;
    }

    case "leave": {
      clientHandle?.close();
      clientHandle = null;
      lastJoinMsg = null; // départ volontaire : plus rien à reconnecter
      break;
    }

    // Réveil de la machine (voir le commentaire près de lastJoinMsg) —
    // envoyé par electron.js via powerMonitor.on("resume"). On ne peut
    // pas savoir si la connexion courante est morte ou juste ralentie :
    // fermer puis rejoindre est sans risque dans les deux cas (rejoindre
    // une connexion déjà saine coûte juste un bref aller-retour), alors
    // qu'attendre le seul battement de cœur peut laisser l'utilisateur
    // des dizaines de secondes dans un salon silencieux sans le savoir.
    case "network-resume": {
      if (lastJoinMsg) handleCommand({ ...lastJoinMsg, cmd: "join" });
      break;
    }

    default:
      process.send({ event: "error", message: `Commande inconnue : ${msg.cmd}` });
  }
}

// ✅ Nettoyage propre si le process parent (Electron) se termine —
// évite un salon "fantôme" qui continuerait de tourner et de répondre
// au beacon réseau après la fermeture du navigateur.
process.on("disconnect", () => {
  for (const h of hostHandles.values()) { try { h.stop(); } catch { /* déjà arrêté */ } }
  try { clientHandle?.close(); } catch { /* déjà fermée */ }
  try { stopDiscovery?.(); } catch { /* déjà arrêtée */ }
  process.exit(0);
});
