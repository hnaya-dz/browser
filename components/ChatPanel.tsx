"use client";
import { useEffect, useMemo, useRef, useState } from "react";
// ✅ Icônes vectorielles (lucide, déjà dans les dépendances) plutôt
// qu'emoji : les emoji sont rendus par la police du système et diffèrent
// visuellement entre Windows 10 et 11 — incohérent d'un poste à l'autre.
import { MessageSquare, Shield, Lock, Smartphone, KeyRound, Eye, EyeOff, Send, History, DoorOpen, Trash2, KeySquare, Users, ArrowLeft, CornerUpLeft, X, CheckCircle2, AlertTriangle, Volume2, VolumeX, CalendarClock, MoreHorizontal, ChevronUp, User, Plus } from "lucide-react";
import ChatAdminPanel from "./ChatAdminPanel";
import ChatServerSetup from "./ChatServerSetup";
import ChatComposerMedia, { MediaPreview, type PreparedMedia } from "./ChatComposerMedia";
import ChatVoteCard from "./ChatVoteCard";
import ChatDemandeCard from "./ChatDemandeCard";
import ChatMeetingCard from "./ChatMeetingCard";
import type { InviteExtra, MeetingExtra, RosterPerson, ChatMessage } from "@/context/chatstore";

// Les trois issues d'un vote, dans le vocabulaire administratif validé
// par l'utilisateur. Ce sont des CLÉS i18n : les libellés partent traduits
// dans la langue de celui qui ouvre le vote, et voyagent tels quels — un
// vote doit garder les mots exacts sous lesquels il a été soumis.
// Étape K — même palette que ChatDemandeCard : la couleur choisie au moment
// d'étiqueter doit être celle qu'on retrouvera dans le fil.
const TAG_TON: Record<string, string> = {
  info: "#8a8a8a", avis: "#4a9eff", validation: "#00c853", approbation: "#ffa726",
};

/** Heure d'un message : l'heure seule dans la journée, la date devant dès
 *  qu'on change de jour. Un fil qui n'affiche que « 14:32 » ne dit pas si
 *  l'on regarde ce matin ou la semaine dernière. Le survol donne la date
 *  et l'heure complètes. */
function heureCourte(ts: number): string {
  const d = new Date(ts);
  const heure = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const aujourdhui = new Date();
  const memeJour = d.getFullYear() === aujourdhui.getFullYear()
    && d.getMonth() === aujourdhui.getMonth()
    && d.getDate() === aujourdhui.getDate();
  return memeJour ? heure : `${d.toLocaleDateString()} ${heure}`;
}

const VOTE_OPTIONS =["voteApprove", "voteReject", "voteReserve"] as const;
import ChatMediaBubble from "./ChatMediaBubble";
import ChatRoster from "./ChatRoster";
import ChatAvatar from "./ChatAvatar";
import ChatIdentite, { avatarEnAttente, oublierAvatarEnAttente } from "./ChatIdentite";
import qrcode from "qrcode-generator";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/context/langcontext";
import { useTabPosition } from "@/context/tabpositioncontext";
import { useTabContext } from "@/context/tabcontext";
import {
  store,
  patchStore,
  getApi,
  clearConnectTimer,
  startConnecting,
  useChatSnapshot,
  resetAdminState,
  marquerFilLu,
  type DiscoveredSession,
} from "@/context/chatstore";
import { estActif as sonActif, definirActif as definirSon, jouerSon } from "@/context/chat-sound";

interface ChatPanelProps {
  onClose: () => void;
}

// Largeur de la colonne ancrée. La fenêtre fait 900px minimum : il reste
// donc toujours ≥ 560px pour la page consultée.
const DOCK_WIDTH = 340;

function getThemeName() {
  if (typeof document === "undefined") return "dark";
  const cls = document.documentElement.classList;
  if (cls.contains("sunset")) return "sunset";
  if (cls.contains("light")) return "light";
  return "dark";
}

