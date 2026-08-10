"use client";
// ═══════════════════════════════════════════════════════════════
// État global de la Messagerie locale — vit au niveau de l'application
// (importé par la barre d'adresse et la navbar dès le démarrage), PAS
// dans le panneau chargé paresseusement. Indispensable pour :
//  - l'icône d'état (grise = déconnecté, verte = connecté) toujours juste ;
//  - le badge « non lus » qui compte les messages reçus panneau fermé ;
//  - conserver fil et statut quand le panneau est fermé puis rouvert.
// La connexion réseau elle-même vit dans le process principal Electron
// (chat-module/worker) — ce store n'est que son reflet côté interface.
// ═══════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { jouerSon, amorcerSon } from "./chat-sound";

export interface ChatMessage {
  id: string;
  groupId: string;
  from: string;
  text: string;
  ts: number;
  // D.2 — type "invite" : carte d'invitation vers un autre salon,
  // coordonnées dans extra {name, address, wsPort, httpPort, pin}
  // Étape H — type "vote" : question soumise au vote, options et mode
  // dans extra. Un vote EST un message (même table, même signature) ;
  // seules les RÉPONSES vivent à part, dans le dépouillement.
  type?: "message" | "invite" | "vote";
  // Étape G — citation : identifiant du message auquel celui-ci répond.
  // L'hôte n'accepte qu'un identifiant EXISTANT dans ce salon, et la
  // citation est couverte par la signature (voir signablePayload) : une
  // réponse ne peut pas être déplacée sous une autre demande.
  replyTo?: string | null;
  // `extra` dépend du type : coordonnées de salon pour une invitation,
  // définition du vote pour un vote. TypeScript ne sait pas discriminer
  // sur un `type` optionnel — les deux points de lecture rétrécissent
  // donc explicitement, après avoir testé `type`.
  extra?: InviteExtra | VoteExtra | null;
  // Étape E — pièce jointe : MÉTADONNÉES seulement. Le fichier vit chez
  // l'hôte et n'est téléchargé qu'à l'ouverture ; `thumb` est une vignette
  // minuscule embarquée, qui permet un aperçu immédiat même dans
  // l'historique (voir chat-module/src/media.js).
  media?: {
    kind: "image" | "voice" | "file";
    mime: string;
    sha256: string;
    size: number;
    thumb?: string | null;
    w?: number | null;
    h?: number | null;
    duration?: number | null;
    name?: string | null;
  } | null;
  deviceFp?: string | null;
  signatureValid?: boolean;
  // Étape J — indice de LIVRAISON, posé par client.js sur les messages du
  // rattrapage. Il ne vient pas du réseau et n'est pas persisté : il sert
  // uniquement à ne pas faire sonner une absence rattrapée.
  backlog?: boolean;
}

/** Une personne de l'annuaire du salon (étape F). Le serveur ne renvoie
 *  QUE ces champs : ni IP, ni machine, ni clé publique. */
/** Coordonnées portées par une carte d'invitation (D.2). */
export interface InviteExtra {
  name: string; address: string; wsPort: number; httpPort: number; pin: string | null;
}

/** Définition d'un vote (étape H) : ses issues et son caractère nominatif.
 *  Ces deux valeurs sont SCELLÉES dans la signature du vote — on ne peut
 *  pas contester après coup ce qui était proposé. */
export interface VoteExtra {
  options: string[];
  nominatif: boolean;
}

export interface RosterPerson {
  fingerprint: string;
  name: string | null;
  role: string | null;
  online: boolean;
  lastSeen: number;
  isMe: boolean;
}

/** Identifiant d'un fil privé — même règle que côté module
 *  (chat-module/src/direct.js) : empreintes triées, donc les deux côtés
 *  calculent le même sans se concerter. */
export function directThreadId(fpA: string, fpB: string): string {
  return "dm:" + [String(fpA).toLowerCase(), String(fpB).toLowerCase()].sort().join("+");
}

/** Salon hébergé par CE poste (liste « Rouvrir un salon ») */
export interface KnownRoom {
  roomId: string;
  name: string;
  createdAt: number;
  lastUsed: number;
}

/** Salon actuellement HÉBERGÉ par ce poste — indépendant du salon
 *  rejoint : on peut héberger « Service Y » tout en discutant dans
 *  « Département X » (c'est le mécanisme des invitations). */
