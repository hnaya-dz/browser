// ═══════════════════════════════════════════════════════════════
// Client — à utiliser depuis le process principal d'Electron
// ═══════════════════════════════════════════════════════════════
// Ce fichier n'a pas d'interface graphique : il expose des fonctions
// simples que le main process d'Electron appelle, puis relaie vers le
// renderer via IPC (comme pour le reste de Hnaya DZ — voir TECHNIQUES.md
// section 1, pattern preload.js déjà en place dans le navigateur).

import WebSocket from "ws";
import { deriveKeyFromPin, encryptPayload, decryptPayload } from "./crypto.js";
import { listenForSessions } from "./discovery.js";

/**
 * Découvre les salons Hnaya Chat disponibles sur le réseau local pendant
 * `timeoutMs` millisecondes, puis arrête l'écoute automatiquement.
 * @param {(session: object) => void} onFound appelé pour chaque salon trouvé
 */
export function discoverSessions(onFound, timeoutMs = 4000) {
  const stop = listenForSessions(onFound);
  setTimeout(stop, timeoutMs);
  return stop; // permet d'arrêter plus tôt si l'utilisateur annule
}

/**
 * Rejoint un salon avec le PIN fourni par l'utilisateur.
 * @param {object} opts
 * @param {string} opts.address IP de l'hôte (issue de discoverSessions)
 * @param {number} opts.wsPort port WebSocket de l'hôte (issu du beacon)
 * @param {string} opts.pin PIN à 6 chiffres saisi par l'utilisateur
 * @param {string} opts.userId identifiant local de l'utilisateur
 * @param {string[]} [opts.groups] groupes à rejoindre (défaut : ["all"])
 * @param {number} [opts.lastSeenTs] timestamp du dernier message reçu (reconnexion)
 * @param {(msg: object) => void} [opts.onMessage] appelé pour chaque message reçu
 * @param {(online: string[]) => void} [opts.onPresence] appelé à chaque mise à jour de présence
 */
export function joinSession({
  address,
  wsPort,
  pin,
  userId,
  groups = ["all"],
  lastSeenTs = 0,
  onMessage,
  onPresence,
}) {
  const sessionKey = deriveKeyFromPin(pin);
  const ws = new WebSocket(`ws://${address}:${wsPort}`);

  ws.on("open", () => {
    ws.send(encryptPayload(sessionKey, { v: 1, type: "join", userId, groups, lastSeenTs }));
  });

  // Battement de cœur côté client : si l'hôte ne répond plus au ping
  // (salon fermé, wifi coupé, machine en veille), on termine la connexion
  // nous-mêmes → l'événement "close" remonte jusqu'à l'UI (« Connexion au
  // salon perdue ») au lieu d'un silence indéfini où les messages envoyés
  // partent dans le vide.
  let alive = true;
  ws.on("pong", () => { alive = true; });
  const heartbeat = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (!alive) { try { ws.terminate(); } catch {} return; }
    alive = false;
    try { ws.ping(); } catch { /* connexion déjà morte */ }
  }, 10000);
  ws.on("close", () => clearInterval(heartbeat));

  ws.on("message", (raw) => {
    let payload;
    try {
      payload = decryptPayload(sessionKey, raw.toString());
    } catch {
      // PIN invalide → tout est illisible. On ignore silencieusement
      // plutôt que de planter — l'UI Electron peut détecter l'absence
      // de "backlog" reçu après un délai pour signaler "PIN incorrect".
      return;
    }

    if (payload.type === "backlog") payload.messages.forEach((m) => onMessage?.(m));
    else if (payload.type === "presence") onPresence?.(payload.online);
    else if (payload.type === "message") onMessage?.(payload);
    // "read" (accusés de lecture) : à relayer vers l'UI selon les besoins
  });

  function send(text, groupId = "all", media = null) {
    ws.send(encryptPayload(sessionKey, { v: 1, type: "message", text, groupId, media }));
  }

  function markRead(messageId, groupId) {
    ws.send(encryptPayload(sessionKey, { v: 1, type: "read", messageId, groupId }));
  }

  return {
    send,
    markRead,
    close: () => ws.close(),
    raw: ws, // accès direct si besoin (ex. écouter "close"/"error" côté Electron)
  };
}
