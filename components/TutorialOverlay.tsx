"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "@/context/langcontext";
import {
  useTutorialSnapshot,
  nextTutorialStep,
  prevTutorialStep,
  closeTutorial,
} from "@/context/tutorialStore";

type Lang = "ar" | "fr" | "en";

// ── Étapes ────────────────────────────────────────────────────────
// targetSelector null = carte centrée sans projecteur (accueil / fin).
// Les étapes dont la cible est absente du DOM sont retirées au
// démarrage : la barre d'adresse (téléchargement, coffre-fort…)
// n'existe que lorsqu'un site est ouvert.
const ALL_STEPS = [
  { id: "language", target: null },
  { id: "welcome", target: null },
  { id: "urlbar", target: "[data-tutorial='urlbar']" },
  { id: "navigation", target: "[data-tutorial='nav-buttons']" },
  { id: "search", target: "[data-tutorial='search-scope']" },
  { id: "shop", target: "[data-tutorial='shop-btn']" },
  { id: "tabs", target: "[data-tutorial='tabbar']" },
  // Légende dessinée à l'intérieur de la carte : ces boutons n'existent
  // qu'une fois un site ouvert, un projecteur ne pourrait donc pas les
  // désigner depuis l'accueil. Remplace l'ancienne étape « download »,
  // que cette légende explique plus complètement.
  { id: "toolbar", target: null },
  { id: "vault", target: "[data-tutorial='vault-btn']" },
  { id: "chat-intro", target: "[data-tutorial='chat-btn']" },
  { id: "chat-features", target: "[data-tutorial='chat-btn']" },
  { id: "privacy", target: "[data-tutorial='privacy-btn']" },
  { id: "theme", target: "[data-tutorial='theme-btn']" },
  { id: "outro", target: null },
] as const;

