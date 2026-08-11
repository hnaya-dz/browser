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
  initStore, saveMessage, getMessagesSince, purgeOldMessages, upsertDeviceSeen, messageExists,
  getMessage, saveVoteChoice, getVoteTally, listVotes,
  listDevices, setDeviceLabel, searchMessages, getConfig, setConfig,
  createRoom, getRoom, touchRoom, setRoomAdminPin, setRoomPin,
  banDevice, unbanDevice, isBanned, listBans,
  addRoomMember, isRoomMember, setRoomLocked,
  getDevice, countDevices, getDataDir, listReferencedMedia,
  setDeviceRole, listRoster, listDirectThreads,
  retireDevice, restoreDevice,
  saveDecision, listDecisions, listDemandes, listMeetings, updateMeeting,
  personIdOf, linkDeviceToPerson, empreintesDeLaPersonne,
  setPersonAvatar, saveRead, listReads, readsForMyMessages,
} from "./store.js";
import { fingerprintFromRawPublicKey, rawFromSpkiBase64, verifyMessage,
         voteDefinitionSeal, voteAnswerSeal,
         demandeSeal, decisionSeal, meetingSeal, meetingUpdateSeal,
         verifyPairing } from "./identity.js";
import { startMobileServer } from "./mobile-server.js";
import { existsSync } from "node:fs";
import {
  createUpload, mediaPath, readChunks, purgeOrphans,
  MAX_CONCURRENT_UPLOADS, MAX_THUMB_BYTES, KINDS, sanitizeFilename,
} from "./media.js";
import { createQuota } from "./quota.js";
import { isDirectGroup, isMemberOfDirect, directMembers } from "./direct.js";

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
// ── Étape I — ce que la licence autorise, à tout instant ───────────────
// Le salon éphémère du navigateur n'a pas de licence : `licenceState` est
// absent et TOUT est permis. Le serveur permanent (serve.js) passe une
// fonction, réévaluée à chaque envoi — c'est ce qui rend l'échéance
// opposable à un serveur qui tourne depuis des mois sans redémarrer.
//
// En lecture seule, on ne bloque pas type par type mais par LISTE BLANCHE :
// un type d'envoi ajouté plus tard sera refusé par défaut au lieu de passer
// silencieusement. Lire, chercher et administrer restent toujours possibles.
const TYPES_EN_LECTURE_SEULE = new Set(["join", "read", "media-get", "roster", "admin"]);

// ── Étape K — vocabulaire des demandes qualifiées ──────────────────────
// Quatre natures d'envoi, et trois issues. Ce sont les termes du circuit
// administratif validés par l'utilisateur ; ils ne sont PAS libres, sinon
// deux services écriraient « validé » et « validée » et rien ne serait
// comparable. « info » n'attend aucune réponse — le serveur refuse toute
// décision sur un message ainsi étiqueté.
const TAGS = new Set(["info", "avis", "validation", "approbation"]);
const ISSUES = new Set(["valide", "refuse", "reserve"]);

