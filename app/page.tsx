"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTabContext } from "@/context/tabcontext";
import { useLanguage } from "@/context/langcontext";

// ─── Config ────────────────────────────────────────────────────────────────

const HNAYA_LINKS = [
  { key: "home",    url: "https://hnaya.dz",                  labels: { ar: "هناية",       fr: "Accueil",        en: "Home"           }, color: "#006341" },
  { key: "market",  url: "https://hnaya.dz/boutique",         labels: { ar: "هناية ماركت", fr: "Hnaya Market",   en: "Hnaya Market"   }, color: "#f59e0b" },
  { key: "tube",    url: "https://hnaya.dz/hnayatube",        labels: { ar: "هناية تيوب",  fr: "Hnaya Tube",     en: "Hnaya Tube"     }, color: "#d61d2c" },
  { key: "apps",    url: "https://hnaya.dz/apps",             labels: { ar: "أبستور",       fr: "Hnaya Appstore", en: "Hnaya Appstore" }, color: "#3b82f6" },
  { key: "webhost", url: "https://hnaya.dz/hnaya-sites-web",  labels: { ar: "ويبهوست",     fr: "Hnaya Webhost",  en: "Hnaya Webhost"  }, color: "#8b5cf6" },
] as const;

const DISCOVER_LABEL = {
  ar: "اكتشف الويب الجزائري",
  fr: "Découvrez le web algérien",
  en: "Discover the Algerian web",
};