export interface HostingInfo {
  roomId: string;
  name: string;
  pin: string;
  adminPin: string;
  wsPort: number;
  httpPort: number;
  lanIp: string | null;
  inviteUrl: string | null;
}

export interface DiscoveredSession {
  sessionName: string;
  address: string;
  wsPort: number;
  hostname: string;
  // Port de la page d'invitation mobile — absent des beacons émis par les
  // versions antérieures à l'accès mobile (repli : 4803)
  httpPort?: number | null;
}

export type ChatStatus =
  | "idle"
  | "discovering"
  | "entering-pin"
  | "connecting"
  | "joined"
  | "error"
  | "network-setup";

/** Dépouillement d'un vote. `detail` ne porte des noms QUE si le vote est
 *  nominatif — en non nominatif l'hôte ne l'envoie jamais, faute de savoir
 *  lui-même qui a voté quoi. `voters` liste en revanche les répondants
 *  dans les deux modes : c'est ce qui permet de relancer les absents. */
export interface VoteTally {
  decompte: Record<number, number>;
  total: number;
  voters: { fingerprint: string; sender: string; ts: number }[];
  detail: { sender: string; fingerprint: string; choice: number; comment: string | null; ts: number }[];
}

export interface ChatStore {
  status: ChatStatus;
  isHost: boolean;
  sessionName: string;
  pin: string | null;
  userId: string;
  messages: ChatMessage[];
  online: string[];
  // ── Étape F — annuaire et conversations privées ──
  // roster : qui est inscrit dans ce salon (nom, fonction, présence).
  // myFingerprint : notre propre empreinte, indispensable pour composer
  // l'identifiant d'un fil privé (voir chat-module/src/direct.js).
  // activeThread : "all" = le salon ; "dm:…" = un fil privé.
  roster: RosterPerson[];
  myFingerprint: string | null;
  // Étape H — dépouillements, par identifiant de vote. Ils n'arrivent PAS
  // avec les messages : l'hôte les rediffuse à chaque réponse, et le
  // message de vote, lui, ne bouge plus une fois publié.
  // `detail` est vide en mode non nominatif — par construction côté hôte,
  // pas par filtrage ici.
  voteTallies: Record<string, VoteTally>;
  // Vote auquel on vient de se voir refuser un second bulletin : il faut
  // le dire, sinon la personne croit avoir voté deux fois.
  voteRefused: string | null;
  // Étape I — échéance de licence du serveur permanent. `licenceReadOnly`
  // coupe la composition côté interface ; l'hôte refuse de toute façon, mais
  // laisser taper un message pour le voir rejeté serait cruel.
  // Reste null en mode poste (salon éphémère, sans licence).
  licenceNotice: string | null;
  licenceReadOnly: boolean;
  activeThread: string;
  discovered: Map<string, DiscoveredSession>;
  error: string | null;
  selectedSession: DiscoveredSession | null;
  // URL de la page mobile du salon courant (QR « Inviter un téléphone ») —
  // fournie par le worker côté hôte, composée depuis la session découverte
  // côté participant ; null si le poste n'a pas d'adresse LAN
  inviteUrl: string | null;
  // null = pas encore vérifié ; false = autorisation pare-feu absente
  // (le bouton « Autoriser » ne s'affiche que dans ce cas)
  networkOk: boolean | null;
  // Messages des autres participants reçus pendant que le panneau est
  // fermé — affiché en pastille rouge sur l'icône, remis à zéro à l'ouverture
  unreadCount: number;
  // ── Étape J ──
  // Non-lus des fils PRIVÉS, par fil. Vit dans le store et non dans le
  // panneau : il y était en useState, donc fermer le dock effaçait les
  // compteurs. On revenait à zéro message privé en attente alors qu'il y
  // en avait — une bonne part du « notification trop discrète ».
  unreadPrivate: Record<string, number>;
  // Le panneau (dock) est-il actuellement affiché ? Piloté par setPanelOpen
  // — source unique de vérité pour le montage du panneau ET le badge
  panelOpen: boolean;
  // ── Administration (étape D) ──
  // PIN admin du salon — connu uniquement de l'hôte (event host-started).
  // Les participants qui le connaissent le saisissent dans le panneau.
  adminPin: string | null;
  // true dès la première réponse admin acceptée par le serveur
  adminAuthed: boolean;
  adminError: string | null;
  adminDevices: AdminDevice[];
  adminSearch: ChatMessage[];
  adminRetention: number | null;
  // ── D.2 ──
  // Empreintes bloquées dans le salon courant (boutons Bloquer/Débloquer)
  adminBans: string[];
  // Étape I — places de licence : occupées / plafond. `maximum: null` en
  // mode poste (salon éphémère, sans licence ni plafond).
  adminPlaces: { occupees: number; maximum: number | null } | null;
  // Verrou du salon courant (null = pas encore lu)
  adminLocked: boolean | null;
  // Salon hébergé correspondant à celui qu'on a REJOINT (null sinon)
  hosting: HostingInfo | null;
  // TOUS les salons ouverts par ce poste (D.4 : plusieurs à la fois, un
  // par paire de ports). C'est ce qui permet d'inviter les membres d'un
  // salon vers un autre salon RESTÉ OUVERT.
  hostings: HostingInfo[];
  // Le salon actuellement REJOINT est-il celui qu'on héberge ?
  // (pilote l'affichage du bloc PINs et le bouton Fermer vs Quitter)
  joinedRoomIsHosted: boolean;
  // Salons connus de ce poste (écran « Rouvrir un salon »)
  rooms: KnownRoom[];
  // IP LAN de ce poste — compose l'adresse d'invitation même sans héberger
  roomsLanIp: string | null;
  // Retour de la dernière invitation ciblée (null | "delivered" | "offline")
  inviteFeedback: string | null;
  // Confirmation visuelle du changement de PIN admin (retour terrain :
  // « le bouton n'a pas cliqué » — la commande passait, sans le dire)
  adminPinChanged: boolean;
}