export function startHost({ sessionName = null, pin, adminPin, roomId, dataDir, wsPort = WS_PORT, httpPort, onError, maxDevices = null, licenceState = null } = {}) {
  const etatLicence = () => {
    if (!licenceState) return { mode: "active", notice: null };
    try { return licenceState() || { mode: "active", notice: null }; }
    catch { return { mode: "active", notice: null }; } // jamais de panne de licence
  };
  // ⚠️ Indexé par CONNEXION (l'objet ws), surtout pas par pseudo.
  // « Ajouter mon mobile » fait rejoindre le téléphone sous le MÊME pseudo
  // que le poste (paramètre ?u= du QR — c'est tout l'intérêt : ne pas
  // inventer un second nom). Avec un index par pseudo, la connexion du
  // téléphone écrasait celle du poste : le poste restait ouvert mais
  // sortait de la table, donc de toute rediffusion. Il devenait sourd à
  // TOUT — y compris aux messages des autres — et le restait même après
  // le départ du téléphone, dont la fermeture supprimait l'entrée.
  // Constaté en usage réel ; test de non-régression : test-meme-pseudo.
  const clients = new Map(); // ws -> { ws, userId, groups, device }
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
  // Répertoire réel (l'appelant peut n'avoir rien précisé) — c'est là que
  // les pièces jointes sont écrites, à côté de la base.
  const mediaRoot = getDataDir();
  // Quota de téléversement par appareil — voir src/quota.js. Vit au niveau
  // du salon (et non de la connexion) : se reconnecter ne remet pas les
  // compteurs à zéro.
  const uploadQuota = createQuota();
  // Étape L — nonces d'appairage déjà servis, avec leur échéance. En
  // mémoire et non en base : un jeton vit quelques minutes, et un
  // redémarrage de l'hôte périme de toute façon tous ceux en circulation.
  const jetonsUtilises = new Map(); // "fp:nonce" -> exp
  const roomPin = room.roomPin || (pin ?? generatePin());
  let currentAdminPin = room.adminPin;
  const sessionKey = deriveKeyFromPin(roomPin);
  sessionName = room.name;

  // maxPayload : plafond DUR sur une trame WebSocket. Sans lui, ws accepte
  // jusqu'à 100 Mio par trame — un poste du réseau pourrait saturer la
  // mémoire de l'hôte d'un seul envoi. Les pièces jointes voyagent en
  // morceaux de 64 Ko (voir src/media.js), largement sous ce plafond.
  const wss = new WebSocketServer({ port: wsPort, maxPayload: 1024 * 1024 });
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

  // Étape E — le serveur ne relaie QUE des champs connus (même règle que
  // pour les invitations) et refuse une pièce jointe dont le fichier n'a
  // pas réellement été reçu : un client ne peut pas fabriquer un message
  // qui pointe vers un contenu inexistant ou vers autre chose que ce qu'il
  // a téléversé.
  const sanitizeMedia = (m) => {
    if (!m || typeof m !== "object") return null;
    const sha = String(m.sha256 || "");
    const mime = String(m.mime || "");
    const kind = String(m.kind || "");
    let filePath;
    try { filePath = mediaPath(mediaRoot, sha, mime); } catch { return null; }
    if (!existsSync(filePath)) return null;
    if (!KINDS.has(kind)) return null;
    const thumb = typeof m.thumb === "string" && Buffer.byteLength(m.thumb, "utf8") <= MAX_THUMB_BYTES
      ? m.thumb : null;
    // Le nom d'origine est conservé pour TOUS les types, y compris les
    // images : sans lui, le destinataire n'avait à l'enregistrement qu'une
    // empreinte tronquée, sans extension — un fichier que Windows refuse
    // d'ouvrir. Nettoyé, car il vient du réseau, et il ne sert JAMAIS à
    // construire un chemin côté hôte (le fichier est nommé d'après son
    // empreinte, voir mediaPath).
    const out = {
      kind, mime, sha256: sha, size: Number(m.size) || 0, thumb,
      name: sanitizeFilename(m.name),
    };
    if (kind === "image") {
      out.w = Number.isFinite(Number(m.w)) ? Math.max(0, Math.round(Number(m.w))) : null;
      out.h = Number.isFinite(Number(m.h)) ? Math.max(0, Math.round(Number(m.h))) : null;
    } else if (kind === "voice") {
      out.duration = Number.isFinite(Number(m.duration)) ? Math.max(0, Math.round(Number(m.duration))) : null;
    }
    return out;
  };

  wss.on("connection", (ws, req) => {
    let userId = null;
    const remoteIp = req?.socket?.remoteAddress || null;
    ws.isAlive = true;
    // Transferts de pièces jointes en cours sur CETTE connexion. Liés à
    // la connexion (et non globaux) : une déconnexion abandonne proprement
    // ses transferts, et un poste ne peut pas en ouvrir un nombre illimité.
    const uploads = new Map();
    ws.on("close", () => { for (const u of uploads.values()) u.abort(); uploads.clear(); });
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
            // Plafond de licence (mode serveur permanent uniquement) :
            // un appareil DÉJÀ connu repasse toujours ; seul un appareil
            // NOUVEAU au-delà du plafond est refusé — le contrôle précède
            // l'inscription au registre pour ne pas le gonfler au passage.
            // (Les clients v1 sans identité ne sont pas comptables ; un
            // déploiement sous licence utilise des salons verrouillés,
            // qui les refusent déjà — voir code 4005.)
            //
            // ⚠️ Un appareil RETIRÉ par l'admin compte comme nouveau : sa
            // fiche existe encore (on garde sa clé publique) mais sa place
            // a été rendue. Tester la seule présence de la fiche le
            // laisserait rentrer gratuitement, plafond atteint ou non.
            const connu = getDevice(fingerprint);
            if (maxDevices !== null && (!connu || connu.retiredAt) && countDevices() >= maxDevices) {
              ws.close(4006, "licence-device-limit");
              return;
            }
            device = { fingerprint, publicKeySpki: payload.device.publicKey };
            upsertDeviceSeen({
              fingerprint,
              publicKeySpki: payload.device.publicKey,
              nickname: userId,
              hostname: payload.device.hostname || null,
              platform: payload.device.platform || null,
              ip: remoteIp,
            });

            // ── Étape L — appairage d'un second appareil ──────────────
            // Le jeton est signé par un appareil DÉJÀ connu de l'hôte. On
            // ne rattache donc jamais sur simple déclaration : c'est ce qui
            // empêche un inconnu de se présenter comme le second appareil
            // du Directeur et de valider à sa place.
            //
            // ⚠️ Le jeton ne peut pas couvrir la clé du nouvel appareil :
            // elle n'existe pas encore quand l'ancien signe. Un jeton
            // intercepté serait donc utilisable par un autre appareil. Trois
            // garde-fous : il expire en quelques minutes, il ne sert qu'une
            // fois, et il ne suffit pas — le PIN du salon reste exigé, et le
            // QR ne le contient pas. Le rattachement est en outre horodaté
            // et attribué (pairedBy) dans le registre : un appairage abusif
            // se voit après coup.
            const jeton = payload.pairing;
            if (jeton && jeton.fp && jeton.sig) {
              const cle = String(jeton.fp) + ":" + String(jeton.nonce);
              const source = getDevice(String(jeton.fp));
              const expire = Number(jeton.exp) || 0;
              if (!source) { /* signataire inconnu : on ignore, on n'échoue pas */ }
              else if (expire < Date.now()) { /* périmé */ }
              else if (jetonsUtilises.has(cle)) { /* déjà servi */ }
              else if (!isRoomMember(activeRoomId, source.fingerprint)) { /* pas de ce salon */ }
              else if (source.fingerprint === fingerprint) { /* déjà cet appareil */ }
              else if (verifyPairing(jeton, source.publicKeySpki)) {
                linkDeviceToPerson(fingerprint, personIdOf(source.fingerprint), source.fingerprint);
                jetonsUtilises.set(cle, expire);
                // Prévenir l'appareil qui a autorisé : détecter vaut mieux
                // que prévenir quand on ne peut pas tout prévenir.
                for (const c of clients.values()) {
                  if (c.device?.fingerprint === source.fingerprint) {
                    c.ws.send(encryptPayload(sessionKey, {
                      v: 1, type: "device-paired", fingerprint, nickname: userId,
                    }));
                  }
                }
              }
            }
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
        clients.set(ws, { ws, userId, groups: payload.groups || ["all"], device });

        // Renvoie les messages manqués depuis la dernière connexion
        const since = payload.lastSeenTs || 0;
        // ⚠️ Étape F — un client demande les groupes qu'il veut relire. Un
        // fil privé n'est servi QUE si son empreinte y figure : sans ce
        // filtre, n'importe qui pouvait réclamer l'historique de deux
        // collègues en devinant l'identifiant du fil.
        const demandes = (payload.groups || ["all"]).filter((g) =>
          !isDirectGroup(g) || (device && isMemberOfDirect(g, device.fingerprint)));
        // Ses fils privés sont AJOUTÉS d'office : l'appareil n'a pas à
        // savoir d'avance dans quels fils on lui a écrit pendant son
        // absence. Le filtre ci-dessus reste la garantie qu'aucun fil
        // étranger ne se glisse dans la demande.
        if (device) {
          for (const g of listDirectThreads(activeRoomId, device.fingerprint)) {
            if (!demandes.includes(g)) demandes.push(g);
          }
        }
        const missed = demandes.flatMap((g) => getMessagesSince(g, since, activeRoomId));

        // ── Étape P — les réunions À VENIR repassent TOUJOURS ─────────
        // Même piège que le dépouillement d'un vote et que les décisions,
        // sous une autre forme : une réunion annoncée hier est plus
        // ancienne que `since`, donc absente du rattrapage. Elle
        // disparaissait de l'épinglage dès qu'on quittait le salon et
        // qu'on y revenait — et, comme c'est son arrivée qui programme le
        // rappel, le rappel disparaissait avec elle. Constaté en test
        // réel : l'utilisateur a fait le lien entre les deux avant moi.
        // On les rejoue tant qu'elles ne sont pas terminées ; la
        // déduplication par identifiant côté client évite le doublon
        // quand elles figurent déjà dans le rattrapage.
        const dejaLa = new Set(missed.map((m) => m.id));
        for (const r of listMeetings(activeRoomId, demandes)) {
          if (!dejaLa.has(r.id)) missed.push(r);
        }
        missed.sort((a, b) => Number(a.ts) - Number(b.ts));
        ws.send(encryptPayload(sessionKey, { v: 1, type: "backlog", messages: missed }));

        // ⚠️ Le dépouillement ne voyage PAS avec les messages : il n'est
        // rediffusé qu'à chaque réponse. Un client n'en recevait donc aucun
        // en arrivant et voyait tous les votes à zéro jusqu'à ce que
        // quelqu'un vote à nouveau.
        //
        // On les envoie ici pour TOUS les votes du salon, et surtout PAS
        // seulement pour ceux du rattrapage : une RECONNEXION ne redemande
        // que les messages postérieurs à `lastSeenTs`, donc le vote n'y
        // figure plus alors que sa carte est toujours à l'écran. C'est le
        // cas que le premier correctif laissait passer — constaté en test
        // réel sur un mobile qui se reconnecte.
        for (const v of listVotes(activeRoomId, demandes)) {
          ws.send(encryptPayload(sessionKey, {
            v: 1, type: "vote-tally", voteId: v.id, groupId: v.groupId,
            ...getVoteTally(v.id),
          }));
        }

        // ── Étape K — issues des demandes qualifiées ──────────────────
        // Même raison, même piège que pour le dépouillement des votes :
        // une décision ne voyage pas avec les messages. Sans ce rejeu, un
        // arrivant — ou une reconnexion, qui ne redemande que les messages
        // récents — verrait « Validation demandée au Directeur » sans
        // jamais savoir qu'il a répondu.
        for (const d of listDemandes(activeRoomId, demandes)) {
          const decisions = listDecisions(d.id);
          if (!decisions.length) continue;
          ws.send(encryptPayload(sessionKey, {
            v: 1, type: "decisions", messageId: d.id, groupId: d.groupId, decisions,
          }));
        }

        // ── Étape N — qui a lu MES messages ───────────────────────────
        // Rejoué à la connexion, sinon fermer le dock effaçait tout et
        // l'expéditeur ne savait plus jamais qui l'avait lu. Uniquement
        // SES messages : rejouer les accusés de tout le salon serait
        // inutile et indiscret.
        if (device) {
          for (const e of readsForMyMessages(activeRoomId, demandes,
                                             empreintesDeLaPersonne(device.fingerprint))) {
            ws.send(encryptPayload(sessionKey, {
              v: 1, type: "reads", messageId: e.messageId, reads: e.reads,
            }));
          }
        }

        // État de la licence dès l'arrivée : un utilisateur doit voir le
        // bandeau AVANT de composer un message, pas découvrir le refus
        // après avoir tapé.
        envoyerEtatLicence(ws);

        broadcastPresence();
        return;
      }

      // ── Étape I — échéance de licence opposable ──────────────────────
      // Passé le délai de grâce, le salon devient muet : on refuse l'envoi
      // et on RÉPOND pourquoi. Un refus silencieux laisserait croire à une
      // panne réseau et ferait appeler l'informaticien, pas Hnaya DZ.
      if (!TYPES_EN_LECTURE_SEULE.has(payload.type)) {
        const etat = etatLicence();
        if (etat.mode === "readonly") {
          ws.send(encryptPayload(sessionKey, {
            v: 1, type: "licence-notice", mode: "readonly",
            readOnly: true, notice: etat.notice, refused: payload.type,
          }));
          return;
        }
      }

      if (payload.type === "message") {
        const now = Date.now();
        const device = clients.get(ws)?.device || null;
        // ⚠️ Étape F — écrire dans un fil privé exige d'y appartenir. Sans
        // ce contrôle, un tiers pouvait déposer un message dans la
        // conversation de deux collègues (elle lui serait restée invisible,
        // mais eux l'auraient vu arriver).
        if (isDirectGroup(payload.groupId)
            && !(device && isMemberOfDirect(payload.groupId, device.fingerprint))) {
          return;
        }
        let msg;

        if (payload.signature && payload.id && payload.ts && device) {
          // ── Protocole v2 : message signé par l'appareil ──
          // La signature couvre (id, from, text, ts) tels qu'écrits par le
          // client. Horodatage trop dérivé → on garde le message (horodaté
          // serveur) mais signatureValid=false : pas d'antidatage signé.
          const core = { id: String(payload.id), from: userId, text: payload.text ?? "", ts: Number(payload.ts) };
          // Étape E — la pièce jointe entre dans le périmètre signé : son
          // empreinte est ajoutée au noyau signable quand il y en a une.
          // Sans cela, la signature ne couvrait que le texte et une image
          // pouvait être substituée après coup sans la casser.
          if (payload.media?.sha256) core.mediaSha = String(payload.media.sha256);
          // Étape G — la citation entre elle aussi dans le périmètre signé :
          // déplacer un « je valide » sous une autre demande doit casser la
          // signature. On n'accepte qu'un identifiant de message existant
          // DANS CE SALON : citer un message d'un autre salon révélerait
          // son existence à qui n'y a pas accès.
          const cite = payload.replyTo ? String(payload.replyTo) : null;
          if (cite && messageExists(cite, activeRoomId)) core.replyTo = cite;
          // Étape K — demande qualifiée. L'étiquette et le destinataire
          // désigné sont scellés ensemble (rang 8) : ni l'une ni l'autre ne
          // peut être modifiée après signature. Un destinataire inconnu du
          // salon est ramené à « personne en particulier » plutôt que
          // conservé tel quel — sinon on désignerait un fantôme que
          // personne ne pourrait lever.
          const etiquette = TAGS.has(String(payload.tag)) ? String(payload.tag) : null;
          const vise = etiquette && /^[0-9a-f]{16}$/.test(String(payload.destinataire || ""))
            && isRoomMember(activeRoomId, String(payload.destinataire))
            ? String(payload.destinataire) : null;
          if (etiquette) core.demandeSha = demandeSeal(etiquette, vise);
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
            media: sanitizeMedia(payload.media),
            replyTo: core.replyTo || null,
            // L'étiquette n'est conservée que si la signature tient : une
            // demande de validation non signée n'engage personne, et la
            // laisser passer donnerait une apparence d'officialité à un
            // message dont on ne peut pas prouver l'auteur.
            tag: verified ? etiquette : null,
            destinataire: verified ? vise : null,
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
            // Étape E — les pièces jointes existent désormais (transfert
            // par morceaux, fichier chez l'hôte : voir src/media.js). Un
            // client v1 n'en produit pas, mais le filtre s'applique quand
            // même : rien n'entre sans passer par sanitizeMedia.
            media: sanitizeMedia(payload.media),
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
          // Le destinataire est désigné par son PSEUDO, mais la table est
          // indexée par connexion : une personne présente sur son poste ET
          // son téléphone a deux entrées. On sert les deux — l'invitation
          // doit arriver là où elle regarde, pas sur un seul de ses écrans.
          const dest = String(payload.to);
          const cibles = [...clients.values()].filter((c) => c.userId === dest);
          for (const t of cibles) t.ws.send(encryptPayload(sessionKey, inv));
          // accusé à l'expéditeur (le destinataire peut être déconnecté)
          ws.send(encryptPayload(sessionKey, { v: 1, type: "invite-sent", to: dest, delivered: cibles.length > 0 }));
        } else {
          if (!saveMessage(inv).inserted) return;
          broadcastToGroup(inv.groupId, inv);
        }
        return;
      }

      // ── Étape H — ouverture d'un vote ────────────────────────────
      // Un vote EST un message (même table, même historique, même
      // signature) : il porte simplement type "vote" et sa définition
      // dans extra. Sa définition est scellée dans la signature, sinon
      // on pourrait contester après coup les options proposées ou
      // prétendre qu'un vote nominatif ne l'était pas.
      if (payload.type === "vote") {
        // `device` est local à chaque branche (voir la branche "message") :
        // on le relit depuis la table des clients, indexée par connexion.
        const device = clients.get(ws)?.device || null;
        if (!userId || !device) return;
        const options = Array.isArray(payload.options)
          ? payload.options.slice(0, 6).map((o) => String(o).slice(0, 40)).filter(Boolean)
          : [];
        if (options.length < 2) return; // un vote à une seule issue n'en est pas un
        const nominatif = payload.nominatif !== false;
        const core = {
          id: String(payload.id), from: userId,
          text: String(payload.text ?? "").slice(0, 500), ts: Number(payload.ts),
          voteSha: voteDefinitionSeal(options, nominatif),
        };
        const verified = verifyMessage(core, payload.signature, device.publicKeySpki);
        const driftOk = Math.abs(Date.now() - core.ts) <= MAX_CLOCK_DRIFT_MS;
        const msg = {
          v: 1, type: "vote", id: core.id, roomId: activeRoomId,
          groupId: payload.groupId || "all", from: userId, text: core.text,
          extra: { options, nominatif },
          ts: driftOk ? core.ts : Date.now(),
          deviceFp: device.fingerprint,
          signature: payload.signature,
          signatureValid: verified && driftOk,
        };
        if (!saveMessage(msg).inserted) return;
        broadcastToGroup(msg.groupId, msg);
        return;
      }

      // ── Étape H — réponse à un vote ──────────────────────────────
      // La réponse n'est PAS un message : elle ne s'affiche pas dans le
      // fil, elle alimente un dépouillement. Elle est néanmoins signée —
      // c'est ce qui rend une validation opposable.
      if (payload.type === "vote-response") {
        const device = clients.get(ws)?.device || null;
        if (!userId || !device) return;
        const voteId = String(payload.voteId || "");
        const choice = Number(payload.choice);
        const vote = getMessage(voteId, activeRoomId);
        // Le vote doit exister DANS CE SALON : répondre à un vote d'un
        // autre salon en révélerait l'existence.
        if (!vote || vote.type !== "vote") return;
        const options = vote.extra?.options || [];
        if (!Number.isInteger(choice) || choice < 0 || choice >= options.length) return;

        const core = {
          id: String(payload.id), from: userId,
          text: String(payload.comment ?? "").slice(0, 300), ts: Number(payload.ts),
          voteSha: voteAnswerSeal(voteId, choice),
        };
        if (!verifyMessage(core, payload.signature, device.publicKeySpki)) return;

        const accepte = saveVoteChoice({
          voteId, choice, comment: core.text || null,
          fingerprint: device.fingerprint, sender: userId,
          nominatif: vote.extra?.nominatif !== false, ts: Date.now(),
        });
        // Refus = second vote non nominatif. On le dit à l'intéressé
        // plutôt que de l'ignorer : sinon il croit avoir voté deux fois.
        if (!accepte) {
          ws.send(encryptPayload(sessionKey, {
            v: 1, type: "vote-refused", voteId, reason: "deja-vote",
          }));
          return;
        }
        broadcastToGroup(vote.groupId, {
          v: 1, type: "vote-tally", voteId,
          groupId: vote.groupId,
          ...getVoteTally(voteId),
        });
        return;
      }

      // ── Étape P — annoncer une réunion ───────────────────────────
      // Une réunion EST un message (même table, même historique, même
      // signature), avec sa définition dans extra. L'heure et la durée
      // sont scellées : une réunion déplaçable après signature ne vaudrait
      // pas mieux qu'un message libre, et le .ics exporté porterait une
      // heure que personne n'a annoncée.
      if (payload.type === "meeting") {
        const device = clients.get(ws)?.device || null;
        if (!userId || !device) return;
        const titre = String(payload.title ?? "").slice(0, 120).trim();
        const debut = Number(payload.startsAt);
        const duree = Number(payload.durationMin);
        if (!titre || !Number.isFinite(debut)) return;
        // ⚠️ On REFUSE une durée hors bornes, on ne la corrige PAS. La
        // durée fait partie du sceau signé : la ramener à 5 minutes ici
        // produirait un sceau différent de celui que le client a signé, et
        // la réunion serait rejetée à l'étape suivante — silencieusement,
        // sans que rien n'explique pourquoi elle n'est jamais partie.
        // Un serveur ne réécrit jamais ce qui est signé.
        if (!Number.isFinite(duree) || duree < 5 || duree > 24 * 60) return;
        // Une réunion dans le passé n'a rien à épingler. On tolère une
        // heure toute proche (quelqu'un annonce « dans cinq minutes »)
        // mais pas une antidatée.
        if (debut < Date.now() - 60000) return;

        const core = {
          id: String(payload.id), from: userId,
          text: String(payload.text ?? "").slice(0, 500), ts: Number(payload.ts),
          demandeSha: meetingSeal(titre, debut, duree),
        };
        const verified = verifyMessage(core, payload.signature, device.publicKeySpki);
        // Non signée, une convocation n'engage personne : on la refuse
        // plutôt que de l'épingler en tête du salon avec l'autorité que
        // cette place confère.
        if (!verified) return;
        const driftOk = Math.abs(Date.now() - core.ts) <= MAX_CLOCK_DRIFT_MS;
        const msg = {
          v: 1, type: "meeting", id: core.id, roomId: activeRoomId,
          groupId: payload.groupId || "all", from: userId, text: core.text,
          extra: {
            title: titre, startsAt: debut, durationMin: duree,
            location: String(payload.location ?? "").slice(0, 120) || null,
          },
          ts: driftOk ? core.ts : Date.now(),
          deviceFp: device.fingerprint,
          signature: payload.signature,
          signatureValid: true,
        };
        if (!saveMessage(msg).inserted) return;
        broadcastToGroup(msg.groupId, msg);
        return;
      }

      // ── Étape R — décaler ou annuler une réunion ─────────────────
      // En entreprise, une réunion se déplace ou tombe plus souvent
      // qu'elle ne se tient telle qu'annoncée. On ne réécrit jamais la
      // convocation d'origine — son heure est scellée dans sa signature —
      // on publie une mise à jour signée qui la remplace, et l'annonce
      // initiale reste dans l'historique.
      if (payload.type === "meeting-update") {
        const device = clients.get(ws)?.device || null;
        if (!userId || !device) return;
        const cible = getMessage(String(payload.messageId || ""), activeRoomId);
        if (!cible || cible.type !== "meeting") return;

        // ⚠️ SEUL L'ORGANISATEUR déplace ou annule, et l'on compare des
        // PERSONNES : il doit pouvoir le faire depuis son téléphone
        // appairé aussi bien que depuis son poste.
        if (!empreintesDeLaPersonne(device.fingerprint).includes(cible.deviceFp)) {
          ws.send(encryptPayload(sessionKey, {
            v: 1, type: "meeting-update-refused", messageId: cible.id, reason: "pas-organisateur",
          }));
          return;
        }

        const action = String(payload.action || "");
        if (action !== "cancelled" && action !== "moved") return;
        let debut = null, duree = null;
        if (action === "moved") {
          debut = Number(payload.startsAt);
          duree = Number(payload.durationMin);
          if (!Number.isFinite(debut) || debut < Date.now() - 60000) return;
          // Même règle que pour l'annonce : une durée hors bornes est
          // REFUSÉE, jamais corrigée — la corriger casserait le sceau.
          if (!Number.isFinite(duree) || duree < 5 || duree > 24 * 60) return;
        }

        const core = {
          id: String(payload.id), from: userId,
          text: String(payload.reason ?? "").slice(0, 300), ts: Number(payload.ts),
          demandeSha: meetingUpdateSeal(cible.id, action, debut || 0, duree || 0),
        };
        // Non signée, une annulation n'engage personne — et elle ferait
        // manquer une réunion qui a bien lieu. On refuse.
        if (!verifyMessage(core, payload.signature, device.publicKeySpki)) return;

        updateMeeting({
          messageId: cible.id, status: action,
          newStartsAt: debut, newDurationMin: duree, par: userId,
        });
        broadcastToGroup(cible.groupId, {
          v: 1, type: "meeting-updated", messageId: cible.id, groupId: cible.groupId,
          status: action, startsAt: debut, durationMin: duree,
          par: userId, ts: Date.now(), reason: core.text || null,
        });
        return;
      }

      // ── Étape K — décision sur une demande qualifiée ─────────────
      // Une demande de validation n'a d'intérêt que si son issue est
      // publique : dans l'exemple qui a motivé la fonction, un chargé de
      // projet demande la validation du Directeur, et TOUTE l'équipe doit
      // savoir s'il a validé. La décision est donc diffusée au fil entier,
      // pas seulement au demandeur.
      if (payload.type === "decision") {
        const device = clients.get(ws)?.device || null;
        if (!userId || !device) return;
        const messageId = String(payload.messageId || "");
        const issue = String(payload.issue || "");
        if (!ISSUES.has(issue)) return;
        const cible = getMessage(messageId, activeRoomId);
        // La demande doit exister DANS CE SALON : répondre à une demande
        // d'un autre salon en révélerait l'existence.
        if (!cible || !cible.tag) return;
        // « Pour info » n'attend aucune réponse : accepter une décision
        // dessus laisserait fabriquer une approbation là où personne n'en
        // avait demandé.
        if (cible.tag === "info") return;
        // ⚠️ Quand un destinataire est DÉSIGNÉ, lui seul décide. C'est
        // toute l'exigence : aucune confusion sur qui valide. Sans
        // destinataire, la demande s'adresse au fil et chacun peut se
        // prononcer — son nom reste attaché à sa décision.
        // Étape L — le destinataire est une PERSONNE : le Directeur désigné
        // sur son poste doit pouvoir répondre depuis son téléphone appairé.
        // Comparer les seules empreintes lui aurait refusé sa propre demande.
        if (cible.destinataire
            && !empreintesDeLaPersonne(device.fingerprint).includes(cible.destinataire)) {
          ws.send(encryptPayload(sessionKey, {
            v: 1, type: "decision-refused", messageId, reason: "pas-destinataire",
          }));
          return;
        }
        // Écrire dans un fil privé exige d'y appartenir — même règle que
        // pour les messages.
        if (isDirectGroup(cible.groupId) && !isMemberOfDirect(cible.groupId, device.fingerprint)) return;

        const core = {
          id: String(payload.id), from: userId,
          text: String(payload.comment ?? "").slice(0, 300), ts: Number(payload.ts),
          demandeSha: decisionSeal(messageId, issue),
        };
        // Une décision NON signée n'est pas enregistrée du tout. Ailleurs
        // on accepte un message non signé en le marquant ; ici la
        // signature EST la valeur de l'objet — « le Directeur a validé »
        // sans preuve ne vaut pas mieux que rien.
        if (!verifyMessage(core, payload.signature, device.publicKeySpki)) return;

        saveDecision({
          messageId, fingerprint: device.fingerprint, sender: userId,
          issue, comment: core.text || null, ts: Date.now(),
          signature: payload.signature,
        });
        broadcastToGroup(cible.groupId, {
          v: 1, type: "decisions", messageId, groupId: cible.groupId,
          decisions: listDecisions(messageId),
        });
        return;
      }

      // ── Étape N — accusé de lecture ──────────────────────────────
      // Le type existait depuis longtemps, diffusé sans être enregistré ni
      // affiché par personne. Il est maintenant persisté et rediffusé sous
      // forme agrégée : l'expéditeur veut savoir QUI a lu, pas recevoir un
      // événement par lecteur et recomposer la liste lui-même.
      if (payload.type === "read") {
        const device = clients.get(ws)?.device || null;
        if (!device) return;
        const messageId = String(payload.messageId || "");
        const cible = getMessage(messageId, activeRoomId);
        // Le message doit exister DANS CE SALON : accuser réception d'un
        // message d'ailleurs en révélerait l'existence.
        if (!cible) return;
        // Écrire dans un fil privé exige d'y appartenir — même règle que
        // partout ailleurs.
        if (isDirectGroup(cible.groupId) && !isMemberOfDirect(cible.groupId, device.fingerprint)) return;
        // On n'accuse pas réception de ses PROPRES messages : « vu par
        // moi-même » n'apprend rien et gonflerait la liste.
        if (empreintesDeLaPersonne(device.fingerprint).includes(cible.deviceFp)) return;

        saveRead({
          messageId, personId: personIdOf(device.fingerprint),
          sender: userId, ts: Date.now(),
        });
        broadcastToGroup(cible.groupId, {
          v: 1, type: "reads", messageId, groupId: cible.groupId,
          reads: listReads(messageId),
        });
        return;
      }

      // ═══ Étape E — PIÈCES JOINTES ═══════════════════════════════════
      // Le fichier ne transite JAMAIS dans le message : il monte à part,
      // en morceaux, sur ce même canal chiffré. Le message qui suivra ne
      // portera que des métadonnées + une vignette minuscule. Sans cela,
      // l'historique renvoyé à chaque connexion recharrierait toutes les
      // images du salon.
      const sendTo = (obj) => { try { ws.send(encryptPayload(sessionKey, obj)); } catch { /* connexion fermée */ } };

      if (payload.type === "media-begin") {
        if (!userId) return; // pas encore identifié
        if (uploads.size >= MAX_CONCURRENT_UPLOADS) {
          sendTo({ v: 1, type: "media-failed", uploadId: payload.uploadId, reason: "busy" });
          return;
        }
        // Quota horaire : contrôlé sur la taille ANNONCÉE, donc avant le
        // moindre octet écrit sur le disque. La clé est l'empreinte de
        // l'appareil quand elle existe (stable, contrairement au pseudo).
        const quotaKey = clients.get(ws)?.device?.fingerprint || `user:${userId}`;
        const refus = uploadQuota.check(quotaKey, Number(payload.size) || 0);
        if (refus) {
          sendTo({ v: 1, type: "media-failed", uploadId: payload.uploadId, reason: refus });
          return;
        }
        try {
          uploads.set(String(payload.uploadId), createUpload({
            dataDir: mediaRoot,
            kind: payload.kind,
            mime: payload.mime,
            size: Number(payload.size),
            thumb: payload.thumb,
          }));
          sendTo({ v: 1, type: "media-go", uploadId: payload.uploadId });
        } catch (e) {
          sendTo({ v: 1, type: "media-failed", uploadId: payload.uploadId, reason: e.message });
        }
        return;
      }

      if (payload.type === "media-chunk") {
        const up = uploads.get(String(payload.uploadId));
        if (!up) return;
        try {
          up.write(Buffer.from(String(payload.data), "base64"));
        } catch (e) {
          uploads.delete(String(payload.uploadId));
          sendTo({ v: 1, type: "media-failed", uploadId: payload.uploadId, reason: e.message });
        }
        return;
      }

      if (payload.type === "media-end") {
        const up = uploads.get(String(payload.uploadId));
        if (!up) return;
        uploads.delete(String(payload.uploadId));
        try {
          const res = up.finish();
          uploadQuota.record(
            clients.get(ws)?.device?.fingerprint || `user:${userId}`,
            res.size,
          );
          // L'empreinte est celle CALCULÉE par l'hôte sur les octets reçus,
          // jamais celle annoncée par le client : c'est elle qui scellera
          // la signature du message.
          sendTo({ v: 1, type: "media-ready", uploadId: payload.uploadId, sha256: res.sha256, size: res.size });
        } catch (e) {
          sendTo({ v: 1, type: "media-failed", uploadId: payload.uploadId, reason: e.message });
        }
        return;
      }

      // Téléchargement à la demande : le destinataire ne récupère le
      // fichier que s'il ouvre la pièce jointe.
      if (payload.type === "media-get") {
        if (!userId) return;
        const sha = String(payload.sha256 || "");
        const mime = String(payload.mime || "");
        let filePath;
        try { filePath = mediaPath(mediaRoot, sha, mime); }
        catch { sendTo({ v: 1, type: "media-error", sha256: sha, reason: "invalid" }); return; }
        if (!existsSync(filePath)) {
          // Purge de rétention passée par là, ou fichier jamais reçu.
          sendTo({ v: 1, type: "media-error", sha256: sha, reason: "gone" });
          return;
        }
        try {
          for (const { seq, data } of readChunks(filePath)) {
            sendTo({ v: 1, type: "media-data", sha256: sha, seq, data: data.toString("base64") });
          }
          sendTo({ v: 1, type: "media-done", sha256: sha });
        } catch {
          sendTo({ v: 1, type: "media-error", sha256: sha, reason: "read" });
        }
        return;
      }

      // ═══ Étape F — ANNUAIRE ═══════════════════════════════════════
      // Accessible à TOUS les membres du salon, contrairement aux
      // commandes d'administration : chacun doit pouvoir voir qui existe
      // pour lui écrire. Ne révèle que ce qui est nécessaire à cela —
      // ni IP, ni machine, ni empreinte d'appareil autre que la sienne.
      // ── Étape M — déposer ou retirer SA photo de profil ──────────
      // On ne change que la sienne : `personIdOf` part de l'appareil
      // connecté, jamais d'un identifiant fourni par le réseau. Sans cela,
      // n'importe qui remplacerait la photo du Directeur.
      if (payload.type === "set-avatar") {
        const device = clients.get(ws)?.device || null;
        if (!device) return;
        const sha = payload.sha256 ? String(payload.sha256) : null;
        if (sha) {
          // Le fichier doit avoir été RÉELLEMENT téléversé : même règle que
          // pour une pièce jointe, on ne référence pas un contenu absent.
          // JPEG imposé : une photo de profil est réencodée par le client
          // (jamais le fichier d'origine — on ne sert pas des octets qu'on
          // n'a pas fabriqués), et en JPEG elle pèse cinq fois moins qu'en
          // PNG pour un carré de 128 px.
          let chemin;
          try { chemin = mediaPath(mediaRoot, sha, "image/jpeg"); } catch { return; }
          if (!existsSync(chemin)) return;
        }
        setPersonAvatar(personIdOf(device.fingerprint), sha);
        // Tout le salon voit le changement : un annuaire à jour chez les
        // uns et périmé chez les autres serait pire que pas de photo.
        for (const c of clients.values()) {
          try { c.ws.send(encryptPayload(sessionKey, { v: 1, type: "avatars-changed" })); } catch {}
        }
        return;
      }

      if (payload.type === "roster") {
        if (!userId) return;
        const enLigne = new Set(
          [...clients.values()].map((c) => c.device?.fingerprint).filter(Boolean),
        );
        const moi = clients.get(ws)?.device?.fingerprint || null;
        // Étape L — une entrée par PERSONNE. Elle est en ligne dès qu'un
        // quelconque de ses appareils l'est : sinon le Directeur, connecté
        // depuis son téléphone, apparaîtrait absent parce que son poste est
        // éteint. Même raisonnement pour « c'est moi ».
        const gens = listRoster(activeRoomId).map((d) => ({
          fingerprint: d.fingerprint,
          name: d.lastNickname || null,
          role: d.role || null,
          online: d.appareils.some((f) => enLigne.has(f)),
          lastSeen: Number(d.lastSeen) || 0,
          isMe: !!moi && d.appareils.includes(moi),
          // Étape L — identifiant de personne : c'est de lui que le client
          // tire la couleur de l'avatar. Le pseudo ne conviendrait pas —
          // corriger une faute dans son nom changerait sa couleur.
          personId: d.personId || d.fingerprint,
          // Étape M — l'EMPREINTE de la photo, pas la photo : le client va
          // la chercher une fois par le canal des pièces jointes, puis la
          // garde. Un annuaire qui transporterait les images repasserait
          // plusieurs centaines de kilooctets à chaque changement de
          // présence, plusieurs fois par minute.
          avatarSha: d.avatarSha || null,
        }));
        sendTo({ v: 1, type: "roster", people: gens, me: moi });
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
            case "role":
              // Fonction dans l'organisation (DRH, DGA…) — décrit la
              // PERSONNE, là où « label » nomme l'APPAREIL.
              setDeviceRole(payload.fingerprint, payload.role);
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
              for (const [cle, c] of clients) {
                if (c.device?.fingerprint === fp) {
                  try { c.ws.close(4004, "device-banned"); } catch {}
                  clients.delete(cle); // la clé est la connexion, pas le pseudo
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

            // ── Étape I — libérer une place de licence ────────────────
            // « Retirer » n'est PAS « bloquer ». Bloquer exclut quelqu'un
            // qu'on ne veut plus voir ; retirer rend la place d'un appareil
            // qui n'existe plus (poste réinstallé, téléphone remplacé).
            // La fiche, la clé publique et les messages sont conservés :
            // l'historique reste vérifiable.
            case "retire-device": {
              const fp = String(payload.fingerprint || "");
              // Un appareil CONNECTÉ ne se retire pas : la place serait
              // reprise à sa prochaine reconnexion, et l'admin croirait
              // l'avoir libérée. Pour écarter quelqu'un, c'est « bloquer ».
              const enLigne = [...clients.values()].some((c) => c.device?.fingerprint === fp);
              if (enLigne) { reply({ ok: false, error: "device-online" }); break; }
              if (!getDevice(fp)) { reply({ ok: false, error: "device-unknown" }); break; }
              retireDevice(fp);
              reply({ ok: true, data: { devices: listDevices(activeRoomId), places: placesLicence() } });
              break;
            }
            case "restore-device": {
              const fp = String(payload.fingerprint || "");
              if (!getDevice(fp)) { reply({ ok: false, error: "device-unknown" }); break; }
              // Reprendre une place ne doit pas pouvoir dépasser le plafond
              if (maxDevices !== null && countDevices() >= maxDevices) {
                reply({ ok: false, error: "licence-device-limit" }); break;
              }
              restoreDevice(fp);
              reply({ ok: true, data: { devices: listDevices(activeRoomId), places: placesLicence() } });
              break;
            }
            case "licence-places":
              reply({ ok: true, data: placesLicence() });
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
                purgeAll();
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
      // Supprimer par CONNEXION : fermer le téléphone ne doit pas retirer
      // le poste, qui partage le même pseudo.
      clients.delete(ws);
      broadcastPresence();
    });
  });

  // Places de licence : occupées / plafond. `null` en mode poste (salon
  // éphémère du navigateur), qui n'a pas de plafond du tout.
  function placesLicence() {
    return { occupees: countDevices(), maximum: maxDevices };
  }

  // État de licence : envoyé à l'arrivée de chaque client, puis rediffusé
  // par serve.js au passage d'un palier (préavis → grâce → lecture seule).
  // Rien n'est envoyé quand tout va bien et qu'il n'y a rien à dire : un
  // bandeau permanent finit par ne plus être lu.
  function envoyerEtatLicence(ws) {
    const etat = etatLicence();
    if (etat.mode === "active" && !etat.notice) return;
    try {
      ws.send(encryptPayload(sessionKey, {
        v: 1, type: "licence-notice", mode: etat.mode,
        readOnly: etat.mode === "readonly", notice: etat.notice || null,
      }));
    } catch { /* connexion partie entre-temps */ }
  }

  function broadcastToGroup(groupId, data) {
    // ⚠️ Étape F — un fil privé se route par APPARTENANCE, jamais par le
    // joker « all ». Sans cette branche, un message privé partait vers
    // TOUS les participants : chacun rejoint avec groups:["all"], et la
    // condition ci-dessous suffisait donc toujours.
    if (isDirectGroup(groupId)) {
      for (const { ws, device } of clients.values()) {
        if (device && isMemberOfDirect(groupId, device.fingerprint)) {
          ws.send(encryptPayload(sessionKey, data));
        }
      }
      return;
    }
    for (const { ws, groups } of clients.values()) {
      if (groups.includes(groupId) || groups.includes("all")) {
        ws.send(encryptPayload(sessionKey, data));
      }
    }
  }

  function broadcastPresence() {
    // Une personne présente sur son poste ET sur son téléphone ne doit
    // apparaître qu'une fois : la présence se raisonne en personnes, pas
    // en connexions (l'index de la table, lui, est bien par connexion).
    const online = [...new Set([...clients.values()].map((c) => c.userId).filter(Boolean))];
    for (const { ws } of clients.values()) {
      ws.send(encryptPayload(sessionKey, { v: 1, type: "presence", online }));
    }
  }

  // ✅ Accès mobile (C-bis) : page web servie aux téléphones du même wifi.
  // httpPort est annoncé dans le beacon pour que les postes déjà connectés
  // puissent aussi afficher le QR d'invitation (URL = adresse de l'hôte).
  const mobileServer = startMobileServer({ sessionName, wsPort, httpPort });
  const stopBeacon = startBeacon({ sessionName, wsPort, httpPort: mobileServer.httpPort });
  // Étape E — la purge de rétention efface les MESSAGES ; les fichiers
  // joints qu'ils citaient deviennent alors orphelins et resteraient sur
  // le disque indéfiniment. On enchaîne donc systématiquement les deux.
  const purgeAll = () => {
    const n = purgeOldMessages();
    try { purgeOrphans(mediaRoot, listReferencedMedia()); } catch { /* disque occupé */ }
    uploadQuota.sweep();
    return n;
  };
  const purgeInterval = setInterval(purgeAll, PURGE_INTERVAL_MS);

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
    /** Rediffuse l'état de licence à tout le monde — appelé par serve.js
     *  quand le palier change pendant que le serveur tourne. */
    notifyLicence() {
      for (const { ws } of clients.values()) envoyerEtatLicence(ws);
    },
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
