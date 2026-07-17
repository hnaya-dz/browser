"use client";
import { useEffect, useState } from "react";
// ✅ Icônes vectorielles (lucide, déjà dans les dépendances) plutôt
// qu'emoji : les emoji sont rendus par la police du système et diffèrent
// visuellement entre Windows 10 et 11 — incohérent d'un poste à l'autre.
import { MessageSquare, Shield, Lock } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/context/langcontext";

interface ChatPanelProps {
  onClose: () => void;
}

interface ChatMessage {
  id: string;
  groupId: string;
  from: string;
  text: string;
  ts: number;
}

interface DiscoveredSession {
  sessionName: string;
  address: string;
  wsPort: number;
  hostname: string;
}

type ChatStatus = "idle" | "discovering" | "entering-pin" | "connecting" | "joined" | "error" | "network-setup";

// ═══════════════════════════════════════════════════════════════
// Store module-level — persiste tant que la page n'est pas rechargée,
// même quand <ChatPanel> est démonté (l'utilisateur ferme le panneau).
// Sans ça, fermer/rouvrir le panneau perdrait l'historique affiché et
// l'état "salon rejoint", alors que la connexion elle-même (côté
// process principal Electron) continue de tourner en arrière-plan.
// ⚠️ Limite connue MVP : les messages reçus PENDANT que le panneau est
// fermé ne sont pas mémorisés ici tant que ce module n'a pas été
// importé une première fois (import paresseux via next/dynamic).
// ═══════════════════════════════════════════════════════════════
interface ChatStore {
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
  // null = pas encore vérifié ; false = autorisation pare-feu absente
  // (le bouton « Autoriser » ne s'affiche que dans ce cas)
  networkOk: boolean | null;
}

const store: ChatStore = {
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
  networkOk: null,
};

const listeners = new Set<() => void>();
function notify() { listeners.forEach((fn) => fn()); }
function patchStore(patch: Partial<ChatStore>) { Object.assign(store, patch); notify(); }

// ═══════════════════════════════════════════════════════════════
// Délai maximum de connexion. Sans ça, si le salon est injoignable
// (pare-feu, mauvais wifi, hôte éteint), la WebSocket reste "en cours de
// connexion" indéfiniment sans jamais émettre "open" ni "error" — l'UI
// resterait bloquée sur "Connexion…" pour toujours. Ce garde-fou affiche
// une erreur claire après CONNECT_TIMEOUT_MS.
// ═══════════════════════════════════════════════════════════════
const CONNECT_TIMEOUT_MS = 12000;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

function clearConnectTimer() {
  if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
}

function startConnecting() {
  clearConnectTimer();
  patchStore({ status: "connecting", error: null });
  connectTimer = setTimeout(() => {
    connectTimer = null;
    if (store.status === "connecting") {
      patchStore({ status: "error", error: "connectionTimeout" });
    }
  }, CONNECT_TIMEOUT_MS);
}

