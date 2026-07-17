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
//   { cmd: "leave" }
//
// Événements envoyés (process.send) :
//   { event: "host-started", pin }
//   { event: "host-stopped" }
//   { event: "session-found", session }
//   { event: "joined" }
//   { event: "join-failed", reason }
//   { event: "message", message }
//   { event: "presence", online }
//   { event: "error", message }

import { startHost } from "./server.js";
import { discoverSessions, joinSession } from "./client.js";

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
      hostHandle = startHost({ sessionName: msg.sessionName || "Hnaya Chat" });
      process.send({ event: "host-started", pin: hostHandle.pin, wsPort: hostHandle.wsPort });
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
        onMessage: (message) => process.send({ event: "message", message }),
        onPresence: (online) => process.send({ event: "presence", online }),
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