export interface AdminDevice {
  fingerprint: string;
  publicKeySpki: string;
  firstSeen: number;
  lastSeen: number;
  lastNickname: string | null;
  nicknames: string[];
  hostname: string | null;
  platform: string | null;
  lastIp: string | null;
  label: string | null;
  // Étape F — fonction de la PERSONNE dans l'organisation (DRH, DGA…),
  // affichée dans l'annuaire ; `label` nomme l'APPAREIL.
  role: string | null;
  // Étape I — appareil retiré par l'admin : sa place de licence est rendue,
  // sa fiche et ses messages sont conservés. Il redevient comptable s'il
  // se reconnecte.
  retiredAt: number | null;
}

export const store: ChatStore = {
  status: "idle",
  isHost: false,
  sessionName: "",
  pin: null,
  userId: "",
  messages: [],
  online: [],
  roster: [],
  myFingerprint: null,
  voteTallies: {},
  voteRefused: null,
  licenceNotice: null,
  licenceReadOnly: false,
  activeThread: "all",
  discovered: new Map(),
  error: null,
  selectedSession: null,
  inviteUrl: null,
  networkOk: null,
  unreadCount: 0,
  unreadPrivate: {},
  panelOpen: false,
  adminPin: null,
  adminAuthed: false,
  adminError: null,
  adminDevices: [],
  adminSearch: [],
  adminRetention: null,
  adminBans: [],
  adminPlaces: null,
  adminLocked: null,
  hosting: null,
  hostings: [],
  joinedRoomIsHosted: false,
  rooms: [],
  roomsLanIp: null,
  inviteFeedback: null,
  adminPinChanged: false,
};

/** Envoie une commande admin au salon (réponse via l'événement
 *  "admin-result"). Le PIN est fourni à chaque appel — jamais persisté. */
export function sendAdminCommand(params: {
  // Soit le PIN saisi, soit vaultRoomKey : dans ce cas le PIN est lu et
  // injecté par le PROCESS PRINCIPAL depuis le coffre chiffré — il ne
  // transite jamais par cette page (voir public/vault-ipc.js).
  adminPin?: string;
  vaultRoomKey?: string;
  action: "devices" | "label" | "search" | "config-get" | "config-set"
    | "ban" | "unban" | "bans" | "set-locked" | "room-info" | "set-admin-pin"
    // Étape I — places de licence : « retirer » rend la place d'un appareil
    // qui n'existe plus, sans effacer sa fiche ni ses messages. À ne pas
    // confondre avec « bloquer », qui exclut une personne.
    | "retire-device" | "restore-device" | "licence-places";
  reqId?: string;
  fingerprint?: string;
  label?: string | null;
  filters?: Record<string, unknown>;
  key?: string;
  value?: unknown;
  locked?: boolean;
  newPin?: string;
}) {
  getApi()?.send("chat-admin", params);
}

