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
import {
  initStore, saveMessage, getMessagesSince, purgeOldMessages, upsertDeviceSeen,
  listDevices, setDeviceLabel, searchMessages, getConfig, setConfig,
  createRoom, getRoom, touchRoom, setRoomAdminPin, setRoomPin,
  banDevice, unbanDevice, isBanned, listBans,
  addRoomMember, isRoomMember, setRoomLocked,
} from "./store.js";
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
export function startHost({ sessionName = null, pin, adminPin, roomId, dataDir, wsPort = WS_PORT, httpPort, onError } = {}) {
  const clients = new Map(); // userId -> { ws, groups, device }
  initStore(dataDir); // dataDir undefined → défaut du module (chat-module/data)

  // ✅ D.2 — le salon est une entité à part entière (historique, PINs et
  // blocages cloisonnés). roomId fourni → RÉOUVERTURE (continuité :
  // même PIN d'accès, même PIN admin, même historique) ; absent →
  // salon NEUF. Le PIN admin peut être choisi à la création (sinon
  // généré) — il est montré à l'hôte par host-started.
  let room;
  if (roomId) {
    room = getRoom(roomId);
    if (!room) throw new Error(`Salon inconnu : ${roomId}`);
    // Renommage uniquement si un nom est EXPLICITEMENT fourni — une
    // réouverture sans nom garde le nom existant
    room = touchRoom(roomId, sessionName ? { name: sessionName } : {});
    // PIN d'accès imposé à la réouverture (serveur permanent : --pin)
    if (/^\d{6}$/.test(String(pin ?? "")) && String(pin) !== room.roomPin) {
      setRoomPin(roomId, String(pin));
      room = getRoom(roomId);
    }
  } else {
    room = createRoom({
      name: sessionName || "Hnaya Chat",
      roomPin: /^\d{6}$/.test(String(pin ?? "")) ? String(pin) : generatePin(),
      adminPin: /^\d{6}$/.test(String(adminPin ?? "")) ? String(adminPin) : generatePin(),
    });
  }
  const activeRoomId = room.roomId;
  const roomPin = room.roomPin || (pin ?? generatePin());
  let currentAdminPin = room.adminPin;
  const sessionKey = deriveKeyFromPin(roomPin);
  sessionName = room.name;

  const wss = new WebSocketServer({ port: wsPort });
  console.log(`[hnaya-chat] Salon "${sessionName}" ouvert sur le port ${wsPort} — PIN : ${roomPin}`);

  // ✅ Étape D — plus de crash brut sur EADDRINUSE (un salon tourne déjà
  // sur ce poste) : nettoyage puis remontée d'une erreur lisible. Sans ce
  // gestionnaire, l'événement "error" non écouté TUE le process entier.
  wss.on("error", (err) => {
    const friendly = err?.code === "EADDRINUSE"
      ? `Le port ${wsPort} est déjà utilisé — un salon est probablement déjà ouvert sur ce poste.`
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

        // ✅ D.2 — appareil bloqué par l'admin de CE salon : refus net
        // (code 4004, distinct du 4001 « PIN incorrect » pour un message
        // clair côté client). Vérifié à CHAQUE join — un blocage prononcé
        // pendant l'absence de l'appareil s'applique à son retour.
        if (device && isBanned(activeRoomId, device.fingerprint)) {
          ws.close(4004, "device-banned");
          return;
        }

        // ✅ D.2 — VERROU : composition figée par l'admin. Seuls les
        // appareils déjà MEMBRES entrent (un PIN qui fuite ne suffit
        // plus). Les clients v1 (sans identité vérifiable) sont refusés
        // sur un salon verrouillé — on ne peut pas prouver leur
        // appartenance. Code 4005, distinct des autres refus.
        if (getRoom(activeRoomId).locked && (!device || !isRoomMember(activeRoomId, device.fingerprint))) {
          ws.close(4005, "room-locked");
          return;
        }
        if (device) addRoomMember(activeRoomId, device.fingerprint);
        clients.set(userId, { ws, groups: payload.groups || ["all"], device });

        // Renvoie les messages manqués depuis la dernière connexion
        const since = payload.lastSeenTs || 0;
        const missed = (payload.groups || ["all"]).flatMap((g) => getMessagesSince(g, since, activeRoomId));
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
            roomId: activeRoomId,
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
            roomId: activeRoomId,
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

      // ✅ D.2 — INVITATION vers un autre salon (typiquement un
      // sous-salon que l'expéditeur héberge). Deux modes :
      //   • ciblée (to = pseudo) : remise directe au seul destinataire
      //     connecté, JAMAIS persistée — le PIN du salon invité ne reste
      //     pas dans l'historique d'ici ;
      //   • à tous (to absent) : message persistant type "invite" — les
      //     absents la découvrent dans le backlog à leur retour.
      // Le serveur ne relaie que des champs connus (pas de passthrough).
      if (payload.type === "invite") {
        const roomInfo = payload.room || {};
        const inv = {
          v: 1,
          type: "invite",
          id: "inv_" + crypto.randomUUID(),
          roomId: activeRoomId,
          groupId: payload.groupId || "all",
          from: userId,
          text: String(roomInfo.name || ""), // repli texte (clients anciens / exports)
          ts: Date.now(),
          targeted: !!payload.to,
          extra: {
            name: String(roomInfo.name || "Salon"),
            address: String(roomInfo.address || ""),
            wsPort: Number(roomInfo.wsPort) || 4802,
            httpPort: Number(roomInfo.httpPort) || 4803,
            pin: /^\d{6}$/.test(String(roomInfo.pin ?? "")) ? String(roomInfo.pin) : null,
          },
        };
        if (payload.to) {
          const target = clients.get(String(payload.to));
          if (target) target.ws.send(encryptPayload(sessionKey, inv));
          // accusé à l'expéditeur (le destinataire peut être déconnecté)
          ws.send(encryptPayload(sessionKey, { v: 1, type: "invite-sent", to: String(payload.to), delivered: !!target }));
        } else {
          if (!saveMessage(inv).inserted) return;
          broadcastToGroup(inv.groupId, inv);
        }
        return;
      }

      if (payload.type === "read") {
        broadcastToGroup(payload.groupId, {
          v: 1,
          type: "read",
          messageId: payload.messageId,
          userId,
        });
        return;
      }

      // ✅ Étape D — commandes d'ADMINISTRATION (registre, historique,
      // réglages). Même canal chiffré que le reste : il faut déjà le PIN
      // du salon pour parler au serveur, PUIS le PIN admin pour ces
      // commandes. Réponses envoyées uniquement à l'appelant.
      if (payload.type === "admin") {
        ws.adminTries = (ws.adminTries || 0);
        const reply = (res) => ws.send(encryptPayload(sessionKey, {
          v: 1, type: "admin-result", action: payload.action, reqId: payload.reqId || null, ...res,
        }));

        if (!checkAdminPin(payload.adminPin, currentAdminPin)) {
          ws.adminTries += 1;
          reply({ ok: false, error: "admin-pin" });
          // 5 tentatives ratées → connexion fermée (frein brutal mais sain
          // contre l'énumération d'un PIN à 6 chiffres depuis le LAN)
          if (ws.adminTries >= 5) ws.close(4003, "admin-pin-attempts");
          return;
        }

        try {
          switch (payload.action) {
            case "devices":
              reply({ ok: true, data: listDevices(activeRoomId) });
              break;
            case "label":
              setDeviceLabel(String(payload.fingerprint || ""), payload.label ?? null);
              reply({ ok: true, data: listDevices(activeRoomId) });
              break;
            case "search":
              // roomId imposé côté serveur : l'admin de CE salon ne peut
              // pas fouiller l'historique des autres salons de la machine
              reply({ ok: true, data: searchMessages({ ...(payload.filters || {}), roomId: activeRoomId }) });
              break;
            case "ban": {
              // Blocage + expulsion immédiate de toutes les connexions
              // actives de cet appareil (sinon il resterait dans le salon
              // jusqu'à sa prochaine reconnexion)
              const fp = String(payload.fingerprint || "");
              banDevice(activeRoomId, fp);
              for (const [uid, c] of clients) {
                if (c.device?.fingerprint === fp) {
                  try { c.ws.close(4004, "device-banned"); } catch {}
                  clients.delete(uid);
                }
              }
              broadcastPresence();
              reply({ ok: true, data: { devices: listDevices(activeRoomId), bans: listBans(activeRoomId) } });
              break;
            }
            case "unban":
              unbanDevice(activeRoomId, String(payload.fingerprint || ""));
              reply({ ok: true, data: { devices: listDevices(activeRoomId), bans: listBans(activeRoomId) } });
              break;
            case "bans":
              reply({ ok: true, data: listBans(activeRoomId) });
              break;
            case "set-locked": {
              // Verrouillage/déverrouillage du salon par l'admin — voir
              // le contrôle au join (code 4005). Les membres CONNECTÉS ne
              // sont pas éjectés au verrouillage : le verrou fige les
              // entrées, il ne vide pas la pièce.
              setRoomLocked(activeRoomId, !!payload.locked);
              reply({ ok: true, data: { locked: !!payload.locked } });
              break;
            }
            case "room-info": {
              const r = getRoom(activeRoomId);
              reply({ ok: true, data: { name: r.name, locked: !!r.locked, retention_days: Number(getConfig("retention_days", 90)) } });
              break;
            }
            case "set-admin-pin": {
              // L'admin authentifié choisit son PIN — action dédiée,
              // jamais par la config générique pilotée par le réseau
              const newPin = String(payload.newPin || "");
              if (!/^\d{6}$/.test(newPin)) { reply({ ok: false, error: "pin-format" }); break; }
              setRoomAdminPin(activeRoomId, newPin);
              currentAdminPin = newPin;
              reply({ ok: true, data: { changed: true } });
              break;
            }
            case "config-get":
              reply({ ok: true, data: { retention_days: Number(getConfig("retention_days", 90)) } });
              break;
            case "config-set": {
              // Seules les clés explicitement autorisées — jamais un
              // set générique piloté par le réseau (admin_pin se change
              // par une action dédiée si besoin, pas ici)
              if (payload.key === "retention_days") {
                const days = Math.max(0, Math.min(3650, Number(payload.value) || 0));
                setConfig("retention_days", String(days));
                purgeOldMessages();
                reply({ ok: true, data: { retention_days: days } });
              } else {
                reply({ ok: false, error: "config-key" });
              }
              break;
            }
            default:
              reply({ ok: false, error: "unknown-action" });
          }
        } catch (err) {
          reply({ ok: false, error: err?.message || "admin-error" });
        }
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
  const mobileServer = startMobileServer({ sessionName, wsPort, httpPort });
  const stopBeacon = startBeacon({ sessionName, wsPort, httpPort: mobileServer.httpPort });
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
    pin: roomPin,
    adminPin: currentAdminPin,
    roomId: activeRoomId,
    wsPort,
    httpPort: mobileServer.httpPort,
    stop() {
      // Retourne une promesse résolue quand les DEUX ports (4802/4803)
      // sont réellement libérés — un stop puis un start immédiat (changer
      // de salon, redémarrage de service) ne tombe plus sur un
      // EADDRINUSE de course. Les appels legacy sans await restent
      // valides : le nettoyage synchrone est fait avant le retour.
      const mobileClosed = mobileServer.stop();
      stopBeacon();
      clearInterval(purgeInterval);
      clearInterval(heartbeatInterval);
      // ✅ Fermer explicitement chaque connexion (code 1001 « going away »)
      // — wss.close() seul n'interrompt pas les connexions existantes :
      // les participants resteraient « connectés » à un salon fantôme.
      for (const { ws } of clients.values()) {
        try { ws.close(1001, "host-closed"); } catch { /* déjà fermée */ }
      }
      const wssClosed = new Promise((resolve) => {
        try { wss.close(() => resolve()); } catch { resolve(); }
      });
      console.log(`[hnaya-chat] Salon "${sessionName}" fermé.`);
      return Promise.all([mobileClosed, wssClosed]);
    },
  };
  return handle;
}

// Comparaison à temps constant du PIN admin — évite qu'un chronométrage
// fin des réponses depuis le LAN ne révèle les chiffres un à un.
function checkAdminPin(given, expected) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
  const { pin, adminPin } = startHost({
    sessionName: "Salon de test",
    onError: (friendly) => {
      console.error(`[hnaya-chat] ${friendly}`);
      process.exit(1);
    },
  });
  console.log(`→ Partage ce PIN avec les autres participants : ${pin}`);
  console.log(`→ PIN ADMIN (registre/historique/réglages — à garder pour vous) : ${adminPin}`);
  process.on("SIGINT", () => process.exit(0));
}
