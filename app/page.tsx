"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTabContext } from "@/context/tabcontext";
import { useLanguage } from "@/context/langcontext";
import BuildStamp from "@/components/BuildStamp";

const TR = {
  ar: {
    title: "بحث", algerie: "الجزائر", monde: "العالم",
    shop: "بحث للتسوّق",
    algeriePlaceholder: "ابحث في الجزائر...", algerieButton: "بحث",
    worldPlaceholder: "ابحث في العالم...", worldButton: "بحث عالمي",
    discover: "اكتشف الويب الجزائري",
    // Signature volontairement NON géographique (décision produit
    // 2026-07-19) : « algérien » limitait la portée de la marque —
    // on met en avant les trois piliers, pas une frontière.
    tagline: "متصفحك، شبكتك، بياناتك",
  },
  fr: {
    title: "Recherche", algerie: "Algérie", monde: "Monde",
    shop: "Achat",
    algeriePlaceholder: "Rechercher en Algérie...", algerieButton: "Rechercher",
    worldPlaceholder: "Rechercher dans le monde...", worldButton: "Recherche monde",
    discover: "Découvrez le web algérien",
    tagline: "Votre navigateur, votre réseau, vos données",
  },
  en: {
    title: "Search", algerie: "Algeria", monde: "World",
    shop: "Buy",
    algeriePlaceholder: "Search in Algeria...", algerieButton: "Search",
    worldPlaceholder: "Search the world...", worldButton: "World search",
    discover: "Discover the Algerian web",
    tagline: "Your browser, your network, your data",
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

  useEffect(() => {
    const intercept = () => {
      document.querySelectorAll<HTMLAnchorElement>(".gsc-results a.gs-title, .gsc-webResult a, .gs-title a")
        .forEach((link) => {
          if (link.dataset.hnayaIntercepted) return;
          link.dataset.hnayaIntercepted = "true";
          link.addEventListener("click", (e) => {
            e.preventDefault();
            const href = link.href || link.getAttribute("data-ctorig") || "";
            if (href.startsWith("http")) addTab(href);
          });
        });
    };
    const observer = new MutationObserver(intercept);
    observer.observe(document.body, { childList: true, subtree: true });
    intercept();
    return () => observer.disconnect();
  }, [addTab]);

  const performAlgerieSearch = useCallback(() => {
    const q = algerieQuery.trim();
    if (!q) return;
    const tryExecute = (): boolean => {
      const g = (window as any).google;
      if (g?.search?.cse?.element) {
        const el = g.search.cse.element.getElement("searchresults-only0") || g.search.cse.element.getElement("search0");
        if (el) { el.execute(q); return true; }
      }
      const input = document.querySelector<HTMLInputElement>(".gsc-input-box input, input.gsc-input");
      const btn = document.querySelector<HTMLElement>(".gsc-search-button button, .gsc-search-button-v2");
      if (input && btn) { input.value = q; input.dispatchEvent(new Event("input", { bubbles: true })); btn.click(); return true; }
      return false;
    };
    if (!tryExecute()) {
      let attempts = 0;
      const iv = setInterval(() => { attempts++; if (tryExecute() || attempts > 10) clearInterval(iv); }, 300);
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

        /* ══════════════════════════════════════════════
           FOND ANIMÉ — SOMBRE (vert algérien profond)
        ══════════════════════════════════════════════ */
        .dark .hnaya-bg {
          position:fixed;inset:0;z-index:-1;overflow:hidden;
          background:linear-gradient(135deg,#001a0e 0%,#003320 40%,#001208 70%,#0a0a0a 100%);
        }
        .dark .hnaya-bg::before {
          content:'';position:absolute;width:600px;height:600px;border-radius:50%;
          background:radial-gradient(circle,rgba(0,99,65,0.35) 0%,transparent 70%);
          top:-100px;left:-100px;animation:pulse-slow 8s ease-in-out infinite alternate;
        }
        .dark .hnaya-bg::after {
          content:'';position:absolute;width:400px;height:400px;border-radius:50%;
          background:radial-gradient(circle,rgba(214,29,44,0.2) 0%,transparent 70%);
          bottom:50px;right:-80px;animation:pulse-slow 10s ease-in-out infinite alternate-reverse;
        }

        /* ══════════════════════════════════════════════
           FOND ANIMÉ — CLAIR (vert pâle)
        ══════════════════════════════════════════════ */
        .light .hnaya-bg {
          position:fixed;inset:0;z-index:-1;overflow:hidden;
          background:linear-gradient(135deg,#e8f5ee 0%,#f0f7f4 45%,#fef9f0 100%);
        }
        .light .hnaya-bg::before {
          content:'';position:absolute;width:600px;height:600px;border-radius:50%;
          background:radial-gradient(circle,rgba(0,99,65,0.12) 0%,transparent 70%);
          top:-100px;left:-100px;animation:pulse-slow 8s ease-in-out infinite alternate;
        }
        .light .hnaya-bg::after {
          content:'';position:absolute;width:400px;height:400px;border-radius:50%;
          background:radial-gradient(circle,rgba(214,29,44,0.08) 0%,transparent 70%);
          bottom:50px;right:-80px;animation:pulse-slow 10s ease-in-out infinite alternate-reverse;
        }

        /* ══════════════════════════════════════════════
           FOND ANIMÉ — COUCHER DE SOLEIL
           Chromostereopsis : rouge/orange vibrante sur fond quasi-noir
           Les couches superposées créent l'effet de profondeur optique
        ══════════════════════════════════════════════ */
        .sunset .hnaya-bg {
          position:fixed;inset:0;z-index:-1;overflow:hidden;
          background:linear-gradient(160deg,
            #0d0005 0%,
            #1a0010 20%,
            #2d0008 40%,
            #1a0800 60%,
            #0d0400 100%
          );
        }
        /* Grande orbe rouge-magenta */
        .sunset .hnaya-bg::before {
          content:'';position:absolute;
          width:800px;height:800px;border-radius:50%;
          background:radial-gradient(circle,
            rgba(220,20,60,0.55) 0%,
            rgba(180,0,80,0.3) 35%,
            transparent 70%
          );
          top:-200px;right:-150px;
          animation:sunset-pulse-a 7s ease-in-out infinite alternate;
          mix-blend-mode:screen;
        }
        /* Orbe orange brûlante */
        .sunset .hnaya-bg::after {
          content:'';position:absolute;
          width:600px;height:600px;border-radius:50%;
          background:radial-gradient(circle,
            rgba(255,100,0,0.6) 0%,
            rgba(255,60,0,0.35) 40%,
            transparent 70%
          );
          bottom:-100px;left:-100px;
          animation:sunset-pulse-b 9s ease-in-out infinite alternate-reverse;
          mix-blend-mode:screen;
        }
        @keyframes sunset-pulse-a {
          from { transform:scale(1) translate(0,0); opacity:0.8; }
          to   { transform:scale(1.2) translate(-40px,30px); opacity:1; }
        }
        @keyframes sunset-pulse-b {
          from { transform:scale(1) translate(0,0); opacity:0.7; }
          to   { transform:scale(1.15) translate(30px,-20px); opacity:1; }
        }
        /* Orbe dorée centrale — couche supplémentaire sunset */
        .sunset .hnaya-bg-extra {
          position:fixed;inset:0;z-index:-1;pointer-events:none;
          overflow:hidden;
        }
        .sunset .hnaya-bg-extra::before {
          content:'';position:absolute;
          width:500px;height:500px;border-radius:50%;
          background:radial-gradient(circle,
            rgba(255,180,0,0.35) 0%,
            rgba(255,120,0,0.2) 45%,
            transparent 70%
          );
          top:30%;left:30%;transform:translate(-50%,-50%);
          animation:sunset-pulse-c 11s ease-in-out infinite alternate;
          mix-blend-mode:screen;
        }
        @keyframes sunset-pulse-c {
          from { transform:translate(-50%,-50%) scale(1); opacity:0.6; }
          to   { transform:translate(-40%,-60%) scale(1.3); opacity:0.9; }
        }
        /* Ligne d'horizon lumineuse */
        .sunset .hnaya-bg-extra::after {
          content:'';position:absolute;
          width:100%;height:2px;
          background:linear-gradient(90deg,
            transparent 0%,
            rgba(255,100,20,0.6) 20%,
            rgba(255,200,50,0.9) 50%,
            rgba(255,100,20,0.6) 80%,
            transparent 100%
          );
          top:65%;
          animation:horizon-glow 6s ease-in-out infinite alternate;
          filter:blur(3px);
          box-shadow:0 0 30px 10px rgba(255,150,0,0.4);
        }
        @keyframes horizon-glow {
          from { opacity:0.6; transform:scaleX(0.9); }
          to   { opacity:1; transform:scaleX(1.05); }
        }

        @keyframes pulse-slow {
          from { transform:scale(1) translateY(0); opacity:0.8; }
          to   { transform:scale(1.15) translateY(-30px); opacity:1; }
        }

        /* ══════════════════════════════════════════════
           CLIN D'ŒIL DU LOGO — animation NON perpétuelle
           Une seule fois à l'ouverture : fondu + montée, puis une brève
           inclinaison avec micro-tassement (langage corporel d'un clin
           d'œil). transform/opacity uniquement → composé par le GPU,
           aucun coût une fois terminée.
        ══════════════════════════════════════════════ */
        .logo-wink {
          transform-origin: 50% 85%;
          animation: logo-wink 1.6s cubic-bezier(0.22, 1, 0.36, 1) 1 both;
        }
        @keyframes logo-wink {
          0%   { opacity:0; transform:translateY(14px) scale(0.96); }
          38%  { opacity:1; transform:translateY(0) scale(1); }
          52%  { transform:rotate(0deg) scaleY(1); }
          64%  { transform:rotate(-7deg) scaleY(0.94); }
          78%  { transform:rotate(2deg) scaleY(1.01); }
          100% { opacity:1; transform:rotate(0deg) scaleY(1); }
        }
        /* Accessibilité + petites machines : aucun mouvement si le
           système demande la réduction des animations */
        @media (prefers-reduced-motion: reduce) {
          .logo-wink, .hnaya-bg::before, .hnaya-bg::after,
          .hnaya-bg-extra::before, .hnaya-bg-extra::after {
            animation: none !important;
          }
        }

        /* ══════════════════════════════════════════════
           CARTE GLASS — 3 THÈMES
        ══════════════════════════════════════════════ */
        .dark .glass-card {
          background:rgba(255,255,255,0.06);
          backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
          border:1px solid rgba(255,255,255,0.12);
          box-shadow:0 8px 40px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.1);
        }
        .light .glass-card {
          background:rgba(255,255,255,0.72);
          backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
          border:1px solid rgba(0,99,65,0.15);
          box-shadow:0 8px 40px rgba(0,99,65,0.08),inset 0 1px 0 rgba(255,255,255,0.9);
        }
        .sunset .glass-card {
          background:rgba(40,5,10,0.55);
          backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
          border:1px solid rgba(255,80,20,0.25);
          box-shadow:0 8px 50px rgba(200,20,0,0.3),inset 0 1px 0 rgba(255,150,50,0.15);
        }

        /* ══════════════════════════════════════════════
           DIVIDER
        ══════════════════════════════════════════════ */
        .dark .glass-divider   { border-color:rgba(255,255,255,0.1); }
        .light .glass-divider  { border-color:rgba(0,99,65,0.12); }
        .sunset .glass-divider { border-color:rgba(255,80,20,0.2); }

        /* ══════════════════════════════════════════════
           TEXTES ADAPTATIFS
        ══════════════════════════════════════════════ */
        .dark .glass-title    { color:rgba(255,255,255,0.5); }
        .dark .glass-tagline  { color:rgba(255,255,255,0.3); }
        .light .glass-title   { color:rgba(0,60,30,0.6); }
        .light .glass-tagline { color:rgba(0,60,30,0.4); }
        .sunset .glass-title  { color:rgba(255,160,80,0.7); }
        .sunset .glass-tagline{ color:rgba(255,120,50,0.5); }

        /* ══════════════════════════════════════════════
           INPUTS ADAPTATIFS
        ══════════════════════════════════════════════ */
        .dark .glass-input {
          background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);
          color:#fff;backdrop-filter:blur(10px);
        }
        .dark .glass-input::placeholder { color:rgba(255,255,255,0.35); }
        .dark .glass-input:focus { outline:none;border-color:rgba(0,180,100,0.6);box-shadow:0 0 0 3px rgba(0,99,65,0.25);background:rgba(255,255,255,0.12); }

        .light .glass-input {
          background:rgba(255,255,255,0.85);border:1px solid rgba(0,99,65,0.2);
          color:#1a2e22;backdrop-filter:blur(10px);
        }
        .light .glass-input::placeholder { color:rgba(0,60,30,0.4); }
        .light .glass-input:focus { outline:none;border-color:rgba(0,99,65,0.5);box-shadow:0 0 0 3px rgba(0,99,65,0.12);background:#fff; }

        .sunset .glass-input {
          background:rgba(60,5,5,0.6);border:1px solid rgba(255,80,20,0.3);
          color:#ffd4a0;backdrop-filter:blur(10px);
        }
        .sunset .glass-input::placeholder { color:rgba(255,150,80,0.4); }
        .sunset .glass-input:focus { outline:none;border-color:rgba(255,120,30,0.7);box-shadow:0 0 0 3px rgba(220,60,0,0.2);background:rgba(80,10,5,0.7); }

        /* ══════════════════════════════════════════════
           SCOPE BUTTONS
        ══════════════════════════════════════════════ */
        .scope-btn { background:transparent;border:1px solid transparent;transition:all 0.2s ease; }
        .dark .scope-wrap  { background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1); }
        .light .scope-wrap { background:rgba(0,99,65,0.06);border:1px solid rgba(0,99,65,0.15); }
        .sunset .scope-wrap{ background:rgba(80,10,0,0.4);border:1px solid rgba(255,80,20,0.2); }

        .dark .scope-btn   { color:rgba(255,255,255,0.5); }
        .light .scope-btn  { color:rgba(0,60,30,0.55); }
        .sunset .scope-btn { color:rgba(255,150,80,0.55); }

        .dark .scope-btn:hover:not(.active-algerie):not(.active-monde)   { background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.85); }
        .light .scope-btn:hover:not(.active-algerie):not(.active-monde)  { background:rgba(0,99,65,0.1);color:#006341; }
        .sunset .scope-btn:hover:not(.active-algerie):not(.active-monde) { background:rgba(255,80,20,0.15);color:#ffb060; }

        .scope-btn.active-algerie { background:rgba(0,99,65,0.4);border-color:rgba(0,180,100,0.5);color:#fff; }
        .light .scope-btn.active-algerie { background:#006341;border-color:#006341;color:#fff; }
        .sunset .scope-btn.active-algerie { background:rgba(220,60,0,0.5);border-color:rgba(255,100,20,0.6);color:#fff; }

        .scope-btn.active-monde { background:rgba(214,29,44,0.4);border-color:rgba(214,29,44,0.5);color:#fff; }
        .light .scope-btn.active-monde { background:#d61d2c;border-color:#d61d2c;color:#fff; }
        .sunset .scope-btn.active-monde { background:rgba(150,0,60,0.5);border-color:rgba(200,20,80,0.6);color:#ffb0c0; }

        /* ══════════════════════════════════════════════
           BOUTONS D'ACTION
        ══════════════════════════════════════════════ */
        .glass-btn-primary {
          background:linear-gradient(135deg,#006341,#004d30);
          border:1px solid rgba(0,180,100,0.4);
          box-shadow:0 4px 20px rgba(0,99,65,0.35);transition:all 0.2s ease;
        }
        .glass-btn-primary:hover { background:linear-gradient(135deg,#007a50,#006341);transform:translateY(-1px);box-shadow:0 6px 28px rgba(0,99,65,0.5); }

        .sunset .glass-btn-primary {
          background:linear-gradient(135deg,#c83200,#8a1a00);
          border:1px solid rgba(255,80,20,0.4);
          box-shadow:0 4px 20px rgba(200,50,0,0.4);
        }
        .sunset .glass-btn-primary:hover { background:linear-gradient(135deg,#e83a00,#c83200);transform:translateY(-1px); }

        .glass-btn-red {
          background:linear-gradient(135deg,#d61d2c,#b61724);
          border:1px solid rgba(214,29,44,0.4);
          box-shadow:0 4px 20px rgba(214,29,44,0.3);transition:all 0.2s ease;
        }
        .glass-btn-red:hover { transform:translateY(-1px);box-shadow:0 6px 28px rgba(214,29,44,0.5); }

        .sunset .glass-btn-red {
          background:linear-gradient(135deg,#8a0040,#5a0030);
          border:1px solid rgba(200,20,80,0.4);
          box-shadow:0 4px 20px rgba(140,0,60,0.4);
        }
        .sunset .glass-btn-red:hover { background:linear-gradient(135deg,#aa0050,#8a0040);transform:translateY(-1px); }

        .glass-btn-amber {
          background:linear-gradient(135deg,#b87000,#8a5200);
          border:1px solid rgba(184,112,0,0.4);
          box-shadow:0 4px 20px rgba(184,112,0,0.3);transition:all 0.2s ease;
        }
        .glass-btn-amber:hover { transform:translateY(-1px);box-shadow:0 6px 28px rgba(184,112,0,0.5); }

        .sunset .glass-btn-amber {
          background:linear-gradient(135deg,#c85000,#8a2800);
          border:1px solid rgba(255,120,0,0.4);
          box-shadow:0 4px 20px rgba(200,80,0,0.4);
        }
        .sunset .glass-btn-amber:hover { background:linear-gradient(135deg,#e06000,#c85000);transform:translateY(-1px); }

        /* ══════════════════════════════════════════════
           BOUTON DÉCOUVRIR
        ══════════════════════════════════════════════ */
        .dark .discover-btn   { background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.75); }
        .dark .discover-btn:hover   { background:rgba(0,99,65,0.3);border-color:rgba(0,180,100,0.5);color:#fff; }
        .light .discover-btn  { background:rgba(255,255,255,0.6);border:1px solid rgba(0,99,65,0.2);color:#006341; }
        .light .discover-btn:hover  { background:rgba(0,99,65,0.1);border-color:rgba(0,99,65,0.4);color:#004d30; }
        .sunset .discover-btn { background:rgba(60,5,0,0.5);border:1px solid rgba(255,80,20,0.25);color:rgba(255,160,80,0.8); }
        .sunset .discover-btn:hover { background:rgba(150,30,0,0.4);border-color:rgba(255,120,30,0.5);color:#ffb060; }
        .discover-btn { backdrop-filter:blur(12px);transition:all 0.25s ease; }
        .discover-btn:hover { transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,0.2); }

        /* ══════════════════════════════════════════════
           RÉSULTATS CSE
        ══════════════════════════════════════════════ */
        .gsc-search-box,.gsc-search-box-tools{display:none!important;}
        .gsc-above-wrapper-area{border-bottom:0!important;padding:0!important;}
        .gsc-adBlock{display:none!important;}
        .gsc-control-cse{padding:0!important;border:0!important;background:transparent!important;}
        .gs-title,.gs-title b{font-size:15px!important;font-weight:700!important;}

        .dark .gsc-result-info{color:rgba(255,255,255,0.4)!important;font-size:11px!important;padding:0 0 8px!important;}
        .dark .gsc-webResult.gsc-result{background:rgba(255,255,255,0.06)!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:6px!important;padding:12px 14px!important;margin:0 0 10px!important;backdrop-filter:blur(10px)!important;}
        .dark .gs-title a,.dark .gs-title a b{color:#4ade80!important;text-decoration:none!important;}
        .dark .gs-snippet{color:rgba(255,255,255,0.6)!important;}
        .dark .gsc-cursor-page{color:rgba(255,255,255,0.5)!important;}
        .dark .gsc-cursor-current-page{color:#4ade80!important;font-weight:bold!important;}

        .light .gsc-result-info{color:rgba(0,60,30,0.5)!important;font-size:11px!important;padding:0 0 8px!important;}
        .light .gsc-webResult.gsc-result{background:rgba(255,255,255,0.8)!important;border:1px solid rgba(0,99,65,0.12)!important;border-radius:6px!important;padding:12px 14px!important;margin:0 0 10px!important;backdrop-filter:blur(8px)!important;box-shadow:0 2px 12px rgba(0,99,65,0.06)!important;}
        .light .gs-title a,.light .gs-title a b{color:#006341!important;text-decoration:none!important;}
        .light .gs-snippet{color:#374151!important;}
        .light .gsc-cursor-page{color:rgba(0,60,30,0.5)!important;}
        .light .gsc-cursor-current-page{color:#006341!important;font-weight:bold!important;}

        .sunset .gsc-result-info{color:rgba(255,150,80,0.5)!important;font-size:11px!important;padding:0 0 8px!important;}
        .sunset .gsc-webResult.gsc-result{background:rgba(50,5,5,0.6)!important;border:1px solid rgba(255,80,20,0.2)!important;border-radius:6px!important;padding:12px 14px!important;margin:0 0 10px!important;backdrop-filter:blur(12px)!important;box-shadow:0 4px 20px rgba(180,20,0,0.2)!important;}
        .sunset .gs-title a,.sunset .gs-title a b{color:#ff9060!important;text-decoration:none!important;}
        .sunset .gs-snippet{color:rgba(255,180,120,0.7)!important;}
        .sunset .gsc-cursor-page{color:rgba(255,120,60,0.5)!important;}
        .sunset .gsc-cursor-current-page{color:#ff9060!important;font-weight:bold!important;}

        /* ══════════════════════════════════════════════
           THÈME PERSONNALISÉ — même style que .dark
           mais avec fond transparent pour laisser
           apparaître l'image de fond
        ══════════════════════════════════════════════ */
        .custom .glass-card {
  background:rgba(0,0,0,0.05);
  backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
  border:1px solid rgba(255,255,255,0.08);
  box-shadow:0 8px 40px rgba(0,0,0,0.2),inset 0 1px 0 rgba(255,255,255,0.05);
}
        .custom .glass-input {
          background:rgba(0,0,0,0.3);
          border:1px solid rgba(255,255,255,0.15);
          color:#fff;backdrop-filter:blur(12px);
        }
        .custom .glass-input::placeholder { color:rgba(255,255,255,0.4); }
        .custom .glass-input:focus {
          outline:none;
          border-color:rgba(0,180,100,0.7);
          box-shadow:0 0 0 3px rgba(0,99,65,0.3);
          background:rgba(0,0,0,0.5);
        }

        .custom .scope-wrap { background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.15); }
        .custom .scope-btn  { color:rgba(255,255,255,0.55); }
        .custom .scope-btn:hover:not(.active-algerie):not(.active-monde) { background:rgba(255,255,255,0.1);color:#fff; }
        .custom .scope-btn.active-algerie { background:rgba(0,99,65,0.5);border-color:rgba(0,180,100,0.6);color:#fff; }
        .custom .scope-btn.active-monde   { background:rgba(214,29,44,0.5);border-color:rgba(214,29,44,0.6);color:#fff; }

        .custom .discover-btn {
          background:rgba(0,0,0,0.4);
          border:1px solid rgba(255,255,255,0.2);
          color:rgba(255,255,255,0.75);
        }
        .custom .discover-btn:hover { background:rgba(0,99,65,0.35);border-color:rgba(0,180,100,0.4);color:#fff; }

        /* Résultats PSE en thème custom */
        .custom .gsc-control-cse{background:transparent!important;border:none!important;}
        .custom .gsc-result-info{color:rgba(255,255,255,0.5)!important;font-size:11px!important;padding:0 0 8px!important;}
        .custom .gsc-webResult.gsc-result{background:rgba(0,0,0,0.45)!important;border:1px solid rgba(255,255,255,0.12)!important;border-radius:6px!important;padding:12px 14px!important;margin:0 0 10px!important;backdrop-filter:blur(12px)!important;}
        .custom .gs-title a,.custom .gs-title a b{color:#7dffb3!important;text-decoration:none!important;}
        .custom .gs-snippet{color:rgba(255,255,255,0.65)!important;}
        .custom .gsc-cursor-page{color:rgba(255,255,255,0.45)!important;}
        .custom .gsc-cursor-current-page{color:#fff!important;font-weight:bold!important;}
      `}</style>

      <div className="hnaya-bg" />
      {/* Couche extra pour le sunset (orbe dorée + horizon) */}
      <div className="hnaya-bg-extra" />

      <section
        className="flex flex-col items-center w-screen min-h-[88vh] pt-[15vh] pb-12 px-4"
        dir={isRTL ? "rtl" : "ltr"}
      >
        <img src="/hnaya.png" alt="حنايا" className="logo-wink h-24 mb-3 object-contain"
          style={{ filter: "drop-shadow(0 0 24px rgba(0,150,80,0.35))" }} />

        <p className="glass-tagline text-xs tracking-widest uppercase mb-8 font-light">{tr.tagline}</p>

        {/* Arrondis resserrés (retour produit 2026-07-19) : rounded-3xl
            faisait « gadget » — registre professionnel visé */}
        <div className="glass-card rounded-lg w-full max-w-3xl overflow-hidden">
          <div className={`flex items-center gap-3 px-5 pt-4 pb-3 glass-divider border-b ${isRTL ? "flex-row-reverse" : ""}`}>
            <span className="glass-title text-xs font-semibold tracking-wider uppercase">{tr.title}</span>
            <div className="scope-wrap flex rounded-md p-1 gap-1" data-tutorial="search-scope">
              <button onClick={() => setScope("algerie")} className={`scope-btn px-4 py-1 rounded text-[13px] font-bold ${scope === "algerie" ? "active-algerie" : ""}`}>{tr.algerie}</button>
              <button onClick={() => setScope("monde")} className={`scope-btn px-4 py-1 rounded text-[13px] font-bold ${scope === "monde" ? "active-monde" : ""}`}>{tr.monde}</button>
            </div>
          </div>

          <div className="p-5">
            <div style={{ display: scope === "algerie" ? "block" : "none" }}>
              <div className={`flex gap-2 mb-4 ${isRTL ? "flex-row-reverse" : ""}`}>
                <input type="text" value={algerieQuery} onChange={(e) => setAlgerieQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && performAlgerieSearch()} placeholder={tr.algeriePlaceholder} className="glass-input flex-1 h-11 px-4 rounded text-[14px]" dir={isRTL ? "rtl" : "ltr"} />
                <button onClick={performAlgerieSearch} className="glass-btn-primary h-11 px-5 rounded font-bold text-white text-[13px]">{tr.algerieButton}</button>
                <button onClick={() => addTab(algerieQuery.trim() ? `https://hnaya.dz/boutique/?search=${encodeURIComponent(algerieQuery.trim())}` : "https://hnaya.dz/boutique/")} className="glass-btn-amber h-11 px-4 rounded font-bold text-white text-[13px] flex items-center gap-2" data-tutorial="shop-btn">
                  <img src="/icons/market.png" alt="" className="w-5 h-5 object-contain" />
                  {tr.shop}
                </button>
              </div>
              <div className="gcse-search" />
            </div>

            {scope === "monde" && (
              <div className={`flex gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
                <input type="text" value={worldQuery} onChange={(e) => setWorldQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && performWorldSearch()} placeholder={tr.worldPlaceholder} className="glass-input flex-1 h-11 px-4 rounded text-[14px]" dir={isRTL ? "rtl" : "ltr"} />
                <button onClick={performWorldSearch} className="glass-btn-red h-11 px-5 rounded font-bold text-white text-[13px]">{tr.worldButton}</button>
              </div>
            )}
          </div>
        </div>

        <button onClick={() => addTab("https://hnaya.dz")} className="discover-btn mt-8 px-6 py-2.5 rounded font-semibold text-sm">
          🇩🇿 {tr.discover}
        </button>

        {/* Version + date de construction : discret, mais suffisant pour
            savoir en un coup d'oeil quel binaire tourne sur ce poste. */}
        <BuildStamp />
      </section>
    </>
  );
}
