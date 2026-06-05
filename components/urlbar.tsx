"use client";
import { useEffect, useState } from "react";
import { ThemeSwitch } from "@/components/theme-switch";
import { useRouter } from "next/navigation";
import { useTabContext } from "@/context/tabcontext";
import { useTabPosition } from "@/context/tabpositioncontext";
import LangSwitch from "./lang-switch";

export default function URLBar() {
  const [url, setUrl] = useState("");
  const router = useRouter();
  const { activeTab, tabs } = useTabContext();
  const { position } = useTabPosition();

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

  const currentTab = tabs.find(tab => tab.id === activeTab);
  if (!currentTab || currentTab.isHome) return null;

  const rightOffset = position === "right" ? "200px" : "0px";

  return (
    <nav
      className="fixed mt-[6vh] h-[6vh] z-50 flex items-center px-4 gap-3 bg-black/50 backdrop-blur-md border-b border-white/10"
      style={{
        left: 0,
        right: rightOffset,
        width: `calc(100vw - ${rightOffset})`,
      }}
    >
      <button onClick={() => window?.electronAPI?.send("go-back")}
        className="text-white/60 hover:text-white hover:scale-110 transition-all">
        <img className="invert w-[2vw] h-[3vh]" src="/icons/arrow.left.svg" alt="Back" />
      </button>
      <button onClick={() => window?.electronAPI?.send("go-forward")}
        className="text-white/60 hover:text-white hover:scale-110 transition-all">
        <img className="invert w-[2vw] h-[3vh]" src="/icons/arrow.right.svg" alt="Forward" />
      </button>
      <button onClick={() => window?.electronAPI?.send("refresh")}
        className="text-white/60 hover:text-white hover:scale-110 transition-all">
        <img className="invert w-[2vw] h-[3vh]" src="/icons/arrow.clockwise.svg" alt="Reload" />
      </button>
      <input
        className="flex-grow px-3 py-1.5 rounded-lg bg-white/10 text-white border border-white/15 h-[3.5vh] text-sm focus:outline-none focus:border-green-500/60 focus:bg-white/15 placeholder-white/30"
        placeholder="URL ou recherche..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleNavigation()}
      />
      <button onClick={handleNavigation}
        className="text-white/60 hover:text-white hover:scale-110 transition-all">
        <img className="invert w-[2vw] h-[3vh]" src="/icons/magnifyingglass.svg" alt="Search" />
      </button>
      <LangSwitch />
      <ThemeSwitch />
    </nav>
  );
}