function getApi() {
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

let listening = false;
function ensureListening() {
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
        patchStore({ pin: evt.pin, isHost: true });
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
        patchStore({ isHost: false });
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
          error: evt.reason === "pin-incorrect" ? "pinIncorrect" : "genericError",
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
        const messages = [...store.messages, evt.message];
        patchStore({ messages });
        break;
      }
      case "presence":
        patchStore({ online: evt.online || [] });
        break;
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

function getThemeName() {
  if (typeof document === "undefined") return "dark";
  const cls = document.documentElement.classList;
  if (cls.contains("sunset")) return "sunset";
  if (cls.contains("light")) return "light";
  return "dark";
}

export default function ChatPanel({ onClose }: ChatPanelProps) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const dir = isRTL ? "rtl" : "ltr";

  const [, forceRender] = useState(0);
  useEffect(() => {
    ensureListening();
    // Préchauffage du module de messagerie dès l'ouverture du panneau —
    // sur machine lente, le premier fork prend plusieurs secondes qui
    // s'ajoutaient au délai ressenti sur « Créer » / « Rejoindre ».
    getApi()?.send?.("chat-warmup");
    const rerender = () => forceRender((n) => n + 1);
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  }, []);

  const [nickname, setNickname] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("hnaya-chat-nickname") || "" : ""
  );
  const [sessionNameInput, setSessionNameInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);

  const theme = getThemeName();
  const isDark = theme === "dark";
  const bg     = isDark ? "#0d1a12" : theme === "light" ? "#fff" : "#1a0500";
  const border = isDark ? "rgba(255,255,255,0.1)" : theme === "light" ? "rgba(0,99,65,0.2)" : "rgba(255,80,20,0.2)";
  const text   = isDark ? "#fff" : theme === "light" ? "#1a2e22" : "#ffd4a0";
  const muted  = isDark ? "rgba(255,255,255,0.45)" : theme === "light" ? "rgba(0,60,30,0.5)" : "rgba(255,150,80,0.6)";
  const accent = theme === "sunset" ? "#c83200" : "#006341";
  const inputBg = isDark ? "rgba(255,255,255,0.07)" : theme === "light" ? "rgba(0,99,65,0.05)" : "rgba(255,80,20,0.07)";

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: `1px solid ${border}`, background: inputBg,
    color: text, fontSize: 13, outline: "none",
  };
  const btnStyle = (primary = false, disabled = false): React.CSSProperties => ({
    padding: "9px 16px", borderRadius: 8, border: primary ? "none" : `1px solid ${border}`,
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
    const res = await api.invoke("chat-start-host", sessionNameInput || "Hnaya Chat");
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

  const handleJoin = () => {
    const api = getApi();
    if (!api?.send || !store.selectedSession || pinInput.length !== 6 || !nickname.trim()) return;
    store.userId = nickname.trim();
    if (typeof window !== "undefined") localStorage.setItem("hnaya-chat-user-id", nickname.trim());
    // Même remise à zéro qu'à la création — le backlog fait foi.
    patchStore({ messages: [], online: [] });
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
    if (store.isHost) api?.send("chat-stop-host");
    patchStore({
      status: "idle", isHost: false, pin: null, messages: [], online: [],
      discovered: new Map(), selectedSession: null, error: null,
    });
    setPinInput("");
  };

  const discoveredList = Array.from(store.discovered.values());

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "14vh 16px 16px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div dir={dir} style={{
        width: 480, maxWidth: "92vw", maxHeight: "80vh", overflowY: "auto",
        background: bg, border: `1px solid ${border}`, borderRadius: 20,
        padding: 22, color: text, boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MessageSquare size={20} style={{ color: accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>{t("Chat.title")}</div>
            <div style={{ fontSize: 11, color: muted, lineHeight: 1.3, marginTop: 1 }}>{t("Chat.subtitle")}</div>
          </div>
          {store.status === "joined" && (
            <button onClick={handleLeave} style={{ ...btnStyle(), padding: "6px 12px", fontSize: 12 }}>
              {/* Sur l'hôte, « Quitter » FERME le salon pour tout le monde —
                  le libellé doit le dire, sinon l'hôte croit juste sortir */}
              {store.isHost ? t("Chat.closeRoom") : t("Chat.leave")}
            </button>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none", color: muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {/* Menu principal */}
        {store.status === "idle" && (
          <>
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

            <div style={{ borderTop: `1px solid ${border}`, paddingTop: 14 }}>
              <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>{t("Chat.sessionName")}</div>
              <input
                style={{ ...inputStyle, marginBottom: 8 }}
                value={sessionNameInput}
                onChange={(e) => setSessionNameInput(e.target.value)}
                placeholder={t("Chat.sessionNamePlaceholder")}
              />
              <button
                onClick={handleCreateRoom}
                disabled={!nickname.trim()}
                style={{ ...btnStyle(true, !nickname.trim()), width: "100%" }}
              >
                {t("Chat.createRoom")}
              </button>
            </div>

            <div style={{ borderTop: `1px solid ${border}`, paddingTop: 14 }}>
              <button
                onClick={handleStartDiscovery}
                disabled={!nickname.trim()}
                style={{ ...btnStyle(false, !nickname.trim()), width: "100%" }}
              >
                {t("Chat.joinRoom")}
              </button>
            </div>

            <div style={{ fontSize: 11, color: muted, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              <Lock size={11} style={{ flexShrink: 0 }} /> {t("Chat.securityNotice")}
            </div>
          </>
        )}

        {/* Découverte des salons */}
        {store.status === "discovering" && (
          <>
            <div style={{ textAlign: "center", padding: "8px 0", color: muted, fontSize: 13 }}>
              {t("Chat.searching")}
            </div>
            {discoveredList.length === 0 ? (
              <>
                <div style={{ textAlign: "center", padding: "12px 0", color: muted, fontSize: 13 }}>
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
            {store.isHost && store.pin && (
              <div style={{
                background: `${accent}18`, border: `1px solid ${accent}40`, borderRadius: 10,
                padding: "8px 12px", textAlign: "center",
              }}>
                <div style={{ fontSize: 10, color: muted }}>{t("Chat.yourPin")}</div>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 4, color: accent }}>{store.pin}</div>
                <div style={{ fontSize: 10, color: muted, marginTop: 2 }}>{t("Chat.pinHint")}</div>
              </div>
            )}

            <div style={{ fontSize: 11, color: muted, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00c853", flexShrink: 0 }} />
              {store.online.length} {t("Chat.online")}
            </div>

            <div style={{
              flex: 1, minHeight: 180, maxHeight: 320, overflowY: "auto",
              display: "flex", flexDirection: "column", gap: 8,
              background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 10,
            }}>
              {store.messages.length === 0 ? (
                <div style={{ textAlign: "center", color: muted, fontSize: 12, padding: "16px 0" }}>
                  {t("Chat.noMessages")}
                </div>
              ) : (
                store.messages.map((m) => {
                  const isMine = m.from === store.userId;
                  return (
                    <div key={m.id} style={{
                      alignSelf: isMine ? (isRTL ? "flex-start" : "flex-end") : (isRTL ? "flex-end" : "flex-start"),
                      maxWidth: "80%",
                      background: isMine ? `${accent}30` : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isMine ? accent + "40" : border}`,
                      borderRadius: 10, padding: "6px 10px",
                    }}>
                      {!isMine && <div style={{ fontSize: 10, color: muted, fontWeight: 700 }}>{m.from}</div>}
                      <div style={{ fontSize: 13 }}>{m.text}</div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
