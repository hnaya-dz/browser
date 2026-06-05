"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTabContext } from "@/context/tabcontext";
import { useLanguage } from "@/context/langcontext";

const TR = {
  ar: {
    title: "بحث", algerie: "الجزائر", monde: "العالم", shop: "منتجات",
    algeriePlaceholder: "ابحث في الجزائر...", algerieButton: "بحث",
    worldPlaceholder: "ابحث في العالم...", worldButton: "بحث عالمي",
    discover: "اكتشف الويب الجزائري",
  },
  fr: {
    title: "Recherche", algerie: "Algérie", monde: "Monde", shop: "Produits",
    algeriePlaceholder: "Rechercher en Algérie...", algerieButton: "Rechercher",
    worldPlaceholder: "Rechercher dans le monde...", worldButton: "Recherche monde",
    discover: "Découvrez le web algérien",
  },
  en: {
    title: "Search", algerie: "Algeria", monde: "World", shop: "Products",
    algeriePlaceholder: "Search in Algeria...", algerieButton: "Search",
    worldPlaceholder: "Search the world...", worldButton: "World search",
    discover: "Discover the Algerian web",
  },
};

export default function Home() {
  const { addTab } = useTabContext();
  const { language, isRTL } = useLanguage();
  const lang = (language as keyof typeof TR) in TR ? (language as keyof typeof TR) : "ar";
  const tr = TR[lang];

  const [scope, setScope] = useState<"algerie" | "monde">("algerie");
  const [algerieQuery, setAlgerieQuery] = useState("");
  const [worldQuery, setWorldQuery] = useState("");
  const scriptInjected = useRef(false);

  useEffect(() => {
    if (scriptInjected.current) return;
    scriptInjected.current = true;
    const script = document.createElement("script");
    script.src = "https://cse.google.com/cse.js?cx=d6cbf11613afc4d13";
    script.async = true;
    document.head.appendChild(script);
  }, []);

  const performAlgerieSearch = useCallback(() => {
    const q = algerieQuery.trim();
    if (!q) return;
    const tryExecute = (): boolean => {
      const g = (window as any).google;
      if (g?.search?.cse?.element) {
        const el = g.search.cse.element.getElement("searchresults-only0")
                || g.search.cse.element.getElement("search0");
        if (el) { el.execute(q); return true; }
      }
      const input = document.querySelector<HTMLInputElement>(".gsc-input-box input, input.gsc-input");
      const btn = document.querySelector<HTMLElement>(".gsc-search-button button, .gsc-search-button-v2");
      if (input && btn) {
        input.value = q;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        btn.click();
        return true;
      }
      return false;
    };
    if (!tryExecute()) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (tryExecute() || attempts > 10) clearInterval(interval);
      }, 300);
    }
  }, [algerieQuery]);

  const performWorldSearch = useCallback(() => {
    const q = worldQuery.trim();
    if (!q) return;
    addTab(`https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`);
  }, [worldQuery, addTab]);

  return (
    <>
      {/* ── Fond glassmorphism ── */}
      <style>{`
        .hnaya-bg {
          position: fixed; inset: 0; z-index: -1;
          background: linear-gradient(135deg, #001a0e 0%, #003320 40%, #001208 70%, #0a0a0a 100%);
          overflow: hidden;
        }
        .hnaya-bg::before {
          content: '';
          position: absolute;
          width: 600px; height: 600px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(0,99,65,0.35) 0%, transparent 70%);
          top: -100px; left: -100px;
          animation: pulse-slow 8s ease-in-out infinite alternate;
        }
        .hnaya-bg::after {
          content: '';
          position: absolute;
          width: 400px; height: 400px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(214,29,44,0.2) 0%, transparent 70%);
          bottom: 50px; right: -80px;
          animation: pulse-slow 10s ease-in-out infinite alternate-reverse;
        }
        @keyframes pulse-slow {
          from { transform: scale(1) translateY(0); opacity: 0.8; }
          to   { transform: scale(1.15) translateY(-30px); opacity: 1; }
        }
        .glass-card {
          background: rgba(255,255,255,0.06);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 8px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1);
        }
        .glass-input {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.15);
          color: #fff;
          backdrop-filter: blur(10px);
        }
        .glass-input::placeholder { color: rgba(255,255,255,0.4); }
        .glass-input:focus {
          outline: none;
          border-color: rgba(0,180,100,0.6);
          box-shadow: 0 0 0 3px rgba(0,99,65,0.25);
          background: rgba(255,255,255,0.12);
        }
        .glass-btn-primary {
          background: linear-gradient(135deg, #006341, #004d30);
          border: 1px solid rgba(0,180,100,0.4);
          box-shadow: 0 4px 20px rgba(0,99,65,0.4);
          transition: all 0.2s ease;
        }
        .glass-btn-primary:hover {
          background: linear-gradient(135deg, #007a50, #006341);
          transform: translateY(-1px);
          box-shadow: 0 6px 28px rgba(0,99,65,0.55);
        }
        .glass-btn-red {
          background: linear-gradient(135deg, #d61d2c, #b61724);
          border: 1px solid rgba(214,29,44,0.4);
          box-shadow: 0 4px 20px rgba(214,29,44,0.3);
          transition: all 0.2s ease;
        }
        .glass-btn-red:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 28px rgba(214,29,44,0.5);
        }
        .glass-btn-amber {
          background: linear-gradient(135deg, #c47f00, #a06800);
          border: 1px solid rgba(196,127,0,0.4);
          box-shadow: 0 4px 20px rgba(196,127,0,0.3);
          transition: all 0.2s ease;
        }
        .glass-btn-amber:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 28px rgba(196,127,0,0.5);
        }
        .scope-btn {
          background: transparent;
          border: 1px solid transparent;
          color: rgba(255,255,255,0.5);
          transition: all 0.2s ease;
        }
        .scope-btn.active-algerie {
          background: rgba(0,99,65,0.4);
          border-color: rgba(0,180,100,0.5);
          color: #fff;
        }
        .scope-btn.active-monde {
          background: rgba(214,29,44,0.4);
          border-color: rgba(214,29,44,0.5);
          color: #fff;
        }
        .scope-btn:hover:not(.active-algerie):not(.active-monde) {
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.85);
        }
        .discover-btn {
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.15);
          backdrop-filter: blur(12px);
          transition: all 0.25s ease;
        }
        .discover-btn:hover {
          background: rgba(0,99,65,0.3);
          border-color: rgba(0,180,100,0.5);
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(0,99,65,0.3);
        }
        /* Google CSE results styled for dark background */
        .gsc-search-box, .gsc-search-box-tools { display: none !important; }
        .gsc-result-info { color: rgba(255,255,255,0.4) !important; font-size: 11px !important; padding: 0 0 8px !important; }
        .gsc-above-wrapper-area { border-bottom: 0 !important; padding: 0 !important; }
        .gsc-webResult.gsc-result {
          background: rgba(255,255,255,0.06) !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          border-radius: 12px !important;
          padding: 12px 14px !important;
          margin: 0 0 10px !important;
          backdrop-filter: blur(10px) !important;
        }
        .gs-title a, .gs-title a b { color: #4ade80 !important; text-decoration: none !important; }
        .gs-title, .gs-title b { font-size: 16px !important; font-weight: 700 !important; }
        .gs-snippet { color: rgba(255,255,255,0.65) !important; }
        .gsc-adBlock { display: none !important; }
        .gsc-control-cse { padding: 0 !important; border: 0 !important; background: transparent !important; }
        .gsc-results .gsc-cursor-box { text-align: center !important; }
        .gsc-cursor-page { color: rgba(255,255,255,0.6) !important; }
        .gsc-cursor-current-page { color: #4ade80 !important; }
      `}</style>

      {/* Fond animé */}
      <div className="hnaya-bg" />

      <section
        className="flex flex-col items-center w-screen min-h-[88vh] pt-[15vh] pb-12 px-4"
        dir={isRTL ? "rtl" : "ltr"}
      >
        {/* Logo */}
        <img
          src="/hnaya.png"
          alt="Hnaya DZ"
          className="h-24 mb-4 object-contain drop-shadow-2xl"
          style={{ filter: "drop-shadow(0 0 24px rgba(0,180,100,0.4))" }}
        />

        {/* Tagline */}
        <p className="text-white/40 text-sm tracking-widest uppercase mb-8 font-light">
          متصفح الجزائر · Navigateur Algérien
        </p>

        {/* ── Carte de recherche (glass) ── */}
        <div className="glass-card rounded-3xl w-full max-w-3xl overflow-hidden">

          {/* Sélecteur scope */}
          <div className={`flex items-center gap-2 px-5 pt-4 pb-3 border-b border-white/10 ${isRTL ? "flex-row-reverse" : ""}`}>
            <span className="text-white/50 text-xs font-semibold tracking-wider uppercase mr-2">
              {tr.title}
            </span>
            <div className="flex rounded-xl bg-white/5 p-1 gap-1 border border-white/10">
              <button
                onClick={() => setScope("algerie")}
                className={`scope-btn px-4 py-1.5 rounded-lg text-sm font-bold ${scope === "algerie" ? "active-algerie" : ""}`}
              >
                {tr.algerie}
              </button>
              <button
                onClick={() => setScope("monde")}
                className={`scope-btn px-4 py-1.5 rounded-lg text-sm font-bold ${scope === "monde" ? "active-monde" : ""}`}
              >
                {tr.monde}
              </button>
            </div>
          </div>

          {/* Corps */}
          <div className="p-5">

            {/* Panel Algérie — toujours dans le DOM */}
            <div style={{ display: scope === "algerie" ? "block" : "none" }}>
              <div className={`flex gap-2 mb-4 ${isRTL ? "flex-row-reverse" : ""}`}>
                <input
                  type="text"
                  value={algerieQuery}
                  onChange={(e) => setAlgerieQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && performAlgerieSearch()}
                  placeholder={tr.algeriePlaceholder}
                  className="glass-input flex-1 h-12 px-4 rounded-xl text-[15px]"
                  dir={isRTL ? "rtl" : "ltr"}
                />
                <button onClick={performAlgerieSearch} className="glass-btn-primary h-12 px-5 rounded-xl font-bold text-white text-sm">
                  {tr.algerieButton}
                </button>
                <button
                  onClick={() => addTab(algerieQuery.trim()
                    ? `https://hnaya.dz/boutique/?search=${encodeURIComponent(algerieQuery.trim())}`
                    : "https://hnaya.dz/boutique/"
                  )}
                  className="glass-btn-amber h-12 px-4 rounded-xl font-bold text-white text-sm flex items-center gap-1.5"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                    <path d="M7 4V2h10v2h4v2l-1.5 14H4.5L3 6V4h4zm2 0h6V3H9v1z"/>
                  </svg>
                  {tr.shop}
                </button>
              </div>
              <div className="gcse-search" />
            </div>

            {/* Panel Monde */}
            {scope === "monde" && (
              <div className={`flex gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                <input
                  type="text"
                  value={worldQuery}
                  onChange={(e) => setWorldQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && performWorldSearch()}
                  placeholder={tr.worldPlaceholder}
                  className="glass-input flex-1 h-12 px-4 rounded-xl text-[15px]"
                  dir={isRTL ? "rtl" : "ltr"}
                />
                <button onClick={performWorldSearch} className="glass-btn-red h-12 px-5 rounded-xl font-bold text-white text-sm">
                  {tr.worldButton}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bouton Découvrir */}
        <button
          onClick={() => addTab("https://hnaya.dz")}
          className="discover-btn mt-8 px-8 py-3.5 rounded-2xl text-white/80 font-semibold text-base"
        >
          🇩🇿 {tr.discover}
        </button>
      </section>
    </>
  );
}
