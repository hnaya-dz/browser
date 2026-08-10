// ═══════════════════════════════════════════════════════════════
// Client — à utiliser depuis le process principal d'Electron
// ═══════════════════════════════════════════════════════════════
// Ce fichier n'a pas d'interface graphique : il expose des fonctions
// simples que le main process d'Electron appelle, puis relaie vers le
// renderer via IPC (comme pour le reste de Hnaya DZ — voir TECHNIQUES.md
// section 1, pattern preload.js déjà en place dans le navigateur).

import WebSocket from "ws";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveKeyFromPin, encryptPayload, decryptPayload } from "./crypto.js";
import { listenForSessions } from "./discovery.js";
import { loadOrCreateIdentity, voteDefinitionSeal, voteAnswerSeal,
         demandeSeal, decisionSeal } from "./identity.js";
import { CHUNK_BYTES } from "./media.js";

// Répertoire par défaut de l'identité d'appareil (même défaut que store.js) ;
// le worker Electron passe son propre dataDir (userData) via joinSession.
const DEFAULT_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

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
  dataDir = DEFAULT_DATA_DIR,
  onMessage,
  onVoteTally,
  onVoteRefused,
  onDecisions,
  onDecisionRefused,
  onLicenceNotice,
  onPresence,
  onAdminResult,
  onInviteSent,
  onRoster,
  onDevicePaired,
  onAvatarsChanged,
  onReads,
  pairing,
}) {
  const sessionKey = deriveKeyFromPin(pin);
  // ✅ Étape D — identité d'appareil : pseudo libre en surface, clé Ed25519
  // stable en dessous. Le join annonce la clé publique + le nom de machine ;
  // chaque message est signé (traçabilité admin, voir identity.js).
  const identity = loadOrCreateIdentity(dataDir);
  const ws = new WebSocket(`ws://${address}:${wsPort}`);

  ws.on("open", () => {
    ws.send(encryptPayload(sessionKey, {
      v: 2,
      type: "join",
      userId,
      groups,
      lastSeenTs,
      device: {
        publicKey: identity.publicKeySpki,
        hostname: os.hostname(),
        platform: process.platform,
      },
      // Étape L — jeton d'appairage, présenté une seule fois par un SECOND
      // appareil de la même personne. Absent dans le cas courant.
      pairing: pairing || undefined,
    }));
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

    // ⚠️ Étape J — les messages du RATTRAPAGE sont marqués. Ils empruntent
    // le même chemin que les messages vifs : sans ce drapeau, rejoindre un
    // salon après une absence déclenchait un signal sonore PAR message
    // rattrapé. Ils restent comptés comme non lus (ils le sont), mais ne
    // sonnent pas — on ne sonne que pour ce qui arrive maintenant.
    if (payload.type === "backlog") payload.messages.forEach((m) => onMessage?.({ ...m, backlog: true }));
    else if (payload.type === "presence") onPresence?.(payload.online);
    else if (payload.type === "message") onMessage?.(payload);
    // Invitation vers un autre salon : mêmes champs qu'un message (id,
    // from, ts) + type "invite" et extra {name, address, pin…} — l'UI en
    // fait une carte cliquable
    else if (payload.type === "invite") onMessage?.(payload);
    // Étape H — un vote EST un message dans le fil ; son dépouillement,
    // lui, arrive à part et se rafraîchit à chaque réponse.
    else if (payload.type === "vote") onMessage?.(payload);
    else if (payload.type === "vote-tally") onVoteTally?.(payload);
    else if (payload.type === "vote-refused") onVoteRefused?.(payload);
    // Étape I — échéance de licence : préavis, délai de grâce, puis
    // lecture seule. Arrive à la connexion et à chaque changement de
    // palier, sans redémarrage du serveur.
    else if (payload.type === "licence-notice") onLicenceNotice?.(payload);
    // Étape K — l'issue d'une demande qualifiée. Comme le dépouillement
    // d'un vote, elle arrive à part du message et se rafraîchit à chaque
    // prise de position.
    else if (payload.type === "decisions") onDecisions?.(payload);
    else if (payload.type === "decision-refused") onDecisionRefused?.(payload);
    // Étape L — un appareil vient d'être rattaché à MA personne. On le dit :
    // le jeton ne peut pas empêcher un usage détourné, mais le signaler
    // permet de s'en apercevoir.
    else if (payload.type === "device-paired") onDevicePaired?.(payload);
    // Étape M — quelqu'un a changé sa photo : l'annuaire affiché est périmé.
    else if (payload.type === "avatars-changed") onAvatarsChanged?.(payload);
    // Étape N — qui a lu ce message. Liste complète et non incrément :
    // l'expéditeur veut savoir QUI, pas recomposer la liste lui-même.
    else if (payload.type === "reads") onReads?.(payload);
    else if (payload.type === "invite-sent") onInviteSent?.(payload);
    else if (payload.type === "admin-result") onAdminResult?.(payload);
    // Étape F — annuaire : qui est inscrit, sa fonction, sa présence
    else if (payload.type === "roster") onRoster?.(payload);
    // ── Étape E — réponses liées aux pièces jointes ──
    else if (payload.type === "media-go") {
      uploads.get(payload.uploadId)?.start?.();
    }
    else if (payload.type === "media-ready") {
      const u = uploads.get(payload.uploadId);
      uploads.delete(payload.uploadId);
      u?.resolve?.({ sha256: payload.sha256, size: payload.size });
    }
    else if (payload.type === "media-failed") {
      const u = uploads.get(payload.uploadId);
      uploads.delete(payload.uploadId);
      u?.reject?.(new Error(payload.reason || "media"));
    }
    else if (payload.type === "media-data") {
      downloads.get(payload.sha256)?.chunks.push(Buffer.from(String(payload.data), "base64"));
    }
    else if (payload.type === "media-done") {
      const d = downloads.get(payload.sha256);
      downloads.delete(payload.sha256);
      if (d) {
        const buf = Buffer.concat(d.chunks);
        // Contrôle d'intégrité côté destinataire : l'octet reçu doit
        // correspondre à l'empreinte annoncée dans le message signé.
        const sha = crypto.createHash("sha256").update(buf).digest("hex");
        if (sha !== payload.sha256) d.waiters.forEach((w) => w.reject(new Error("integrity")));
        else d.waiters.forEach((w) => w.resolve(buf));
      }
    }
    else if (payload.type === "media-error") {
      const d = downloads.get(payload.sha256);
      downloads.delete(payload.sha256);
      d?.waiters.forEach((w) => w.reject(new Error(payload.reason || "media")));
    }
    // "read" (accusés de lecture) : à relayer vers l'UI selon les besoins
  });

  function send(text, groupId = "all", media = null, replyTo = null, demande = null) {
    // Protocole v2 : id + horodatage générés ICI puis signés — le serveur
    // vérifie la signature avec la clé publique annoncée au join. Il ne
    // peut pas générer ces champs lui-même : la signature doit couvrir
    // exactement ce que l'appareil a écrit (non-répudiation).
    const core = { id: "msg_" + crypto.randomUUID(), from: userId, text: text ?? "", ts: Date.now() };
    // Étape E — la pièce jointe entre dans le périmètre signé (5e élément
    // du noyau, voir identity.js) : elle ne peut plus être substituée sans
    // casser la signature. Un message sans pièce jointe signe exactement
    // les mêmes octets qu'avant.
    if (media?.sha256) core.mediaSha = String(media.sha256);
    // Étape G — la citation entre dans le périmètre signé, de sorte qu'une
    // réponse (« je valide ») ne puisse pas être déplacée sous une autre
    // demande. Voir signablePayload : quand une citation existe,
    // l'emplacement du média est écrit même vide.
    if (replyTo) core.replyTo = String(replyTo);
    // Étape K — demande qualifiée : l'étiquette et le destinataire désigné
    // sont scellés ensemble au rang 8. Le sceau doit être calculé sur
    // EXACTEMENT ce que l'hôte recalculera de son côté (voir demandeSeal
    // et le contrôle dans server.js), sinon la signature est rejetée.
    const tag = demande?.tag || null;
    const destinataire = demande?.destinataire || null;
    if (tag) core.demandeSha = demandeSeal(tag, destinataire);
    ws.send(encryptPayload(sessionKey, {
      v: 2,
      type: "message",
      id: core.id,
      text: core.text,
      ts: core.ts,
      groupId,
      media,
      replyTo: replyTo ? String(replyTo) : null,
      tag,
      destinataire,
      signature: identity.signMessage(core),
    }));
  }

  /** Étape K — se prononcer sur une demande. La signature EST la valeur de
   *  l'objet : « le Directeur a validé » ne vaut que prouvé. L'hôte refuse
   *  une décision non signée, et n'accepte que le destinataire désigné
   *  quand il y en a un. */
  function decider({ messageId, issue, comment = "" }) {
    const core = {
      id: "dec_" + crypto.randomUUID(), from: userId,
      text: comment ?? "", ts: Date.now(),
      demandeSha: decisionSeal(messageId, issue),
    };
    ws.send(encryptPayload(sessionKey, {
      v: 2, type: "decision", id: core.id, messageId, issue,
      comment: core.text, ts: core.ts, signature: identity.signMessage(core),
    }));
    return core.id;
  }

  // ── Étape H — votes ─────────────────────────────────────────────────
  /** Ouvre un vote. Sa définition (options + mode) est SCELLÉE dans la
   *  signature : on ne pourra pas contester après coup ce qui était
   *  proposé, ni prétendre qu'un vote nominatif ne l'était pas. */
  function openVote({ question, options, nominatif = true, groupId = "all" }) {
    const core = {
      id: "vote_" + crypto.randomUUID(), from: userId,
      text: question ?? "", ts: Date.now(),
      voteSha: voteDefinitionSeal(options, nominatif),
    };
    ws.send(encryptPayload(sessionKey, {
      v: 2, type: "vote", id: core.id, text: core.text, ts: core.ts,
      groupId, options, nominatif, signature: identity.signMessage(core),
    }));
    return core.id;
  }

  /** Répond à un vote. La réponse est signée : c'est ce qui rend une
   *  validation opposable. En mode non nominatif elle est définitive —
   *  l'hôte répond "vote-refused" à une seconde tentative. */
  function answerVote({ voteId, choice, comment = "" }) {
    const core = {
      id: "ans_" + crypto.randomUUID(), from: userId,
      text: comment ?? "", ts: Date.now(),
      voteSha: voteAnswerSeal(voteId, choice),
    };
    ws.send(encryptPayload(sessionKey, {
      v: 2, type: "vote-response", id: core.id, voteId, choice,
      comment: core.text, ts: core.ts, signature: identity.signMessage(core),
    }));
  }

  // ── Étape E — pièces jointes ────────────────────────────────────────
  // Transferts en cours, par identifiant : la réponse de l'hôte arrive de
  // façon asynchrone sur le même canal, il faut savoir à qui la rendre.
  const uploads = new Map();   // uploadId  -> { resolve, reject }
  const downloads = new Map(); // sha256    -> { chunks, resolve, reject }

  /**
   * Téléverse un fichier vers l'hôte, morceau par morceau.
   * Résout avec l'empreinte CALCULÉE PAR L'HÔTE — c'est elle qui doit
   * ensuite figurer dans le message (et donc dans la signature).
   */
  function uploadMedia({ kind, mime, buffer, thumb }, onProgress) {
    return new Promise((resolve, reject) => {
      const uploadId = "up_" + crypto.randomUUID();
      uploads.set(uploadId, { resolve, reject });
      ws.send(encryptPayload(sessionKey, {
        v: 1, type: "media-begin", uploadId, kind, mime, size: buffer.length, thumb: thumb || null,
      }));
      // L'envoi effectif attend le feu vert de l'hôte (media-go) : inutile
      // d'expédier des mégaoctets qu'il refusera.
      uploads.get(uploadId).start = () => {
        for (let off = 0, seq = 0; off < buffer.length; off += CHUNK_BYTES, seq++) {
          const part = buffer.subarray(off, Math.min(off + CHUNK_BYTES, buffer.length));
          ws.send(encryptPayload(sessionKey, {
            v: 1, type: "media-chunk", uploadId, seq, data: Buffer.from(part).toString("base64"),
          }));
          onProgress?.(Math.min(off + part.length, buffer.length), buffer.length);
        }
        ws.send(encryptPayload(sessionKey, { v: 1, type: "media-end", uploadId }));
      };
    });
  }

  /** Récupère une pièce jointe. Le contenu n'est demandé qu'à l'ouverture. */
  function fetchMedia({ sha256, mime }) {
    return new Promise((resolve, reject) => {
      const existing = downloads.get(sha256);
      if (existing) { existing.waiters.push({ resolve, reject }); return; }
      downloads.set(sha256, { chunks: [], waiters: [{ resolve, reject }] });
      ws.send(encryptPayload(sessionKey, { v: 1, type: "media-get", sha256, mime }));
    });
  }

  function markRead(messageId, groupId) {
    ws.send(encryptPayload(sessionKey, { v: 1, type: "read", messageId, groupId }));
  }

  // ✅ Étape D — commande d'administration (registre/historique/réglages).
  // Le PIN admin transite chiffré (canal AES du salon) et n'est jamais
  // stocké côté client : l'UI le demande à chaque ouverture du panneau.
  function sendAdmin({ adminPin, action, reqId, ...rest }) {
    ws.send(encryptPayload(sessionKey, { v: 1, type: "admin", adminPin, action, reqId, ...rest }));
  }

  // ✅ D.2 — invitation vers un autre salon : ciblée (to = pseudo) ou à
  // tous (to absent). room = { name, address, wsPort, httpPort, pin }.
  function sendInvite({ to = null, room }) {
    ws.send(encryptPayload(sessionKey, { v: 1, type: "invite", to, room }));
  }

  /** Demande l'annuaire du salon. La réponse arrive via onRoster. */
  function requestRoster() {
    ws.send(encryptPayload(sessionKey, { v: 1, type: "roster" }));
  }

  return {
    send,
    openVote,
    answerVote,
    decider,
    /** Étape L — jeton à glisser dans le QR « Ajouter mon mobile ». Signé
     *  par CET appareil : c'est ce qui prouve le rattachement. */
    makePairingToken: (dureeMs) => identity.makePairingToken(dureeMs),
    /** Étape M — déclare SA photo de profil, dont les octets ont déjà été
     *  téléversés. `sha256` à null la retire. */
    setAvatar(sha256) {
      ws.send(encryptPayload(sessionKey, { v: 1, type: "set-avatar", sha256: sha256 || null }));
    },
    markRead,
    requestRoster,
    sendAdmin,
    sendInvite,
    uploadMedia,
    fetchMedia,
    close: () => ws.close(),
    raw: ws, // accès direct si besoin (ex. écouter "close"/"error" côté Electron)
  };
}
