"use client";
import { usePathname } from "next/navigation";
import { ThemeSwitch } from "@/components/theme-switch";
import LangSwitch from "./lang-switch";
import { useTabContext } from "@/context/tabcontext";
import { useLanguage } from "@/context/langcontext";

const HNAYA_NAV = [
  { key: "home",    url: "https://hnaya.dz",               labels: { ar: "هناية",        fr: "Accueil",        en: "Home"          }, color: "#006341" },
  { key: "market",  url: "https://hnaya.dz/boutique",      labels: { ar: "هناية ماركت",  fr: "Hnaya Market",   en: "Hnaya Market"  }, color: "#f59e0b" },
  { key: "tube",    url: "https://hnaya.dz/hnayatube",     labels: { ar: "هناية تيوب",   fr: "Hnaya Tube",     en: "Hnaya Tube"    }, color: "#d61d2c" },
  { key: "apps",    url: "https://hnaya.dz/apps",          labels: { ar: "أبستور",        fr: "Hnaya Appstore", en: "Hnaya Appstore" }, color: "#3b82f6" },
  { key: "webhost", url: "https://hnaya.dz/hnaya-sites-web", labels: { ar: "ويبهوست",    fr: "Hnaya Webhost",  en: "Hnaya Webhost" }, color: "#8b5cf6" },
];

export const Navbar = () => {
  const pathname = usePathname();
  const { addTab } = useTabContext();
  const { language, isRTL } = useLanguage();

  if (pathname === "/browser") return null;

  return (
    <nav
      className="fixed mt-[6vh] h-[6vh] z-40 w-screen flex items-center px-4 gap-3 bg-white dark:bg-black border-b border-gray-200 dark:border-gray-800"
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* Logo — visible uniquement hors page d'accueil */}
      {pathname !== "/" && (
        <button onClick={() => addTab("https://hnaya.dz")} className="flex-shrink-0">
          <img src="/hnaya.png" alt="Hnaya DZ" className="h-[4vh] object-contain" />
        </button>
      )}

      {/* Liens rapides Hnaya */}
      <div className="flex items-center gap-2 overflow-x-auto flex-1 hide-scrollbar">
        {HNAYA_NAV.map((link) => (
          <button
            key={link.key}
            onClick={() => addTab(link.url)}
            className="flex-shrink-0 px-3 py-1 rounded-lg text-white text-xs font-bold hover:opacity-90 hover:scale-105 transition-all duration-150 shadow-sm"
            style={{ backgroundColor: link.color }}
          >
            {link.labels[language as keyof typeof link.labels] ?? link.labels.fr}
          </button>
        ))}
      </div>

      {/* Switches */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <LangSwitch />
        <ThemeSwitch />
      </div>
    </nav>
  );
};