const CONTENT: Record<Lang, Record<string, { title: string; body: string }>> = {
  fr: {
    welcome: {
      title: "Bienvenue dans Hnaya",
      body: "Votre navigateur, votre réseau, vos données. Ce guide vous présente les fonctions principales en quelques écrans. Vous pourrez le relancer à tout moment avec l'icône Livre.",
    },
    urlbar: {
      title: "Barre d'adresse",
      body: "Saisissez une adresse de site ou des mots à rechercher, puis appuyez sur Entrée.",
    },
    navigation: {
      title: "Naviguer entre les pages",
      body: "Revenir à la page précédente, avancer, et actualiser la page affichée.",
    },
    search: {
      title: "Recherche Algérie ou Monde",
      body: "« Algérie » privilégie les sites algériens, « Monde » interroge le web entier. Choisissez selon ce que vous cherchez.",
    },
    shop: {
      title: "Achat",
      body: "Ce bouton lance votre recherche sur Hnaya Market et affiche directement les résultats d'une sélection de sites e-commerce algériens connus et fiables.",
    },
    tabs: {
      title: "Vos onglets",
      body: "Chaque site ouvert occupe un onglet. Cliquez dessus pour l'afficher, faites-le glisser pour le déplacer, la croix le ferme.",
    },
    toolbar: {
      title: "Favoris et téléchargement",
      body: "Ces trois boutons se trouvent à droite de la barre d'adresse. Ils apparaissent dès qu'un site est ouvert.",
    },
    vault: {
      title: "Vos mots de passe",
      body: "Enregistrez vos identifiants de sites, chiffrés sur ce poste. Un point vert signale qu'un identifiant existe pour la page ouverte.",
    },
    "chat-intro": {
      title: "Messagerie locale",
      body: "Échangez avec vos collègues sur le réseau interne, sans passer par Internet ni par un service extérieur : les messages ne quittent jamais vos locaux.",
    },
    "chat-features": {
      title: "Messagerie : créer ou rejoindre",
      body: "Créez un salon et communiquez son code d'accès, ou rejoignez celui d'un collègue. L'historique est conservé, chaque message est signé, et un espace administrateur permet de gérer les appareils autorisés.",
    },
    privacy: {
      title: "Confidentialité",
      body: "Le détail des protections actives et leurs interrupteurs se trouvent dans ce panneau.",
    },
    theme: {
      title: "Langue et apparence",
      body: "Basculez entre arabe, français et anglais, et changez de thème. Vos choix sont conservés.",
    },
    outro: {
      title: "Vous êtes prêt",
      body: "D'autres boutons apparaîtront dans la barre d'adresse une fois un site ouvert : téléchargement de vidéo, favoris, mots de passe. Relancez ce guide quand vous voulez avec l'icône Livre.",
    },
  },
  en: {
    welcome: {
      title: "Welcome to Hnaya",
      body: "Your browser, your network, your data. This guide walks through the main features in a few screens. You can replay it anytime from the Book icon.",
    },
    urlbar: {
      title: "Address bar",
      body: "Type a website address or words to search for, then press Enter.",
    },
    navigation: {
      title: "Moving between pages",
      body: "Go back to the previous page, forward again, and reload the current page.",
    },
    search: {
      title: "Algeria or World search",
      body: "“Algeria” favours Algerian websites, “World” searches the whole web. Pick whichever fits what you are looking for.",
    },
    shop: {
      title: "Buy",
      body: "This button runs your search on Hnaya Market and shows results straight from a curated selection of known, trustworthy Algerian e-commerce sites.",
    },
    tabs: {
      title: "Your tabs",
      body: "Each open site gets a tab. Click one to show it, drag to reorder, and use the cross to close it.",
    },
    toolbar: {
      title: "Favorites and downloads",
      body: "These three buttons sit on the right of the address bar. They appear as soon as a site is open.",
    },
    vault: {
      title: "Your passwords",
      body: "Store website logins, encrypted on this machine. A green dot means a login exists for the page you are on.",
    },
    "chat-intro": {
      title: "Local Messaging",
      body: "Talk to colleagues over your internal network, with no Internet and no outside service involved: messages never leave your premises.",
    },
    "chat-features": {
      title: "Messaging: create or join",
      body: "Create a room and share its access code, or join a colleague's. History is kept, every message is signed, and an admin area manages which devices are allowed.",
    },
    privacy: {
      title: "Privacy",
      body: "The full list of active protections and their switches live in this panel.",
    },
    theme: {
      title: "Language and appearance",
      body: "Switch between Arabic, French and English, and change the theme. Your choices are remembered.",
    },
    outro: {
      title: "You are all set",
      body: "More buttons appear in the address bar once a site is open: video download, bookmarks, passwords. Replay this guide anytime from the Book icon.",
    },
  },
  ar: {
    welcome: {
      title: "أهلاً بك في حنايا",
      body: "متصفحك، شبكتك، بياناتك. يعرّفك هذا الدليل بالوظائف الأساسية في بضع شاشات. يمكنك إعادة تشغيله في أي وقت من أيقونة الكتاب.",
    },
    urlbar: {
      title: "شريط العنوان",
      body: "اكتب عنوان موقع أو كلمات للبحث، ثم اضغط Enter.",
    },
    navigation: {
      title: "التنقّل بين الصفحات",
      body: "العودة إلى الصفحة السابقة، التقدّم، وتحديث الصفحة المعروضة.",
    },
    search: {
      title: "البحث في الجزائر أو العالم",
      body: "«الجزائر» يرجّح المواقع الجزائرية، و«العالم» يبحث في الويب كلّه. اختر حسب ما تبحث عنه.",
    },
    shop: {
      title: "الشراء",
      body: "يشغّل هذا الزر بحثك على حنايا ماركت ويعرض النتائج مباشرة من مجموعة مختارة من مواقع البيع الجزائرية المعروفة والموثوقة.",
    },
    tabs: {
      title: "ألسنتك",
      body: "كل موقع مفتوح له لسان. انقر عليه لعرضه، اسحبه لتغيير ترتيبه، والعلامة × تغلقه.",
    },
    toolbar: {
      title: "المفضلة والتحميل",
      body: "توجد هذه الأزرار الثلاثة على يمين شريط العنوان، وتظهر بمجرد فتح موقع.",
    },
    vault: {
      title: "كلمات المرور",
      body: "احفظ بيانات دخولك إلى المواقع، مشفّرة على هذا الجهاز. النقطة الخضراء تعني وجود بيانات محفوظة للصفحة الحالية.",
    },
    "chat-intro": {
      title: "المراسلة المحلية",
      body: "تواصل مع زملائك عبر الشبكة الداخلية، دون إنترنت ودون أي خدمة خارجية: الرسائل لا تغادر مقرّكم أبداً.",
    },
    "chat-features": {
      title: "المراسلة: إنشاء أو انضمام",
      body: "أنشئ غرفة وشارك رمز الدخول، أو انضم إلى غرفة زميل. السجلّ محفوظ، وكل رسالة موقّعة، ومساحة المسؤول تتيح إدارة الأجهزة المسموح لها.",
    },
    privacy: {
      title: "الخصوصية",
      body: "تفاصيل الحماية المفعّلة ومفاتيحها موجودة في هذه اللوحة.",
    },
    theme: {
      title: "اللغة والمظهر",
      body: "بدّل بين العربية والفرنسية والإنجليزية، وغيّر المظهر. اختياراتك محفوظة.",
    },
    outro: {
      title: "أنت جاهز",
      body: "ستظهر أزرار أخرى في شريط العنوان بمجرد فتح موقع: تحميل الفيديو، المفضّلة، كلمات المرور. أعد تشغيل هذا الدليل متى شئت من أيقونة الكتاب.",
    },
  },
};

