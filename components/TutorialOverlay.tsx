"use client";
import { useTutorialSnapshot, nextTutorialStep, prevTutorialStep, completeTutorial, skipTutorial } from "@/context/tutorialStore";
import { useLanguage } from "@/context/langcontext";
import { useTranslation } from "@/hooks/useTranslation";
import { ChevronRight, ChevronLeft, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Tutorial steps: each step has a target selector and content
const TUTORIAL_STEPS = [
  {
    id: "welcome",
    targetSelector: null, // No highlight for welcome
    position: "center" as const,
  },
  {
    id: "urlbar",
    targetSelector: "[data-tutorial='urlbar']",
    position: "bottom" as const,
  },
  {
    id: "navigation",
    targetSelector: "[data-tutorial='nav-buttons']",
    position: "bottom" as const,
  },
  {
    id: "search",
    targetSelector: "[data-tutorial='search-scope']",
    position: "bottom" as const,
  },
  {
    id: "tabs",
    targetSelector: "[data-tutorial='tabbar']",
    position: "bottom" as const,
  },
  {
    id: "download",
    targetSelector: "[data-tutorial='download-btn']",
    position: "bottom" as const,
  },
  {
    id: "vault",
    targetSelector: "[data-tutorial='vault-btn']",
    position: "bottom" as const,
  },
  {
    id: "chat-intro",
    targetSelector: "[data-tutorial='chat-btn']",
    position: "bottom" as const,
  },
  {
    id: "chat-features",
    targetSelector: "[data-tutorial='chat-btn']",
    position: "bottom" as const,
  },
  {
    id: "privacy",
    targetSelector: "[data-tutorial='privacy-btn']",
    position: "bottom" as const,
  },
  {
    id: "theme",
    targetSelector: "[data-tutorial='theme-btn']",
    position: "bottom" as const,
  },
  {
    id: "outro",
    targetSelector: null,
    position: "center" as const,
  },
];

interface StepContent {
  title: string;
  description: string;
}

const getStepContent = (stepId: string, language: string): StepContent => {
  const contents: Record<string, Record<string, StepContent>> = {
    fr: {
      welcome: {
        title: "Bienvenue dans Hnaya",
        description: "Votre navigateur, votre réseau, vos données. Ce guide rapide vous montre les fonctionnalités essentielles. Cliquez sur les flèches ou « Passer » pour explorer.",
      },
      urlbar: {
        title: "Barre d'adresse",
        description: "Saisissez une adresse Web ou une recherche ici. Appuyez sur Entrée pour naviguer.",
      },
      navigation: {
        title: "Navigation",
        description: "Retour, avance et actualiser. Comme dans tout navigateur.",
      },
      search: {
        title: "Recherche Algérie & Monde",
        description: "Choisissez votre portée : Algérie pour les contenus locaux, Monde pour le web global.",
      },
      tabs: {
        title: "Gestion des onglets",
        description: "Plusieurs onglets ouverts à la fois. Cliquez sur l'onglet pour le voir, bouton × pour fermer.",
      },
      download: {
        title: "Téléchargement vidéo",
        description: "Téléchargez la vidéo depuis cette page. Supporte 30+ plateformes : YouTube, TikTok, Instagram, etc.",
      },
      vault: {
        title: "Coffre-fort de mots de passe",
        description: "Sauvegardez vos identifiants en toute sécurité (AES-256). Le navigateur les remplira automatiquement.",
      },
      "chat-intro": {
        title: "Messagerie locale — Essentiel",
        description: "Communiquez en sécurité sur votre réseau interne. Pas de cloud, pas d'intermédiaire : les données restent chez vous.",
      },
      "chat-features": {
        title: "Messagerie — Créer ou rejoindre",
        description: "Créez un salon pour vos collègues (ils rejoignent via code PIN). Historique conservé, signature cryptographique pour l'audit. Administrateur pour les paramètres.",
      },
      privacy: {
        title: "Sécurité & confidentialité",
        description: "DNS sécurisé, blocage des traqueurs, nettoyage des URL. Tous les détails ici, avec options pour désactiver si un site plante.",
      },
      theme: {
        title: "Thème & langue",
        description: "Clair ou sombre, français/anglais/arabe. Réglages sauvegardés.",
      },
      outro: {
        title: "C'est parti !",
        description: "Vous maîtrisez les bases. Explorez à votre rythme. Révisez ce guide avec l'icône Livre (en haut) à tout moment.",
      },
    },
    en: {
      welcome: {
        title: "Welcome to Hnaya",
        description: "Your browser, your network, your data. This quick guide shows you the essential features. Click the arrows or \"Skip\" to explore.",
      },
      urlbar: {
        title: "Address bar",
        description: "Type a web address or search here. Press Enter to go.",
      },
      navigation: {
        title: "Navigation",
        description: "Back, forward, and refresh. Like in any browser.",
      },
      search: {
        title: "Search Algeria & World",
        description: "Choose your scope: Algeria for local content, World for the global web.",
      },
      tabs: {
        title: "Tab management",
        description: "Multiple tabs open at once. Click a tab to view it, × button to close it.",
      },
      download: {
        title: "Video download",
        description: "Download video from this page. Supports 30+ platforms: YouTube, TikTok, Instagram, etc.",
      },
      vault: {
        title: "Password vault",
        description: "Save your logins securely (AES-256). The browser fills them automatically.",
      },
      "chat-intro": {
        title: "Local Messaging — Essential",
        description: "Communicate securely on your internal network. No cloud, no intermediary: your data stays with you.",
      },
      "chat-features": {
        title: "Messaging — Create or join",
        description: "Create a room for your team (they join via PIN code). History kept, cryptographic signature for audit. Admin panel for settings.",
      },
      privacy: {
        title: "Security & privacy",
        description: "Secure DNS, tracker blocking, URL cleanup. Full details here, with options to disable if a site breaks.",
      },
      theme: {
        title: "Theme & language",
        description: "Light or dark, French/English/Arabic. Settings saved.",
      },
      outro: {
        title: "You're all set!",
        description: "You've got the basics. Explore at your own pace. Revisit this guide using the Book icon (top) anytime.",
      },
    },
    ar: {
      welcome: {
        title: "أهلاً بك في حنايا",
        description: "متصفحك، شبكتك، بياناتك. هذا الدليل السريع يعرض المزايا الأساسية. انقر الأسهم أو \"تخطّ\" للاستكشاف.",
      },
      urlbar: {
        title: "شريط العنوان",
        description: "اكتب عنوان موقع أو ابحث هنا. اضغط Enter للانتقال.",
      },
      navigation: {
        title: "الملاحة",
        description: "الخلف والأمام والتحديث. كما في أي متصفح.",
      },
      search: {
        title: "البحث عن الجزائر والعالم",
        description: "اختر نطاقك: الجزائر للمحتوى المحلي، العالم للويب العالمي.",
      },
      tabs: {
        title: "إدارة الألسنة",
        description: "عدة ألسنة مفتوحة في نفس الوقت. انقر اللسان لعرضه، الزر × لإغلاقه.",
      },
      download: {
        title: "تحميل الفيديو",
        description: "حمّل الفيديو من هذه الصفحة. يدعم 30+ منصة: YouTube و TikTok و Instagram وغيرها.",
      },
      vault: {
        title: "الخزنة الآمنة",
        description: "احفظ بيانات دخولك بأمان (AES-256). يملأ المتصفح بيانات دخولك تلقائياً.",
      },
      "chat-intro": {
        title: "المراسلة المحلية — أساسي",
        description: "تواصل آمن على شبكتك الداخلية. لا سحابة، لا وسيط: بياناتك معك.",
      },
      "chat-features": {
        title: "المراسلة — إنشاء أو الانضمام",
        description: "أنشئ غرفة لفريقك (يندمجون برمز PIN). محفوظ السجل، توقيع تشفيري للتدقيق. لوحة مسؤول للإعدادات.",
      },
      privacy: {
        title: "الأمان والخصوصية",
        description: "DNS آمن، حجب المتتبعات، تنظيف الروابط. التفاصيل هنا، مع خيارات لتعطيل إن تعطّل موقع.",
      },
      theme: {
        title: "المظهر واللغة",
        description: "فاتح أو غامق، عربي/فرنسي/إنجليزي. الإعدادات محفوظة.",
      },
      outro: {
        title: "استعد تماماً!",
        description: "ستتقن الأساسيات. استكشف بوتيرتك. أعد الاطلاع على هذا الدليل بأيقونة الكتاب (في الأعلى) في أي وقت.",
      },
    },
  };

  return (
    contents[language]?.[stepId] || {
      title: "Tutorial",
      description: "No content available",
    }
  );
};

export const TutorialOverlay = () => {
  const tutorial = useTutorialSnapshot();
  const { language, isRTL } = useLanguage();
  const { t } = useTranslation();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const step = TUTORIAL_STEPS[tutorial.currentStep];
  const stepContent = getStepContent(step.id, language);
  const totalSteps = TUTORIAL_STEPS.length;
  const isFirst = tutorial.currentStep === 0;
  const isLast = tutorial.currentStep === totalSteps - 1;

  // Measure target element
  useEffect(() => {
    if (!step.targetSelector) {
      setTargetRect(null);
      return;
    }
    const target = document.querySelector(step.targetSelector);
    if (target) {
      const rect = target.getBoundingClientRect();
      setTargetRect(rect);
    }
  }, [step.targetSelector, tutorial.currentStep]);

  if (!tutorial.isActive) return null;

  const handleNext = () => {
    if (isLast) {
      completeTutorial();
    } else {
      nextTutorialStep();
    }
  };

  const handlePrev = () => {
    if (!isFirst) {
      prevTutorialStep();
    }
  };

  const handleSkip = () => {
    skipTutorial();
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 pointer-events-none"
      style={{ direction: isRTL ? "rtl" : "ltr" }}
    >
      {/* Dark overlay */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300"
        style={{ pointerEvents: "auto" }}
        onClick={handleSkip}
      />

      {/* Spotlight (if target exists) */}
      {targetRect && (
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          <defs>
            <mask id="tutorial-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={targetRect.left - 8}
                y={targetRect.top - 8}
                width={targetRect.width + 16}
                height={targetRect.height + 16}
                rx="8"
                fill="black"
              />
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.3)"
            mask="url(#tutorial-mask)"
          />
          {/* Highlight border */}
          <rect
            x={targetRect.left - 8}
            y={targetRect.top - 8}
            width={targetRect.width + 16}
            height={targetRect.height + 16}
            rx="8"
            fill="none"
            stroke="rgba(0, 200, 83, 0.5)"
            strokeWidth="2"
            className="animate-pulse"
          />
        </svg>
      )}

      {/* Popover */}
      <div
        className="absolute pointer-events-auto max-w-sm bg-white/10 backdrop-blur-lg border border-white/20 rounded-lg p-6 shadow-2xl transition-all duration-300"
        style={{
          left: step.position === "center" ? "50%" : targetRect ? Math.max(20, Math.min(window.innerWidth - 400, targetRect.left + targetRect.width / 2 - 200)) : "50%",
          top: step.position === "center" ? "50%" : targetRect ? targetRect.bottom + 20 : "50%",
          transform: step.position === "center" ? "translate(-50%, -50%)" : isRTL ? "translateX(50%)" : "translateX(-50%)",
        }}
      >
        <div className="text-white">
          <div className="flex items-start justify-between gap-4 mb-3">
            <h3 className="text-lg font-semibold">{stepContent.title}</h3>
            <button
              onClick={handleSkip}
              className="text-white/50 hover:text-white transition-colors flex-shrink-0"
              aria-label="Close tutorial"
            >
              <X size={20} />
            </button>
          </div>
          <p className="text-white/80 text-sm leading-relaxed mb-6">
            {stepContent.description}
          </p>

          {/* Progress bar */}
          <div className="w-full bg-white/10 rounded-full h-1 mb-4">
            <div
              className="bg-gradient-to-r from-green-400 to-green-500 h-1 rounded-full transition-all duration-300"
              style={{ width: `${((tutorial.currentStep + 1) / totalSteps) * 100}%` }}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-white/50">
              {tutorial.currentStep + 1} / {totalSteps}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSkip}
                className="px-3 py-2 text-xs font-medium text-white/60 hover:text-white/80 transition-colors rounded hover:bg-white/5"
              >
                {isLast ? t("Tutorial.done") || "Terminé" : t("Tutorial.skip") || "Passer"}
              </button>
              <button
                onClick={handlePrev}
                disabled={isFirst}
                className="px-2 py-2 rounded hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-white"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={handleNext}
                className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded font-medium text-sm hover:from-green-600 hover:to-green-700 transition-all duration-200"
              >
                {isLast ? t("Tutorial.finish") || "Terminer" : t("Tutorial.next") || "Suivant"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
