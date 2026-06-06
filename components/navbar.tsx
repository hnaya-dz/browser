"use client";
import { usePathname } from "next/navigation";
import { ThemeSwitch } from "@/components/theme-switch";
import LangSwitch from "./lang-switch";
import { useTabContext } from "@/context/tabcontext";
import { useTabPosition } from "@/context/tabpositioncontext";
import { useLanguage } from "@/context/langcontext";

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
        <LangSwitch />
        <ThemeSwitch />
      </div>
    </nav>
  );
};
