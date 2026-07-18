"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { MessageSquare, Shield } from "lucide-react";
import { ThemeSwitch } from "@/components/theme-switch";
import LangSwitch from "./lang-switch";
import { useTabContext } from "@/context/tabcontext";
import { useTabPosition } from "@/context/tabpositioncontext";
import { useLanguage } from "@/context/langcontext";
import { useTranslation } from "@/hooks/useTranslation";
import { setPanelOpen, useChatSnapshot } from "@/context/chatstore";

const PrivacyPanel = dynamic(() => import("./PrivacyPanel"), { ssr: false });

const HNAYA_NAV = [
  { key: "home",    url: "https://hnaya.dz",                 labels: { ar: "حنايا",       fr: "Accueil",        en: "Home"           } },
  { key: "market",  url: "https://hnaya.dz/boutique",        labels: { ar: "حنايا ماركت", fr: "Hnaya Market",   en: "Hnaya Market"   } },
  { key: "tube",    url: "https://hnaya.dz/hnayatube",       labels: { ar: "حنايا تيوب",  fr: "Hnaya Tube",     en: "Hnaya Tube"     } },
  { key: "apps",    url: "https://hnaya.dz/apps",            labels: { ar: "أبستور",       fr: "Hnaya Appstore", en: "Hnaya Appstore" } },
  { key: "webhost", url: "https://hnaya.dz/hnaya-sites-web", labels: { ar: "ويبهوست",     fr: "Hnaya Webhost",  en: "Hnaya Webhost"  } },
];

export const Navbar = () => {
  const pathname = usePathname();
  const { addTab } = useTabContext();
  const { language, isRTL } = useLanguage();
  const { position } = useTabPosition();
  const { t } = useTranslation();
  // État global de la messagerie : couleur d'icône (vert = connecté) et
  // badge non-lus, tenus à jour même quand le dock est fermé
  const chat = useChatSnapshot();
  const [showPrivacy, setShowPrivacy] = useState(false);

  if (pathname === "/browser") return null;

  const rightOffset = position === "right" ? "200px" : "0px";

  return (
    <nav
      className="fixed mt-[6vh] h-[6vh] z-40 flex items-center px-4 gap-3 bg-black/40 backdrop-blur-md border-b border-white/10"
      style={{ left: 0, right: rightOffset, width: `calc(100vw - ${rightOffset})` }}
      dir={isRTL ? "rtl" : "ltr"}
    >
      {pathname !== "/" && (
        <button onClick={() => addTab("https://hnaya.dz")} className="flex-shrink-0">
          <img src="/hnaya.png" alt="حنايا" className="h-[4vh] object-contain" />
        </button>
      )}
      <div className="flex items-center gap-2 overflow-x-auto flex-1 hide-scrollbar">
        {HNAYA_NAV.map((link) => (
          <button
            key={link.key}
            onClick={() => addTab(link.url)}
            className="flex-shrink-0 px-3 py-1 rounded-lg text-white/70 text-xs font-medium hover:text-white hover:bg-white/10 transition-all duration-150"
          >
            {link.labels[language as keyof typeof link.labels] ?? link.labels.fr}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => setPanelOpen(!chat.panelOpen)}
          className="px-2 text-white/70 hover:text-white transition-all duration-150"
          title={t("Chat.title")}
          style={{ position: "relative" }}
        >
          {/* Icône vectorielle : rendu identique sur Windows 10 et 11,
              contrairement aux emoji (police système) */}
          <MessageSquare size={16} style={chat.status === "joined" ? { color: "#00c853" } : undefined} />
          {chat.unreadCount > 0 && (
            <span style={{
              position: "absolute", top: 0, right: 2, width: 8, height: 8,
              borderRadius: "50%", background: "#ff3b30",
              border: "1.5px solid rgba(0,0,0,0.4)",
            }} />
          )}
        </button>
        {/* Panneau Confidentialité — page d'accueil : pas de WebContentsView
            à masquer, ouverture directe */}
        <button
          onClick={() => setShowPrivacy(true)}
          className="px-2 text-white/70 hover:text-white transition-all duration-150"
          title={t("Privacy.title")}
        >
          <Shield size={16} />
        </button>
        <LangSwitch />
        <ThemeSwitch />
      </div>
      {showPrivacy && <PrivacyPanel onClose={() => setShowPrivacy(false)} />}
    </nav>
  );
};
