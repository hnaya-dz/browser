"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTabContext } from "@/context/tabcontext";
import { useLanguage } from "@/context/langcontext";

const TR = {
  ar: {
    title: "بحث", algerie: "الجزائر", monde: "العالم",
    shop: "بحث للتسوّق",
    algeriePlaceholder: "ابحث في الجزائر...", algerieButton: "بحث",
    worldPlaceholder: "ابحث في العالم...", worldButton: "بحث عالمي",
    discover: "اكتشف الويب الجزائري",
    tagline: "متصفح الجزائر · Navigateur Algérien",
  },
  fr: {
    title: "Recherche", algerie: "Algérie", monde: "Monde",
    shop: "Achat",
    algeriePlaceholder: "Rechercher en Algérie...", algerieButton: "Rechercher",
    worldPlaceholder: "Rechercher dans le monde...", worldButton: "Recherche monde",
    discover: "Découvrez le web algérien",
    tagline: "متصفح الجزائر · Navigateur Algérien",
  },
  en: {
    title: "Search", algerie: "Algeria", monde: "World",
    shop: "Buy",
    algeriePlaceholder: "Search in Algeria...", algerieButton: "Search",
    worldPlaceholder: "Search the world...", worldButton: "World search",
    discover: "Discover the Algerian web",
    tagline: "متصفح الجزائر · Navigateur Algérien",
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

  // Inject Google CSE script once
  useEffect(() => {
    if (scriptInjected.current) return;
    scriptInjected.current = true;
    const script = document.createElement("script");
    script.src = "https://cse.google.com/cse.js?cx=d6cbf11613afc4d13";
    script.async = true;
    document.head.appendChild(script);
  }, []);

  // Intercepter les clics PSE → addTab (même comportement que Startpage)
  useEffect(() => {
    const interceptGSCLinks = () => {
      const links = document.querySelectorAll<HTMLAnchorElement>(
        ".gsc-results a.gs-title, .gsc-webResult a, .gs-title a"
      );
      links.forEach((link) => {
        if (link.dataset.hnayaIntercepted) return;
        link.dataset.hnayaIntercepted = "true";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const href = link.href || link.getAttribute("data-ctorig") || "";
          if (href.startsWith("http")) addTab(href);
        });
      });
    };
    const observer = new MutationObserver(interceptGSCLinks);
    observer.observe(document.body, { childList: true, subtree: true });
    interceptGSCLinks();
    return () => observer.disconnect();
  }, [addTab]);

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
      <style>{`

        /* ════════════════════════════════════════
           FOND ANIMÉ — MODE SOMBRE
        ════════════════════════════════════════ */
        .dark .hnaya-bg {
          position: fixed; inset: 0; z-index: -1; overflow: hidden;
          background: linear-gradient(135deg, #001a0e 0%, #003320 40%, #001208 70%, #0a0a0a 100%);
        }
        .dark .hnaya-bg::before {
          content: '';
          position: absolute;
          width: 600px; height: 600px; border-radius: 50%;
          background: radial-gradient(circle, rgba(0,99,65,0.35) 0%, transparent 70%);
          top: -100px; left: -100px;
          animation: pulse-slow 8s ease-in-out infinite alternate;
        }
        .dark .hnaya-bg::after {
          content: '';
          position: absolute;
          width: 400px; height: 400px; border-radius: 50%;
          background: radial-gradient(circle, rgba(214,29,44,0.2) 0%, transparent 70%);
          bottom: 50px; right: -80px;
          animation: pulse-slow 10s ease-in-out infinite alternate-reverse;
        }

        /* ════════════════════════════════════════
           FOND ANIMÉ — MODE CLAIR
        ════════════════════════════════════════ */
        html:not(.dark) .hnaya-bg {
          position: fixed; inset: 0; z-index: -1; overflow: hidden;
          background: linear-gradient(135deg, #e8f5ee 0%, #f0f7f4 45%, #fef9f0 100%);
        }
        html:not(.dark) .hnaya-bg::before {
          content: '';
          position: absolute;
          width: 600px; height: 600px; border-radius: 50%;
          background: radial-gradient(circle, rgba(0,99,65,0.12) 0%, transparent 70%);
          top: -100px; left: -100px;
          animation: pulse-slow 8s ease-in-out infinite alternate;
        }
        html:not(.dark) .hnaya-bg::after {
          content: '';
          position: absolute;
          width: 400px; height: 400px; border-radius: 50%;
          background: radial-gradient(circle, rgba(214,29,44,0.08) 0%, transparent 70%);
          bottom: 50px; right: -80px;
          animation: pulse-slow 10s ease-in-out infinite alternate-reverse;
        }

        @keyframes pulse-slow {
          from { transform: scale(1) translateY(0); opacity: 0.8; }
          to   { transform: scale(1.15) translateY(-30px); opacity: 1; }
        }

        /* ════════════════════════════════════════
           CARTE GLASS — MODE SOMBRE
        ════════════════════════════════════════ */
        .dark .glass-card {
          background: rgba(255,255,255,0.06);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 8px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1);
        }
        .dark .glass-divider { border-color: rgba(255,255,255,0.1); }

        /* ════════════════════════════════════════
           CARTE GLASS — MODE CLAIR
        ════════════════════════════════════════ */
        html:not(.dark) .glass-card {
          background: rgba(255,255,255,0.72);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(0,99,65,0.15);
          box-shadow: 0 8px 40px rgba(0,99,65,0.08), inset 0 1px 0 rgba(255,255,255,0.9);
        }
        html:not(.dark) .glass-divider { border-color: rgba(0,99,65,0.12); }

        /* ════════════════════════════════════════
           TEXTE ADAPTATIF
        ════════════════════════════════════════ */
        .dark .glass-title   { color: rgba(255,255,255,0.5); }
        .dark .glass-tagline { color: rgba(255,255,255,0.35); }
        html:not(.dark) .glass-title   { color: rgba(0,60,30,0.6); }
        html:not(.dark) .glass-tagline { color: rgba(0,60,30,0.45); }

        /* ════════════════════════════════════════
           INPUT ADAPTATIF
        ════════════════════════════════════════ */
        .dark .glass-input {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.15);
          color: #fff;
          backdrop-filter: blur(10px);
        }
        .dark .glass-input::placeholder { color: rgba(255,255,255,0.35); }
        .dark .glass-input:focus {
          outline: none;
          border-color: rgba(0,180,100,0.6);
          box-shadow: 0 0 0 3px rgba(0,99,65,0.25);
          background: rgba(255,255,255,0.12);
        }
        html:not(.dark) .glass-input {
          background: rgba(255,255,255,0.85);
          border: 1px solid rgba(0,99,65,0.2);
          color: #1a2e22;
          backdrop-filter: blur(10px);
        }
        html:not(.dark) .glass-input::placeholder { color: rgba(0,60,30,0.4); }
        html:not(.dark) .glass-input:focus {
          outline: none;
          border-color: rgba(0,99,65,0.5);
          box-shadow: 0 0 0 3px rgba(0,99,65,0.12);
          background: #fff;
        }

        /* ════════════════════════════════════════
           SCOPE BUTTONS ADAPTATIFS
        ════════════════════════════════════════ */
        .dark .scope-wrap {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
        }
        html:not(.dark) .scope-wrap {
          background: rgba(0,99,65,0.06);
          border: 1px solid rgba(0,99,65,0.15);
        }
        .dark .scope-btn   { color: rgba(255,255,255,0.5); }
        html:not(.dark) .scope-btn { color: rgba(0,60,30,0.55); }
        .dark .scope-btn:hover:not(.active-algerie):not(.active-monde) {
          background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85);
        }
        html:not(.dark) .scope-btn:hover:not(.active-algerie):not(.active-monde) {
          background: rgba(0,99,65,0.1); color: #006341;
        }
        .scope-btn { background: transparent; border: 1px solid transparent; transition: all 0.2s ease; }
        .scope-btn.active-algerie { background: rgba(0,99,65,0.4); border-color: rgba(0,180,100,0.5); color: #fff; }
        html:not(.dark) .scope-btn.active-algerie { background: #006341; border-color: #006341; color: #fff; }
        .scope-btn.active-monde   { background: rgba(214,29,44,0.4); border-color: rgba(214,29,44,0.5); color: #fff; }
        html:not(.dark) .scope-btn.active-monde   { background: #d61d2c; border-color: #d61d2c; color: #fff; }

        /* ════════════════════════════════════════
           BOUTONS D'ACTION (identiques dark/light)
        ════════════════════════════════════════ */
        .glass-btn-primary {
          background: linear-gradient(135deg, #006341, #004d30);
          border: 1px solid rgba(0,180,100,0.4);
          box-shadow: 0 4px 20px rgba(0,99,65,0.35);
          transition: all 0.2s ease;
        }
        .glass-btn-primary:hover { background: linear-gradient(135deg, #007a50, #006341); transform: translateY(-1px); box-shadow: 0 6px 28px rgba(0,99,65,0.5); }
        .glass-btn-red {
          background: linear-gradient(135deg, #d61d2c, #b61724);
          border: 1px solid rgba(214,29,44,0.4);
          box-shadow: 0 4px 20px rgba(214,29,44,0.3);
          transition: all 0.2s ease;
        }
        .glass-btn-red:hover { transform: translateY(-1px); box-shadow: 0 6px 28px rgba(214,29,44,0.5); }
        .glass-btn-amber {
          background: linear-gradient(135deg, #b87000, #8a5200);
          border: 1px solid rgba(184,112,0,0.4);
          box-shadow: 0 4px 20px rgba(184,112,0,0.3);
          transition: all 0.2s ease;
        }
        .glass-btn-amber:hover { transform: translateY(-1px); box-shadow: 0 6px 28px rgba(184,112,0,0.5); }

        /* ════════════════════════════════════════
           BOUTON DÉCOUVRIR ADAPTATIF
        ════════════════════════════════════════ */
        .dark .discover-btn {
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.15);
          color: rgba(255,255,255,0.75);
          backdrop-filter: blur(12px);
        }
        .dark .discover-btn:hover {
          background: rgba(0,99,65,0.3);
          border-color: rgba(0,180,100,0.5);
          color: #fff;
        }
        html:not(.dark) .discover-btn {
          background: rgba(255,255,255,0.6);
          border: 1px solid rgba(0,99,65,0.2);
          color: #006341;
          backdrop-filter: blur(12px);
        }
        html:not(.dark) .discover-btn:hover {
          background: rgba(0,99,65,0.1);
          border-color: rgba(0,99,65,0.4);
          color: #004d30;
        }
        .discover-btn { transition: all 0.25s ease; }
        .discover-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,99,65,0.2); }

        /* ════════════════════════════════════════
           RÉSULTATS GOOGLE CSE
        ════════════════════════════════════════ */
        .gsc-search-box, .gsc-search-box-tools { display: none !important; }
        .gsc-above-wrapper-area { border-bottom: 0 !important; padding: 0 !important; }
        .gsc-adBlock { display: none !important; }
        .gsc-control-cse { padding: 0 !important; border: 0 !important; background: transparent !important; }
        .gsc-results .gsc-cursor-box { text-align: center !important; }

        /* Résultats mode sombre */
        .dark .gsc-result-info { color: rgba(255,255,255,0.4) !important; font-size: 11px !important; padding: 0 0 8px !important; }
        .dark .gsc-webResult.gsc-result {
          background: rgba(255,255,255,0.06) !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          border-radius: 12px !important; padding: 12px 14px !important; margin: 0 0 10px !important;
          backdrop-filter: blur(10px) !important;
        }
        .dark .gs-title a, .dark .gs-title a b { color: #4ade80 !important; text-decoration: none !important; }
        .dark .gs-snippet { color: rgba(255,255,255,0.6) !important; }
        .dark .gsc-cursor-page { color: rgba(255,255,255,0.5) !important; }
        .dark .gsc-cursor-current-page { color: #4ade80 !important; font-weight: bold !important; }

        /* Résultats mode clair */
        html:not(.dark) .gsc-result-info { color: rgba(0,60,30,0.5) !important; font-size: 11px !important; padding: 0 0 8px !important; }
        html:not(.dark) .gsc-webResult.gsc-result {
          background: rgba(255,255,255,0.8) !important;
          border: 1px solid rgba(0,99,65,0.12) !important;
          border-radius: 12px !important; padding: 12px 14px !important; margin: 0 0 10px !important;
          backdrop-filter: blur(8px) !important;
          box-shadow: 0 2px 12px rgba(0,99,65,0.06) !important;
        }
        html:not(.dark) .gs-title a, html:not(.dark) .gs-title a b { color: #006341 !important; text-decoration: none !important; }
        html:not(.dark) .gs-snippet { color: #374151 !important; }
        html:not(.dark) .gsc-cursor-page { color: rgba(0,60,30,0.5) !important; }
        html:not(.dark) .gsc-cursor-current-page { color: #006341 !important; font-weight: bold !important; }

        .gs-title, .gs-title b { font-size: 16px !important; font-weight: 700 !important; }
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
          alt="حنايا"
          className="h-24 mb-3 object-contain"
          style={{ filter: "drop-shadow(0 0 24px rgba(0,150,80,0.35))" }}
        />

        {/* Tagline */}
        <p className="glass-tagline text-xs tracking-widest uppercase mb-8 font-light">
          {tr.tagline}
        </p>

        {/* ── Carte de recherche ── */}
        <div className="glass-card rounded-3xl w-full max-w-3xl overflow-hidden">

          {/* Scope switcher */}
          <div className={`flex items-center gap-3 px-5 pt-4 pb-3 glass-divider border-b ${isRTL ? "flex-row-reverse" : ""}`}>
            <span className="glass-title text-xs font-semibold tracking-wider uppercase">
              {tr.title}
            </span>
            <div className="scope-wrap flex rounded-xl p-1 gap-1">
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

            {/* Panel Algérie — toujours dans le DOM pour init CSE */}
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
                  onClick={() => addTab(
                    algerieQuery.trim()
                      ? `https://hnaya.dz/boutique/?search=${encodeURIComponent(algerieQuery.trim())}`
                      : "https://hnaya.dz/boutique/"
                  )}
                  className="glass-btn-amber h-12 px-4 rounded-xl font-bold text-white text-sm flex items-center gap-2"
                >
                  <img src="/icons/market.png" alt="" className="w-5 h-5 object-contain" />
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
          className="discover-btn mt-8 px-8 py-3.5 rounded-2xl font-semibold text-base"
        >
          🇩🇿 {tr.discover}
        </button>
      </section>
    </>
  );
}
