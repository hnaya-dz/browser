"use client";
import { useEffect, useState } from "react";
import { ThemeSwitch } from "@/components/theme-switch";
import { useRouter } from "next/navigation";
import { useTabContext } from "@/context/tabcontext";
import { useTabPosition } from "@/context/tabpositioncontext";
import LangSwitch from "./lang-switch";

// ── Icônes SVG inline — aucun fichier externe requis ─────────────────────────
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
  const [url, setUrl] = useState("");
  const router = useRouter();
  const { activeTab, tabs } = useTabContext();
  const { position } = useTabPosition();

  // ✅ Bloquer le scroll du body quand un onglet externe est actif
  const currentTab = tabs.find(tab => tab.id === activeTab);
  const isExternalTab = currentTab && !currentTab.isHome;

  useEffect(() => {
    if (isExternalTab) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isExternalTab]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.receive("update-url", (tabId: number, newUrl: string) => {
        if (tabId === activeTab) setUrl(newUrl);
      });
    }
  }, [activeTab, router]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.send("get-current-url", activeTab);
      window.electronAPI.receive("current-url", (tabId: number, currentUrl: string) => {
        if (tabId === activeTab) setUrl(currentUrl);
      });
    }
  }, [activeTab]);

  const isValidURL = (input: string) => {
    try {
      const p = new URL(input);
      return p.protocol === "http:" || p.protocol === "https:";
    } catch { return false; }
  };

  const handleNavigation = () => {
    if (isValidURL(url)) {
      window?.electronAPI?.send("navigate", url);
    } else {
      window?.electronAPI?.send("close-browser-view");
      router.push(`/results?q=${encodeURIComponent(url)}`);
    }
  };

  if (!isExternalTab) return null;

  // En mode latéral, la URLBar s'étend sur toute la largeur moins 200px
  const rightOffset = position === "right" ? "200px" : "0px";

  // En mode latéral, la URLBar est tout en haut (mt-0) car TabBar est à droite
  // En mode haut, elle est sous la TabBar (mt-[6vh])
  const topOffset = position === "right" ? "0px" : "6vh";

  return (
    <nav
      className="fixed z-50 h-[6vh] flex items-center px-4 gap-2 backdrop-blur-md border-b urlbar-themed"
      style={{
        top: topOffset,
        left: 0,
        right: rightOffset,
        width: `calc(100vw - ${rightOffset})`,
      }}
    >
      <style>{`
        .urlbar-themed {
          background: rgba(0,0,0,0.45);
          border-color: rgba(255,255,255,0.1);
        }
        .light .urlbar-themed {
          background: rgba(255,255,255,0.75);
          border-color: rgba(0,99,65,0.15);
        }
        .sunset .urlbar-themed {
          background: rgba(30,3,0,0.7);
          border-color: rgba(255,80,20,0.2);
        }

        /* Boutons nav */
        .urlbar-btn {
          color: rgba(255,255,255,0.6);
          transition: all 0.15s ease;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .urlbar-btn:hover { color: #fff; background: rgba(255,255,255,0.1); transform: scale(1.1); }
        .light .urlbar-btn { color: rgba(0,60,30,0.6); }
        .light .urlbar-btn:hover { color: #006341; background: rgba(0,99,65,0.1); }
        .sunset .urlbar-btn { color: rgba(255,150,80,0.6); }
        .sunset .urlbar-btn:hover { color: #ffb060; background: rgba(255,80,20,0.15); }

        /* Input URL */
        .urlbar-input {
          flex: 1;
          height: 3.5vh;
          padding: 0 12px;
          border-radius: 8px;
          font-size: 13px;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.1);
          color: #fff;
          outline: none;
          transition: all 0.2s ease;
        }
        .urlbar-input::placeholder { color: rgba(255,255,255,0.3); }
        .urlbar-input:focus { border-color: rgba(0,180,100,0.6); background: rgba(255,255,255,0.15); box-shadow: 0 0 0 2px rgba(0,99,65,0.2); }

        .light .urlbar-input {
          background: rgba(255,255,255,0.9);
          border-color: rgba(0,99,65,0.2);
          color: #1a2e22;
        }
        .light .urlbar-input::placeholder { color: rgba(0,60,30,0.35); }
        .light .urlbar-input:focus { border-color: rgba(0,99,65,0.5); box-shadow: 0 0 0 2px rgba(0,99,65,0.12); }

        .sunset .urlbar-input {
          background: rgba(50,5,0,0.6);
          border-color: rgba(255,80,20,0.25);
          color: #ffd4a0;
        }
        .sunset .urlbar-input::placeholder { color: rgba(255,120,60,0.35); }
        .sunset .urlbar-input:focus { border-color: rgba(255,100,20,0.6); box-shadow: 0 0 0 2px rgba(200,60,0,0.2); }
      `}</style>

      <button className="urlbar-btn" onClick={() => window?.electronAPI?.send("go-back")} title="Précédent">
        <IconBack />
      </button>
      <button className="urlbar-btn" onClick={() => window?.electronAPI?.send("go-forward")} title="Suivant">
        <IconForward />
      </button>
      <button className="urlbar-btn" onClick={() => window?.electronAPI?.send("refresh")} title="Recharger">
        <IconRefresh />
      </button>

      <input
        className="urlbar-input"
        placeholder="URL ou recherche..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleNavigation()}
      />

      <button className="urlbar-btn" onClick={handleNavigation} title="Naviguer">
        <IconSearch />
      </button>
      <LangSwitch />
      <ThemeSwitch />
    </nav>
  );
}
