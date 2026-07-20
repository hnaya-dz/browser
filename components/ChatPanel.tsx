"use client";
import { useEffect, useMemo, useRef, useState } from "react";
// ✅ Icônes vectorielles (lucide, déjà dans les dépendances) plutôt
// qu'emoji : les emoji sont rendus par la police du système et diffèrent
// visuellement entre Windows 10 et 11 — incohérent d'un poste à l'autre.
import { MessageSquare, Shield, Lock, Smartphone, KeyRound, Eye, EyeOff, Send, History, DoorOpen, Trash2 } from "lucide-react";
import ChatAdminPanel from "./ChatAdminPanel";
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
  type DiscoveredSession,
} from "@/context/chatstore";

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
    // Préchauffage du module de messagerie dès l'ouverture du panneau —
    // sur machine lente, le premier fork prend plusieurs secondes qui
    // s'ajoutaient au délai ressenti sur « Créer » / « Rejoindre ».
    getApi()?.send?.("chat-warmup");
    // Réserve la colonne : la page web se rétrécit au lieu d'être cachée
    getApi()?.send?.("chat-dock", DOCK_WIDTH);
    return () => { getApi()?.send?.("chat-dock", 0); };
  }, []);

  const [nickname, setNickname] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("hnaya-chat-nickname") || "" : ""
  );
  const [sessionNameInput, setSessionNameInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
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

  // Pré-remplissage du formulaire d'invitation : le salon qu'on héberge
  // (cas type : je viens de créer « Service Y », j'invite depuis « X »),
  // sinon le dernier hébergé connu
  const openInvitePanel = () => {
    let src: any = store.hosting;
    if (!src) {
      try { src = JSON.parse(localStorage.getItem("hnaya-chat-last-hosted") || "null"); } catch {}
    }
    setInviteRoom({
      name: src?.name || "",
      address: src?.lanIp ? `${src.lanIp}${src.wsPort && src.wsPort !== 4802 ? ":" + src.wsPort : ""}` : "",
      pin: src?.pin || "",
    });
    setInviteTarget("");
    patchStore({ inviteFeedback: null });
    setShowInvitePanel(true);
  };

  const sendInvitation = () => {
    const api = getApi();
    if (!api?.send || !inviteRoom.name.trim() || !inviteRoom.address.trim()) return;
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
  const joinFromInvite = (extra: NonNullable<import("@/context/chatstore").ChatMessage["extra"]>) => {
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
  const inviteQrSvg = useMemo(() => {
    if (!store.inviteUrl) return "";
    const qr = qrcode(0, "M");
    qr.addData(store.inviteUrl);
    qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 0 });
  }, [store.inviteUrl]);

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
      pin: pinInput,
      userId: store.userId,
      groups: ["all"],
      lastSeenTs: 0,
    });
  };

  const handleSend = () => {
    const api = getApi();
    const text = messageInput.trim();
    if (!api?.send || !text) return;
    api.send("chat-send-message", { text, groupId: "all", media: null });
    setMessageInput("");
  };

  const handleLeave = () => {
    const api = getApi();
    clearConnectTimer();
    api?.send("chat-leave");
    // D.2 : l'hébergement ne s'arrête QUE si on quitte le salon qu'on
    // héberge — quitter « X » en hébergeant « Y » laisse Y ouvert (c'est
    // le mécanisme des invitations vers un sous-salon). Le bandeau de
    // l'accueil rappelle le salon resté ouvert.
    if (store.joinedRoomIsHosted) api?.send("chat-stop-host");
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

  const discoveredList = Array.from(store.discovered.values());
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

      {/* Contenu déroulant pour les écrans hors discussion */}
      <div style={{
        flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12,
        overflowY: store.status === "joined" ? "hidden" : "auto",
      }}>

        {/* Menu principal */}
        {store.status === "idle" && (
          <>
            {/* D.2 — un salon hébergé par ce poste tourne encore (on l'a
                quitté sans le fermer, ex. pour aller inviter ailleurs) */}
            {store.hosting && (
              <div style={{
                border: `1px solid ${accent}40`, background: `${accent}12`,
                borderRadius: 6, padding: 8, display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00c853", flexShrink: 0 }} />
                <span style={{ fontSize: 11, flex: 1 }}>
                  {t("Chat.hostingBanner")} <b>{store.hosting.name}</b>
                </span>
                <button
                  onClick={() => handleReopenRoom(store.hosting!.roomId, store.hosting!.name)}
                  style={{ ...btnStyle(true), padding: "4px 9px", fontSize: 10.5 }}
                >
                  {t("Chat.hostingRejoin")}
                </button>
                <button
                  onClick={() => getApi()?.send?.("chat-stop-host")}
                  style={{ ...btnStyle(), padding: "4px 9px", fontSize: 10.5 }}
                >
                  {t("Chat.closeRoom")}
                </button>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>
                {t("Chat.nickname")} <span style={{ color: accent }}>*</span>
              </div>
              <input
                style={{
                  ...inputStyle,
                  borderColor: nickname.trim() ? border : `${accent}80`,
                }}
                value={nickname}
                onChange={(e) => saveNickname(e.target.value)}
                placeholder={t("Chat.nicknamePlaceholder")}
              />
              {!nickname.trim() && (
                <div style={{ fontSize: 11, color: accent, marginTop: 4 }}>
                  {t("Chat.nicknameRequired")}
                </div>
              )}
            </div>

            <div style={{ borderTop: `1px solid ${border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>{t("Chat.sessionName")}</div>
              <input
                style={{ ...inputStyle, marginBottom: 8 }}
                value={sessionNameInput}
                onChange={(e) => setSessionNameInput(e.target.value)}
                placeholder={t("Chat.sessionNamePlaceholder")}
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
              <button
                onClick={handleCreateRoom}
                disabled={!nickname.trim()}
                style={{ ...btnStyle(true, !nickname.trim()), width: "100%" }}
              >
                {t("Chat.createRoom")}
              </button>
            </div>

            {/* D.2 — réouverture explicite : c'est ICI que vit la
                continuité (« Créer » = toujours un salon neuf) */}
            {store.rooms.length > 0 && (
              <div style={{ borderTop: `1px solid ${border}`, paddingTop: 12 }}>
                <div style={{ fontSize: 11, color: muted, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                  <History size={12} /> {t("Chat.reopenTitle")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                  {store.rooms.slice(0, 8).map((r) => (
                    confirmDelete === r.roomId ? (
                      // Confirmation en place — la suppression efface aussi
                      // tout l'historique du salon
                      <div key={r.roomId} style={{
                        border: "1px solid #ff525260", background: "rgba(255,82,82,0.08)",
                        borderRadius: 4, padding: 8, display: "flex", flexDirection: "column", gap: 6,
                      }}>
                        <div style={{ fontSize: 10.5, lineHeight: 1.45 }}>
                          {t("Chat.deleteConfirm")} <b>{r.name}</b>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => handleDeleteRoom(r.roomId)}
                            style={{ ...btnStyle(), flex: 1, padding: "5px 8px", fontSize: 10.5, color: "#ff5252", borderColor: "#ff525260" }}
                          >
                            {t("Chat.deleteYes")}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            style={{ ...btnStyle(), flex: 1, padding: "5px 8px", fontSize: 10.5 }}
                          >
                            {t("Chat.back")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div key={r.roomId} style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                        <button
                          onClick={() => handleReopenRoom(r.roomId, r.name)}
                          disabled={!nickname.trim()}
                          style={{
                            ...btnStyle(false, !nickname.trim()), flex: 1, minWidth: 0,
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
                        {store.hosting?.roomId !== r.roomId && (
                          <button
                            onClick={() => setConfirmDelete(r.roomId)}
                            title={t("Chat.deleteRoom")}
                            style={{ ...btnStyle(), padding: "0 9px", color: muted, flexShrink: 0 }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    )
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
                  key={`${s.address}:${s.wsPort}`}
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
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
                placeholder={t("Chat.pinPlaceholder")}
              />
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
            {store.joinedRoomIsHosted && store.pin && !showAdmin && (
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

            <div style={{ fontSize: 11, color: muted, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00c853", flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{store.online.length} {t("Chat.online")}</span>
              {/* Inviter un téléphone : QR vers la page mobile servie par
                  l'hôte — visible pour tous les participants (l'URL pointe
                  toujours vers l'hôte), masqué si le poste n'a pas de LAN */}
              {store.inviteUrl && !showAdmin && (
                <button
                  onClick={() => setShowInvite(v => !v)}
                  style={{
                    ...btnStyle(showInvite), padding: "4px 8px", fontSize: 10,
                    display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  }}
                  title={showInvite ? t("Chat.inviteClose") : t("Chat.invitePhone")}
                >
                  <Smartphone size={12} />
                  {/* Le bouton devient « Fermer » quand le QR est affiché —
                      demande explicite du test terrain (dégager le dock) */}
                  {showInvite ? t("Chat.inviteClose") : t("Chat.invitePhone")}
                </button>
              )}
              {/* D.2 — inviter les membres vers un autre salon (sous-salon) */}
              {!showAdmin && (
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
              {!showInvitePanel && (
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
                {!store.hosting && (
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
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  <option value="">{t("Chat.inviteAll")}</option>
                  {store.online.filter((u) => u !== store.userId).map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <div style={{ fontSize: 9.5, color: muted, lineHeight: 1.5 }}>
                  {inviteTarget ? t("Chat.inviteTargetedHint") : t("Chat.inviteAllHint")}
                </div>
                <button
                  onClick={sendInvitation}
                  disabled={!inviteRoom.name.trim() || !inviteRoom.address.trim()}
                  style={btnStyle(true, !inviteRoom.name.trim() || !inviteRoom.address.trim())}
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
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, direction: "ltr" }}>{store.inviteUrl}</div>
                <div style={{ fontSize: 9.5, color: muted, marginTop: 4, lineHeight: 1.5 }}>
                  {t("Chat.inviteHint")}
                </div>
              </div>
            )}

            {/* Fil de messages : occupe tout l'espace restant du dock,
                défile indépendamment (minHeight: 0 requis en flex) */}
            {!showAdmin && <div style={{
              flex: 1, minHeight: 0, overflowY: "auto",
              display: "flex", flexDirection: "column", gap: 8,
              background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 10,
            }}>
              {store.messages.length === 0 ? (
                <div style={{ textAlign: "center", color: muted, fontSize: 12, padding: "16px 0" }}>
                  {t("Chat.noMessages")}
                </div>
              ) : (
                store.messages.map((m) => {
                  const isMine = m.from === store.userId;
                  // D.2 — carte d'invitation : cliquable, rejoint le salon
                  // invité avec le PIN prérempli s'il a été transmis
                  if (m.type === "invite" && m.extra) {
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
                          {m.extra.name}
                        </div>
                        <div style={{ fontSize: 9.5, color: muted, direction: "ltr" }}>
                          {m.extra.address}{m.extra.wsPort !== 4802 ? ":" + m.extra.wsPort : ""}
                          {m.extra.pin ? " · PIN ✓" : ""}
                        </div>
                        <button
                          onClick={() => joinFromInvite(m.extra!)}
                          style={{ ...btnStyle(true), padding: "5px 14px", fontSize: 11, marginTop: 5 }}
                        >
                          {t("Chat.inviteJoin")}
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} style={{
                      alignSelf: isMine ? (isRTL ? "flex-start" : "flex-end") : (isRTL ? "flex-end" : "flex-start"),
                      maxWidth: "85%",
                      background: isMine ? `${accent}30` : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isMine ? accent + "40" : border}`,
                      borderRadius: 8, padding: "6px 10px",
                    }}>
                      {!isMine && <div style={{ fontSize: 10, color: muted, fontWeight: 700 }}>{m.from}</div>}
                      <MessageText
                        text={m.text}
                        accent={theme === "sunset" ? "#ffb060" : "#00c853"}
                        onOpen={(url) => addTab(url)}
                      />
                    </div>
                  );
                })
              )}
              {/* Ancre de défilement — toujours en dernier */}
              <div ref={messagesEndRef} />
            </div>}

            {!showAdmin && <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder={t("Chat.messagePlaceholder")}
              />
              <button onClick={handleSend} disabled={!messageInput.trim()} style={btnStyle(true, !messageInput.trim())}>
                {t("Chat.send")}
              </button>
            </div>}
          </>
        )}
      </div>
    </div>
  );
}
