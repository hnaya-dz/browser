"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { ThemeSwitch } from "@/components/theme-switch";
import { useRouter } from "next/navigation";
import { useTabContext } from "@/context/tabcontext";
import { useTabPosition } from "@/context/tabpositioncontext";
import LangSwitch from "./lang-switch";
import DownloadPanel from "./DownloadPanel";
import dynamic from "next/dynamic";
import { isDownloadableUrl as isDownloadable } from "@/shared/supportedHosts";
import { useTranslation } from "@/hooks/useTranslation";
import { MessageSquare, Shield, Bell } from "lucide-react";
import { setPanelOpen, useChatSnapshot } from "@/context/chatstore";
import { useNotifications } from "@/context/notifications";

const VaultPanel = dynamic(() => import("./VaultPanel"), { ssr: false });
const FavoritesPanel = dynamic(() => import("./FavoritesPanel"), { ssr: false });
const PrivacyPanel = dynamic(() => import("./PrivacyPanel"), { ssr: false });
const NotificationCenter = dynamic(() => import("./NotificationCenter"), { ssr: false });
const ChatMeetingChip = dynamic(() => import("./ChatMeetingChip"), { ssr: false });

const HINT_DL_KEY    = "hnaya-hint-download-seen";
const HINT_VAULT_KEY = "hnaya-hint-vault-seen";

const IconBack = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M5 12l7-7M5 12l7 7"/>
  </svg>
);
const IconForward = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M13 5l7 7-7 7"/>
  </svg>
);
const IconRefresh = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
    <path d="M3.51 9a9 9 0 0114.36-3.36L23 10M1 14l5.13 4.36A9 9 0 0020.49 15"/>
  </svg>
);
const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
  </svg>
);