/** Réinitialise l'état admin (fermeture du panneau admin ou du salon). */
export function resetAdminState() {
  patchStore({
    adminAuthed: false, adminError: null, adminDevices: [], adminSearch: [],
    adminRetention: null, adminBans: [], adminPlaces: null, adminLocked: null,
    adminPinChanged: false,
  });
}

const listeners = new Set<() => void>();
function notify() { listeners.forEach((fn) => fn()); }

export function patchStore(patch: Partial<ChatStore>) {
  Object.assign(store, patch);
  notify();
}

export function getApi() {
  return typeof window !== "undefined" ? (window as any).electronAPI : null;
}

function getUserId() {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("hnaya-chat-user-id");
  if (!id) {
    id = "user_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("hnaya-chat-user-id", id);
  }
  return id;
}

// ═══════════════════════════════════════════════════════════════
// Délai maximum de connexion. Sans ça, si le salon est injoignable
// (pare-feu, mauvais wifi, hôte éteint), la WebSocket reste "en cours de
// connexion" indéfiniment sans jamais émettre "open" ni "error" — l'UI
// resterait bloquée sur "Connexion…" pour toujours. Ce garde-fou affiche
// une erreur claire après CONNECT_TIMEOUT_MS.
// ═══════════════════════════════════════════════════════════════
const CONNECT_TIMEOUT_MS = 12000;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

export function clearConnectTimer() {
  if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
}

export function startConnecting() {
  clearConnectTimer();
  // L'état de licence appartient au salon qu'on rejoint, pas au précédent.
  // Sans cette remise à zéro, quitter un serveur en lecture seule pour
  // créer un salon local laissait le bandeau — et la saisie bloquée.
  patchStore({
    status: "connecting", error: null, licenceNotice: null, licenceReadOnly: false,
    // Les non-lus privés appartiennent au salon qu'on quitte.
    unreadPrivate: {},
  });
  connectTimer = setTimeout(() => {
    connectTimer = null;
    if (store.status === "connecting") {
      patchStore({ status: "error", error: "connectionTimeout" });
    }
  }, CONNECT_TIMEOUT_MS);
}

/** Ouvre/ferme le panneau. L'ouverture remet le compteur non-lus à zéro.
 *  ⚠️ PAS les non-lus privés : ouvrir le dock ne fait pas lire les
 *  conversations privées, qui sont dans d'autres fils. Les remettre à zéro
 *  ici escamoterait justement ce qu'on cherche à rendre visible. Seul
 *  marquerFilLu, à l'ouverture du fil concerné, les efface. */
export function setPanelOpen(open: boolean) {
  if (!open) { patchStore({ panelOpen: false }); return; }
  amorcerSon(); // le clic est le geste utilisateur qui débloque l'audio
  patchStore({ panelOpen: true, unreadCount: 0 });
  if (store.activeThread !== "all") marquerFilLu(store.activeThread);
}

/** Le fil vient d'être ouvert : ses messages sont lus. */
export function marquerFilLu(threadId: string) {
  if (!store.unreadPrivate[threadId]) return;
  const reste = { ...store.unreadPrivate };
  delete reste[threadId];
  patchStore({ unreadPrivate: reste });
}

/** Total des messages privés non lus, tous fils confondus. */
export function totalPrivesNonLus(): number {
  return Object.values(store.unreadPrivate).reduce((a, b) => a + b, 0);
}