// Légende de l'étape « toolbar » : chaque ligne reproduit l'icône telle
// qu'elle apparaît réellement dans la barre d'adresse, pour que le lecteur
// la reconnaisse même si le bouton n'est pas affiché au moment du guide.
const LEGEND: Record<Lang, { icon: string; label: string; desc: string }[]> = {
  fr: [
    {
      icon: "☆",
      label: "Ajouter aux favoris",
      desc: "Enregistre la page ouverte. L'étoile devient dorée ; cliquez à nouveau pour la retirer.",
    },
    {
      icon: "📑",
      label: "Liste des favoris",
      desc: "Vos favoris classés par dossier, et vos groupes d'onglets : enregistrez toutes les pages ouvertes d'un coup pour les rouvrir plus tard. « Sauvegarder mes favoris » les exporte dans un fichier, « Importer des favoris » les restaure sur un autre poste.",
    },
    {
      icon: "⬇️",
      label: "Télécharger la vidéo",
      desc: "N'apparaît que sur les sites de vidéo (plus de 30 plateformes). Deux qualités : Rapide (MP4 720p, lisible partout) ou Haute qualité. Vous choisissez le dossier, après acceptation de l'avertissement légal.",
    },
  ],
  en: [
    {
      icon: "☆",
      label: "Add to favorites",
      desc: "Saves the open page. The star turns gold; click again to remove it.",
    },
    {
      icon: "📑",
      label: "Favorites list",
      desc: "Your favorites sorted into folders, plus tab groups: save every open page at once and reopen them later. “Back up my favorites” exports them to a file, “Import favorites” restores them on another machine.",
    },
    {
      icon: "⬇️",
      label: "Download the video",
      desc: "Only appears on video sites (over 30 platforms). Two qualities: Fast (MP4 720p, plays anywhere) or High quality. You pick the folder, once you have accepted the legal notice.",
    },
  ],
  ar: [
    {
      icon: "☆",
      label: "إضافة إلى المفضلة",
      desc: "يحفظ الصفحة المفتوحة. تصبح النجمة ذهبية؛ انقر مرة أخرى لإزالتها.",
    },
    {
      icon: "📑",
      label: "قائمة المفضلة",
      desc: "مفضّلاتك مرتّبة في مجلدات، ومجموعات الألسنة: احفظ كل الصفحات المفتوحة دفعة واحدة لإعادة فتحها لاحقاً. «نسخ احتياطي للمفضلة» يصدّرها في ملف، و«استيراد المفضلة» يستعيدها على جهاز آخر.",
    },
    {
      icon: "⬇️",
      label: "تحميل الفيديو",
      desc: "يظهر فقط في مواقع الفيديو (أكثر من 30 منصة). جودتان: «سريع» (MP4 بدقة 720p، يُقرأ في كل مكان) أو «جودة عالية». تختار المجلد، بعد الموافقة على التنبيه القانوني.",
    },
  ],
};