export default function URLBar() {
  const { activeTab, tabs } = useTabContext();
  const { position } = useTabPosition();
  const { t } = useTranslation();
  const router = useRouter();

  const currentTab = tabs.find(tab => tab.id === activeTab);
  const isExternalTab = currentTab && !currentTab.isHome;

  // URL affichée dans l'input (peut être éditée par l'utilisateur)
  const [url, setUrl] = useState(currentTab?.url || "");
  // ✅ URL réelle de la WebContentsView — source de vérité pour isDownloadable et injection
  const [realViewUrl, setRealViewUrl] = useState(currentTab?.url || "");

  const [showDownload, setShowDownload] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [showVault, setShowVault] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const { nonLues: notifsNonLues } = useNotifications();
  // État global de la messagerie : couleur d'icône, badge non-lus, dock
  const chat = useChatSnapshot();
  const [isFavorited, setIsFavorited] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [showDlHint, setShowDlHint] = useState(false);
  const [showVaultHint, setShowVaultHint] = useState(false);
  const dlHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vaultHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync url et realViewUrl quand l'onglet actif change
  useEffect(() => {
    setUrl(currentTab?.url || "");
    setRealViewUrl(currentTab?.url || "");
  }, [activeTab, currentTab?.url]);

  // Bloquer le scroll du body quand un onglet externe est actif
  useEffect(() => {
    document.body.style.overflow = isExternalTab ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isExternalTab]);

  // Écouter les mises à jour d'URL depuis Electron (navigation dans la page)
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    const handler = (tabId: number, newUrl: string) => {
      if (tabId === activeTab) {
        setUrl(newUrl);
        setRealViewUrl(newUrl); // ✅ mise à jour de la vraie URL
      }
    };
    api.receive("update-url", handler);
    return () => api.removeListener("update-url", handler);
  }, [activeTab]);

  // Écouter le canal open-download-panel (depuis HnayaTube Watch)
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    const handler = (videoUrl: string) => {
      setDownloadUrl(videoUrl);
      setShowDownload(true);
    };
    api.receive("open-download-panel", handler);
    return () => api.removeListener("open-download-panel", handler);
  }, []);

  // Vérifier si la page actuelle est en favori
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.invoke || !realViewUrl) { setIsFavorited(false); return; }
    api.invoke("favorites-is-saved", realViewUrl)
      .then((saved: boolean) => setIsFavorited(saved))
      .catch(() => setIsFavorited(false));
  }, [realViewUrl]);

  // Vérifier si des credentials existent pour le site actif
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.invoke || !realViewUrl) { setHasCredentials(false); return; }
    api.invoke("vault-find-for-current-tab", realViewUrl)
      .then((matches: any[]) => setHasCredentials(Array.isArray(matches) && matches.length > 0))
      .catch(() => setHasCredentials(false));
  }, [realViewUrl]);

  // Hint téléchargement — une seule fois
  useEffect(() => {
    if (!isDownloadable(realViewUrl)) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(HINT_DL_KEY)) return;
    setShowDlHint(true);
    dlHintTimer.current = setTimeout(() => {
      setShowDlHint(false);
      localStorage.setItem(HINT_DL_KEY, "1");
    }, 4000);
    return () => { if (dlHintTimer.current) clearTimeout(dlHintTimer.current); };
  }, [realViewUrl]);

  // Hint vault — une seule fois
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(HINT_VAULT_KEY)) return;
    if (!isExternalTab) return;
    const t = setTimeout(() => {
      setShowVaultHint(true);
      vaultHintTimer.current = setTimeout(() => {
        setShowVaultHint(false);
        localStorage.setItem(HINT_VAULT_KEY, "1");
      }, 4000);
    }, 2000);
    return () => {
      clearTimeout(t);
      if (vaultHintTimer.current) clearTimeout(vaultHintTimer.current);
    };
  }, [isExternalTab]);

  const isValidURL = (input: string) => {
    try { const p = new URL(input); return p.protocol === "http:" || p.protocol === "https:"; }
    catch { return false; }
  };

  const handleNavigation = useCallback(() => {
    if (isValidURL(url)) {
      (window as any)?.electronAPI?.send("navigate", url);
    } else {
      const searchUrl = `https://www.startpage.com/sp/search?query=${encodeURIComponent(url)}`;
      (window as any)?.electronAPI?.send("navigate", searchUrl);
    }
  }, [url]);

  const handleDownloadClick = useCallback(async () => {
    setShowDlHint(false);
    localStorage.setItem(HINT_DL_KEY, "1");
    if (dlHintTimer.current) clearTimeout(dlHintTimer.current);
    // ✅ Récupérer la vraie URL depuis Electron (pas localhost du renderer)
    const realUrl = await (window as any)?.electronAPI?.invoke("get-active-tab-url");
    await (window as any)?.electronAPI?.invoke("hide-active-view-sync");
    setDownloadUrl(realUrl || realViewUrl);
    setShowDownload(true);
  }, [realViewUrl]);

  const handleCloseDownload = useCallback(() => {
    setShowDownload(false);
    (window as any)?.electronAPI?.send("show-active-view");
  }, []);

  const handleFavoritesClick = useCallback(async () => {
    await (window as any)?.electronAPI?.invoke("hide-active-view-sync");
    setShowFavorites(true);
  }, []);

  const handleCloseFavorites = useCallback(() => {
    setShowFavorites(false);
    (window as any)?.electronAPI?.send("show-active-view");
  }, []);

  const handleToggleFavorite = useCallback(async () => {
    const api = (window as any).electronAPI;
    if (!api?.invoke || !realViewUrl) return;
    if (isFavorited) {
      const list = await api.invoke("favorites-list");
      const entry = list?.find((f: any) => f.url === realViewUrl);
      if (entry) { await api.invoke("favorites-remove", entry.id); setIsFavorited(false); }
    } else {
      await api.invoke("favorites-add", { url: realViewUrl, title: currentTab?.title || realViewUrl, favicon: currentTab?.faviconUrl || null });
      setIsFavorited(true);
    }
  }, [realViewUrl, isFavorited, currentTab]);

  const handleVaultClick = useCallback(async () => {
    setShowVaultHint(false);
    localStorage.setItem(HINT_VAULT_KEY, "1");
    if (vaultHintTimer.current) clearTimeout(vaultHintTimer.current);
    await (window as any)?.electronAPI?.invoke("hide-active-view-sync");
    setShowVault(true);
  }, []);

  const handleCloseVault = useCallback(() => {
    setShowVault(false);
    (window as any)?.electronAPI?.send("show-active-view");
  }, []);

  const handleNotifsClick = useCallback(async () => {
    await (window as any)?.electronAPI?.invoke("hide-active-view-sync");
    setShowNotifs(true);
  }, []);

  const handleCloseNotifs = useCallback(() => {
    setShowNotifs(false);
    (window as any)?.electronAPI?.send("show-active-view");
  }, []);

  const handlePrivacyClick = useCallback(async () => {
    await (window as any)?.electronAPI?.invoke("hide-active-view-sync");
    setShowPrivacy(true);
  }, []);

  const handleClosePrivacy = useCallback(() => {
    setShowPrivacy(false);
    (window as any)?.electronAPI?.send("show-active-view");
  }, []);

  // ✅ Le dock ne masque PAS la page (le process principal rétrécit la
  // vue) — donc ni hide-active-view-sync ni show-active-view ici,
  // contrairement aux panneaux modaux (coffre-fort, favoris).

  if (!isExternalTab) return null;

  const rightOffset = position === "right" ? "200px" : "0px";
  const topOffset   = position === "right" ? "0px" : "6vh";
  // ✅ canDownload basé sur realViewUrl (pas l'input éditable)
  const canDownload = isDownloadable(realViewUrl);

  return (
    <>
      <nav
        className="fixed z-50 h-[6vh] flex items-center px-4 gap-2 backdrop-blur-md border-b urlbar-themed"
        style={{ top: topOffset, left: 0, right: rightOffset, width: `calc(100vw - ${rightOffset})` }}
      >
        <style>{`
          .urlbar-themed{background:rgba(0,0,0,0.45);border-color:rgba(255,255,255,0.1)}
          .light .urlbar-themed{background:rgba(255,255,255,0.75);border-color:rgba(0,99,65,0.15)}
          .sunset .urlbar-themed{background:rgba(30,3,0,0.7);border-color:rgba(255,80,20,0.2)}
          .urlbar-btn{color:rgba(255,255,255,0.6);transition:all 0.15s;padding:4px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative}
          .urlbar-btn:hover{color:#fff;background:rgba(255,255,255,0.1);transform:scale(1.1)}
          .light .urlbar-btn{color:rgba(0,60,30,0.6)}
          .light .urlbar-btn:hover{color:#006341;background:rgba(0,99,65,0.1)}
          .sunset .urlbar-btn{color:rgba(255,150,80,0.6)}
          .sunset .urlbar-btn:hover{color:#ffb060;background:rgba(255,80,20,0.15)}
          .urlbar-btn-dl{color:#fff;background:rgba(0,99,65,0.35);border:1px solid rgba(0,180,100,0.4);padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:4px;flex-shrink:0;transition:all 0.15s;cursor:pointer;position:relative}
          .urlbar-btn-dl:hover{background:rgba(0,99,65,0.6);transform:scale(1.05);box-shadow:0 2px 12px rgba(0,150,80,0.4)}
          .light .urlbar-btn-dl{background:rgba(0,99,65,0.12);border-color:rgba(0,99,65,0.3);color:#006341}
          .light .urlbar-btn-dl:hover{background:rgba(0,99,65,0.25)}
          .sunset .urlbar-btn-dl{background:rgba(200,50,0,0.3);border-color:rgba(255,80,20,0.4);color:#ffb060}
          .sunset .urlbar-btn-dl:hover{background:rgba(200,50,0,0.5)}
          .urlbar-btn-vault{padding:4px 8px;border-radius:6px;font-size:15px;display:flex;align-items:center;flex-shrink:0;transition:all 0.15s;cursor:pointer;border:1px solid transparent;background:transparent;position:relative}
          .urlbar-btn-vault:hover{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.15);transform:scale(1.1)}
          .light .urlbar-btn-vault:hover{background:rgba(0,99,65,0.1);border-color:rgba(0,99,65,0.2)}
          .vault-dot{position:absolute;top:1px;right:1px;width:7px;height:7px;border-radius:50%;background:#00c853;border:1.5px solid rgba(0,0,0,0.4)}
          .chat-unread-dot{position:absolute;top:1px;right:1px;width:8px;height:8px;border-radius:50%;background:#ff3b30;border:1.5px solid rgba(0,0,0,0.4)}
          /* Étape J — un message PRIVÉ mérite plus qu'une pastille muette
             identique à celle du salon : un compte chiffré, et une pulsation
             les premières secondes. C'est celui qu'on ne doit pas rater. */
          .chat-unread-count{position:absolute;top:-2px;right:-3px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#ff3b30;color:#fff;font-size:9px;font-weight:700;line-height:14px;text-align:center;border:1.5px solid rgba(0,0,0,0.4);animation:chat-pulse 1.1s ease-out 3}
          @keyframes chat-pulse{0%{box-shadow:0 0 0 0 rgba(255,59,48,0.65)}70%{box-shadow:0 0 0 7px rgba(255,59,48,0)}100%{box-shadow:0 0 0 0 rgba(255,59,48,0)}}
          .urlbar-hint{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.88);color:#fff;font-size:11px;font-weight:500;padding:5px 10px;border-radius:6px;white-space:nowrap;pointer-events:none;z-index:9999;animation:hint-in 0.2s ease}
          .urlbar-hint::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:rgba(0,0,0,0.88)}
          @keyframes hint-in{from{opacity:0;transform:translateX(-50%) translateY(4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
          .urlbar-input{flex:1;height:3.5vh;padding:0 12px;border-radius:8px;font-size:13px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.1);color:#fff;outline:none;transition:all 0.2s}
          .urlbar-input::placeholder{color:rgba(255,255,255,0.3)}
          .urlbar-input:focus{border-color:rgba(0,180,100,0.6);background:rgba(255,255,255,0.15);box-shadow:0 0 0 2px rgba(0,99,65,0.2)}
          .light .urlbar-input{background:rgba(255,255,255,0.9);border-color:rgba(0,99,65,0.2);color:#1a2e22}
          .light .urlbar-input::placeholder{color:rgba(0,60,30,0.35)}
          .light .urlbar-input:focus{border-color:rgba(0,99,65,0.5);box-shadow:0 0 0 2px rgba(0,99,65,0.12)}
          .sunset .urlbar-input{background:rgba(50,5,0,0.6);border-color:rgba(255,80,20,0.25);color:#ffd4a0}
          .sunset .urlbar-input::placeholder{color:rgba(255,120,60,0.35)}
          .sunset .urlbar-input:focus{border-color:rgba(255,100,20,0.6);box-shadow:0 0 0 2px rgba(200,60,0,0.2)}
        `}</style>

        {/* ✅ Infobulles et placeholder traduits (clés Navbar existantes) —
            elles étaient codées en dur en français même en interface arabe */}
        <button className="urlbar-btn" onClick={() => (window as any)?.electronAPI?.send("go-back")} title={t("Navbar.back")} data-tutorial="nav-buttons"><IconBack /></button>
        <button className="urlbar-btn" onClick={() => (window as any)?.electronAPI?.send("go-forward")} title={t("Navbar.forward")} data-tutorial="nav-buttons"><IconForward /></button>
        <button className="urlbar-btn" onClick={() => (window as any)?.electronAPI?.send("refresh")} title={t("Navbar.reload")} data-tutorial="nav-buttons"><IconRefresh /></button>

        <input
          className="urlbar-input"
          placeholder={t("Navbar.searchPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNavigation()}
          data-tutorial="urlbar"
        />

        <button className="urlbar-btn" onClick={handleNavigation} title={t("Navbar.search")}><IconSearch /></button>

        {/* Bouton téléchargement */}
        {canDownload && (
          <div style={{ position: "relative", flexShrink: 0 }} data-tutorial="download-btn">
            {showDlHint && (
              <div className="urlbar-hint">{t("URLBar.hintDownload")}</div>
            )}
            <button
              className="urlbar-btn-dl"
              onClick={handleDownloadClick}
              title={t("URLBar.downloadTitle")}
            >
              ⬇️ {t("URLBar.download")}
            </button>
          </div>
        )}

        {/* Bouton favori — ajouter/retirer la page active */}
        <button
          onClick={handleToggleFavorite}
          className="urlbar-btn"
          title={isFavorited ? t("Favorites.alreadySaved") : t("Favorites.addedToFavorites")}
          style={{ color: isFavorited ? "#f5c518" : undefined, fontSize: 16 }}
        >
          {isFavorited ? "★" : "☆"}
        </button>

        {/* Bouton favoris — ouvrir le panneau */}
        <button
          onClick={handleFavoritesClick}
          className="urlbar-btn"
          title={t("Favorites.title")}
          style={{ fontSize: 15 }}
        >
          📑
        </button>

        {/* Bouton vault */}
        <div style={{ position: "relative", flexShrink: 0 }} data-tutorial="vault-btn">
          {showVaultHint && (
            <div className="urlbar-hint">
              {hasCredentials ? t("URLBar.hintVaultFound") : t("URLBar.hintVault")}
            </div>
          )}
          <button
            className="urlbar-btn-vault"
            onClick={handleVaultClick}
            title={hasCredentials ? t("URLBar.vaultTitleFound") : t("URLBar.vaultTitle")}
          >
            🔐
            {hasCredentials && <span className="vault-dot" />}
          </button>
        </div>

        {/* Bouton messagerie locale (LAN) — icône vectorielle, rendu
            identique sur Windows 10 et 11 contrairement aux emoji.
            Vert = connecté à un salon ; pastille rouge = non-lus. */}
        <button
          onClick={() => setPanelOpen(!chat.panelOpen)}
          className="urlbar-btn"
          title={t("Chat.title")}
          data-tutorial="chat-btn"
        >
          <MessageSquare size={17} style={chat.status === "joined" ? { color: "#00c853" } : undefined} />
          {/* Privé d'abord : le compte chiffré remplace la pastille, sinon
              les deux signaux se ressembleraient à s'y méprendre. */}
          {(() => {
            const prives = Object.values(chat.unreadPrivate).reduce((a, b) => a + b, 0);
            if (prives > 0) return <span className="chat-unread-count">{prives}</span>;
            return chat.unreadCount > 0 ? <span className="chat-unread-dot" /> : null;
          })()}
        </button>

        {/* Étape Q — prochaine réunion, hors de la console. Le dock est
            fermé la plupart du temps ; une réunion épinglée à l'intérieur
            n'est vue que par qui regardait déjà. */}
        <ChatMeetingChip compact />

        {/* Centre de notifications — surface COMMUNE, hors du dock de
            messagerie : elle accueillera les outils de productivité à
            venir. La pastille de non-lus de la messagerie reste sur son
            propre bouton, là où l'œil la cherche ; ici on retrouve ce qui
            demande une suite (validation attendue, licence, réunion). */}
        <button
          onClick={handleNotifsClick}
          className="urlbar-btn"
          title={t("Notifications.title")}
        >
          <Bell size={17} />
          {notifsNonLues > 0 && <span className="chat-unread-count">{notifsNonLues}</span>}
        </button>

        {/* Bouton confidentialité — interrupteurs blocage traqueurs /
            nettoyage des liens (panneau modal, comme coffre-fort/favoris) */}
        <button
          onClick={handlePrivacyClick}
          className="urlbar-btn"
          title={t("Privacy.title")}
          data-tutorial="privacy-btn"
        >
          <Shield size={17} />
        </button>

        <LangSwitch />
        <ThemeSwitch />
      </nav>

      {showDownload && (
        <DownloadPanel url={downloadUrl} onClose={handleCloseDownload} />
      )}

      {showFavorites && (
        <FavoritesPanel onClose={handleCloseFavorites} />
      )}

      {showVault && (
        <VaultPanel onClose={handleCloseVault} />
      )}

      {showPrivacy && (
        <PrivacyPanel onClose={handleClosePrivacy} />
      )}

      {showNotifs && (
        <NotificationCenter onClose={handleCloseNotifs} />
      )}
    </>
  );
}
