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
//   { cmd: "send-message", text, groupId, media }
//   { cmd: "mark-read", messageId, groupId }
//   { cmd: "admin", adminPin, action, reqId, ... }   (étape D)
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
//   { event: "error", message }

import os from "node:os";
import { startHost } from "./server.js";
import { discoverSessions, joinSession } from "./client.js";
import { initStore, listRooms } from "./store.js";

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

let hostHandle = null;      // { pin, stop } si on héberge un salon
let clientHandle = null;    // { send, markRead, close } si on a rejoint un salon
let stopDiscovery = null;   // fonction pour arrêter une découverte en cours

process.on("message", (msg) => {
  try {
    handleCommand(msg);
  } catch (err) {
    process.send?.({ event: "error", message: err?.message || String(err) });
  }
});

function handleCommand(msg) {
  switch (msg.cmd) {
    case "start-host": {
      if (hostHandle) hostHandle.stop(); // évite deux hôtes simultanés sur ce poste
      hostHandle = startHost({
        // Nom transmis seulement s'il est fourni : une réouverture sans
        // nom (roomId seul) conserve le nom existant du salon
        sessionName: msg.sessionName || undefined,
        // D.2 : roomId → réouverture d'un salon existant ; adminPin →
        // PIN admin choisi par l'utilisateur à la création (optionnel)
        roomId: msg.roomId || undefined,
        adminPin: msg.adminPin || undefined,
        dataDir: DATA_DIR,
        // EADDRINUSE & co : le serveur ne crash plus — on remonte une
        // erreur lisible à l'UI et on considère l'hôte arrêté.
        onError: (friendly) => {
          hostHandle = null;
          process.send?.({ event: "error", message: friendly });
        },
      });
      // inviteUrl : ce que le QR du dock encode — null si aucune IP LAN
      // (poste hors réseau : salon local possible, accès mobile non)
      const lanIp = getLanAddress();
      process.send({
        event: "host-started",
        pin: hostHandle.pin,
        adminPin: hostHandle.adminPin,
        roomId: hostHandle.roomId,
        sessionName: msg.sessionName || "Hnaya Chat",
        wsPort: hostHandle.wsPort,
        httpPort: hostHandle.httpPort,
        lanIp,
        inviteUrl: lanIp ? `http://${lanIp}:${hostHandle.httpPort}` : null,
      });
      break;
    }

    case "stop-host": {
      hostHandle?.stop();
      hostHandle = null;
      process.send({ event: "host-stopped" });
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
      clientHandle.send(msg.text, msg.groupId, msg.media || null);
      break;
    }

    case "mark-read": {
      clientHandle?.markRead(msg.messageId, msg.groupId);
      break;
    }

    case "list-rooms": {
      // Liste des salons hébergés par CE poste (écran « Rouvrir un salon »)
      initStore(DATA_DIR);
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
      });
      break;
    }

    case "leave": {
      clientHandle?.close();
      clientHandle = null;
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
  try { hostHandle?.stop(); } catch { /* déjà arrêté */ }
  try { clientHandle?.close(); } catch { /* déjà fermée */ }
  try { stopDiscovery?.(); } catch { /* déjà arrêtée */ }
  process.exit(0);
});