const UI: Record<Lang, { next: string; prev: string; skip: string; finish: string; close: string }> = {
  fr: { next: "Suivant", prev: "Précédent", skip: "Passer le guide", finish: "Terminer", close: "Fermer le guide" },
  en: { next: "Next", prev: "Back", skip: "Skip guide", finish: "Finish", close: "Close guide" },
  ar: { next: "التالي", prev: "السابق", skip: "تخطّي الدليل", finish: "إنهاء", close: "إغلاق الدليل" },
};

const POPOVER_MAX_W = 380;
const MARGIN = 16; // marge minimale avec les bords de l'écran
const ARROW_GAP = 26; // espace réservé à la flèche entre carte et cible
const HOLE_PAD = 6;

interface Placement {
  left: number;
  top: number;
  arrow: "up" | "down" | null;
  arrowX: number; // position de la flèche, relative à la carte
}

export const TutorialOverlay = () => {
  const tutorial = useTutorialSnapshot();
  const { language, isRTL, toggleLanguage } = useLanguage();
  const lang = (language as Lang) || "fr";
  const ui = UI[lang];

  const popRef = useRef<HTMLDivElement | null>(null);
  const popObserver = useRef<ResizeObserver | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [popH, setPopH] = useState(0);
  const [viewport, setViewport] = useState({ w: 1280, h: 720 });
  // Étapes retenues, figées à l'ouverture (cf. commentaire sur ALL_STEPS)
  const [stepIds, setStepIds] = useState<string[]>([]);

  // ── Sélection des étapes pertinentes à l'ouverture ──────────────
  useEffect(() => {
    if (!tutorial.isActive) return;
    const ids = ALL_STEPS.filter((s) => {
      if (s.id === "language") return tutorial.fromLaunch;
      if (!s.target) return true;
      return document.querySelector(s.target) !== null;
    }).map((s) => s.id);
    setStepIds(ids);
  }, [tutorial.isActive, tutorial.fromLaunch]);

  const steps = useMemo(
    () => stepIds.map((id) => ALL_STEPS.find((s) => s.id === id)!).filter(Boolean),
    [stepIds],
  );

  const index = Math.min(tutorial.currentStep, Math.max(0, steps.length - 1));
  const step = steps[index];
  const isLanguageStep = step?.id === "language";
  const isLegendStep = step?.id === "toolbar";
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  // ── Mesure de la cible ──────────────────────────────────────────
  const measure = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    if (!step?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    measure();
  }, [measure, tutorial.currentStep, tutorial.isActive]);

  useEffect(() => {
    if (!tutorial.isActive) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, tutorial.isActive]);

  // Hauteur réelle de la carte : indispensable pour décider de la placer
  // au-dessus ou en dessous sans jamais sortir de l'écran.
  // ⚠️ Mesure par ref-callback et NON par effet : la carte n'apparaît
  // qu'au rendu suivant l'activation (les étapes sont sélectionnées dans
  // un effet), or un effet dont les dépendances n'ont pas changé entre
  // ces deux rendus ne se rejoue pas — la hauteur restait à 0 et la carte
  // se plaçait de travers. La ref-callback, elle, se déclenche exactement
  // au montage du nœud.
  const attachPopover = useCallback((node: HTMLDivElement | null) => {
    popRef.current = node;
    popObserver.current?.disconnect();
    popObserver.current = null;
    if (!node) return;
    setPopH(node.offsetHeight);
    const ro = new ResizeObserver(() => setPopH(node.offsetHeight));
    ro.observe(node);
    popObserver.current = ro;
  }, []);

  useEffect(() => () => popObserver.current?.disconnect(), []);

  // La carte est le même nœud DOM d'une étape à l'autre : la ref-callback
  // ne se redéclenche donc pas et la hauteur mémorisée restait celle de
  // l'étape précédente. On la relit à chaque changement de contenu.
  useLayoutEffect(() => {
    if (popRef.current) setPopH(popRef.current.offsetHeight);
  }, [tutorial.currentStep, tutorial.isActive, stepIds.length, lang]);

  if (!tutorial.isActive || !step) return null;

  // Largeur adaptative : sur une fenêtre étroite, une largeur fixe
  // ferait déborder la carte hors de l'écran.
  const POPOVER_W = Math.min(POPOVER_MAX_W, viewport.w - MARGIN * 2);

  // ── Placement de la carte ───────────────────────────────────────
  const placement: Placement = (() => {
    if (!rect) {
      // Centrage confié au CSS (cf. `centered` plus bas) : le calculer à
      // partir de la hauteur mesurée l'exposait à une mesure périmée, ce
      // qui faisait déborder la carte de l'écran sur les étapes hautes.
      return {
        left: Math.round((viewport.w - POPOVER_W) / 2),
        top: 0,
        arrow: null,
        arrowX: 0,
      };
    }
    const centerX = rect.left + rect.width / 2;
    const left = Math.round(
      Math.min(Math.max(centerX - POPOVER_W / 2, MARGIN), viewport.w - POPOVER_W - MARGIN),
    );

    const below = rect.bottom + ARROW_GAP;
    const above = rect.top - ARROW_GAP - popH;
    const fitsBelow = below + popH <= viewport.h - MARGIN;
    const fitsAbove = above >= MARGIN;

    let top: number;
    let arrow: "up" | "down";
    if (fitsBelow) {
      top = Math.round(below);
      arrow = "up"; // la flèche pointe vers le haut, vers la cible
    } else if (fitsAbove) {
      top = Math.round(above);
      arrow = "down";
    } else {
      top = Math.round(Math.min(Math.max(MARGIN, below), viewport.h - popH - MARGIN));
      arrow = "up";
    }

    return {
      left,
      top,
      arrow,
      arrowX: Math.round(Math.min(Math.max(centerX - left, 28), POPOVER_W - 28)),
    };
  })();

  const handleNext = () => (isLast ? closeTutorial() : nextTutorialStep());
  const handlePickLanguage = (l: Lang) => {
    toggleLanguage(l);
    nextTutorialStep();
  };

  const content = CONTENT[lang][step.id];

  return (
    <div
      className="fixed inset-0 z-[60]"
      style={{ pointerEvents: "none" }}
      role="dialog"
      aria-modal="true"
    >
      <style>{`
        .tuto-card{position:absolute;pointer-events:auto;
          background:#0d1512;border:1px solid rgba(255,255,255,0.14);border-radius:6px;
          box-shadow:0 18px 48px rgba(0,0,0,0.55);padding:20px}
        .light .tuto-card{background:#ffffff;border-color:rgba(0,99,65,0.2);color:#12211a}
        .tuto-title{font-size:16px;font-weight:650;letter-spacing:-0.01em;color:#fff;margin:0}
        .light .tuto-title{color:#0c1a13}
        .tuto-body{font-size:13.5px;line-height:1.6;color:rgba(255,255,255,0.72);margin:10px 0 0}
        .light .tuto-body{color:rgba(12,26,19,0.75)}
        .tuto-btn{border-radius:4px;font-size:12.5px;font-weight:600;padding:7px 14px;
          transition:background-color .15s ease,color .15s ease,border-color .15s ease;
          border:1px solid transparent;cursor:pointer}
        .tuto-btn-primary{background:#00994d;color:#fff}
        .tuto-btn-primary:hover{background:#00b35a}
        .tuto-btn-ghost{background:transparent;color:rgba(255,255,255,0.55)}
        .tuto-btn-ghost:hover{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.9)}
        .light .tuto-btn-ghost{color:rgba(12,26,19,0.55)}
        .light .tuto-btn-ghost:hover{background:rgba(0,99,65,0.08);color:#0c1a13}
        .tuto-btn-icon{border-radius:4px;padding:7px;background:transparent;
          color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.14);cursor:pointer;
          display:flex;align-items:center;transition:background-color .15s ease}
        .tuto-btn-icon:hover:not(:disabled){background:rgba(255,255,255,0.08);color:#fff}
        .tuto-btn-icon:disabled{opacity:.3;cursor:default}
        .light .tuto-btn-icon{color:rgba(12,26,19,0.6);border-color:rgba(0,99,65,0.2)}
        .tuto-lang{display:flex;flex-direction:column;gap:8px;margin-top:16px}
        .tuto-lang button{display:flex;align-items:center;justify-content:space-between;
          width:100%;padding:11px 14px;border-radius:4px;cursor:pointer;
          background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);
          color:#fff;font-size:14px;font-weight:600;
          transition:background-color .15s ease,border-color .15s ease}
        .tuto-lang button:hover{background:rgba(0,153,77,0.18);border-color:rgba(0,180,100,0.55)}
        .light .tuto-lang button{background:rgba(0,99,65,0.05);border-color:rgba(0,99,65,0.2);color:#0c1a13}
        .tuto-lang .tag{font-size:12px;font-weight:700;opacity:.55;letter-spacing:.06em}
        .tuto-progress{height:2px;border-radius:2px;background:rgba(255,255,255,0.12);overflow:hidden}
        .light .tuto-progress{background:rgba(0,99,65,0.15)}
        .tuto-progress > i{display:block;height:100%;background:#00994d;border-radius:2px;
          transition:width .25s ease}
        .tuto-step-count{font-size:11.5px;color:rgba(255,255,255,0.4);font-variant-numeric:tabular-nums}
        .light .tuto-step-count{color:rgba(12,26,19,0.45)}
        /* Légende : plafonnée en hauteur d'écran pour qu'une fenêtre basse
           ne fasse pas déborder la carte hors du cadre visible. */
        .tuto-legend{display:flex;flex-direction:column;gap:13px;margin-top:15px;
          max-height:44vh;overflow-y:auto}
        .tuto-legend-row{display:flex;align-items:flex-start;gap:11px}
        .tuto-ico{flex-shrink:0;width:30px;height:30px;border-radius:4px;
          display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;
          background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14)}
        .light .tuto-ico{background:rgba(0,99,65,0.05);border-color:rgba(0,99,65,0.2)}
        .tuto-legend b{display:block;font-size:13px;font-weight:650;color:#fff;margin-bottom:3px}
        .light .tuto-legend b{color:#0c1a13}
        .tuto-legend-desc{display:block;font-size:12.5px;line-height:1.55;
          color:rgba(255,255,255,0.68)}
        .light .tuto-legend-desc{color:rgba(12,26,19,0.72)}
      `}</style>

      {/* Voile + trou de projecteur. Un masque SVG évacue complètement la
          zone ciblée : l'élément expliqué reste net et pleinement lisible
          (aucun flou sur l'interface, retour utilisateur). */}
      <svg width={viewport.w} height={viewport.h} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <mask id="tuto-hole">
            <rect width="100%" height="100%" fill="#fff" />
            {rect && (
              <rect
                x={rect.left - HOLE_PAD}
                y={rect.top - HOLE_PAD}
                width={rect.width + HOLE_PAD * 2}
                height={rect.height + HOLE_PAD * 2}
                rx="4"
                fill="#000"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(3,10,7,0.66)" mask="url(#tuto-hole)" />
        {rect && (
          <rect
            x={rect.left - HOLE_PAD}
            y={rect.top - HOLE_PAD}
            width={rect.width + HOLE_PAD * 2}
            height={rect.height + HOLE_PAD * 2}
            rx="4"
            fill="none"
            stroke="#00c853"
            strokeWidth="2"
          />
        )}
      </svg>

      <div
        ref={attachPopover}
        className="tuto-card"
        style={{
          left: placement.left,
          width: POPOVER_W,
          // Sans cible, on centre en CSS et on plafonne la hauteur : la
          // carte reste dans le cadre quelle que soit la longueur du texte.
          // Avec cible, la position calculée sert la flèche (qui déborde
          // volontairement de la carte, d'où l'absence de `overflow`).
          ...(placement.arrow
            ? { top: placement.top }
            : {
                top: "50%",
                transform: "translateY(-50%)",
                maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
                overflowY: "auto" as const,
              }),
        }}
        dir={isRTL ? "rtl" : "ltr"}
      >
        {/* Flèche : repère franc entre la carte et l'élément désigné */}
        {placement.arrow && (
          <svg
            width="34"
            height="20"
            viewBox="0 0 34 20"
            style={{
              position: "absolute",
              left: placement.arrowX - 17,
              [placement.arrow === "up" ? "top" : "bottom"]: -19,
              transform: placement.arrow === "down" ? "rotate(180deg)" : undefined,
            }}
            aria-hidden="true"
          >
            <path d="M17 0 L34 20 L0 20 Z" fill="#00c853" />
          </svg>
        )}

        {isLanguageStep ? (
          <div dir="ltr">
            {/* Écran d'ouverture au premier lancement : les trois langues
                sont proposées ensemble, l'utilisateur n'a pas à subir la
                langue du système s'il ne la maîtrise pas. */}
            <p className="tuto-title" style={{ textAlign: "center" }}>
              أهلاً بك في حنايا
            </p>
            <p className="tuto-title" style={{ textAlign: "center", marginTop: 2 }}>
              Bienvenue dans Hnaya · Welcome to Hnaya
            </p>
            {/* Invitation rédigée en entier dans chaque langue : le lecteur
                doit trouver une phrase complète qu'il comprend, pas trois
                fragments accolés. */}
            <p className="tuto-body" style={{ textAlign: "center", margin: "12px 0 0" }} dir="rtl">
              اختر لغتك للمتابعة
            </p>
            <p className="tuto-body" style={{ textAlign: "center", margin: "2px 0 0" }}>
              Choisissez votre langue pour continuer
            </p>
            <p className="tuto-body" style={{ textAlign: "center", margin: "2px 0 0" }}>
              Choose your language to continue
            </p>
            <div className="tuto-lang">
              <button onClick={() => handlePickLanguage("ar")} dir="rtl">
                <span>العربية</span>
                <span className="tag">ع</span>
              </button>
              <button onClick={() => handlePickLanguage("fr")}>
                <span>Français</span>
                <span className="tag">FR</span>
              </button>
              <button onClick={() => handlePickLanguage("en")}>
                <span>English</span>
                <span className="tag">EN</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <p className="tuto-title" style={{ flex: 1 }}>{content?.title}</p>
              <button className="tuto-btn-icon" onClick={closeTutorial} title={ui.close} aria-label={ui.close}>
                <X size={15} />
              </button>
            </div>
            <p className="tuto-body">{content?.body}</p>

            {isLegendStep && (
              <div className="tuto-legend">
                {LEGEND[lang].map((row) => (
                  <div className="tuto-legend-row" key={row.label}>
                    <span className="tuto-ico" aria-hidden="true">{row.icon}</span>
                    <div>
                      <b>{row.label}</b>
                      <span className="tuto-legend-desc">{row.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <div className="tuto-progress">
                <i style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
                <span className="tuto-step-count">
                  {index + 1} / {steps.length}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {!isLast && (
                    <button className="tuto-btn tuto-btn-ghost" onClick={closeTutorial}>
                      {ui.skip}
                    </button>
                  )}
                  <button
                    className="tuto-btn-icon"
                    onClick={prevTutorialStep}
                    disabled={isFirst}
                    title={ui.prev}
                    aria-label={ui.prev}
                  >
                    {isRTL ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                  </button>
                  <button className="tuto-btn tuto-btn-primary" onClick={handleNext}>
                    {isLast ? ui.finish : ui.next}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
