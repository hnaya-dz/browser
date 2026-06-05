"use client";
import { useEffect, useRef } from "react";
import { useTabContext } from "@/context/tabcontext";
import { useLanguage } from "@/context/langcontext";

const HNAYA_LINKS = [
  {
    key: "home",
    url: "https://hnaya.dz",
    labels: { ar: "هناية", fr: "Accueil", en: "Home" },
    icon: "🏠",
    color: "#006341",
  },
  {
    key: "market",
    url: "https://hnaya.dz/boutique",
    labels: { ar: "هناية ماركت", fr: "Hnaya Market", en: "Hnaya Market" },
    icon: "🛒",
    color: "#f59e0b",
  },
  {
    key: "tube",
    url: "https://hnaya.dz/hnayatube",
    labels: { ar: "هناية تيوب", fr: "Hnaya Tube", en: "Hnaya Tube" },
    icon: "▶️",
    color: "#d61d2c",
  },
  {
    key: "apps",
    url: "https://hnaya.dz/apps",
    labels: { ar: "هناية أبستور", fr: "Hnaya Appstore", en: "Hnaya Appstore" },
    icon: "📱",
    color: "#3b82f6",
  },
  {
    key: "webhost",
    url: "https://hnaya.dz/hnaya-sites-web",
    labels: { ar: "هناية ويبهوست", fr: "Hnaya Webhost", en: "Hnaya Webhost" },
    icon: "🌐",
    color: "#8b5cf6",
  },
];

const DISCOVER_LABEL = {
  ar: "اكتشف الويب الجزائري",
  fr: "Découvrez le web algérien",
  en: "Discover the Algerian web",
};