const TR = {
  ar: { title: "بحث", algerie: "الجزائر", monde: "العالم", shop: "منتجات", algeriePlaceholder: "ابحث في الجزائر...", algerieButton: "بحث", worldPlaceholder: "ابحث في العالم...", worldButton: "بحث عالمي" },
  fr: { title: "Recherche", algerie: "Algérie", monde: "Monde", shop: "Produits", algeriePlaceholder: "Rechercher en Algérie...", algerieButton: "Rechercher", worldPlaceholder: "Rechercher dans le monde...", worldButton: "Recherche monde" },
  en: { title: "Search", algerie: "Algeria", monde: "World", shop: "Products", algeriePlaceholder: "Search in Algeria...", algerieButton: "Search", worldPlaceholder: "Search the world...", worldButton: "World search" },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function Home() {
  const { addTab } = useTabContext();
  const { language, isRTL } = useLanguage();
  const lang = (language as keyof typeof TR) in TR ? (language as keyof typeof TR) : "ar";
  const tr = TR[lang];

  const [scope, setScope] = useState<"algerie" | "monde">("algerie");
  const [algerieQuery, setAlgerieQuery] = useState("");
  const [worldQuery, setWorldQuery] = useState("");
  const cseReady = useRef(false);
  const scriptInjected = useRef(false);

  // Inject Google CSE script once
  useEffect(() => {
    if (scriptInjected.current) return;
    scriptInjected.current = true;
    const script = document.createElement("script");
    script.src = "https://cse.google.com/cse.js?cx=d6cbf11613afc4d13";
    script.async = true;
    script.onload = () => { cseReady.current = true; };
    document.head.appendChild(script);
  }, []);

  // ── Algérie search (Google CSE) ──────────────────────────────────────────
  const performAlgerieSearch = useCallback(() => {
    const q = algerieQuery.trim();
    if (!q) return;

    const tryExecute = () => {
      const g = (window as any).google;
      if (g?.search?.cse?.element) {
        const el = g.search.cse.element.getElement("searchresults-only0");
        if (el) { el.execute(q); return true; }
      }
      // Fallback: hidden input + button
      const input = document.querySelector<HTMLInputElement>("input.gsc-input");
      const btn   = document.querySelector<HTMLElement>(".gsc-search-button, .gsc-search-button-v2");
      if (input && btn) { input.value = q; btn.click(); return true; }
      return false;
    };

    if (!tryExecute()) setTimeout(tryExecute, 800);
  }, [algerieQuery]);

  // ── World search (Startpage, opens in new tab) ───────────────────────────
  const performWorldSearch = useCallback(() => {
    const q = worldQuery.trim();
    if (!q) return;
    addTab(`https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`);
  }, [worldQuery, addTab]);

  return (
    <section
      className="flex flex-col items-center w-screen min-h-[88vh] pt-[14vh] pb-10 px-4 bg-background"
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* Logo */}
      <img src="/hnaya.png" alt="Hnaya DZ" className="h-16 mb-6 object-contain" />

      {/* Quick links */}
      <div className="flex flex-wrap gap-3 justify-center mb-8">
        {HNAYA_LINKS.map((link) => (
          <button
            key={link.key}
            onClick={() => addTab(link.url)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm text-white shadow-md hover:scale-105 hover:shadow-lg transition-all duration-200"
            style={{ backgroundColor: link.color }}
          >
            {link.labels[lang] ?? link.labels.fr}
          </button>
        ))}
      </div>

      {/* ── Search Widget ────────────────────────────────────────────────── */}
      <div className="w-full max-w-4xl rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden">

        {/* Header: scope switcher */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{tr.title}</span>
          <div className="flex rounded-full bg-gray-100 dark:bg-gray-800 p-1 gap-1">
            <button
              onClick={() => setScope("algerie")}
              className="px-4 py-1.5 rounded-full text-sm font-bold transition-all duration-200"
              style={scope === "algerie"
                ? { backgroundColor: "#006341", color: "#fff" }
                : { color: "#374151" }}
            >
              {tr.algerie}
            </button>
            <button
              onClick={() => setScope("monde")}
              className="px-4 py-1.5 rounded-full text-sm font-bold transition-all duration-200"
              style={scope === "monde"
                ? { backgroundColor: "#d61d2c", color: "#fff" }
                : { color: "#374151" }}
            >
              {tr.monde}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5">

          {/* ── Algérie panel (Google CSE) ── */}
          {scope === "algerie" && (
            <div>
              <div className="flex gap-3 mb-4">
                <input
                  type="text"
                  value={algerieQuery}
                  onChange={(e) => setAlgerieQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && performAlgerieSearch()}
                  placeholder={tr.algeriePlaceholder}
                  className="flex-1 h-12 px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-[15px] outline-none focus:ring-2 focus:ring-green-600"
                />
                <button
                  onClick={performAlgerieSearch}
                  className="h-12 px-6 rounded-xl font-bold text-white text-sm hover:opacity-90 hover:scale-105 transition-all"
                  style={{ backgroundColor: "#006341" }}
                >
                  {tr.algerieButton}
                </button>
                <button
                  onClick={() => addTab(
                    algerieQuery.trim()
                      ? `https://hnaya.dz/boutique/?search=${encodeURIComponent(algerieQuery.trim())}`
                      : "https://hnaya.dz/boutique/"
                  )}
                  className="h-12 px-5 rounded-xl font-bold text-white text-sm hover:opacity-90 hover:scale-105 transition-all flex items-center gap-2"
                  style={{ backgroundColor: "#f59e0b" }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M7 4V2h10v2h4v2l-1.5 14H4.5L3 6V4h4zm2 0h6V3H9v1z"/>
                  </svg>
                  {tr.shop}
                </button>
              </div>
              {/* Google CSE results render here */}
              <div className="gcse-searchresults-only" />
            </div>
          )}

          {/* ── Monde panel (Startpage) ── */}
          {scope === "monde" && (
            <div className="flex gap-3">
              <input
                type="text"
                value={worldQuery}
                onChange={(e) => setWorldQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && performWorldSearch()}
                placeholder={tr.worldPlaceholder}
                className="flex-1 h-12 px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-[15px] outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                onClick={performWorldSearch}
                className="h-12 px-6 rounded-xl font-bold text-white text-sm hover:opacity-90 hover:scale-105 transition-all"
                style={{ backgroundColor: "#d61d2c" }}
              >
                {tr.worldButton}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Discover button */}
      <button
        onClick={() => addTab("https://hnaya.dz")}
        className="mt-8 px-10 py-4 rounded-2xl text-white font-bold text-lg shadow-lg hover:scale-105 hover:shadow-xl transition-all duration-200"
        style={{ backgroundColor: "#006341" }}
      >
        🇩🇿 {DISCOVER_LABEL[lang] ?? DISCOVER_LABEL.fr}
      </button>
    </section>
  );
}
