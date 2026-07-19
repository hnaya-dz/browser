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
import { initStore, saveMessage, getMessagesSince, purgeOldMessages, upsertDeviceSeen } from "./store.js";
import { fingerprintFromRawPublicKey, rawFromSpkiBase64, verifyMessage } from "./identity.js";
import { startMobileServer } from "./mobile-server.js";

const WS_PORT = 4802; // port local arbitraire pour le chat LAN Hnaya
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000; // purge de rétention toutes les 6h
// Dérive d'horloge tolérée sur l'horodatage SIGNÉ par le client (protocole
// v2) : au-delà, on garde le message mais horodaté par le serveur et marqué
// non valide — une signature sur un horodatage fantaisiste ne vaut rien
// pour un audit.
const MAX_CLOCK_DRIFT_MS = 10 * 60 * 1000;
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
export function startHost({ sessionName = "Hnaya Chat", pin = generatePin(), dataDir, onError } = {}) {
  const sessionKey = deriveKeyFromPin(pin);
  const clients = new Map(); // userId -> { ws, groups, device }
  initStore(dataDir); // dataDir undefined → défaut du module (chat-module/data)

  const wss = new WebSocketServer({ port: WS_PORT });
  console.log(`[hnaya-chat] Salon "${sessionName}" ouvert sur le port ${WS_PORT} — PIN : ${pin}`);

  // ✅ Étape D — plus de crash brut sur EADDRINUSE (un salon tourne déjà
  // sur ce poste) : nettoyage puis remontée d'une erreur lisible. Sans ce
  // gestionnaire, l'événement "error" non écouté TUE le process entier.
  wss.on("error", (err) => {
    const friendly = err?.code === "EADDRINUSE"
      ? `Le port ${WS_PORT} est déjà utilisé — un salon est probablement déjà ouvert sur ce poste.`
      : (err?.message || String(err));
    try { handle.stop(); } catch { /* ressources partiellement créées */ }
    if (onError) onError(friendly, err);
    else console.error(`[hnaya-chat] Erreur serveur : ${friendly}`);
  });

  wss.on("connection", (ws, req) => {
    let userId = null;
    const remoteIp = req?.socket?.remoteAddress || null;
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

        // ✅ Étape D — registre des appareils : le join v2 annonce la clé
        // publique Ed25519. L'empreinte est calculée ICI (jamais confiée
        // au client) et la fiche appareil est mise à jour (pseudos vus,
        // machine, IP). Clients 0.3.1 (v1, sans device) : accueillis tels
        // quels, leurs messages seront simplement « non signés ».
        let device = null;
        if (payload.device?.publicKey) {
          try {
            const fingerprint = fingerprintFromRawPublicKey(rawFromSpkiBase64(payload.device.publicKey));
            device = { fingerprint, publicKeySpki: payload.device.publicKey };
            upsertDeviceSeen({
              fingerprint,
              publicKeySpki: payload.device.publicKey,
              nickname: userId,
              hostname: payload.device.hostname || null,
              platform: payload.device.platform || null,
              ip: remoteIp,
            });
          } catch { device = null; /* clé malformée → traité comme v1 */ }
        }
        clients.set(userId, { ws, groups: payload.groups || ["all"], device });

        // Renvoie les messages manqués depuis la dernière connexion
        const since = payload.lastSeenTs || 0;
        const missed = (payload.groups || ["all"]).flatMap((g) => getMessagesSince(g, since));
        ws.send(encryptPayload(sessionKey, { v: 1, type: "backlog", messages: missed }));

        broadcastPresence();
        return;
      }

      if (payload.type === "message") {
        const now = Date.now();
        const device = clients.get(userId)?.device || null;
        let msg;

        if (payload.signature && payload.id && payload.ts && device) {
          // ── Protocole v2 : message signé par l'appareil ──
          // La signature couvre (id, from, text, ts) tels qu'écrits par le
          // client. Horodatage trop dérivé → on garde le message (horodaté
          // serveur) mais signatureValid=false : pas d'antidatage signé.
          const core = { id: String(payload.id), from: userId, text: payload.text ?? "", ts: Number(payload.ts) };
          const verified = verifyMessage(core, payload.signature, device.publicKeySpki);
          const driftOk = Math.abs(now - core.ts) <= MAX_CLOCK_DRIFT_MS;
          msg = {
            v: 1,
            type: "message",
            id: core.id,
            groupId: payload.groupId || "all",
            from: userId,
            text: core.text,
            media: payload.media || null,
            ts: driftOk ? core.ts : now,
            deviceFp: device.fingerprint,
            signature: payload.signature,
            signatureValid: verified && driftOk,
          };
        } else {
          // ── Protocole v1 (clients 0.3.1) : id/horodatage serveur ──
          msg = {
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
            ts: now,
            deviceFp: device?.fingerprint || null,
            signature: null,
            signatureValid: false,
          };
        }

        // Anti-rejeu : un id déjà en base (client malveillant ou doublon
        // réseau) n'est ni réenregistré ni rediffusé.
        if (!saveMessage(msg).inserted) return;
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

  // ✅ Accès mobile (C-bis) : page web servie aux téléphones du même wifi.
  // httpPort est annoncé dans le beacon pour que les postes déjà connectés
  // puissent aussi afficher le QR d'invitation (URL = adresse de l'hôte).
  const mobileServer = startMobileServer({ sessionName, wsPort: WS_PORT });
  const stopBeacon = startBeacon({ sessionName, wsPort: WS_PORT, httpPort: mobileServer.httpPort });
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

  const handle = {
    pin,
    wsPort: WS_PORT,
    httpPort: mobileServer.httpPort,
    stop() {
      mobileServer.stop();
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
  return handle;
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
  const { pin } = startHost({
    sessionName: "Salon de test",
    onError: (friendly) => {
      console.error(`[hnaya-chat] ${friendly}`);
      process.exit(1);
    },
  });
  console.log(`→ Partage ce PIN avec les autres participants : ${pin}`);
  process.on("SIGINT", () => process.exit(0));
}
