"use client";
import { useEffect, useState, useCallback } from "react";
import { ThemeSwitch } from "@/components/theme-switch";
import { useRouter } from "next/navigation";
import { useTabContext } from "@/context/tabcontext";
import { useTabPosition } from "@/context/tabpositioncontext";
import LangSwitch from "./lang-switch";
import DownloadPanel from "./DownloadPanel";

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

const SUPPORTED_HOSTS = [
  "youtube.com","youtu.be","facebook.com","fb.watch",
  "instagram.com","tiktok.com","dailymotion.com",
  "twitter.com","x.com","vimeo.com","twitch.tv","reddit.com",
];

function isDownloadable(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    return SUPPORTED_HOSTS.some(h => host === h || host.endsWith("." + h));
  } catch { return false; }
}

export default function URLBar() {
  const { activeTab, tabs } = useTabContext();
  const { position } = useTabPosition();
  const router = useRouter();

  const currentTab = tabs.find(tab => tab.id === activeTab);
  const isExternalTab = currentTab && !currentTab.isHome;

  // ✅ Initialiser l'URL depuis le tab context (source fiable immédiate)
  // puis la mettre à jour via IPC lors des navigations
  const [url, setUrl] = useState(currentTab?.url || "");
  const [showDownload, setShowDownload] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");

  // Sync url quand l'onglet actif change
  useEffect(() => {
    setUrl(currentTab?.url || "");
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
      if (tabId === activeTab) setUrl(newUrl);
    };
    api.receive("update-url", handler);
    return () => api.removeListener("update-url", handler);
  }, [activeTab]);

  // Écouter le canal open-download-panel (depuis injection HnayaTube)
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    const handler = (ytUrl: string) => {
      setDownloadUrl(ytUrl);
      setShowDownload(true);
    };
    api.receive("open-download-panel", handler);
    return () => api.removeListener("open-download-panel", handler);
  }, []);

  const isValidURL = (input: string) => {
    try { const p = new URL(input); return p.protocol === "http:" || p.protocol === "https:"; }
    catch { return false; }
  };

  const handleNavigation = useCallback(() => {
    if (isValidURL(url)) {
      (window as any)?.electronAPI?.send("navigate", url);
    } else {
      (window as any)?.electronAPI?.send("close-browser-view");
      router.push(`/results?q=${encodeURIComponent(url)}`);
    }
  }, [url, router]);

  const handleDownloadClick = useCallback(() => {
    // Masquer la WebContentsView pour que le panneau React soit visible
    (window as any)?.electronAPI?.send("hide-active-view");
    setDownloadUrl(url);
    setShowDownload(true);
  }, [url]);

  const handleCloseDownload = useCallback(() => {
    setShowDownload(false);
    // Restaurer la WebContentsView
    (window as any)?.electronAPI?.send("show-active-view");
  }, []);

  if (!isExternalTab) return null;

  const rightOffset = position === "right" ? "200px" : "0px";
  const topOffset = position === "right" ? "0px" : "6vh";
  const canDownload = isDownloadable(url);

  return (
    <>
      <nav
        className="fixed z-50 h-[6vh] flex items-center px-4 gap-2 backdrop-blur-md border-b urlbar-themed"
        style={{ top: topOffset, left: 0, right: rightOffset, width: `calc(100vw - ${rightOffset})` }}
      >
        <style>{`
          .urlbar-themed { background:rgba(0,0,0,0.45); border-color:rgba(255,255,255,0.1); }
          .light .urlbar-themed { background:rgba(255,255,255,0.75); border-color:rgba(0,99,65,0.15); }
          .sunset .urlbar-themed { background:rgba(30,3,0,0.7); border-color:rgba(255,80,20,0.2); }
          .urlbar-btn { color:rgba(255,255,255,0.6); transition:all 0.15s ease; padding:4px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
          .urlbar-btn:hover { color:#fff; background:rgba(255,255,255,0.1); transform:scale(1.1); }
          .light .urlbar-btn { color:rgba(0,60,30,0.6); }
          .light .urlbar-btn:hover { color:#006341; background:rgba(0,99,65,0.1); }
          .sunset .urlbar-btn { color:rgba(255,150,80,0.6); }
          .sunset .urlbar-btn:hover { color:#ffb060; background:rgba(255,80,20,0.15); }
          .urlbar-btn-dl { color:#fff; background:rgba(0,99,65,0.35); border:1px solid rgba(0,180,100,0.4); padding:4px 10px; border-radius:6px; font-size:12px; font-weight:700; display:flex; align-items:center; gap:4px; flex-shrink:0; transition:all 0.15s ease; cursor:pointer; }
          .urlbar-btn-dl:hover { background:rgba(0,99,65,0.6); transform:scale(1.05); box-shadow:0 2px 12px rgba(0,150,80,0.4); }
          .light .urlbar-btn-dl { background:rgba(0,99,65,0.12); border-color:rgba(0,99,65,0.3); color:#006341; }
          .light .urlbar-btn-dl:hover { background:rgba(0,99,65,0.25); }
          .sunset .urlbar-btn-dl { background:rgba(200,50,0,0.3); border-color:rgba(255,80,20,0.4); color:#ffb060; }
          .sunset .urlbar-btn-dl:hover { background:rgba(200,50,0,0.5); }
          .urlbar-input { flex:1; height:3.5vh; padding:0 12px; border-radius:8px; font-size:13px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.1); color:#fff; outline:none; transition:all 0.2s ease; }
          .urlbar-input::placeholder { color:rgba(255,255,255,0.3); }
          .urlbar-input:focus { border-color:rgba(0,180,100,0.6); background:rgba(255,255,255,0.15); box-shadow:0 0 0 2px rgba(0,99,65,0.2); }
          .light .urlbar-input { background:rgba(255,255,255,0.9); border-color:rgba(0,99,65,0.2); color:#1a2e22; }
          .light .urlbar-input::placeholder { color:rgba(0,60,30,0.35); }
          .light .urlbar-input:focus { border-color:rgba(0,99,65,0.5); box-shadow:0 0 0 2px rgba(0,99,65,0.12); }
          .sunset .urlbar-input { background:rgba(50,5,0,0.6); border-color:rgba(255,80,20,0.25); color:#ffd4a0; }
          .sunset .urlbar-input::placeholder { color:rgba(255,120,60,0.35); }
          .sunset .urlbar-input:focus { border-color:rgba(255,100,20,0.6); box-shadow:0 0 0 2px rgba(200,60,0,0.2); }
        `}</style>

        <button className="urlbar-btn" onClick={() => (window as any)?.electronAPI?.send("go-back")} title="Précédent"><IconBack /></button>
        <button className="urlbar-btn" onClick={() => (window as any)?.electronAPI?.send("go-forward")} title="Suivant"><IconForward /></button>
        <button className="urlbar-btn" onClick={() => (window as any)?.electronAPI?.send("refresh")} title="Recharger"><IconRefresh /></button>

        <input
          className="urlbar-input"
          placeholder="URL ou recherche..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNavigation()}
        />

        <button className="urlbar-btn" onClick={handleNavigation} title="Naviguer"><IconSearch /></button>

        {/* ⬇️ Bouton téléchargement — visible seulement si l'URL est supportée */}
        {canDownload && (
          <button
            className="urlbar-btn-dl"
            onClick={handleDownloadClick}
            title="Télécharger cette vidéo en MP4"
          >
            ⬇️ MP4
          </button>
        )}

        <LangSwitch />
        <ThemeSwitch />
      </nav>

      {showDownload && (
        <DownloadPanel
          url={downloadUrl}
          onClose={handleCloseDownload}
        />
      )}
    </>
  );
}