// ═══════════════════════════════════════════════════════════════
// Panneau ANCRÉ (dock) à droite — remplace l'ancienne fenêtre modale qui
// masquait la page. Principe : le process principal rétrécit la
// WebContentsView de DOCK_WIDTH (canal "chat-dock"), ce qui rend visible
// cette colonne React à droite — l'utilisateur discute EN voyant la page.
// C'est la même mécanique que la barre d'onglets latérale (tabSideWidth).
// ═══════════════════════════════════════════════════════════════
// Découpe un message en texte + liens cliquables. Les URLs collées dans la
// discussion passaient comme du texte mort (retour de test terrain) — ici
// elles s'ouvrent dans un nouvel onglet, le dock restant visible à côté.
// ⚠️ Détecte aussi les liens tapés SANS schéma — « www.hnaya.dz » ou
// « hnaya.dz/boutique » (personne ne tape https:// à la main ; second
// retour terrain : « les liens ne sont pas actifs pour l'envoyeur »).
// TLD volontairement limités pour éviter les faux positifs sur des noms
// de fichiers (« electron.js », « package.json »).
// ⚠️ Même regex dans chat-module/mobile/index.html (renderText) — les
// deux côtés doivent linkifier à l'identique.
const URL_SPLIT = /((?:https?:\/\/|www\.)[^\s]+|(?:[a-zA-Z0-9-]+\.)+(?:dz|com|net|org|fr|io)(?:\/[^\s]*)?)/g;
const isLinkPart = (p: string) => /^(?:https?:\/\/|www\.|(?:[a-zA-Z0-9-]+\.)+(?:dz|com|net|org|fr|io)(?:\/|$))/.test(p);
const toHref = (p: string) => (/^https?:\/\//.test(p) ? p : "https://" + p);
function MessageText({ text, accent, onOpen }: { text: string; accent: string; onOpen: (url: string) => void }) {
  const parts = String(text).split(URL_SPLIT);
  return (
    <div style={{ fontSize: 13, wordBreak: "break-word" }}>
      {parts.map((p, i) =>
        isLinkPart(p) ? (
          <a
            key={i}
            onClick={(e) => { e.preventDefault(); onOpen(toHref(p)); }}
            href={toHref(p)}
            style={{ color: accent, textDecoration: "underline", cursor: "pointer", direction: "ltr", unicodeBidi: "embed" }}
          >
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </div>
  );
}

// D.2 — ligne de PIN masqué avec œil individuel : l'hôte peut montrer le
// PIN d'accès à un collègue SANS exposer le PIN admin (chaque ligne a son
// propre interrupteur, tous masqués par défaut).
function PinRow({ label, pin, accent, muted }: { label: string; pin: string; accent: string; muted: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 10, color: muted, flex: 1, textAlign: "start" }}>{label}</span>
      <span style={{
        fontSize: 16, fontWeight: 700, letterSpacing: 3, color: accent,
        fontVariantNumeric: "tabular-nums", direction: "ltr",
      }}>
        {show ? pin : "••••••"}
      </span>
      <button
        onClick={() => setShow((v) => !v)}
        aria-label={label}
        style={{ background: "none", border: "none", cursor: "pointer", color: muted, padding: 2, lineHeight: 0 }}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

export default function ChatPanel({ onClose }: ChatPanelProps) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { position } = useTabPosition();
  const { addTab } = useTabContext();
  const dir = isRTL ? "rtl" : "ltr";
  useChatSnapshot();

  useEffect(() => {
    // Filet de sécurité seulement : le préchauffage réel a lieu bien plus
    // tôt, dans ChatDockMount, qui vit en permanence dans la mise en page.
    // Ici, au montage du panneau, il arrivait trop tard — le processus
    // démarrait en même temps que les premières actions de l'utilisateur.
    // Sans effet si le processus tourne déjà (ensureChatWorker est idempotent).
    getApi()?.send?.("chat-warmup");
    // Réserve la colonne : la page web se rétrécit au lieu d'être cachée
    getApi()?.send?.("chat-dock", DOCK_WIDTH);
    return () => { getApi()?.send?.("chat-dock", 0); };
  }, []);

  const [nickname, setNickname] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("hnaya-chat-nickname") || "" : ""
  );
  const [sessionNameInput, setSessionNameInput] = useState("");
  // Le pseudo est déjà mémorisé : on le RAPPELLE, on ne le redemande pas.
  // Ce drapeau n'ouvre le champ que sur demande explicite — ou d'office à
  // la toute première utilisation, quand il n'y a encore rien à rappeler.
  const [changerPseudo, setChangerPseudo] = useState(false);
  // Créer un salon est une action d'installation, pas un geste quotidien :
  // repliée par défaut.
  const [creationOuverte, setCreationOuverte] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [messageInput, setMessageInput] = useState("");
  // Étape E — pièce jointe préparée, en attente d'envoi
  // Étape F — annuaire ouvert, et personne à qui l'on écrit en privé
  const [showRoster, setShowRoster] = useState(false);
  const [threadPeer, setThreadPeer] = useState<{ name: string | null; role: string | null } | null>(null);
  // Étape J — les non-lus privés vivaient ICI, en useState : fermer le dock
  // démontait le panneau et effaçait les compteurs. On retrouvait « aucun
  // message privé » alors qu'il y en avait. Ils sont maintenant dans le
  // store, alimentés à la réception (voir chatstore, événement "message").
  const [pendingMedia, setPendingMedia] = useState<PreparedMedia | null>(null);
  // Étape G — message auquel on répond. On garde l'identifiant SEUL : le
  // message cité est relu dans le fil au moment de l'affichage, de sorte
  // qu'une purge de rétention ne laisse pas une copie fantôme à l'écran.
  const [replyToId, setReplyToId] = useState<string | null>(null);
  // Étape H — ouverture d'un vote. Les trois libellés sont ceux du
  // vocabulaire administratif validé par l'utilisateur ; ils restent
  // modifiables, mais ce sont les valeurs par défaut.
  // Étape J — interrupteur du signal sonore. Lu paresseusement : le
  // localStorage n'existe pas au rendu serveur.
  const [son, setSon] = useState(() => sonActif());
  // Codes du salon : dépliés par défaut — on en a besoin à la création —
  // puis repliés définitivement dès que l'utilisateur les a notés.
  const [codesVisibles, setCodesVisibles] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("hnaya-chat-codes") !== "0";
  });
  // Actions secondaires, regroupées. Elles restaient toutes en ligne et
  // débordaient sur deux ou trois rangées.
  const [plusOuvert, setPlusOuvert] = useState(false);
  // Étape K — nature du prochain envoi, et personne désignée. Remis à zéro
  // après chaque envoi : une étiquette qui « colle » ferait partir en
  // demande de validation le message anodin qui suit.
  const [tag, setTag] = useState<"info" | "avis" | "validation" | "approbation" | null>(null);
  const [destinataire, setDestinataire] = useState<string>("");
  // Étape P — formulaire d'annonce d'une réunion
  const [reunionOuverte, setReunionOuverte] = useState(false);
  const [reunionTitre, setReunionTitre] = useState("");
  const [reunionQuand, setReunionQuand] = useState("");
  const [reunionDuree, setReunionDuree] = useState("60");
  const [reunionLieu, setReunionLieu] = useState("");
  const [voteOuvert, setVoteOuvert] = useState(false);
  const [voteQuestion, setVoteQuestion] = useState("");
  const [voteNominatif, setVoteNominatif] = useState(true);
  const [mediaBusy, setMediaBusy] = useState(false);
  // Conversion audio en cours (formats hors liste : FLAC, AIFF…) — null =
  // aucune conversion, sinon avancement 0..1.
  const [converting, setConverting] = useState<number | null>(null);
  const [mediaError, setMediaError] = useState("");
  // Annotation de pages — une image annotée déposée depuis la surface
  // (hors du dock) transite par le store, faute de chemin direct entre
  // deux composants qui ne se connaissent pas. On la reprend ici, puis on
  // VIDE le dépôt : sans cela, refermer puis rouvrir le dock reproposerait
  // indéfiniment la même pièce jointe.
  useEffect(() => {
    if (!store.pieceJointeDeposee) return;
    setPendingMedia(store.pieceJointeDeposee);
    setMediaError("");
    patchStore({ pieceJointeDeposee: null });
  }, [store.pieceJointeDeposee]);
  const [setupBusy, setSetupBusy] = useState(false);
  // false = masqué ; "guest" = inviter quelqu'un d'autre ; "mine" = lier
  // SON PROPRE téléphone (le QR emporte alors le pseudo courant)
  const [showInvite, setShowInvite] = useState<false | "guest" | "mine">(false);
  // Panneau admin (étape D) — remplace le fil tant qu'il est ouvert ;
  // l'état d'authentification est réinitialisé à chaque fermeture
  const [showAdmin, setShowAdmin] = useState(false);
  const toggleAdmin = () => {
    // ⚠️ resetAdminState HORS de la fonction de mise à jour d'état :
    // React exécute les updaters PENDANT le rendu — un patchStore là-dedans
    // déclenche « Cannot update a component while rendering » (vu en test
    // terrain sur le bouton Fermer du panneau admin).
    if (showAdmin) resetAdminState();
    setShowAdmin(!showAdmin);
  };

  // ── D.2 : création enrichie, réouverture, invitations ──
  const [adminPinInput, setAdminPinInput] = useState("");
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<string>(""); // "" = à tous
  const [inviteRoom, setInviteRoom] = useState({ name: "", address: "", pin: "" });

  // Liste des salons de CE poste, rafraîchie à chaque retour à l'accueil
  useEffect(() => {
    if (store.status === "idle") getApi()?.send?.("chat-list-rooms");
  }, [store.status]);

  // Étape F — l'annuaire est demandé dès l'entrée dans un salon : sans
  // lui on ne connaît pas sa propre empreinte, donc on ne peut composer
  // aucun identifiant de fil privé.
  useEffect(() => {
    if (store.status === "joined") getApi()?.send?.("chat-roster");
  }, [store.status]);

  // Étape N — accuser réception de ce qu'on a SOUS LES YEUX. Le fil doit
  // être ouvert ET le panneau affiché : un message compté « lu » alors que
  // le dock est fermé ferait mentir l'accusé, et c'est justement sa seule
  // valeur. L'ensemble évite de renvoyer indéfiniment le même accusé à
  // chaque rendu — l'hôte l'ignorerait, mais c'est du trafic pour rien.
  const dejaAccuses = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!store.panelOpen || showRoster || showAdmin) return;
    for (const m of messagesDuFil) {
      if (m.from === store.userId) continue;
      if (dejaAccuses.current.has(m.id)) continue;
      dejaAccuses.current.add(m.id);
      getApi()?.send?.("chat-mark-read", { messageId: m.id, groupId: m.groupId });
    }
  }, [store.messages.length, store.activeThread, store.panelOpen, showRoster, showAdmin]);

  const ouvrirFil = (threadId: string, personne: { name: string | null; role: string | null }) => {
    patchStore({ activeThread: threadId });
    setThreadPeer(personne);
    setShowRoster(false);
    marquerFilLu(threadId);
  };

  // Étape J — de qui viennent les messages privés en attente. Le nom est
  // relu dans le fil plutôt que stocké : un pseudo changé entre-temps
  // s'affiche à jour, et il n'y a pas un deuxième état à tenir cohérent.
  const privesEnAttente = Object.entries(store.unreadPrivate)
    .filter(([, n]) => n > 0)
    .map(([fil, n]) => {
      const dernier = [...store.messages].reverse()
        .find((m) => m.groupId === fil && m.from !== store.userId);
      return { fil, n, de: dernier?.from || t("Chat.adminUnnamed") };
    });
  const totalPrives = privesEnAttente.reduce((a, p) => a + p.n, 0);


  const revenirAuSalon = () => {
    patchStore({ activeThread: "all" });
    setThreadPeer(null);
  };

  // Le fil affiché ne montre QUE ses propres messages. Les anciens
  // messages sans groupId (versions antérieures) restent dans le salon.
  const messagesDuFil = store.messages.filter(
    (m) => (m.groupId || "all") === store.activeThread,
  );

  // Étape P — réunions du fil courant qui ne sont pas terminées. Le filtre
  // porte sur l'heure de FIN, pas de début : une réunion en cours doit
  // rester épinglée, c'est même à ce moment-là qu'elle sert le plus.
  const reunionsAVenir = messagesDuFil.filter((m) => {
    if (m.type !== "meeting") return false;
    const e = m.extra as MeetingExtra | null;
    if (!e?.startsAt) return false;
    return e.startsAt + (e.durationMin || 0) * 60000 > Date.now();
  });

  // Pré-remplissage du formulaire d'invitation : le salon qu'on héberge
  // (cas type : je viens de créer « Service Y », j'invite depuis « X »),
  // sinon le dernier hébergé connu
  const [inviteRoomId, setInviteRoomId] = useState<string>("");
  const openInvitePanel = () => {
    // Rafraîchir la liste des salons de ce poste pour le sélecteur
    getApi()?.send?.("chat-list-rooms");
    let src: any = store.hosting;
    if (!src) {
      try { src = JSON.parse(localStorage.getItem("hnaya-chat-last-hosted") || "null"); } catch {}
    }
    setInviteRoomId(store.hosting?.roomId || "");
    setInviteRoom({
      name: src?.name || "",
      address: src?.lanIp ? `${src.lanIp}${src.wsPort && src.wsPort !== 4802 ? ":" + src.wsPort : ""}` : "",
      pin: src?.pin || "",
    });
    setInviteTarget("");
    patchStore({ inviteFeedback: null });
    setShowInvitePanel(true);
  };

  // Sélection d'un salon de ce poste → remplissage automatique. Le PIN
  // n'est connu que du salon ACTUELLEMENT hébergé (les autres dorment) :
  // pour eux, on remplit nom + adresse et on prévient qu'il faut l'ouvrir.
  const pickInviteRoom = (roomId: string) => {
    setInviteRoomId(roomId);
    if (!roomId) return;
    const room = store.rooms.find((r) => r.roomId === roomId);
    if (!room) return;
    const open = store.hostings.find((h) => h.roomId === roomId);
    const ip = open?.lanIp || store.hosting?.lanIp || store.roomsLanIp || "";
    const port = open ? open.wsPort : 4802;
    setInviteRoom({
      name: room.name,
      address: ip ? `${ip}${port !== 4802 ? ":" + port : ""}` : "",
      pin: open ? open.pin : "",
    });
  };

  // ── De quel auteur vient ce message ? ────────────────────────────────
  // L'annuaire indexe des PERSONNES, avec l'empreinte d'un appareil
  // représentatif ; un message porte l'empreinte de l'appareil qui l'a
  // écrit, qui peut être un AUTRE appareil de la même personne. On tente
  // donc l'empreinte, puis le pseudo.
  //
  // ⚠️ REPLI ASSUMÉ : personne inconnue de l'annuaire — elle a quitté le
  // salon, ou le message vient du rattrapage — on dérive la couleur de
  // l'empreinte de l'appareil. Elle reste stable et distinctive, ce qui
  // est tout ce qu'on demande à une pastille. Ne JAMAIS la dériver du
  // pseudo : deux collègues homonymes auraient la même, or c'est
  // exactement ce que l'avatar doit permettre de distinguer.
  const parEmpreinte = useMemo(() => {
    const m = new Map<string, RosterPerson>();
    for (const p of store.roster) m.set(p.fingerprint, p);
    return m;
  }, [store.roster]);
  const parPseudo = useMemo(() => {
    const m = new Map<string, RosterPerson>();
    for (const p of store.roster) if (p.name) m.set(p.name, p);
    return m;
  }, [store.roster]);

  const personneDuMessage = (m: ChatMessage) => {
    const p = (m.deviceFp && parEmpreinte.get(m.deviceFp)) || parPseudo.get(m.from);
    return {
      personId: p?.personId || p?.fingerprint || m.deviceFp || m.from,
      name: p?.name ?? m.from,
      avatarSha: p?.avatarSha ?? null,
    };
  };

  // ⚠️ PHOTO CHOISIE HORS SALON : APPLIQUÉE DÈS QU'ON EN REJOINT UN.
  // Elle a été retenue localement par ChatIdentite, faute d'hôte vers qui
  // la téléverser. On attend de se voir dans l'ANNUAIRE — et non le simple
  // statut « joined » : c'est l'annuaire qui prouve que l'hôte nous connaît
  // et saura rattacher la photo à notre personne.
  // Le garde-fou par ref évite de retenter à chaque rafraîchissement de
  // l'annuaire, lequel arrive à chaque changement de présence.
  const avatarEnCours = useRef(false);
  useEffect(() => {
    if (avatarEnCours.current) return;
    const bytes = avatarEnAttente();
    if (!bytes) return;
    if (!store.roster.some((p) => p.isMe)) return;
    avatarEnCours.current = true;
    getApi()?.invoke?.("chat-media-upload", { bytes, kind: "image", mime: "image/jpeg", thumb: null })
      .then((up: { ok?: boolean; sha256?: string } | undefined) => {
        if (!up?.ok || !up.sha256) { avatarEnCours.current = false; return; }
        getApi()?.send?.("chat-set-avatar", { sha256: up.sha256 });
        // Retirée seulement APRÈS un téléversement réussi : un échec doit
        // laisser la photo en attente, pas la perdre en silence.
        oublierAvatarEnAttente();
        setTimeout(() => getApi()?.send?.("chat-roster"), 400);
      })
      .catch(() => { avatarEnCours.current = false; });
  }, [store.roster]);

  // ⚠️ INVITER VERS UN SALON FERMÉ : ON L'OUVRE, PUIS ON ENVOIE.
  // Un salon fermé n'a ni adresse ni code à transmettre (voir
  // pickInviteRoom, qui les laisse vides) : l'envoi était donc bloqué en
  // amont, sans autre explication qu'un bouton inerte et un avertissement
  // à côté. Inviter quelqu'un dans un salon suppose de toute façon qu'il
  // soit joignable au moment où l'invité clique — autant l'ouvrir nous-
  // mêmes plutôt que d'exiger deux gestes dans le bon ordre.
  // L'invitation est mise en attente le temps que l'hôte démarre ; c'est
  // `host-started` qui apporte l'adresse et le code réels, qu'on ne peut
  // pas deviner avant.
  const invitationEnAttente = useRef<{ to: string | null; roomId: string } | null>(null);

  useEffect(() => {
    const attente = invitationEnAttente.current;
    if (!attente) return;
    const ouvert = store.hostings.find((h) => h.roomId === attente.roomId);
    if (!ouvert) return;
    invitationEnAttente.current = null;
    const ip = ouvert.lanIp || store.roomsLanIp || "";
    if (!ip) { patchStore({ inviteFeedback: "error" }); return; }
    getApi()?.send?.("chat-send-invite", {
      to: attente.to,
      room: {
        name: ouvert.name,
        address: `${ip}${ouvert.wsPort !== 4802 ? ":" + ouvert.wsPort : ""}`,
        wsPort: ouvert.wsPort,
        httpPort: ouvert.httpPort,
        pin: ouvert.pin || null,
      },
    });
    if (!attente.to) patchStore({ inviteFeedback: "delivered" });
  }, [store.hostings]);

  // Envoyable soit parce qu'on a saisi des coordonnées complètes, soit
  // parce qu'on a désigné un salon de CE poste — fermé ou non, puisqu'on
  // sait désormais l'ouvrir. Sans ce second cas, le bouton restait inerte
  // sur un salon fermé, dont l'adresse et le code sont vides par nature.
  const salonDeCePoste = !!inviteRoomId && store.rooms.some((r) => r.roomId === inviteRoomId);
  const invitationPossible = salonDeCePoste
    || (!!inviteRoom.name.trim() && !!inviteRoom.address.trim());

  const sendInvitation = () => {
    const api = getApi();
    if (!api?.send) return;
    // Salon de ce poste, choisi dans la liste, mais pas encore ouvert :
    // on l'ouvre et l'invitation partira dès qu'il aura démarré.
    if (inviteRoomId && !store.hostings.some((h) => h.roomId === inviteRoomId)) {
      invitationEnAttente.current = { to: inviteTarget || null, roomId: inviteRoomId };
      api.invoke?.("chat-start-host", { roomId: inviteRoomId });
      return;
    }
    if (!inviteRoom.name.trim() || !inviteRoom.address.trim()) return;
    // Adresse au format ip[:portWS] — le port HTTP mobile suit (+1 par
    // convention 4802→4803 uniquement si port par défaut)
    const [addr, portStr] = inviteRoom.address.trim().split(":");
    const wsPort = Number(portStr) || 4802;
    api.send("chat-send-invite", {
      to: inviteTarget || null,
      room: {
        name: inviteRoom.name.trim(),
        address: addr,
        wsPort,
        httpPort: wsPort === 4802 ? 4803 : wsPort + 1,
        pin: /^\d{6}$/.test(inviteRoom.pin) ? inviteRoom.pin : null,
      },
    });
    if (!inviteTarget) patchStore({ inviteFeedback: "delivered" });
  };

  // Rejoindre depuis une carte d'invitation : coordonnées connues, PIN
  // prérempli s'il a été transmis — l'utilisateur confirme en un clic
  const joinFromInvite = (extra: InviteExtra) => {
    setPinInput(extra.pin || "");
    handlePickSession({
      sessionName: extra.name,
      address: extra.address,
      wsPort: extra.wsPort || 4802,
      httpPort: extra.httpPort || 4803,
      hostname: extra.address,
    });
  };

  // D.2 — suppression définitive d'un salon depuis la liste « Rouvrir » :
  // historique, appartenances et blocages inclus. Deux gardes : le salon
  // en cours d'hébergement n'est pas supprimable (bouton masqué) et une
  // confirmation explicite est demandée.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ══════════════════════════════════════════════════════════════
  // Coffre chiffré — code d'ACCÈS du salon (D.3)
  // ══════════════════════════════════════════════════════════════
  // Le code se remplit tout seul si l'utilisateur l'a fait retenir, et
  // une case propose de le retenir après une connexion RÉUSSIE (jamais
  // avant : on n'enregistre pas un code erroné).
  // Clé de mémorisation du code d'accès dans le coffre.
  // ⚠️ Le salon entre dans la clé quand il y en a plusieurs derrière le
  // même port : sans lui, Direction et DRH partageraient une entrée, et
  // le code de l'une ouvrirait le formulaire de l'autre — un code faux,
  // proposé avec l'assurance d'un code juste. Sans salon, la clé reste
  // TELLE QU'AVANT : les codes déjà enregistrés continuent d'être
  // retrouvés.
  const roomKeyOf = (s: DiscoveredSession | null) =>
    s ? `${s.address}:${s.wsPort}${s.roomId ? `/${s.roomId}` : ""}` : null;
  const [pinFromVault, setPinFromVault] = useState(false);
  const [rememberPin, setRememberPin] = useState(false);

  useEffect(() => {
    const key = roomKeyOf(store.selectedSession);
    if (store.status !== "entering-pin" || !key) return;
    setPinFromVault(false);
    getApi()?.invoke?.("chat-session-get", key)
      .then((sess: { accessPin?: string } | null) => {
        const pin = sess?.accessPin;
        if (pin && /^\d{6}$/.test(pin)) {
          setPinInput(pin);
          setPinFromVault(true);
          setRememberPin(true); // session active → la case reste cochée
        }
      })
      .catch(() => { /* stockage indisponible — saisie manuelle */ });
  }, [store.status, store.selectedSession?.address, store.selectedSession?.wsPort]);

  // Enregistrement APRÈS connexion réussie uniquement
  const pendingPinSave = useRef<{ key: string; pin: string; name: string } | null>(null);
  useEffect(() => {
    if (store.status !== "joined" || !pendingPinSave.current) return;
    const { key, pin, name } = pendingPinSave.current;
    pendingPinSave.current = null;
    getApi()?.invoke?.("chat-session-save", { roomKey: key, roomName: name, accessPin: pin });
  }, [store.status]);
  const handleDeleteRoom = (roomId: string) => {
    getApi()?.send?.("chat-delete-room", roomId);
    setConfirmDelete(null);
  };

  const handleReopenRoom = async (roomId: string, name: string) => {
    const api = getApi();
    if (!api?.invoke || !nickname.trim()) return;
    store.userId = nickname.trim();
    if (typeof window !== "undefined") localStorage.setItem("hnaya-chat-user-id", nickname.trim());
    patchStore({ status: "connecting", error: null, sessionName: name, messages: [], online: [] });
    const net = await api.invoke("chat-network-check").catch(() => null);
    if (net && net.rulesOk === false) { patchStore({ status: "network-setup" }); return; }
    startConnecting();
    const res = await api.invoke("chat-start-host", { roomId });
    if (!res?.ok) { clearConnectTimer(); patchStore({ status: "error", error: "moduleNotFound" }); }
  };

  // ✅ Fil ouvert sur le DERNIER message (retour de test terrain) : au
  // montage du panneau ET à chaque nouveau message, défiler en bas.
  // "auto" (pas "smooth") pour l'arrivée sur un long historique.
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (store.status === "joined") {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [store.messages.length, store.status]);

  // QR d'invitation mobile — recalculé uniquement quand l'URL change
  // Deux QR distincts : « inviter un mobile » (URL nue, pour un collègue
  // qui choisira son pseudo) et « ajouter mon mobile » (URL + pseudo, pour
  // que le téléphone rejoigne sous LA MÊME identité). Le PIN n'est dans
  // aucun des deux : un QR se photographie par-dessus l'épaule.
  // Étape L — le QR « Ajouter mon mobile » porte en plus un JETON
  // D'APPAIRAGE signé par ce poste. C'est lui qui prouve que le téléphone
  // est bien un second appareil de la même personne : sans preuve, l'hôte
  // en ferait une personne distincte, et l'on retrouverait le doublon dans
  // l'annuaire, le vote et les décisions.
  // Redemandé à chaque ouverture du QR : le jeton expire en quelques
  // minutes, ce qui limite la portée d'une photo prise par-dessus l'épaule.
  const [pairingToken, setPairingToken] = useState<string>("");
  useEffect(() => {
    if (showInvite !== "mine") { setPairingToken(""); return; }
    let vivant = true;
    getApi()?.invoke?.("chat-pairing-token").then((r: { ok?: boolean; token?: unknown }) => {
      if (!vivant || !r?.ok || !r.token) return;
      // base64url : un QR est plus court et plus fiable sans +, / ni =.
      // btoa et non Buffer : on est dans le renderer, sans polyfill Node.
      // Le contenu est intégralement ASCII (hexadécimal, base64, nombres).
      const brut = btoa(JSON.stringify(r.token));
      setPairingToken(brut.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    }).catch(() => { /* pas connecté : le QR marche encore, sans appairage */ });
    return () => { vivant = false; };
  }, [showInvite]);

  const inviteQrTarget = useMemo(() => {
    if (!store.inviteUrl) return "";
    if (showInvite === "mine" && nickname.trim()) {
      const base = `${store.inviteUrl}/?u=${encodeURIComponent(nickname.trim())}`;
      return pairingToken ? `${base}&p=${pairingToken}` : base;
    }
    return store.inviteUrl;
  }, [store.inviteUrl, showInvite, nickname, pairingToken]);

  const inviteQrSvg = useMemo(() => {
    if (!inviteQrTarget) return "";
    const qr = qrcode(0, "M");
    qr.addData(inviteQrTarget);
    qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 0 });
  }, [inviteQrTarget]);

  const theme = getThemeName();
  const isDark = theme === "dark";
  const bg     = isDark ? "#0d1a12" : theme === "light" ? "#fff" : "#1a0500";
  const border = isDark ? "rgba(255,255,255,0.1)" : theme === "light" ? "rgba(0,99,65,0.2)" : "rgba(255,80,20,0.2)";
  const text   = isDark ? "#fff" : theme === "light" ? "#1a2e22" : "#ffd4a0";
  const muted  = isDark ? "rgba(255,255,255,0.45)" : theme === "light" ? "rgba(0,60,30,0.5)" : "rgba(255,150,80,0.6)";
  const accent = theme === "sunset" ? "#c83200" : "#006341";
  const inputBg = isDark ? "rgba(255,255,255,0.07)" : theme === "light" ? "rgba(0,99,65,0.05)" : "rgba(255,80,20,0.07)";

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 4,
    border: `1px solid ${border}`, background: inputBg,
    color: text, fontSize: 13, outline: "none",
  };
  // ⚠️ Une liste déroulante ne se style PAS comme un champ de saisie.
  // `inputStyle` pose un fond translucide, très bien par-dessus le
  // panneau — mais Windows dessine la liste ouverte lui-même, sur un fond
  // BLANC, en héritant de la couleur de texte du thème sombre : texte
  // blanc sur blanc, liste illisible tant qu'une ligne n'est pas
  // survolée. Constaté en test réel sur le choix du destinataire.
  // Fond OPAQUE obligatoire, sur le select ET sur chaque option.
  const selectStyle: React.CSSProperties = {
    ...inputStyle, background: bg, color: text, cursor: "pointer",
  };
  const optionStyle: React.CSSProperties = { background: bg, color: text };

  const btnStyle = (primary = false, disabled = false): React.CSSProperties => ({
    padding: "9px 16px", borderRadius: 4, border: primary ? "none" : `1px solid ${border}`,
    background: primary ? `linear-gradient(135deg,${accent},${accent}cc)` : "transparent",
    color: primary ? "#fff" : text, fontWeight: 600, fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, transition: "all .15s",
  });

  const saveNickname = (value: string) => {
    setNickname(value);
    if (typeof window !== "undefined") localStorage.setItem("hnaya-chat-nickname", value);
  };

  const doCreateRoom = async () => {
    const api = getApi();
    if (!api?.invoke || !nickname.trim()) return;
    store.userId = nickname.trim();
    if (typeof window !== "undefined") localStorage.setItem("hnaya-chat-user-id", nickname.trim());
    // Repartir d'un fil vide : le backlog du serveur va reconstruire
    // l'historique — sans cette remise à zéro, les messages d'un salon
    // précédent (panneau fermé sans « Quitter ») resteraient affichés.
    patchStore({ sessionName: sessionNameInput || "Hnaya Chat", messages: [], online: [] });
    startConnecting();
    // D.2 : PIN admin choisi (optionnel — généré sinon) transmis à la création
    const res = await api.invoke("chat-start-host", {
      sessionName: sessionNameInput || "Hnaya Chat",
      adminPin: /^\d{6}$/.test(adminPinInput) ? adminPinInput : undefined,
    });
    if (!res?.ok) { clearConnectTimer(); patchStore({ status: "error", error: "moduleNotFound" }); }
  };

  const handleCreateRoom = async () => {
    const api = getApi();
    if (!api?.invoke || !nickname.trim()) return;
    // Retour visuel IMMÉDIAT : la vérification pare-feu qui suit peut
    // prendre plusieurs secondes au premier lancement (PowerShell lent
    // sur machines modestes) — sans ce basculement d'écran, l'utilisateur
    // croit que son clic n'a pas été pris en compte et re-clique.
    patchStore({ status: "connecting", error: null });
    // Vérifie l'autorisation pare-feu AVANT d'héberger : sans règle
    // entrante, les autres postes voient le salon mais ne peuvent pas
    // s'y connecter (« Connexion… » qui expire chez eux).
    const net = await api.invoke("chat-network-check").catch(() => null);
    if (net && net.rulesOk === false) { patchStore({ status: "network-setup" }); return; }
    await doCreateRoom();
  };

  const handleNetworkSetup = async (thenDiscover: boolean) => {
    const api = getApi();
    if (!api?.invoke || setupBusy) return;
    setSetupBusy(true);
    // Si l'autorisation est déjà en place (accordée lors d'une session
    // précédente), ne pas redemander l'UAC — relancer simplement l'action.
    const net = await api.invoke("chat-network-check").catch(() => null);
    let ok = net?.rulesOk === true;
    if (!ok) {
      const res = await api.invoke("chat-network-setup").catch(() => null);
      ok = !!res?.ok;
    }
    setSetupBusy(false);
    if (ok) {
      if (thenDiscover) handleStartDiscovery();
      else await doCreateRoom();
    } else {
      patchStore({ status: "error", error: "networkSetupFailed" });
    }
  };

  const handleStartDiscovery = () => {
    const api = getApi();
    if (!api?.send) return;
    patchStore({ discovered: new Map(), status: "discovering" });
    // 30 s d'écoute (annonce toutes les 2 s) : sur machine lente, le
    // démarrage du module peut dépasser une fenêtre courte — avec 4 s,
    // le premier essai ratait systématiquement le salon sur le poste
    // de test le plus modeste.
    api.send("chat-discover", 30000);
    // En parallèle (instantané grâce au cache) : détermine si le bouton
    // « Autoriser l'accès réseau » est pertinent — inutile de l'afficher
    // quand l'autorisation est déjà en place.
    api.invoke?.("chat-network-check")
      .then((net: any) => patchStore({ networkOk: net ? net.rulesOk !== false : null }))
      .catch(() => patchStore({ networkOk: null }));
  };

  const handlePickSession = (session: DiscoveredSession) => {
    patchStore({ selectedSession: session, status: "entering-pin", error: null });
  };

  // ✅ Étape D — rejoindre par adresse IP : indispensable quand la
  // découverte multicast ne passe pas (multi-sites, VPN, VLAN cloisonnés,
  // salon permanent dans un autre sous-réseau). L'adresse est retenue
  // pour la prochaine fois — cas typique : serveur permanent de service.
  const [manualIp, setManualIp] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("hnaya-chat-manual-ip") || "" : ""
  );
  // Format accepté : « 192.168.1.10 » ou « 192.168.1.10:4812 » (D.2 —
  // plusieurs salons permanents par machine, un port WebSocket chacun)
  const manualIpValid = /^[a-zA-Z0-9][a-zA-Z0-9.\-]{2,}(:\d{2,5})?$/.test(manualIp.trim());
  const handleManualJoin = async () => {
    if (!manualIpValid) return;
    const raw = manualIp.trim();
    localStorage.setItem("hnaya-chat-manual-ip", raw);
    const [address, portStr] = raw.split(":");
    const wsPort = Number(portStr) || 4802;
    // Convention : page mobile sur wsPort+1 quand le port n'est pas celui
    // par défaut (serve.js --ws-port 4812 --http-port 4813)
    const httpPort = wsPort === 4802 ? 4803 : wsPort + 1;
    // Récupère le vrai nom du salon via /info.json du serveur (CORS ouvert
    // sur ce seul endpoint) — sinon l'en-tête n'afficherait que l'IP.
    // 1,5 s maximum : ne jamais bloquer la connexion sur ce confort.
    let sessionName = raw;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const info = await fetch(`http://${address}:${httpPort}/info.json`, { signal: ctrl.signal }).then((r) => r.json());
      clearTimeout(timer);
      if (info?.sessionName) sessionName = String(info.sessionName);
      // Serveur multi-salons : demander le code d'accès sans avoir demandé
      // LEQUEL enverrait sur le salon principal, silencieusement. On
      // affiche donc le choix — c'est un salon qu'on rejoint.
      if (Array.isArray(info?.rooms) && info.rooms.length > 1) {
        const carte = new Map(store.discovered);
        carte.set(`${address}:${wsPort}`, {
          sessionName, address, wsPort, httpPort, hostname: address, rooms: info.rooms,
        });
        patchStore({ discovered: carte, status: "discovering" });
        return;
      }
    } catch { /* serveur sans page mobile ou délai — l'IP fera l'affaire */ }
    handlePickSession({
      sessionName, address, wsPort, httpPort, hostname: address,
    });
  };

  const handleJoin = () => {
    const api = getApi();
    if (!api?.send || !store.selectedSession || pinInput.length !== 6 || !nickname.trim()) return;
    store.userId = nickname.trim();
    if (typeof window !== "undefined") localStorage.setItem("hnaya-chat-user-id", nickname.trim());
    // Coffre : mémoriser la demande, l'enregistrement n'aura lieu qu'une
    // fois la connexion acceptée (voir l'effet sur status === "joined")
    const vaultKey = roomKeyOf(store.selectedSession);
    pendingPinSave.current = rememberPin && vaultKey
      ? { key: vaultKey, pin: pinInput, name: store.selectedSession.sessionName || vaultKey }
      : null;
    // Même remise à zéro qu'à la création — le backlog fait foi.
    // ✅ Retenir aussi le nom du salon rejoint : affiché dans l'en-tête
    // du dock une fois connecté (on doit savoir OÙ on discute).
    patchStore({
      messages: [], online: [],
      sessionName: store.selectedSession.sessionName || "",
      // L'invitation mobile pointe vers l'HÔTE (c'est lui qui sert la
      // page) — un participant peut donc aussi montrer le QR
      inviteUrl: `http://${store.selectedSession.address}:${store.selectedSession.httpPort || 4803}`,
    });
    startConnecting();
    api.send("chat-join", {
      address: store.selectedSession.address,
      wsPort: store.selectedSession.wsPort,
      // Sans lui, on atterrirait sur le salon principal de l'hôte, quel
      // que soit celui qu'on a désigné dans la liste.
      roomId: store.selectedSession.roomId || null,
      pin: pinInput,
      userId: store.userId,
      groups: ["all"],
      lastSeenTs: 0,
    });
  };

  const handleSend = async () => {
    const api = getApi();
    const text = messageInput.trim();
    // Un vocal ou une image peut partir SANS texte — d'où la condition
    // sur l'un ou l'autre, et non sur le texte seul.
    if (!api?.send || (!text && !pendingMedia)) return;

    if (!pendingMedia) {
      // Le message part dans le fil OUVERT : le salon, ou la conversation
      // privée en cours.
      api.send("chat-send-message", {
        text, groupId: store.activeThread, media: null, replyTo: replyToId,
        demande: tag ? { tag, destinataire: destinataire || null } : null,
      });
      setMessageInput("");
      setReplyToId(null);
      setTag(null); setDestinataire("");
      return;
    }

    // Le fichier monte D'ABORD chez l'hôte ; le message ne part qu'ensuite,
    // avec l'empreinte calculée par l'hôte — c'est elle qui scelle la
    // signature (voir chat-module/src/identity.js).
    setMediaBusy(true); setMediaError("");
    try {
      const up = await getApi()?.invoke?.("chat-media-upload", {
        bytes: pendingMedia.bytes,
        kind: pendingMedia.kind,
        mime: pendingMedia.mime,
        thumb: pendingMedia.thumb || null,
      });
      if (!up?.ok) {
        const codes: Record<string, string> = {
          "quota-bytes": "mediaQuotaBytes", "quota-files": "mediaQuotaFiles",
          size: "mediaTooBig", mime: "mediaTypeRefused", busy: "mediaBusy",
        };
        setMediaError(t(`Chat.${codes[up?.error] || "mediaFailed"}`));
        return;
      }
      api.send("chat-send-message", {
        text, groupId: store.activeThread, replyTo: replyToId,
        // Une demande de validation porte souvent SUR la pièce jointe (un
        // rapport, un tableur). L'empreinte du fichier est déjà dans le
        // périmètre signé : valider la demande, c'est valider ces
        // octets-là, pas « un fichier du même nom ».
        demande: tag ? { tag, destinataire: destinataire || null } : null,
        media: {
          kind: pendingMedia.kind, mime: pendingMedia.mime,
          sha256: up.sha256, size: up.size,
          thumb: pendingMedia.thumb || null,
          w: pendingMedia.w, h: pendingMedia.h,
          duration: pendingMedia.duration,
          name: pendingMedia.name,
        },
      });
      setMessageInput("");
      setPendingMedia(null);
      setReplyToId(null);
      setTag(null); setDestinataire("");
    } finally {
      setMediaBusy(false);
    }
  };

  /** Quitte la CONVERSATION en laissant le salon ouvert pour les autres. */
  const handleBackToMenu = () => {
    const api = getApi();
    clearConnectTimer();
    api?.send("chat-leave"); // ferme MA connexion, pas le salon
    resetAdminState();
    setShowAdmin(false);
    setShowInvitePanel(false);
    patchStore({
      status: "idle", isHost: false, pin: null, adminPin: null,
      joinedRoomIsHosted: false, hosting: null,
      messages: [], online: [], discovered: new Map(),
      selectedSession: null, error: null, inviteUrl: null,
    });
    setPinInput("");
  };

  const handleLeave = () => {
    const api = getApi();
    clearConnectTimer();
    api?.send("chat-leave");
    // D.2 : l'hébergement ne s'arrête QUE si on quitte le salon qu'on
    // héberge — quitter « X » en hébergeant « Y » laisse Y ouvert (c'est
    // le mécanisme des invitations vers un sous-salon). Le bandeau de
    // l'accueil rappelle le salon resté ouvert.
    if (store.joinedRoomIsHosted) api?.send("chat-stop-host", store.hosting?.roomId || null);
    resetAdminState();
    setShowAdmin(false);
    setShowInvitePanel(false);
    patchStore({
      status: "idle", isHost: false, pin: null, adminPin: null, joinedRoomIsHosted: false,
      messages: [], online: [],
      discovered: new Map(), selectedSession: null, error: null, inviteUrl: null,
    });
    setPinInput("");
  };

  // On rejoint un SALON, pas un serveur. Un hôte qui en sert plusieurs
  // derrière une même écoute (rooms-host.js) les annonce tous : on déplie
  // donc son annonce en une entrée par salon. Chacune porte son roomId,
  // qui voyagera jusqu'au raccordement. Un hôte à salon unique n'annonce
  // pas de liste et reste une entrée, exactement comme avant.
  const discoveredList = Array.from(store.discovered.values()).flatMap((s) =>
    Array.isArray(s.rooms) && s.rooms.length > 0
      ? s.rooms.map((r) => ({ ...s, sessionName: r.name, roomId: r.roomId, rooms: null }))
      : [s],
  );
  // La barre d'onglets latérale occupe déjà les 200px de droite quand elle
  // est active — le dock se place alors juste à sa gauche.
  const rightOffset = position === "right" ? 200 : 0;

  return (
    <div dir={dir} style={{
      position: "fixed", top: "12vh", bottom: 0, right: rightOffset,
      width: DOCK_WIDTH, zIndex: 9000,
      background: bg, borderLeft: `1px solid ${border}`,
      boxShadow: "-8px 0 30px rgba(0,0,0,0.35)",
      padding: 14, color: text,
      display: "flex", flexDirection: "column", gap: 12,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <MessageSquare size={20} style={{ color: accent, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{t("Chat.title")}</div>
          {/* Connecté : afficher le NOM DU SALON (on doit savoir où on
              discute) — sinon le sous-titre descriptif habituel */}
          {store.status === "joined" && store.sessionName ? (
            <div style={{
              fontSize: 11, color: accent, fontWeight: 600, lineHeight: 1.3, marginTop: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {store.sessionName}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: muted, lineHeight: 1.3, marginTop: 1 }}>{t("Chat.subtitle")}</div>
          )}
        </div>
        {/* D.4 — revenir au menu SANS fermer le salon qu'on héberge :
            indispensable pour en ouvrir un second et inviter de l'un vers
            l'autre (le salon resté ouvert apparaît en bandeau à l'accueil). */}
        {store.status === "joined" && store.joinedRoomIsHosted && (
          <button
            onClick={handleBackToMenu}
            title={t("Chat.backToMenuHint")}
            style={{ ...btnStyle(), padding: "5px 10px", fontSize: 11 }}
          >
            {t("Chat.backToMenu")}
          </button>
        )}
        {store.status === "joined" && (
          <button onClick={handleLeave} style={{ ...btnStyle(), padding: "5px 10px", fontSize: 11 }}>
            {/* Sur le salon qu'on HÉBERGE, « Quitter » le FERME pour tout
                le monde — le libellé doit le dire. Ailleurs (même en
                hébergeant un autre salon), on ne fait que sortir. */}
            {store.joinedRoomIsHosted ? t("Chat.closeRoom") : t("Chat.leave")}
          </button>
        )}
        <button onClick={onClose} style={{ background: "none", border: "none", color: muted, fontSize: 18, cursor: "pointer", flexShrink: 0 }}>✕</button>
      </div>

      {/* Contenu déroulant — classe thin-scroll : barre fine visible */}
      <div className="thin-scroll" style={{
        flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12,
        // ✅ Toujours « auto » : en conversation, le fil gère son propre
        // défilement et ce conteneur ne déborde pas — mais les panneaux
        // Admin / Inviter, eux, peuvent dépasser la hauteur du dock. Avec
        // « hidden », leurs derniers champs devenaient inatteignables
        // (retour terrain : « le dock n'a pas de barre de défilement »).
        overflowY: "auto",
      }}>

        {/* Menu principal */}
        {store.status === "idle" && (
          <>
            {/* D.2 — un salon hébergé par ce poste tourne encore (on l'a
                quitté sans le fermer, ex. pour aller inviter ailleurs) */}
            {/* D.4 — TOUS les salons que ce poste héberge (plusieurs
                possibles) : c'est ce qui permet d'inviter d'un salon vers
                un autre resté ouvert. */}
            {store.hostings.map((h) => (
              <div key={h.roomId} style={{
                border: `1px solid ${accent}40`, background: `${accent}12`,
                borderRadius: 6, padding: 8, display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00c853", flexShrink: 0 }} />
                <span style={{ fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t("Chat.hostingBanner")} <b>{h.name}</b>
                </span>
                <button
                  onClick={() => handleReopenRoom(h.roomId, h.name)}
                  style={{ ...btnStyle(true), padding: "4px 9px", fontSize: 10.5, flexShrink: 0 }}
                >
                  {t("Chat.hostingRejoin")}
                </button>
                <button
                  onClick={() => getApi()?.send?.("chat-stop-host", h.roomId)}
                  style={{ ...btnStyle(), padding: "4px 9px", fontSize: 10.5, flexShrink: 0 }}
                >
                  {t("Chat.closeRoom")}
                </button>
              </div>
            ))}
            {/* ── IDENTITÉ ────────────────────────────────────────────
                Le pseudo se pose UNE FOIS, comme un mot de passe : ensuite
                on le rappelle, on ne le redemande pas. Il était présenté en
                champ de saisie obligatoire à chaque ouverture — avec son
                astérisque rouge — alors qu'il était déjà mémorisé et
                simplement réaffiché. Cela donnait à croire qu'il fallait le
                ressaisir, et occupait le haut de l'écran pour rien. */}
            {nickname.trim() && !changerPseudo ? (
              // Hors salon : pas de photo, il n'y a nulle part où l'envoyer.
              <ChatIdentite
                pseudo={nickname}
                onChangerPseudo={() => setChangerPseudo(true)}
                connecte={false}
                accent={accent} muted={muted} border={border} text={text}
              />
            ) : (
              <div>
                <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>
                  {t("Chat.nickname")} <span style={{ color: accent }}>*</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{
                      ...inputStyle, flex: 1,
                      border: `1px solid ${nickname.trim() ? border : `${accent}80`}`,
                    }}
                    value={nickname}
                    onChange={(e) => saveNickname(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && nickname.trim()) setChangerPseudo(false); }}
                    placeholder={t("Chat.nicknamePlaceholder")}
                    autoFocus={changerPseudo}
                  />
                  {nickname.trim() && (
                    <button onClick={() => setChangerPseudo(false)} style={{ ...btnStyle(true), padding: "0 14px" }}>
                      {t("Chat.nicknameDone")}
                    </button>
                  )}
                </div>
                {!nickname.trim() && (
                  <div style={{ fontSize: 11, color: accent, marginTop: 4 }}>
                    {t("Chat.nicknameRequired")}
                  </div>
                )}
              </div>
            )}

            {/* ── CRÉER UN SALON — action RARE, donc repliée ───────────
                Une organisation crée ses salons à l'installation, puis
                presque plus jamais. Trois champs de saisie occupaient
                pourtant le haut de l'écran à chaque ouverture, devant les
                salons existants, qui sont eux l'usage quotidien.
                Retour terrain : « je ne vois pas l'intérêt de proposer la
                création d'un salon à chaque ouverture de la messagerie ». */}
            {!creationOuverte ? (
              <button
                onClick={() => setCreationOuverte(true)}
                style={{
                  ...btnStyle(), width: "100%", padding: "7px 10px", fontSize: 11.5,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  opacity: 0.75,
                }}
              >
                <Plus size={13} /> {t("Chat.createRoom")}
              </button>
            ) : (
              <div style={{ borderTop: `1px solid ${border}`, paddingTop: 12 }}>
                <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>{t("Chat.sessionName")}</div>
                <input
                  style={{ ...inputStyle, marginBottom: 8 }}
                  value={sessionNameInput}
                  onChange={(e) => setSessionNameInput(e.target.value)}
                  placeholder={t("Chat.sessionNamePlaceholder")}
                  autoFocus
                />
                {/* D.2 — PIN admin choisi (optionnel, généré sinon) : fini
                    le PIN fantôme découvert après coup dans les Réglages */}
                <input
                  style={{ ...inputStyle, marginBottom: 8, direction: "ltr", textAlign: "start" }}
                  value={adminPinInput}
                  onChange={(e) => setAdminPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("Chat.adminPinOptional")}
                  inputMode="numeric"
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={handleCreateRoom}
                    disabled={!nickname.trim()}
                    style={{ ...btnStyle(true, !nickname.trim()), flex: 1 }}
                  >
                    {t("Chat.createRoom")}
                  </button>
                  <button onClick={() => setCreationOuverte(false)} style={{ ...btnStyle(), padding: "0 14px" }}>
                    {t("Chat.cancel")}
                  </button>
                </div>
              </div>
            )}

            {/* D.2 — réouverture explicite : c'est ICI que vit la
                continuité (« Créer » = toujours un salon neuf) */}
            {store.rooms.length > 0 && (
              <div style={{ borderTop: `1px solid ${border}`, paddingTop: 12 }}>
                <div style={{ fontSize: 11, color: muted, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                  <History size={12} /> {t("Chat.reopenTitle")}
                </div>
                {/* ⚠️ La confirmation vit HORS de la liste déroulante :
                    à l'intérieur, ses boutons pouvaient tomber sous la zone
                    visible et devenaient inatteignables (retour terrain :
                    « pas moyen de confirmer »). */}
                {confirmDelete && (
                  <div style={{
                    border: "1px solid #ff525260", background: "rgba(255,82,82,0.08)",
                    borderRadius: 4, padding: 8, marginBottom: 8,
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                    <div style={{ fontSize: 10.5, lineHeight: 1.45 }}>
                      {t("Chat.deleteConfirm")}{" "}
                      <b>{store.rooms.find((r) => r.roomId === confirmDelete)?.name}</b>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => handleDeleteRoom(confirmDelete)}
                        style={{ ...btnStyle(), flex: 1, padding: "6px 8px", fontSize: 10.5, color: "#ff5252", border: "1px solid #ff525260" }}
                      >
                        {t("Chat.deleteYes")}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        style={{ ...btnStyle(), flex: 1, padding: "6px 8px", fontSize: 10.5 }}
                      >
                        {t("Chat.cancel")}
                      </button>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                  {store.rooms.slice(0, 8).map((r) => (
                    <div key={r.roomId} style={{
                      display: "flex", gap: 6, alignItems: "stretch",
                      opacity: confirmDelete && confirmDelete !== r.roomId ? 0.45 : 1,
                    }}>
                      <button
                        onClick={() => handleReopenRoom(r.roomId, r.name)}
                        disabled={!nickname.trim() || !!confirmDelete}
                        style={{
                          ...btnStyle(false, !nickname.trim() || !!confirmDelete), flex: 1, minWidth: 0,
                          display: "flex", alignItems: "center", gap: 8, textAlign: "start",
                        }}
                      >
                        <DoorOpen size={13} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                        <span style={{ fontSize: 9.5, color: muted, flexShrink: 0 }}>
                          {new Date(r.lastUsed).toLocaleDateString()}
                        </span>
                      </button>
                      {/* Pas de suppression du salon actuellement hébergé
                          (il faut le fermer d'abord) */}
                      {!store.hostings.some((h) => h.roomId === r.roomId) && (
                        <button
                          onClick={() => setConfirmDelete(r.roomId)}
                          title={t("Chat.deleteRoom")}
                          style={{
                            ...btnStyle(), padding: "0 9px", flexShrink: 0,
                            color: confirmDelete === r.roomId ? "#ff5252" : muted,
                            border: `1px solid ${confirmDelete === r.roomId ? "#ff525260" : border}`,
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ borderTop: `1px solid ${border}`, paddingTop: 12 }}>
              <button
                onClick={handleStartDiscovery}
                disabled={!nickname.trim()}
                style={{ ...btnStyle(false, !nickname.trim()), width: "100%" }}
              >
                {t("Chat.joinRoom")}
              </button>
            </div>

            {/* Serveur permanent (tier premium) — section repliée, ne
                concerne que l'IT/gérant sur la machine toujours allumée */}
            <ChatServerSetup
              accent={accent} muted={muted} border={border}
              inputStyle={inputStyle} btnStyle={btnStyle}
            />

            <div style={{ fontSize: 10, color: muted, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              <Lock size={11} style={{ flexShrink: 0 }} /> {t("Chat.securityNotice")}
            </div>
          </>
        )}

        {/* Découverte des salons */}
        {store.status === "discovering" && (
          <>
            <div style={{ textAlign: "center", padding: "6px 0", color: muted, fontSize: 12 }}>
              {t("Chat.searching")}
            </div>
            {discoveredList.length === 0 ? (
              <>
                <div style={{ textAlign: "center", padding: "10px 0", color: muted, fontSize: 12 }}>
                  {t("Chat.noRoomsFound")}
                </div>
                {/* Bouton d'autorisation UNIQUEMENT si elle est absente —
                    l'afficher en permanence sème le doute chez l'utilisateur
                    déjà autorisé (retour de test terrain) */}
                {store.networkOk === false && (
                  <>
                    <div style={{ fontSize: 11, color: muted, textAlign: "center" }}>
                      {t("Chat.noRoomsHint")}
                    </div>
                    <button
                      onClick={() => handleNetworkSetup(true)}
                      disabled={setupBusy}
                      style={{ ...btnStyle(false, setupBusy), width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      {setupBusy ? "…" : <><Shield size={14} /> {t("Chat.networkSetupAllow")}</>}
                    </button>
                  </>
                )}
              </>
            ) : (
              discoveredList.map((s) => (
                <button
                  key={`${s.address}:${s.wsPort}/${s.roomId || ""}`}
                  onClick={() => handlePickSession(s)}
                  style={{
                    ...btnStyle(), width: "100%", textAlign: isRTL ? "right" : "left",
                    display: "flex", flexDirection: "column", gap: 2,
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{s.sessionName}</span>
                  <span style={{ fontSize: 11, color: muted }}>{s.hostname} · {s.address}</span>
                </button>
              ))
            )}
            {/* Rejoindre par IP (étape D) : serveurs permanents ou salons
                hors de portée du multicast */}
            <div style={{ borderTop: `1px solid ${border}`, paddingTop: 8, marginTop: 2 }}>
              <div style={{ fontSize: 10.5, color: muted, marginBottom: 5 }}>{t("Chat.manualIpHint")}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  style={{ ...inputStyle, flex: 1, direction: "ltr", textAlign: "start" }}
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleManualJoin()}
                  placeholder="192.168.1.10"
                />
                <button onClick={handleManualJoin} disabled={!manualIpValid} style={btnStyle(true, !manualIpValid)}>
                  {t("Chat.manualIpJoin")}
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => patchStore({ status: "idle" })} style={{ ...btnStyle(), flex: 1 }}>
                {t("Chat.back")}
              </button>
              <button onClick={handleStartDiscovery} style={{ ...btnStyle(), flex: 1 }}>
                {t("Chat.refresh")}
              </button>
            </div>
          </>
        )}

        {/* Saisie du PIN */}
        {store.status === "entering-pin" && (
          <>
            <div style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>{store.selectedSession?.sessionName}</span>
              {" — "}
              <span style={{ color: muted }}>{store.selectedSession?.address}</span>
            </div>
            <div>
              <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>{t("Chat.enterPin")}</div>
              <input
                style={{ ...inputStyle, letterSpacing: 4, fontSize: 18, textAlign: "center" }}
                value={pinInput}
                maxLength={6}
                inputMode="numeric"
                onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, "")); setPinFromVault(false); }}
                placeholder={t("Chat.pinPlaceholder")}
              />
              {/* Coffre chiffré : code rempli automatiquement, ou case à
                  cocher pour le faire retenir après une connexion réussie */}
              {pinFromVault ? (
                <div style={{ fontSize: 10, color: "#00c853", marginTop: 5, display: "flex", alignItems: "center", gap: 5 }}>
                  <KeySquare size={11} /> {t("Chat.pinFromVault")}
                  <button
                    onClick={() => {
                      const key = roomKeyOf(store.selectedSession);
                      if (key) getApi()?.invoke?.("chat-session-forget", key);
                      setPinInput(""); setPinFromVault(false); setRememberPin(false);
                    }}
                    style={{ background: "none", border: "none", color: muted, cursor: "pointer", fontSize: 10, textDecoration: "underline", padding: 0 }}
                  >
                    {t("Chat.pinForget")}
                  </button>
                </div>
              ) : (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 10.5, color: muted, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={rememberPin}
                      onChange={(e) => setRememberPin(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    <KeySquare size={11} /> {t("Chat.pinRemember")}
                  </label>
                  {rememberPin && (
                    <div style={{ fontSize: 9.5, color: muted, marginTop: 4, lineHeight: 1.45 }}>
                      {t("Chat.pinRememberHint")}
                    </div>
                  )}
                </>
              )}
            </div>
            {store.error && (
              <div style={{ color: "#ff6060", fontSize: 12, textAlign: "center" }}>
                {t(`Chat.${store.error}`)}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => patchStore({ status: "discovering", error: null })} style={{ ...btnStyle(), flex: 1 }}>
                {t("Chat.back")}
              </button>
              <button
                onClick={handleJoin}
                disabled={pinInput.length !== 6}
                style={{ ...btnStyle(true, pinInput.length !== 6), flex: 2 }}
              >
                {t("Chat.join")}
              </button>
            </div>
          </>
        )}

        {/* Autorisation pare-feu requise pour héberger */}
        {store.status === "network-setup" && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <Shield size={15} style={{ color: accent, flexShrink: 0 }} /> {t("Chat.networkSetupTitle")}
            </div>
            <div style={{ fontSize: 12, color: muted, lineHeight: 1.6 }}>
              {t("Chat.networkSetupExplain")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => patchStore({ status: "idle" })} style={{ ...btnStyle(), flex: 1 }}>
                {t("Chat.back")}
              </button>
              <button
                onClick={() => handleNetworkSetup(false)}
                disabled={setupBusy}
                style={{ ...btnStyle(true, setupBusy), flex: 2 }}
              >
                {setupBusy ? "…" : t("Chat.networkSetupAllow")}
              </button>
            </div>
          </>
        )}

        {/* Connexion en cours */}
        {store.status === "connecting" && (
          <div style={{ textAlign: "center", padding: "20px 0", color: muted, fontSize: 13 }}>
            {t("Chat.joining")}…
          </div>
        )}

        {/* Erreur générique (hors saisie PIN) */}
        {store.status === "error" && (
          <>
            <div style={{ textAlign: "center", padding: "12px 0", color: "#ff6060", fontSize: 13 }}>
              ⚠️ {t(`Chat.${store.error}`)}
            </div>
            <button onClick={() => patchStore({ status: "idle", error: null })} style={{ ...btnStyle(), width: "100%" }}>
              {t("Chat.back")}
            </button>
          </>
        )}

        {/* Salon rejoint — fil de discussion */}
        {store.status === "joined" && (
          <>
            {/* D.2 — les DEUX PINs de l'hôte, masqués par défaut avec œil
                individuel : montrer le PIN d'accès à un collègue n'expose
                jamais le PIN admin */}
            {/* Présence ET accès aux codes sur UNE SEULE ligne.
                Les deux occupaient chacune la leur, et le bloc des codes
                restait déplié en permanence — trois lignes de chrome pour
                une information qu'on note une fois et qu'on ne relit
                jamais. Dans un dock de 340 px, cela se prend directement
                sur la zone de lecture, que l'usage réel a signalée comme
                trop courte. Le choix est mémorisé : replié une fois,
                replié pour toujours. */}
            <div style={{ fontSize: 11, color: muted, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00c853", flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{store.online.length} {t("Chat.online")}</span>
              {store.joinedRoomIsHosted && store.pin && !showAdmin && (
                <button
                  onClick={() => { const v = !codesVisibles; setCodesVisibles(v); try { localStorage.setItem("hnaya-chat-codes", v ? "1" : "0"); } catch {} }}
                  style={{
                    background: "transparent", border: `1px solid ${border}`, borderRadius: 4,
                    color: "inherit", cursor: "pointer", fontSize: 9.5, padding: "2px 7px",
                    display: "flex", alignItems: "center", gap: 3, flexShrink: 0,
                  }}
                >
                  <KeyRound size={10} /> {t("Chat.codes")}
                </button>
              )}
            </div>

            {store.joinedRoomIsHosted && store.pin && !showAdmin && codesVisibles && (
              <div style={{
                background: `${accent}18`, border: `1px solid ${accent}40`, borderRadius: 8,
                padding: "8px 10px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4,
              }}>
                <PinRow label={t("Chat.yourPin")} pin={store.pin} accent={accent} muted={muted} />
                {store.adminPin && (
                  <PinRow label={t("Chat.adminPinYours")} pin={store.adminPin} accent={accent} muted={muted} />
                )}
                <div style={{ fontSize: 9, color: muted, textAlign: "center" }}>{t("Chat.pinHint")}</div>
              </div>
            )}

            {/* ⚠️ flexWrap est INDISPENSABLE ici. Ces cinq boutons portent
                tous flexShrink:0 (leur libellé ne doit pas être tronqué) et
                le dock ne fait que ~340 px : sur une seule ligne, « Annuaire »,
                « Inviter vers » et « Admin » sortaient de l'écran. Ils
                n'étaient atteignables qu'en découvrant un défilement dont
                rien ne signalait l'existence — un nouvel utilisateur pouvait
                ignorer ces trois fonctions. Constaté en usage réel.
                Ne pas revenir à une ligne unique sans rendre les libellés
                rétractables. */}
            <div style={{ fontSize: 11, color: muted, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {/* Inviter un téléphone : QR vers la page mobile servie par
                  l'hôte — visible pour tous les participants (l'URL pointe
                  toujours vers l'hôte), masqué si le poste n'a pas de LAN */}
              {store.inviteUrl && !showAdmin && plusOuvert && (
                <>
                  {/* Lier SON PROPRE téléphone : le QR emporte le pseudo, le
                      mobile rejoint sous la même identité sans en inventer
                      un second. */}
                  <button
                    onClick={() => setShowInvite(v => (v === "mine" ? false : "mine"))}
                    disabled={!nickname.trim()}
                    style={{
                      ...btnStyle(showInvite === "mine", !nickname.trim()),
                      padding: "4px 8px", fontSize: 10,
                      display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                    }}
                    title={showInvite === "mine" ? t("Chat.inviteClose") : t("Chat.addMyPhone")}
                  >
                    <Smartphone size={12} />
                    {showInvite === "mine" ? t("Chat.inviteClose") : t("Chat.addMyPhone")}
                  </button>
                  <button
                    onClick={() => setShowInvite(v => (v === "guest" ? false : "guest"))}
                    style={{
                      ...btnStyle(showInvite === "guest"), padding: "4px 8px", fontSize: 10,
                      display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                    }}
                    title={showInvite === "guest" ? t("Chat.inviteClose") : t("Chat.invitePhone")}
                  >
                    <Smartphone size={12} />
                    {/* Le bouton devient « Fermer » quand le QR est affiché —
                        demande explicite du test terrain (dégager le dock) */}
                    {showInvite === "guest" ? t("Chat.inviteClose") : t("Chat.invitePhone")}
                  </button>
                </>
              )}
              {/* Étape F — annuaire : écrire à quelqu'un sans créer de
                  salon ni partager de PIN. Le total de non-lus privés est
                  visible depuis le bouton, fil fermé. */}
              {!showAdmin && (
                <button
                  onClick={() => { setShowRoster(v => !v); getApi()?.send?.("chat-roster"); }}
                  style={{
                    ...btnStyle(showRoster), padding: "4px 8px", fontSize: 10,
                    display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  }}
                  title={showRoster ? t("Chat.inviteClose") : t("Chat.rosterTitle")}
                >
                  <Users size={12} />
                  {showRoster ? t("Chat.inviteClose") : t("Chat.rosterTitle")}
                  {totalPrives > 0 && (
                    <span style={{
                      background: "#ff5252", color: "#fff", borderRadius: 8,
                      minWidth: 15, height: 15, fontSize: 9, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                    }}>{totalPrives}</span>
                  )}
                </button>
              )}
              {/* Étape J — signal sonore, activable. Allumer joue le son
                  aussitôt : l'utilisateur entend ce qu'il vient d'activer,
                  et cela confirme du même coup que l'audio du poste marche
                  — sinon un réglage « activé » sans effet resterait un
                  mystère. Le clic est aussi le geste utilisateur exigé par
                  Chromium pour débloquer la lecture. */}
              {!showAdmin && (
                <button
                  onClick={() => {
                    const suivant = !son;
                    definirSon(suivant);
                    setSon(suivant);
                    if (suivant) jouerSon("private");
                  }}
                  style={{
                    ...btnStyle(son), padding: "4px 8px", fontSize: 10,
                    display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  }}
                  title={son ? t("Chat.soundOn") : t("Chat.soundOff")}
                  aria-label={son ? t("Chat.soundOn") : t("Chat.soundOff")}
                >
                  {son ? <Volume2 size={12} /> : <VolumeX size={12} />}
                </button>
              )}
              {/* Étape P — annoncer une réunion */}
              {!showAdmin && (
                <button
                  onClick={() => setReunionOuverte((v) => !v)}
                  disabled={store.licenceReadOnly}
                  style={{
                    ...btnStyle(reunionOuverte), padding: "4px 8px", fontSize: 10,
                    display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  }}
                >
                  <CalendarClock size={12} /> {t("Chat.meeting")}
                </button>
              )}
              {/* Étape H — soumettre au vote */}
              {!showAdmin && (
                <button
                  onClick={() => setVoteOuvert((v) => !v)}
                  style={{
                    ...btnStyle(voteOuvert), padding: "4px 8px", fontSize: 10,
                    display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  }}
                  title={voteOuvert ? t("Chat.inviteClose") : t("Chat.voteNew")}
                >
                  <CheckCircle2 size={12} />
                  {voteOuvert ? t("Chat.inviteClose") : t("Chat.voteShort")}
                </button>
              )}
              {/* D.2 — inviter les membres vers un autre salon (sous-salon) */}
              {!showAdmin && plusOuvert && (
                <button
                  onClick={() => (showInvitePanel ? setShowInvitePanel(false) : openInvitePanel())}
                  style={{
                    ...btnStyle(showInvitePanel), padding: "4px 8px", fontSize: 10,
                    display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  }}
                  title={showInvitePanel ? t("Chat.inviteClose") : t("Chat.inviteToRoom")}
                >
                  <Send size={12} />
                  {showInvitePanel ? t("Chat.inviteClose") : t("Chat.inviteToRoom")}
                </button>
              )}
              {/* Administration (étape D) : registre des appareils,
                  historique, réglages — protégé par le PIN admin */}
              {!showInvitePanel && (plusOuvert || showAdmin) && (
                <button
                  onClick={toggleAdmin}
                  style={{
                    ...btnStyle(showAdmin), padding: "4px 8px", fontSize: 10,
                    display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  }}
                  title={showAdmin ? t("Chat.inviteClose") : t("Chat.admin")}
                >
                  <KeyRound size={12} />
                  {showAdmin ? t("Chat.inviteClose") : t("Chat.admin")}
                </button>
              )}
              {/* ⚠️ « Plus » est un BOUTON VISIBLE, pas un menu caché.
                  La leçon de l'étape précédente tient toujours : trois
                  actions inatteignables sans découvrir un défilement que
                  rien ne signalait, et un utilisateur pouvait ignorer
                  qu'elles existaient. Un bouton étiqueté se voit ; ce qui
                  était invisible, c'était le hors-champ.
                  Restent en ligne les actions du quotidien — annuaire,
                  son, réunion, vote. Passent derrière « Plus » celles
                  qu'on utilise une fois par salon : lier son téléphone,
                  inviter, administrer. Une rangée gagnée, prise sur le
                  chrome et rendue à la lecture. */}
              {!showAdmin && (
                <button
                  onClick={() => setPlusOuvert((v) => !v)}
                  style={{
                    ...btnStyle(plusOuvert), padding: "4px 8px", fontSize: 10,
                    display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  }}
                  title={t("Chat.moreActions")}
                >
                  {plusOuvert ? <ChevronUp size={12} /> : <MoreHorizontal size={12} />}
                  {plusOuvert ? t("Chat.inviteClose") : t("Chat.moreActions")}
                </button>
              )}
            </div>

            {/* D.2 — panneau d'envoi d'invitation : coordonnées du salon
                cible (préremplies si on héberge) + destinataire. Ciblée =
                remise directe jamais persistée ; à tous = message
                persistant dans le fil. */}
            {showInvitePanel && !showAdmin && (
              <div style={{
                border: `1px solid ${border}`, borderRadius: 8, padding: 10,
                display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, background: inputBg,
              }}>
                {/* Explication du principe : on invite les membres d'ICI
                    vers un AUTRE salon (retour terrain : « je ne comprends
                    pas avec quelle logique fonctionne ce bouton ») */}
                <div style={{ fontSize: 10, color: muted, lineHeight: 1.5 }}>
                  {t("Chat.invitePanelHint")}
                </div>
                {/* Sélecteur des salons de ce poste — remplit nom, adresse
                    et PIN automatiquement (retour terrain) */}
                {store.rooms.length > 0 && (
                  <select
                    value={inviteRoomId}
                    onChange={(e) => pickInviteRoom(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="" style={optionStyle}>{t("Chat.inviteRoomPick")}</option>
                    {store.rooms.map((r) => (
                      <option key={r.roomId} value={r.roomId} style={optionStyle}>
                        {r.name}{store.hostings.some((h) => h.roomId === r.roomId) ? " ● " + t("Chat.inviteRoomOpen") : ""}
                      </option>
                    ))}
                  </select>
                )}
                {/* Salon choisi mais pas ouvert → il faut l'ouvrir pour que
                    l'invitation soit utilisable */}
                {inviteRoomId && !store.hostings.some((h) => h.roomId === inviteRoomId) && (
                  <div style={{ fontSize: 10, color: "#ffb300", lineHeight: 1.5 }}>
                    {t("Chat.inviteRoomClosedHint")}
                  </div>
                )}
                {store.hostings.length === 0 && !inviteRoomId && (
                  <div style={{ fontSize: 10, color: "#ffb300", lineHeight: 1.5 }}>
                    {t("Chat.inviteNoHostHint")}
                  </div>
                )}
                <input style={inputStyle} value={inviteRoom.name}
                  onChange={(e) => setInviteRoom((s) => ({ ...s, name: e.target.value }))}
                  placeholder={t("Chat.inviteRoomName")} />
                <input style={{ ...inputStyle, direction: "ltr", textAlign: "start" }} value={inviteRoom.address}
                  onChange={(e) => setInviteRoom((s) => ({ ...s, address: e.target.value }))}
                  placeholder={t("Chat.inviteRoomAddress")} />
                <input style={{ ...inputStyle, direction: "ltr", textAlign: "start" }} value={inviteRoom.pin}
                  onChange={(e) => setInviteRoom((s) => ({ ...s, pin: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                  placeholder={t("Chat.inviteRoomPin")} inputMode="numeric" />
                <select
                  value={inviteTarget}
                  onChange={(e) => setInviteTarget(e.target.value)}
                  style={selectStyle}
                >
                  {/* « À tous » + un choix par membre connecté (le compteur
                      lève le doute quand on est seul dans le salon) */}
                  <option value="" style={optionStyle}>
                    {t("Chat.inviteAll")} — {store.online.length} {t("Chat.online")}
                  </option>
                  {store.online.filter((u) => u !== store.userId).map((u) => (
                    <option key={u} value={u} style={optionStyle}>{u}</option>
                  ))}
                </select>
                <div style={{ fontSize: 9.5, color: muted, lineHeight: 1.5 }}>
                  {inviteTarget ? t("Chat.inviteTargetedHint") : t("Chat.inviteAllHint")}
                </div>
                <button
                  onClick={sendInvitation}
                  disabled={!invitationPossible}
                  style={btnStyle(true, !invitationPossible)}
                >
                  {t("Chat.inviteSend")}
                </button>
                {store.inviteFeedback && (
                  <div style={{ fontSize: 10.5, color: store.inviteFeedback === "delivered" ? "#00c853" : "#ffb300" }}>
                    {store.inviteFeedback === "delivered" ? t("Chat.inviteDelivered") : t("Chat.inviteOffline")}
                  </div>
                )}
              </div>
            )}

            {/* Panneau admin (étape D) — remplace fil + composeur */}
            {showAdmin && (
              <ChatAdminPanel
                accent={accent}
                muted={muted}
                border={border}
                inputBg={inputBg}
                inputStyle={inputStyle}
                btnStyle={btnStyle}
                selectStyle={selectStyle}
                optionStyle={optionStyle}
              />
            )}

            {/* Panneau QR d'invitation mobile */}
            {!showAdmin && showInvite && store.inviteUrl && (
              <div style={{
                background: `${accent}12`, border: `1px solid ${accent}35`, borderRadius: 10,
                padding: 10, textAlign: "center", flexShrink: 0,
              }}>
                <div style={{
                  background: "#fff", borderRadius: 6, padding: 6,
                  display: "inline-block", lineHeight: 0,
                }}
                  // QR noir sur fond blanc quel que soit le thème — condition
                  // de lisibilité pour les caméras de téléphone
                  dangerouslySetInnerHTML={{ __html: inviteQrSvg }}
                />
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, direction: "ltr", wordBreak: "break-all" }}>
                  {inviteQrTarget}
                </div>
                <div style={{ fontSize: 9.5, color: muted, marginTop: 4, lineHeight: 1.5 }}>
                  {showInvite === "mine" ? t("Chat.addMyPhoneHint") : t("Chat.inviteHint")}
                </div>
              </div>
            )}

            {/* Fil de messages : occupe tout l'espace restant du dock,
                défile indépendamment (minHeight: 0 requis en flex) */}
            {/* Étape P — réunions à venir, ÉPINGLÉES en tête du fil. Elles
                y restent jusqu'à leur heure de fin, puis redescendent dans
                l'historique comme n'importe quel message — sinon le haut
                du salon se remplirait de réunions périmées. */}
            {!showAdmin && !showRoster && reunionsAVenir.map((m) => (
              <div key={"pin-" + m.id} style={{ flexShrink: 0 }}>
                <ChatMeetingCard message={m} accent={accent} muted={muted} border={border} compact />
              </div>
            ))}

            {/* Étape J — messages privés en attente. Ils n'étaient signalés
                que par un petit compte sur le bouton « Annuaire », au milieu
                d'une rangée d'autres boutons : on ne le voyait pas. Ici, le
                bandeau NOMME l'expéditeur et ouvre la conversation d'un clic.
                Il ne s'affiche que pour les fils qu'on ne regarde pas. */}
            {!showAdmin && !showRoster && privesEnAttente
              .filter((p) => p.fil !== store.activeThread)
              .map((p) => (
                <button
                  key={p.fil}
                  onClick={() => ouvrirFil(p.fil, { name: p.de, role: null })}
                  style={{
                    display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                    width: "100%", textAlign: "start", cursor: "pointer",
                    background: "rgba(255,82,82,0.14)", border: "1px solid rgba(255,82,82,0.45)",
                    borderRadius: 6, padding: "7px 9px", color: "inherit",
                  }}
                >
                  <MessageSquare size={13} style={{ color: "#ff8080", flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, flex: 1, minWidth: 0 }}>
                    <b>{p.de}</b> — {t("Chat.privateWaiting")}
                  </span>
                  <span style={{
                    background: "#ff5252", color: "#fff", borderRadius: 8,
                    minWidth: 16, height: 16, fontSize: 9.5, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "0 4px", flexShrink: 0,
                  }}>{p.n}</span>
                </button>
              ))}

            {/* Étape F — bandeau du fil privé : on doit savoir À QUI l'on
                écrit, et pouvoir revenir au salon d'un geste. */}
            {!showAdmin && threadPeer && store.activeThread !== "all" && (
              <div style={{
                display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                background: `${accent}18`, border: `1px solid ${accent}40`,
                borderRadius: 6, padding: "6px 8px",
              }}>
                <button
                  onClick={revenirAuSalon}
                  style={{ background: "transparent", border: "none", color: muted, cursor: "pointer", padding: 2, display: "flex" }}
                  title={t("Chat.threadBack")}
                  aria-label={t("Chat.threadBack")}
                >
                  {isRTL ? <ArrowLeft size={14} style={{ transform: "scaleX(-1)" }} /> : <ArrowLeft size={14} />}
                </button>
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <b>{threadPeer.name || t("Chat.rosterUnnamed")}</b>
                  {threadPeer.role && <span style={{ color: accent }}> · {threadPeer.role}</span>}
                </span>
                <span style={{ fontSize: 9.5, color: muted, flexShrink: 0 }}>{t("Chat.threadPrivate")}</span>
              </div>
            )}

            {/* ── OÙ L'ON ÉCRIT — bandeau du SALON ────────────────────────
                ⚠️ RISQUE DE CONFIDENTIALITÉ, PAS SIMPLE CONFORT.
                Le fil privé nommait son destinataire dans un bandeau bien
                visible ; le salon, lui, n'avait que son nom en 11 px sous
                le titre du panneau. Cette asymétrie est précisément ce qui
                permet d'écrire à la Direction en croyant écrire à la DRH —
                et tout l'intérêt du produit repose sur le cloisonnement.
                Signalé en usage réel : « on ne voit pas son nom, ce qui
                pourrait causer l'envoi d'informations confidentielles vers
                les mauvais destinataires. »
                Même grammaire visuelle que le bandeau privé, à la même
                place : ce qui change, c'est la destination, pas la forme. */}
            {!showAdmin && !showRoster && store.activeThread === "all" && store.sessionName && (
              <div style={{
                display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                background: `${accent}18`, border: `1px solid ${accent}40`,
                borderRadius: 6, padding: "6px 8px",
              }}>
                <Users size={13} style={{ color: accent, flexShrink: 0 }} />
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 11.5,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  <b>{store.sessionName}</b>
                </span>
                <span style={{ fontSize: 9.5, color: muted, flexShrink: 0 }}>
                  {store.online.length > 0
                    ? `${store.online.length} ${t("Chat.roomBannerPeople")}`
                    : t("Chat.roomBannerAll")}
                </span>
              </div>
            )}

            {/* Annuaire : remplace le fil tant qu'il est ouvert */}
            {!showAdmin && showRoster && <div style={{
              flex: 1, minHeight: 0, overflowY: "auto",
              background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 10,
            }}>
              <ChatRoster
                accent={accent} muted={muted} border={border} text={text}
                onOpenThread={ouvrirFil}
                unreadByThread={store.unreadPrivate}
              />
            </div>}

            {!showAdmin && !showRoster && <div style={{
              flex: 1, minHeight: 0, overflowY: "auto",
              display: "flex", flexDirection: "column", gap: 8,
              background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 10,
            }}>
              {messagesDuFil.length === 0 ? (
                <div style={{ textAlign: "center", color: muted, fontSize: 12, padding: "16px 0" }}>
                  {store.activeThread === "all" ? t("Chat.noMessages") : t("Chat.threadEmpty")}
                </div>
              ) : (
                messagesDuFil.map((m, rang) => {
                  const isMine = m.from === store.userId;
                  // ⚠️ UN AVATAR PAR PRISE DE PAROLE, PAS PAR MESSAGE.
                  // Répété à chaque ligne, un échange animé devient une
                  // colonne de vignettes qui mange la largeur utile d'un
                  // dock de 340 px. On ne le montre donc qu'au CHANGEMENT
                  // d'auteur ; les messages suivants gardent un retrait de
                  // même largeur, pour que les bulles restent alignées.
                  const precedent = messagesDuFil[rang - 1];
                  const nouvelAuteur = !precedent
                    || precedent.from !== m.from
                    || (precedent.deviceFp || "") !== (m.deviceFp || "");
                  const qui = personneDuMessage(m);
                  // D.2 — carte d'invitation : cliquable, rejoint le salon
                  // invité avec le PIN prérempli s'il a été transmis
                  if (m.type === "invite" && m.extra) {
                    // Même remarque que pour le vote : `extra` est construit
                    // par l'hôte SELON le type, mais TypeScript ne sait pas
                    // discriminer sur un `type` optionnel.
                    const inv = m.extra as InviteExtra;
                    // L'expéditeur ne se voit PAS proposer de rejoindre son
                    // propre salon (retour terrain) — simple accusé discret
                    if (isMine) {
                      return (
                        <div key={m.id} style={{
                          alignSelf: "center", fontSize: 9.5, color: muted,
                          textAlign: "center", padding: "2px 0",
                        }}>
                          {t("Chat.inviteSentTo")} <b>{inv.name}</b>
                        </div>
                      );
                    }
                    return (
                      <div key={m.id} style={{
                        alignSelf: "center", width: "95%",
                        background: `${accent}15`, border: `1px dashed ${accent}70`,
                        borderRadius: 8, padding: "8px 10px", textAlign: "center",
                      }}>
                        <div style={{ fontSize: 10, color: muted }}>
                          <b>{m.from}</b> {t("Chat.inviteCardText")}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, margin: "3px 0", color: accent }}>
                          {inv.name}
                        </div>
                        <div style={{ fontSize: 9.5, color: muted, direction: "ltr" }}>
                          {inv.address}{inv.wsPort !== 4802 ? ":" + inv.wsPort : ""}
                          {inv.pin ? " · PIN ✓" : ""}
                        </div>
                        <button
                          onClick={() => joinFromInvite(inv)}
                          style={{ ...btnStyle(true), padding: "5px 14px", fontSize: 11, marginTop: 5 }}
                        >
                          {t("Chat.inviteJoin")}
                        </button>
                      </div>
                    );
                  }
                  // Étape H — un vote occupe toute la largeur : c'est une
                  // pièce de décision, pas une réplique dans la conversation.
                  if (m.type === "vote") {
                    return (
                      <div key={m.id} id={"msg-" + m.id} style={{ alignSelf: "stretch", display: "flex" }}>
                        <ChatVoteCard
                          message={m}
                          tally={store.voteTallies[m.id]}
                          roster={store.roster}
                          myFingerprint={store.myFingerprint}
                          onAnswer={(choice) => getApi()?.send?.("chat-answer-vote", { voteId: m.id, choice })}
                          accent={accent} muted={muted} border={border}
                        />
                      </div>
                    );
                  }
                  // Étape P — une réunion occupe toute la largeur : c'est
                  // une convocation, pas une réplique.
                  if (m.type === "meeting") {
                    return (
                      <div key={m.id} id={"msg-" + m.id} style={{ alignSelf: "stretch", display: "flex" }}>
                        <ChatMeetingCard message={m} accent={accent} muted={muted} border={border} />
                      </div>
                    );
                  }
                  // Étape K — une demande qualifiée occupe toute la largeur,
                  // comme un vote : c'est un acte du circuit, pas une
                  // réplique. Le message et sa pièce jointe restent rendus
                  // normalement au-dessous — valider « le rapport » veut
                  // dire valider CE fichier, dont l'empreinte est déjà dans
                  // la signature de la demande.
                  if (m.tag) {
                    return (
                      <div key={m.id} id={"msg-" + m.id} style={{
                        alignSelf: "stretch", display: "flex", flexDirection: "column", gap: 5,
                      }}>
                        <ChatDemandeCard
                          message={m}
                          decisions={store.decisions[m.id] || []}
                          accent={accent} muted={muted} border={border}
                          onDecide={(issue) => getApi()?.send?.("chat-decider", { messageId: m.id, issue })}
                        />
                        <div style={{
                          background: isMine ? `${accent}30` : "rgba(255,255,255,0.06)",
                          border: `1px solid ${isMine ? accent + "40" : border}`,
                          borderRadius: 8, padding: "6px 10px",
                        }}>
                          <div style={{ fontSize: 10.5, color: muted, marginBottom: 2 }}>{m.from}</div>
                          {m.text && <div style={{ fontSize: 12.5, lineHeight: 1.5, wordBreak: "break-word" }}>{m.text}</div>}
                          {m.media && (
                            <ChatMediaBubble
                              media={m.media}
                              muted={muted} border={border}
                              accent={theme === "sunset" ? "#ffb060" : "#00c853"}
                            />
                          )}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} id={"msg-" + m.id} style={{
                      alignSelf: isMine ? (isRTL ? "flex-start" : "flex-end") : (isRTL ? "flex-end" : "flex-start"),
                      maxWidth: "85%",
                      display: "flex", gap: 6, alignItems: "flex-end",
                      flexDirection: isRTL ? "row-reverse" : "row",
                    }}>
                      {/* L'avatar n'accompagne QUE les messages des autres.
                          Sur les siens, il n'apprend rien — la bulle est
                          déjà alignée et colorée — et coûterait 24 px de
                          largeur à chaque ligne. */}
                      {!isMine && (nouvelAuteur ? (
                        <ChatAvatar
                          personId={qui.personId}
                          name={qui.name}
                          avatarSha={qui.avatarSha}
                          size={24}
                        />
                      ) : (
                        <span style={{ width: 24, flexShrink: 0 }} />
                      ))}
                    <div style={{
                      flex: 1, minWidth: 0,
                      background: isMine ? `${accent}30` : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isMine ? accent + "40" : border}`,
                      borderRadius: 8, padding: "6px 10px",
                      position: "relative",
                    }}>
                      {/* Répondre : bouton discret, toujours présent. Pas au
                          survol seulement — une action invisible n'existe
                          pas, c'est la leçon des trois boutons cachés. */}
                      <button
                        onClick={() => setReplyToId(m.id)}
                        title={t("Chat.reply")}
                        aria-label={t("Chat.reply")}
                        style={{
                          position: "absolute", top: 2,
                          [isRTL ? "left" : "right"]: 2,
                          background: "transparent", border: "none", cursor: "pointer",
                          color: muted, padding: 2, opacity: 0.55, lineHeight: 0,
                        }}
                      >
                        <CornerUpLeft size={11} />
                      </button>
                      {/* Auteur et HEURE. L'heure manquait côté poste alors
                          que la page mobile l'affichait : sans elle, on ne
                          sait pas si l'on lit un échange de ce matin ou de
                          la semaine dernière — signalé en usage réel.
                          Elle est portée par la même ligne que l'auteur, et
                          seule quand le message est de nous : ajouter une
                          ligne par message aurait encore réduit la place
                          disponible, déjà comptée. */}
                      <div style={{
                        display: "flex", alignItems: "baseline", gap: 6,
                        fontSize: 10, color: muted,
                        justifyContent: isMine ? "flex-end" : "flex-start",
                      }}>
                        {!isMine && <span style={{ fontWeight: 700 }}>{m.from}</span>}
                        <span title={new Date(m.ts).toLocaleString()}>{heureCourte(m.ts)}</span>
                      </div>
                      {/* Étape G — message cité. On le relit dans le fil
                          plutôt que d'en avoir gardé une copie : après une
                          purge de rétention, la cible a pu disparaître, et
                          il vaut mieux le dire que d'afficher un fantôme. */}
                      {m.replyTo && (() => {
                        const cible = store.messages.find((x) => x.id === m.replyTo);
                        return (
                          <div
                            onClick={() => {
                              if (!cible) return;
                              document.getElementById("msg-" + cible.id)
                                ?.scrollIntoView({ block: "center", behavior: "smooth" });
                            }}
                            style={{
                              borderInlineStart: `2px solid ${accent}`,
                              paddingInlineStart: 6, marginBottom: 4,
                              opacity: 0.75, cursor: cible ? "pointer" : "default",
                            }}
                          >
                            <div style={{ fontSize: 9.5, color: accent, fontWeight: 700 }}>
                              {cible ? cible.from : t("Chat.replyGone")}
                            </div>
                            {cible && (
                              <div style={{
                                fontSize: 10, color: muted, overflow: "hidden",
                                textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220,
                              }}>
                                {cible.text || (cible.media ? t("Chat.mediaAttachment") : "")}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Texte facultatif : un vocal ou une image peut
                          partir seul, sans un mot */}
                      {m.text ? (
                        <MessageText
                          text={m.text}
                          accent={theme === "sunset" ? "#ffb060" : "#00c853"}
                          onOpen={(url) => addTab(url)}
                        />
                      ) : null}
                      {m.media && (
                        <ChatMediaBubble
                          media={m.media}
                          muted={muted} border={border}
                          accent={theme === "sunset" ? "#ffb060" : "#00c853"}
                        />
                      )}
                      {/* Étape N — « vu par », sous SES PROPRES messages
                          seulement : c'est l'expéditeur qui se demande si
                          on l'a lu. L'afficher sous ceux des autres
                          reviendrait à surveiller qui lit quoi. */}
                      {isMine && (store.reads[m.id]?.length ?? 0) > 0 && (
                        <div
                          style={{ fontSize: 9.5, color: muted, marginTop: 3, textAlign: "end" }}
                          title={store.reads[m.id]
                            .map((r) => `${r.sender || "?"} · ${new Date(r.ts).toLocaleString()}`)
                            .join("\n")}
                        >
                          {t("Chat.seenBy")} {store.reads[m.id].map((r) => r.sender || "?").join(", ")}
                        </div>
                      )}
                    </div>
                    </div>
                  );
                })
              )}
              {/* Ancre de défilement — toujours en dernier */}
              <div ref={messagesEndRef} />
            </div>}

            {!showAdmin && <div style={{ flexShrink: 0 }}>
              {converting !== null && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
                  padding: "7px 9px", border: `1px solid ${border}`, borderRadius: 4,
                  fontSize: 11, color: muted,
                }}>
                  <span>{t("Chat.mediaConverting")}</span>
                  <div style={{ flex: 1, height: 3, background: `${accent}25`, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{
                      width: `${Math.round(converting * 100)}%`, height: "100%",
                      background: accent, transition: "width .2s linear",
                    }} />
                  </div>
                </div>
              )}
              {/* Étape P — annoncer une réunion. L'heure se saisit en heure
                  LOCALE (datetime-local) et part en millisecondes absolues :
                  deux postes réglés sur des fuseaux différents doivent voir
                  le même instant, pas la même chaîne de caractères. */}
              {reunionOuverte && (
                <div style={{
                  border: `1px solid ${accent}55`, background: `${accent}10`,
                  borderRadius: 6, padding: 8, marginBottom: 6,
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <div style={{ fontSize: 10, color: accent, fontWeight: 700 }}>
                    {t("Chat.meetingNew")}
                  </div>
                  <input
                    style={{ ...inputStyle, fontSize: 11 }}
                    value={reunionTitre}
                    onChange={(e) => setReunionTitre(e.target.value)}
                    placeholder={t("Chat.meetingTitlePlaceholder")}
                    maxLength={120}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="datetime-local"
                      style={{ ...inputStyle, fontSize: 11, flex: 1, minWidth: 0 }}
                      value={reunionQuand}
                      onChange={(e) => setReunionQuand(e.target.value)}
                    />
                    <input
                      type="number"
                      style={{ ...inputStyle, fontSize: 11, width: 76 }}
                      value={reunionDuree}
                      min={5}
                      max={1440}
                      onChange={(e) => setReunionDuree(e.target.value)}
                      title={t("Chat.meetingDuration")}
                    />
                  </div>
                  <input
                    style={{ ...inputStyle, fontSize: 11 }}
                    value={reunionLieu}
                    onChange={(e) => setReunionLieu(e.target.value)}
                    placeholder={t("Chat.meetingPlacePlaceholder")}
                    maxLength={120}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => {
                        const quand = new Date(reunionQuand).getTime();
                        const duree = Number(reunionDuree);
                        if (!reunionTitre.trim() || !Number.isFinite(quand)) return;
                        getApi()?.send?.("chat-open-meeting", {
                          title: reunionTitre.trim(), startsAt: quand, durationMin: duree,
                          location: reunionLieu.trim(), groupId: store.activeThread,
                        });
                        setReunionOuverte(false); setReunionTitre("");
                        setReunionQuand(""); setReunionLieu(""); setReunionDuree("60");
                      }}
                      disabled={store.licenceReadOnly || !reunionTitre.trim() || !reunionQuand
                        || Number(reunionDuree) < 5 || Number(reunionDuree) > 1440}
                      style={{
                        ...btnStyle(true, store.licenceReadOnly || !reunionTitre.trim() || !reunionQuand
                          || Number(reunionDuree) < 5 || Number(reunionDuree) > 1440),
                        flex: 1, fontSize: 11,
                      }}
                    >
                      {t("Chat.meetingSend")}
                    </button>
                    <button
                      onClick={() => { setReunionOuverte(false); setReunionTitre(""); setReunionQuand(""); setReunionLieu(""); }}
                      style={{ ...btnStyle(false), fontSize: 11 }}
                    >
                      {t("Chat.inviteClose")}
                    </button>
                  </div>
                </div>
              )}

              {/* Étape H — ouvrir un vote. Le mode non nominatif est une
                  case à cocher, décidée À L'ÉMISSION : c'est le choix de
                  celui qui pose la question, pas un réglage du salon. */}
              {voteOuvert && (
                <div style={{
                  border: `1px solid ${accent}55`, background: `${accent}10`,
                  borderRadius: 6, padding: 8, marginBottom: 6,
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <div style={{ fontSize: 10, color: accent, fontWeight: 700 }}>
                    {t("Chat.voteNew")}
                  </div>
                  <input
                    style={{ ...inputStyle, fontSize: 11.5 }}
                    value={voteQuestion}
                    onChange={(e) => setVoteQuestion(e.target.value)}
                    placeholder={t("Chat.voteQuestionPlaceholder")}
                    maxLength={200}
                  />
                  <div style={{ fontSize: 10, color: muted }}>
                    {t("Chat.voteOptionsFixed")} : {VOTE_OPTIONS.map((k) => t(`Chat.${k}`)).join(" · ")}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!voteNominatif}
                      onChange={(e) => setVoteNominatif(!e.target.checked)}
                    />
                    <span>{t("Chat.voteNotNamedOption")}</span>
                  </label>
                  {/* Dire tout de suite ce que le mode implique : le
                      découvrir après coup serait une mauvaise surprise. */}
                  {!voteNominatif && (
                    <div style={{ fontSize: 9.5, color: muted, lineHeight: 1.45 }}>
                      {t("Chat.voteNotNamedHint")}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => {
                        const q = voteQuestion.trim();
                        if (!q) return;
                        getApi()?.send?.("chat-open-vote", {
                          question: q,
                          options: VOTE_OPTIONS.map((k) => t(`Chat.${k}`)),
                          nominatif: voteNominatif,
                          groupId: store.activeThread,
                        });
                        setVoteQuestion(""); setVoteOuvert(false); setVoteNominatif(true);
                      }}
                      disabled={store.licenceReadOnly || !voteQuestion.trim()}
                      style={{ ...btnStyle(true, store.licenceReadOnly || !voteQuestion.trim()), flex: 1, fontSize: 11 }}
                    >
                      {t("Chat.voteSend")}
                    </button>
                    <button
                      onClick={() => { setVoteOuvert(false); setVoteQuestion(""); setVoteNominatif(true); }}
                      style={{ ...btnStyle(false), fontSize: 11 }}
                    >
                      {t("Chat.inviteClose")}
                    </button>
                  </div>
                </div>
              )}
              {/* Étape G — ce que l'on s'apprête à citer. Sans cet aperçu,
                  on écrit une réponse sans plus savoir à quoi elle répond. */}
              {replyToId && (() => {
                const cible = store.messages.find((x) => x.id === replyToId);
                if (!cible) return null;
                return (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
                    borderInlineStart: `2px solid ${accent}`, paddingInlineStart: 7,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9.5, color: accent, fontWeight: 700 }}>
                        {t("Chat.replyingTo")} {cible.from}
                      </div>
                      <div style={{
                        fontSize: 10.5, color: muted, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {cible.text || (cible.media ? t("Chat.mediaAttachment") : "")}
                      </div>
                    </div>
                    <button
                      onClick={() => setReplyToId(null)}
                      title={t("Chat.replyCancel")}
                      aria-label={t("Chat.replyCancel")}
                      style={{
                        background: "transparent", border: "none", color: muted,
                        cursor: "pointer", padding: 3, flexShrink: 0, lineHeight: 0,
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })()}
              {pendingMedia && (
                <MediaPreview
                  media={pendingMedia}
                  onCancel={() => { setPendingMedia(null); setMediaError(""); }}
                  muted={muted} border={border} accent={accent}
                />
              )}
              {mediaError && (
                <div style={{ fontSize: 10.5, color: "#ff8080", marginBottom: 5, lineHeight: 1.45 }}>{mediaError}</div>
              )}
              {/* Étape K — qualifier l'envoi. Quatre natures, et le nom de
                  la personne dont on attend la réponse. Rien n'est
                  sélectionné par défaut : la plupart des messages sont de
                  simples messages, et une étiquette imposée d'office
                  perdrait tout son sens de signal. */}
              {!showRoster && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                  {(["info", "avis", "validation", "approbation"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setTag(tag === k ? null : k)}
                      disabled={store.licenceReadOnly}
                      style={{
                        padding: "3px 7px", fontSize: 9.5, fontWeight: 600, borderRadius: 4,
                        cursor: store.licenceReadOnly ? "default" : "pointer",
                        background: tag === k ? `${TAG_TON[k]}28` : "transparent",
                        border: `1px solid ${tag === k ? TAG_TON[k] : border}`,
                        color: tag === k ? TAG_TON[k] : muted,
                      }}
                    >
                      {t(`Chat.tag_${k}`)}
                    </button>
                  ))}
                  {/* Désigner quelqu'un n'est possible que si l'on attend
                      une réponse : un « pour info » adressé à une personne
                      précise laisserait croire qu'elle doit agir. */}
                  {tag && tag !== "info" && (
                    <select
                      value={destinataire}
                      onChange={(e) => setDestinataire(e.target.value)}
                      style={{ ...selectStyle, padding: "3px 6px", fontSize: 10, flex: 1, minWidth: 110 }}
                    >
                      <option value="" style={optionStyle}>
                        {t("Chat.demandeAnyone")}
                      </option>
                      {store.roster
                        .filter((p) => !p.isMe)
                        .map((p) => (
                          <option key={p.fingerprint} value={p.fingerprint} style={optionStyle}>
                            {p.name || p.fingerprint.slice(0, 8)}{p.role ? ` · ${p.role}` : ""}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              )}
              {/* Étape I — échéance de licence. Le texte vient de l'hôte
                  (nom de l'organisme, date, coordonnées de renouvellement) :
                  une seule formulation pour le poste, le mobile et le
                  journal du serveur. Ambre = préavis, rouge = envoi suspendu. */}
              {store.licenceNotice && (
                <div style={{
                  display: "flex", gap: 6, alignItems: "flex-start",
                  fontSize: 10.5, lineHeight: 1.45, marginBottom: 6,
                  padding: "6px 8px", borderRadius: 6,
                  color: store.licenceReadOnly ? "#ff9d9d" : "#ffcf8a",
                  background: store.licenceReadOnly ? "rgba(255,80,80,0.10)" : "rgba(255,180,60,0.10)",
                  border: `1px solid ${store.licenceReadOnly ? "rgba(255,80,80,0.35)" : "rgba(255,180,60,0.30)"}`,
                }}>
                  <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{store.licenceNotice}</span>
                </div>
              )}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <ChatComposerMedia
                  accent={accent} muted={muted} border={border}
                  disabled={store.licenceReadOnly || mediaBusy || !!pendingMedia || converting !== null}
                  onPrepared={(m) => { setPendingMedia(m); setMediaError(""); }}
                  onError={(msg) => setMediaError(msg)}
                  onConverting={setConverting}
                />
                <input
                  style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  disabled={store.licenceReadOnly}
                  /* La DESTINATION jusque dans le champ de saisie : « Écrire
                     dans Direction… ». Le nom du salon n'existait qu'en 11 px
                     sous le titre du panneau — présent, mais pas là où l'œil
                     se porte au moment d'écrire. Signalé comme un risque de
                     confidentialité : se tromper de salon, c'est adresser un
                     document à la mauvaise direction. */
                  placeholder={store.licenceReadOnly ? t("Chat.licenceSuspended")
                    : pendingMedia ? t("Chat.mediaCaptionPlaceholder")
                    : threadPeer && store.activeThread !== "all"
                      ? `${t("Chat.writeToPrefix")} ${threadPeer.name || t("Chat.rosterUnnamed")}…`
                      : store.sessionName
                        ? `${t("Chat.writeInPrefix")} ${store.sessionName}…`
                        : t("Chat.messagePlaceholder")}
                />
                <button
                  onClick={handleSend}
                  disabled={store.licenceReadOnly || mediaBusy || (!messageInput.trim() && !pendingMedia)}
                  style={{ ...btnStyle(true, store.licenceReadOnly || mediaBusy || (!messageInput.trim() && !pendingMedia)), flexShrink: 0 }}
                >
                  {mediaBusy ? "…" : t("Chat.send")}
                </button>
              </div>
            </div>}
          </>
        )}
      </div>
    </div>
  );
}
