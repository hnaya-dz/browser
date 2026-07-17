// ═══════════════════════════════════════════════════════════════
// Hôte du salon de chat local — n'importe quel poste peut lancer ceci
// ═══════════════════════════════════════════════════════════════
// Pas de serveur dédié requis : un utilisateur clique "Créer un salon",
// ce module tourne localement sur SON poste, les autres postes le
// rejoignent automatiquement via la découverte réseau (discovery.js).

import { WebSocketServer } from "ws";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { deriveKeyFromPin, encryptPayload, decryptPayload, generatePin } from "./crypto.js";
import { startBeacon } from "./discovery.js";
import { saveMessage, getMessagesSince, purgeOldMessages } from "./db.js";

const WS_PORT = 4802; // port local arbitraire pour le chat LAN Hnaya
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000; // purge de rétention toutes les 6h
// Battement de cœur : détecte les connexions mortes (wifi coupé, veille,
// crash) — sans ping/pong, une connexion TCP peut rester silencieusement
// « établie » indéfiniment et les messages partent dans le vide.
const HEARTBEAT_MS = 10000;

/**
 * Démarre un salon hébergé sur ce poste.
 * @param {object} opts
 * @param {string} [opts.sessionName] nom affiché aux autres postes (ex. "Famille Benali")
 * @param {string} [opts.pin] PIN à 6 chiffres ; généré aléatoirement si absent
 * @returns {{ pin: string, stop: () => void }}
 */
export function startHost({ sessionName = "Hnaya Chat", pin = generatePin() } = {}) {
  const sessionKey = deriveKeyFromPin(pin);
  const clients = new Map(); // userId -> { ws, groups }

  const wss = new WebSocketServer({ port: WS_PORT });
  console.log(`[hnaya-chat] Salon "${sessionName}" ouvert sur le port ${WS_PORT} — PIN : ${pin}`);

  wss.on("connection", (ws) => {
    let userId = null;
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (raw) => {
      let payload;
      try {
        payload = decryptPayload(sessionKey, raw.toString());
      } catch {
        // Mauvais PIN (ou message corrompu) → le message est illisible.
        // On ferme proprement plutôt que de laisser une connexion morte.
        ws.close(4001, "PIN incorrect ou message illisible");
        return;
      }

      if (payload.type === "join") {
        userId = payload.userId;
        clients.set(userId, { ws, groups: payload.groups || ["all"] });

        // Renvoie les messages manqués depuis la dernière connexion
        const since = payload.lastSeenTs || 0;
        const missed = (payload.groups || ["all"]).flatMap((g) => getMessagesSince(g, since));
        ws.send(encryptPayload(sessionKey, { v: 1, type: "backlog", messages: missed }));

        broadcastPresence();
        return;
      }

      if (payload.type === "message") {
        const msg = {
          v: 1,
          type: "message",
          id: "msg_" + crypto.randomUUID(),
          groupId: payload.groupId || "all",
          from: userId,
          text: payload.text ?? "",
          // media : réservé à la V2 (image/audio/vidéo) — voir README.md,
          // section "Étape suivante". Ne pas mettre de gros binaires ici
          // tel quel : prévoir un transfert par chunks ou un endpoint
          // HTTP local séparé pour les fichiers volumineux.
          media: payload.media || null,
          ts: Date.now(),
        };
        saveMessage(msg);
        broadcastToGroup(msg.groupId, msg);
        return;
      }

      if (payload.type === "read") {
        broadcastToGroup(payload.groupId, {
          v: 1,
          type: "read",
          messageId: payload.messageId,
          userId,
        });
      }
    });

    ws.on("close", () => {
      if (userId) clients.delete(userId);
      broadcastPresence();
    });
  });

  function broadcastToGroup(groupId, data) {
    for (const { ws, groups } of clients.values()) {
      if (groups.includes(groupId) || groups.includes("all")) {
        ws.send(encryptPayload(sessionKey, data));
      }
    }
  }

  function broadcastPresence() {
    const online = [...clients.keys()];
    for (const { ws } of clients.values()) {
      ws.send(encryptPayload(sessionKey, { v: 1, type: "presence", online }));
    }
  }

  const stopBeacon = startBeacon({ sessionName, wsPort: WS_PORT });
  const purgeInterval = setInterval(purgeOldMessages, PURGE_INTERVAL_MS);

  // Ping périodique de chaque participant — sans pong avant le cycle
  // suivant, la connexion est terminée (déclenche "close" côté client,
  // qui met à jour la présence pour tout le monde).
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* connexion déjà morte */ }
    }
  }, HEARTBEAT_MS);

  return {
    pin,
    wsPort: WS_PORT,
    stop() {
      stopBeacon();
      clearInterval(purgeInterval);
      clearInterval(heartbeatInterval);
      // ✅ Fermer explicitement chaque connexion (code 1001 « going away »)
      // — wss.close() seul n'interrompt pas les connexions existantes :
      // les participants resteraient « connectés » à un salon fantôme.
      for (const { ws } of clients.values()) {
        try { ws.close(1001, "host-closed"); } catch { /* déjà fermée */ }
      }
      wss.close();
      console.log(`[hnaya-chat] Salon "${sessionName}" fermé.`);
    },
  };
}

// ── Exécution directe (yarn host / node src/server.js) ──
// Ne se déclenche PAS quand ce fichier est importé par le processus
// principal d'Electron — uniquement en lancement autonome, pratique
// pour tester ce squelette indépendamment du navigateur.
// ⚠️ pathToFileURL() est obligatoire ici (pas de comparaison de chaîne
// "file://" + argv[1] à la main) : sur Windows, import.meta.url produit
// "file:///C:/..." (slashes, triple slash) alors que process.argv[1]
// contient des antislashs ("C:\..."), donc l'ancienne comparaison directe
// était toujours fausse et yarn host ne démarrait jamais rien.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { pin } = startHost({ sessionName: "Salon de test" });
  console.log(`→ Partage ce PIN avec les autres participants : ${pin}`);
  process.on("SIGINT", () => process.exit(0));
}