let listening = false;
export function ensureListening() {
  if (listening) return;
  listening = true;
  store.userId = getUserId();
  const api = getApi();
  if (!api?.receive) return;

  api.receive("chat-event", (evt: any) => {
    switch (evt.event) {
      case "host-started": {
        // ✅ L'hôte rejoint automatiquement son propre salon pour pouvoir
        // discuter — sans ça, "Créer un salon" ouvrirait un serveur muet.
        const hosting = {
          roomId: evt.roomId,
          name: evt.sessionName || "Hnaya Chat",
          pin: evt.pin,
          adminPin: evt.adminPin,
          wsPort: evt.wsPort,
          httpPort: evt.httpPort,
          lanIp: evt.lanIp || null,
          inviteUrl: evt.inviteUrl || null,
        };
        // Mémoire des coordonnées du dernier salon hébergé — pré-remplit
        // le formulaire d'invitation depuis un AUTRE salon
        try { localStorage.setItem("hnaya-chat-last-hosted", JSON.stringify(hosting)); } catch {}
        // D.4 : la liste des salons ouverts s'enrichit (plusieurs à la fois)
        const hostings = [...store.hostings.filter((h) => h.roomId !== hosting.roomId), hosting];
        patchStore({
          pin: evt.pin, adminPin: evt.adminPin || null, isHost: true,
          inviteUrl: evt.inviteUrl || null, hosting, hostings, joinedRoomIsHosted: true,
        });
        startConnecting();
        api.send("chat-join", {
          address: "127.0.0.1",
          wsPort: evt.wsPort,
          pin: evt.pin,
          userId: store.userId,
          groups: ["all"],
          lastSeenTs: 0,
        });
        break;
      }
      case "host-stopped": {
        // Retire le salon fermé de la liste ; les autres restent ouverts
        const remaining = evt.roomId
          ? store.hostings.filter((h) => h.roomId !== evt.roomId)
          : [];
        const closedCurrent = !evt.roomId || store.hosting?.roomId === evt.roomId;
        patchStore({
          hostings: remaining,
          ...(closedCurrent
            ? { isHost: false, adminPin: null, hosting: null, joinedRoomIsHosted: false }
            : {}),
        });
        break;
      }
      case "rooms":
        patchStore({ rooms: evt.rooms || [], roomsLanIp: evt.lanIp ?? store.roomsLanIp });
        break;
      case "invite-sent":
        patchStore({ inviteFeedback: evt.delivered ? "delivered" : "offline" });
        break;
      case "session-found": {
        const key = `${evt.session.address}:${evt.session.wsPort}`;
        const discovered = new Map(store.discovered);
        discovered.set(key, evt.session);
        patchStore({ discovered });
        break;
      }
      case "joined":
        clearConnectTimer();
        patchStore({ status: "joined", error: null });
        break;
      case "join-failed":
        clearConnectTimer();
        patchStore({
          status: "error",
          error: evt.reason === "pin-incorrect" ? "pinIncorrect"
            : evt.reason === "banned" ? "accessBanned"     // D.2 : appareil bloqué
            : evt.reason === "locked" ? "roomLocked"       // D.2 : salon verrouillé
            : evt.reason === "device-limit" ? "deviceLimit" // licence : plafond atteint
            : "genericError",
        });
        break;
      case "disconnected":
        clearConnectTimer();
        // Ne réagir que si on se croyait connecté — un "disconnected"
        // émis après « Quitter » (volontaire) ne doit rien afficher.
        if (store.status === "joined") {
          patchStore({ status: "error", error: "connectionLost", online: [] });
        }
        break;
      case "message": {
        // Déduplication par id : le backlog renvoyé à la (re)connexion
        // peut recouper des messages déjà affichés (ex. re-création d'un
        // salon sur le même poste, l'hôte persistant l'historique 30 j).
        // Sans ce filtre : clés React dupliquées + messages en double.
        if (store.messages.some((m) => m.id === evt.message.id)) break;
        const patch: Partial<ChatStore> = { messages: [...store.messages, evt.message] };
        // Badge non-lus : uniquement les messages des AUTRES participants
        // reçus pendant que le panneau est fermé
        if (!store.panelOpen && evt.message.from !== store.userId) {
          patch.unreadCount = store.unreadCount + 1;
        }
        // ── Étape J — signal sonore et non-lus privés ──
        // « Sous les yeux » = panneau ouvert ET fil concerné affiché. Dans
        // ce seul cas on ne fait ni bruit ni compteur : le message est déjà
        // lu au moment où il arrive.
        const groupe = evt.message.groupId || "all";
        const prive = groupe.startsWith("dm:");
        const sousLesYeux = store.panelOpen && groupe === store.activeThread;
        const desAutres = evt.message.from !== store.userId;
        if (desAutres && !sousLesYeux) {
          if (prive) {
            patch.unreadPrivate = {
              ...store.unreadPrivate,
              [groupe]: (store.unreadPrivate[groupe] || 0) + 1,
            };
          }
          // Le son est déclenché ICI, dans le store, et non dans un effet
          // React : il doit sonner une fois par message, y compris panneau
          // fermé, sans dépendre du montage d'un composant.
          // Jamais sur le rattrapage (voir client.js) : rejoindre après une
          // absence sonnerait une fois par message manqué.
          if (!evt.message.backlog) jouerSon(prive ? "private" : "room");
        }
        patchStore(patch);
        break;
      }
      // Étape H — dépouillement rafraîchi à chaque réponse
      case "vote-tally": {
        patchStore({
          voteTallies: {
            ...store.voteTallies,
            [evt.voteId]: {
              decompte: evt.decompte || {}, total: evt.total || 0,
              voters: evt.voters || [], detail: evt.detail || [],
            },
          },
        });
        break;
      }
      case "vote-refused":
        patchStore({ voteRefused: evt.voteId || null });
        break;
      // Étape I — préavis d'échéance, puis lecture seule. L'hôte l'envoie
      // à la connexion ET au franchissement d'un palier : le bandeau
      // apparaît sur un salon ouvert depuis des jours, sans rien relancer.
      case "licence-notice":
        patchStore({
          licenceNotice: evt.notice || null,
          licenceReadOnly: !!evt.readOnly,
        });
        break;
      case "presence":
        patchStore({ online: evt.online || [] });
        // La présence vient de changer : l'annuaire affiché doit suivre,
        // sinon la pastille verte ment jusqu'au prochain aller-retour.
        if (store.roster.length) getApi()?.send?.("chat-roster");
        break;
      case "roster":
        patchStore({
          roster: (evt.people || []) as RosterPerson[],
          myFingerprint: evt.me || store.myFingerprint,
        });
        break;
      case "admin-result": {
        const r = evt.result || {};
        if (!r.ok) {
          // "admin-pin" → retour à la saisie du PIN ; autre erreur → bandeau
          patchStore({ adminError: r.error || "admin-error", ...(r.error === "admin-pin" ? { adminAuthed: false } : {}) });
          break;
        }
        const patch: Partial<ChatStore> = { adminError: null, adminAuthed: true };
        if (r.action === "devices" || r.action === "label") patch.adminDevices = r.data || [];
        else if (r.action === "search") patch.adminSearch = r.data || [];
        else if (r.action === "config-get" || r.action === "config-set") {
          patch.adminRetention = r.data?.retention_days ?? null;
        }
        // D.2 : blocages (ban/unban renvoient devices + bans), verrou,
        // fiche du salon (room-info porte aussi la rétention)
        else if (r.action === "ban" || r.action === "unban") {
          patch.adminDevices = r.data?.devices || [];
          patch.adminBans = (r.data?.bans || []).map((b: any) => b.fingerprint);
        }
        else if (r.action === "bans") patch.adminBans = (r.data || []).map((b: any) => b.fingerprint);
        // Étape I — retrait/reprise d'une place de licence
        else if (r.action === "retire-device" || r.action === "restore-device") {
          patch.adminDevices = r.data?.devices || [];
          patch.adminPlaces = r.data?.places || null;
        }
        else if (r.action === "licence-places") patch.adminPlaces = r.data || null;
        else if (r.action === "set-locked") patch.adminLocked = !!r.data?.locked;
        else if (r.action === "set-admin-pin") patch.adminPinChanged = true;
        else if (r.action === "room-info") {
          patch.adminLocked = !!r.data?.locked;
          patch.adminRetention = r.data?.retention_days ?? null;
        }
        patchStore(patch);
        break;
      }
      case "error":
        // Ne bascule vers l'écran d'erreur QUE si on était en train de se
        // connecter — un aléa réseau pendant une session déjà établie ne
        // doit pas éjecter l'utilisateur du fil de discussion.
        if (store.status === "connecting") {
          clearConnectTimer();
          patchStore({ status: "error", error: "genericError" });
        }
        break;
    }
  });
}

/**
 * Abonnement React au store : re-rend le composant à chaque changement
 * et démarre l'écoute des événements dès le premier montage (donc dès
 * l'affichage de la barre — les messages reçus panneau fermé comptent).
 */
export function useChatSnapshot(): ChatStore {
  const [, force] = useState(0);
  useEffect(() => {
    ensureListening();
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return store;
}