export default function Home() {
  const { addTab } = useTabContext();
  const { language, isRTL } = useLanguage();
  const widgetRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  // Inject Google CSE script once
  useEffect(() => {
    if (scriptRef.current) return;
    const script = document.createElement("script");
    script.src = "https://cse.google.com/cse.js?cx=d6cbf11613afc4d13";
    script.async = true;
    document.head.appendChild(script);
    scriptRef.current = script;
  }, []);

  // Sync widget language with app language
  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget) return;
    const lang = language === "ar" ? "ar" : language === "fr" ? "fr" : "fr";
    // Click the correct lang button inside the widget
    const btn = widget.querySelector<HTMLButtonElement>(
      `.hnaya-btn-lang[data-lang="${lang}"]`
    );
    if (btn && !btn.classList.contains("active")) {
      btn.click();
    }
  }, [language]);

  const handleDiscover = () => {
    addTab("https://hnaya.dz");
  };

  return (
    <section
      className="flex flex-col items-center w-screen min-h-[88vh] pt-[14vh] pb-10 px-4 bg-background"
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* Logo */}
      <img
        src="/hnaya.png"
        alt="Hnaya DZ"
        className="h-16 mb-8 object-contain"
      />

      {/* Hnaya Quick Links */}
      <div
        className={`flex flex-wrap gap-3 justify-center mb-8`}
      >
        {HNAYA_LINKS.map((link) => (
          <button
            key={link.key}
            onClick={() => addTab(link.url)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm text-white shadow-md hover:scale-105 hover:shadow-lg transition-all duration-200"
            style={{ backgroundColor: link.color }}
          >
            <span>{link.icon}</span>
            <span>{link.labels[language as keyof typeof link.labels] ?? link.labels.fr}</span>
          </button>
        ))}
      </div>

      {/* Search Widget */}
      <div className="w-full max-w-4xl" ref={widgetRef}>
        <style>{`
          .hnaya-search-widget{
            --hnaya-green:#006341;--hnaya-green-dark:#004d30;--hnaya-red:#d61d2c;
            --hnaya-red-dark:#b61724;--hnaya-shop:#f59e0b;--hnaya-shop-dark:#d97706;
            --hnaya-soft:#eef2f6;--hnaya-line:#dbe3ea;--hnaya-line-strong:#c8d2dc;
            --hnaya-text:#16202a;--hnaya-radius-xl:22px;
            --hnaya-shadow:0 18px 50px rgba(15,23,42,.08);
            max-width:100%;margin:0 auto;
            font-family:Inter,"Segoe UI","Noto Sans Arabic",Arial,sans-serif;
            color:var(--hnaya-text);
          }
          .hnaya-search-widget[dir="rtl"]{text-align:right}
          .hnaya-card{background:#fff;border:1px solid var(--hnaya-line);border-radius:var(--hnaya-radius-xl);box-shadow:var(--hnaya-shadow);overflow:hidden;}
          .hnaya-body{padding:18px 20px}
          .hnaya-topbar{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;margin-bottom:8px;}
          .hnaya-left{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
          .hnaya-title{font-size:15px;font-weight:700;line-height:1;}
          .hnaya-segment{display:inline-flex;align-items:center;gap:4px;background:#e2e8f0;border:1px solid var(--hnaya-line-strong);border-radius:999px;padding:4px;}
          .hnaya-btn-segment{appearance:none;border:0;background:transparent;color:var(--hnaya-text);padding:9px 15px;border-radius:999px;cursor:pointer;font-size:14px;font-weight:700;line-height:1;transition:background-color .2s ease,color .2s ease,transform .2s ease;}
          .hnaya-btn-segment:hover{transform:translateY(-1px)}
          .hnaya-btn-segment.active[data-scope="algerie"]{background:var(--hnaya-green);color:#fff;}
          .hnaya-btn-segment.active[data-scope="monde"]{background:var(--hnaya-red);color:#fff;}
          .hnaya-btn-lang.active{background:var(--hnaya-green);color:#fff;}
          .hnaya-engine-panel{display:none}
          .hnaya-engine-panel.active{display:block}
          .hnaya-google-panel,.hnaya-world-panel{border:1px solid var(--hnaya-line);border-radius:16px;background:#fff;overflow:hidden;}
          .hnaya-google-native,.hnaya-world-content{padding:12px;}
          .hnaya-algerie-searchbar,.hnaya-world-form{display:flex;gap:8px;align-items:stretch;margin-bottom:10px;}
          .hnaya-algerie-input,.hnaya-world-input{flex:1;min-width:0;height:48px;border:1px solid var(--hnaya-line);border-radius:12px;padding:0 12px;font-size:15px;background:#f8fafc;color:var(--hnaya-text);box-sizing:border-box;outline:none;}
          .hnaya-algerie-input:focus{border-color:var(--hnaya-green);box-shadow:0 0 0 3px rgba(0,99,65,.10);}
          .hnaya-world-input:focus{border-color:var(--hnaya-red);box-shadow:0 0 0 3px rgba(214,29,44,.10);}
          .hnaya-algerie-submit,.hnaya-world-submit,.hnaya-shop-link{height:48px;border:0;border-radius:12px;color:#fff;font-weight:700;font-size:14px;cursor:pointer;padding:0 16px;transition:background-color .2s ease,transform .2s ease;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;}
          .hnaya-algerie-submit{background:var(--hnaya-green);min-width:140px;}
          .hnaya-algerie-submit:hover{background:var(--hnaya-green-dark);transform:translateY(-1px);}
          .hnaya-world-submit{background:var(--hnaya-red);min-width:160px;}
          .hnaya-world-submit:hover{background:var(--hnaya-red-dark);transform:translateY(-1px);}
          .hnaya-shop-link{background:var(--hnaya-shop);min-width:132px;}
          .hnaya-shop-link:hover{background:var(--hnaya-shop-dark);transform:translateY(-1px);}
          .hnaya-search-widget .gsc-control-cse,.hnaya-search-widget .gsc-control-cse-en{padding:0!important;border:0!important;background:transparent!important;}
          .hnaya-search-widget .gsc-search-box,.hnaya-search-widget .gsc-search-box-tools{display:none!important;}
          .hnaya-search-widget .gsc-result-info{color:#667085!important;font-size:12px!important;padding:0 0 8px 0!important;}
          .hnaya-search-widget .gsc-above-wrapper-area{border-bottom:0!important;padding:0!important;}
          .hnaya-search-widget .gsc-webResult.gsc-result,.hnaya-search-widget .gsc-result{border:1px solid var(--hnaya-line)!important;border-radius:12px!important;background:#fff!important;padding:12px 14px!important;margin:0 0 10px 0!important;}
          .hnaya-search-widget .gs-title,.hnaya-search-widget .gs-title b{font-size:19px!important;line-height:1.35!important;font-weight:750!important;text-decoration:none!important;}
          .hnaya-search-widget .gs-title a,.hnaya-search-widget .gs-title a b{color:var(--hnaya-green)!important;text-decoration:none!important;}
          .hnaya-search-widget .gsc-adBlock{display:none!important}
        `}</style>

        <div className="hnaya-search-widget" id="hnaya-widget" dir={isRTL ? "rtl" : "ltr"} lang={language}>
          <div className="hnaya-card">
            <div className="hnaya-body">
              <div className="hnaya-topbar">
                <div className="hnaya-left">
                  <div className="hnaya-title" id="hnaya-title">بحث</div>
                  <div className="hnaya-segment" role="tablist">
                    <button type="button" className="hnaya-btn-segment active hnaya-scope-btn" data-scope="algerie" aria-selected="true">
                      <span className="i18n" data-key="algerie">الجزائر</span>
                    </button>
                    <button type="button" className="hnaya-btn-segment hnaya-scope-btn" data-scope="monde" aria-selected="false">
                      <span className="i18n" data-key="monde">العالم</span>
                    </button>
                  </div>
                </div>
                <div className="hnaya-segment" role="tablist">
                  <button type="button" className="hnaya-btn-segment hnaya-btn-lang" data-lang="fr">Français</button>
                  <button type="button" className="hnaya-btn-segment hnaya-btn-lang active" data-lang="ar">عربي</button>
                </div>
              </div>
              <div className="hnaya-engine-area">
                <div id="hnaya-google-panel" className="hnaya-engine-panel active">
                  <div className="hnaya-google-panel">
                    <div className="hnaya-google-native">
                      <div className="hnaya-algerie-searchbar">
                        <input type="text" id="hnaya-algerie-query" className="hnaya-algerie-input" autoComplete="off" />
                        <button type="button" id="hnaya-algerie-submit" className="hnaya-algerie-submit"></button>
                        <a
                          href="https://hnaya.dz/boutique/"
                          id="hnaya-shop-link"
                          className="hnaya-shop-link"
                          onClick={(e) => { e.preventDefault(); addTab("https://hnaya.dz/boutique/"); }}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                            <path fill="currentColor" d="M7 4V2h10v2h4v2l-1.5 14H4.5L3 6V4h4zm2 0h6V3H9v1z"/>
                          </svg>
                          <span id="hnaya-shop-label"></span>
                        </a>
                      </div>
                      <div className="gcse-searchresults-only"></div>
                    </div>
                  </div>
                </div>
                <div id="hnaya-startpage-panel" className="hnaya-engine-panel">
                  <div className="hnaya-world-panel">
                    <div className="hnaya-world-content">
                      <div className="hnaya-world-form">
                        <input type="text" id="hnaya-world-query" className="hnaya-world-input" autoComplete="off" />
                        <button type="button" id="hnaya-world-submit" className="hnaya-world-submit"
                          onClick={() => {
                            const q = (document.getElementById("hnaya-world-query") as HTMLInputElement)?.value.trim();
                            if (q) addTab(`https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`);
                          }}
                        ></button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Discover button */}
      <button
        onClick={handleDiscover}
        className="mt-8 px-10 py-4 rounded-2xl text-white font-bold text-lg shadow-lg hover:scale-105 hover:shadow-xl transition-all duration-200"
        style={{ backgroundColor: "#006341" }}
      >
        🇩🇿 {DISCOVER_LABEL[language as keyof typeof DISCOVER_LABEL] ?? DISCOVER_LABEL.fr}
      </button>

      {/* Widget JS */}
      <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var addTab = null;
  window.__hnayaAddTab = function(fn){ addTab = fn; };

  var translations = {
    ar:{title:'بحث',algerie:'الجزائر',monde:'العالم',shop:'منتجات',worldPlaceholder:'ابحث في العالم...',worldButton:'بحث عالمي',algeriePlaceholder:'ابحث في الجزائر...',algerieButton:'بحث'},
    fr:{title:'Recherche',algerie:'Algérie',monde:'Monde',shop:'Produits',worldPlaceholder:'Rechercher dans le monde...',worldButton:'Recherche monde',algeriePlaceholder:'Rechercher en Algérie...',algerieButton:'Rechercher'}
  };
  var state = { scope:'algerie', lang:'ar' };
  function el(id){ return document.getElementById(id); }
  function t(){ return translations[state.lang] || translations.ar; }
  function updateUI(){
    var tr = t();
    var w = el('hnaya-widget');
    if(w){ w.setAttribute('dir', state.lang==='ar'?'rtl':'ltr'); w.setAttribute('lang', state.lang); }
    if(el('hnaya-title')) el('hnaya-title').textContent = tr.title;
    if(el('hnaya-world-query')) el('hnaya-world-query').placeholder = tr.worldPlaceholder;
    if(el('hnaya-world-submit')) el('hnaya-world-submit').textContent = tr.worldButton;
    if(el('hnaya-algerie-submit')) el('hnaya-algerie-submit').textContent = tr.algerieButton;
    if(el('hnaya-algerie-query')) el('hnaya-algerie-query').placeholder = tr.algeriePlaceholder;
    if(el('hnaya-shop-label')) el('hnaya-shop-label').textContent = tr.shop;
    document.querySelectorAll('.i18n').forEach(function(n){ var k=n.dataset.key; if(tr[k]) n.textContent=tr[k]; });
  }
  function setScope(scope){
    state.scope=scope;
    document.querySelectorAll('.hnaya-scope-btn').forEach(function(b){ var a=b.dataset.scope===scope; b.classList.toggle('active',a); b.setAttribute('aria-selected',a?'true':'false'); });
    var gp=el('hnaya-google-panel'), wp=el('hnaya-startpage-panel');
    if(gp) gp.classList.toggle('active',scope==='algerie');
    if(wp) wp.classList.toggle('active',scope==='monde');
    updateUI();
  }
  function setLang(lang){
    state.lang=lang;
    document.querySelectorAll('.hnaya-btn-lang').forEach(function(b){ b.classList.toggle('active',b.dataset.lang===lang); });
    updateUI();
  }
  function performAlgerieSearch(){
    var q = el('hnaya-algerie-query') ? el('hnaya-algerie-query').value.trim() : '';
    if(!q){ if(el('hnaya-algerie-query')) el('hnaya-algerie-query').focus(); return; }
    var done = function(){
      if(window.google&&google.search&&google.search.cse&&google.search.cse.element){
        var e=google.search.cse.element.getElement('searchresults-only0');
        if(e){ e.execute(q); return true; }
      }
      var fi=document.querySelector('input.gsc-input'), fb=document.querySelector('.gsc-search-button,.gsc-search-button-v2');
      if(fi&&fb){ fi.value=q; fb.click(); return true; }
      return false;
    };
    if(!done()) setTimeout(done, 700);
  }
  function init(){
    document.querySelectorAll('.hnaya-scope-btn').forEach(function(b){ b.addEventListener('click',function(){ setScope(this.dataset.scope); }); });
    document.querySelectorAll('.hnaya-btn-lang').forEach(function(b){ b.addEventListener('click',function(){ setLang(this.dataset.lang); }); });
    var as=el('hnaya-algerie-submit'); if(as) as.addEventListener('click', performAlgerieSearch);
    var aq=el('hnaya-algerie-query'); if(aq) aq.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); performAlgerieSearch(); } });
    updateUI();
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
      ` }} />
    </section>
  );
}
