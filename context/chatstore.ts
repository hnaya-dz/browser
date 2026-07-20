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

export interface ChatMessage {
  id: string;
  groupId: string;
  from: string;
  text: string;
  ts: number;
  // D.2 — type "invite" : carte d'invitation vers un autre salon,
  // coordonnées dans extra {name, address, wsPort, httpPort, pin}
  type?: "message" | "invite";
  extra?: { name: string; address: string; wsPort: number; httpPort: number; pin: string | null } | null;
  deviceFp?: string | null;
  signatureValid?: boolean;
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

export interface ChatStore {
  status: ChatStatus;
  isHost: boolean;
  sessionName: string;
  pin: string | null;
  userId: string;
  messages: ChatMessage[];
  online: string[];
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
  // Verrou du salon courant (null = pas encore lu)
  adminLocked: boolean | null;
  // Salon hébergé par ce poste (bandeau + invitations) — survit au fait
  // de rejoindre un AUTRE salon ; null si on n'héberge rien
  hosting: HostingInfo | null;
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
}

export const store: ChatStore = {
  status: "idle",
  isHost: false,
  sessionName: "",
  pin: null,
  userId: "",
  messages: [],
  online: [],
  discovered: new Map(),
  error: null,
  selectedSession: null,
  inviteUrl: null,
  networkOk: null,
  unreadCount: 0,
  panelOpen: false,
  adminPin: null,
  adminAuthed: false,
  adminError: null,
  adminDevices: [],
  adminSearch: [],
  adminRetention: null,
  adminBans: [],
  adminLocked: null,
  hosting: null,
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
    | "ban" | "unban" | "bans" | "set-locked" | "room-info" | "set-admin-pin";
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
    adminRetention: null, adminBans: [], adminLocked: null, adminPinChanged: false,
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
  patchStore({ status: "connecting", error: null });
  connectTimer = setTimeout(() => {
    connectTimer = null;
    if (store.status === "connecting") {
      patchStore({ status: "error", error: "connectionTimeout" });
    }
  }, CONNECT_TIMEOUT_MS);
}

/** Ouvre/ferme le panneau. L'ouverture remet le compteur non-lus à zéro. */
export function setPanelOpen(open: boolean) {
  patchStore(open ? { panelOpen: true, unreadCount: 0 } : { panelOpen: false });
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
        patchStore({
          pin: evt.pin, adminPin: evt.adminPin || null, isHost: true,
          inviteUrl: evt.inviteUrl || null, hosting, joinedRoomIsHosted: true,
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
      case "host-stopped":
        patchStore({ isHost: false, adminPin: null, hosting: null, joinedRoomIsHosted: false });
        break;
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
        patchStore(patch);
        break;
      }
      case "presence":
        patchStore({ online: evt.online || [] });
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
