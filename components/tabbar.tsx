"use client";
import { X, Plus, Home, PanelRight, PanelTop, ChevronLeft, ChevronRight } from "lucide-react";
import { useTabContext } from "@/context/tabcontext";
import { useTabPosition } from "@/context/tabpositioncontext";
import { useLoading } from "@/context/loadingcontext";
import { useTranslation } from "@/hooks/useTranslation";
import { useEffect, useRef, useState, useCallback } from "react";

function useDragSort(onReorder: (from: number, to: number) => void) {
  const dragIndex = useRef<number | null>(null);
  const onDragStart = (index: number) => (e: React.DragEvent) => {
    dragIndex.current = index;
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex.current !== null && dragIndex.current !== index) {
      onReorder(dragIndex.current, index);
    }
    dragIndex.current = null;
  };
  const onDragEnd = () => { dragIndex.current = null; };
  return { onDragStart, onDragOver, onDrop, onDragEnd };
}

// ✅ Hook scroll horizontal avec détection débordement
function useTabScroll() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState);
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", updateScrollState); ro.disconnect(); };
  }, [updateScrollState]);

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -160, behavior: "smooth" });
  };
  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 160, behavior: "smooth" });
  };

  return { scrollRef, canScrollLeft, canScrollRight, scrollLeft, scrollRight };
}

export default function TabBar() {
  const { tabs, activeTab, switchTab, closeTab, addTab, reorderTabs } = useTabContext();
  const { position, togglePosition } = useTabPosition();
  const { setIsLoading } = useLoading();
  const { t } = useTranslation();
  const isListenerSet = useRef(false);
  const [faviconErrors, setFaviconErrors] = useState<Record<number, boolean>>({});
  const [hoveredTab, setHoveredTab] = useState<number | null>(null);
  const { scrollRef, canScrollLeft, canScrollRight, scrollLeft, scrollRight } = useTabScroll();

  // ✅ Scroller automatiquement vers l'onglet actif quand il change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeEl = el.querySelector("[data-active='true']") as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [activeTab]);

  useEffect(() => {
    if (isListenerSet.current) return;
    isListenerSet.current = true;
    const handleNewTabUrl = (url: string) => addTab(url);
    window.electronAPI?.receive("new-tab-url", handleNewTabUrl);
    return () => { window.electronAPI?.removeListener("new-tab-url", handleNewTabUrl); };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "t") { e.preventDefault(); addTab("https://hnaya.dz"); }
      if (e.ctrlKey && e.key === "w") {
        e.preventDefault();
        const current = tabs.find(t => t.id === activeTab);
        if (current && !current.isHome) closeTab(activeTab);
      }
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.id === activeTab);
        const next = tabs[(idx + 1) % tabs.length];
        if (next) switchTab(next.id);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [tabs, activeTab, addTab, closeTab, switchTab]);

  const handleFaviconError = (tabId: number) => {
    setFaviconErrors(prev => ({ ...prev, [tabId]: true }));
  };

  const { onDragStart, onDragOver, onDrop, onDragEnd } = useDragSort(reorderTabs);

  const renderTab = (tab: typeof tabs[0], index: number) => {
    const isActive = activeTab === tab.id;
    const showFavicon = tab.faviconUrl && !faviconErrors[tab.id];
    const isHovered = hoveredTab === tab.id;

    return (
      <div
        key={tab.id}
        data-active={isActive}
        draggable
        onDragStart={onDragStart(index)}
        onDragOver={onDragOver(index)}
        onDrop={onDrop(index)}
        onDragEnd={onDragEnd}
        onMouseEnter={() => setHoveredTab(tab.id)}
        onMouseLeave={() => setHoveredTab(null)}
        role="button"
        tabIndex={0}
        className={`
          relative flex items-center gap-1.5 cursor-pointer select-none group
          transition-colors duration-150
          ${position === "top"
            ? "pl-3 pr-2 py-1 rounded-t-lg max-w-[180px] min-w-[80px] h-[5vh] flex-shrink-0"
            : "px-3 py-2 rounded-lg w-full min-h-[40px] flex-shrink-0"
          }
          ${isActive
            ? "bg-white/10 shadow-sm border border-white/20"
            : "bg-transparent hover:bg-white/8 border border-transparent"
          }
        `}
        onClick={() => {
          switchTab(tab.id);
          if (tab.isHome) setIsLoading(false);
          else setIsLoading(true);
        }}
        onKeyDown={(e) => e.key === "Enter" && switchTab(tab.id)}
      >
        <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
          {tab.isHome ? (
            <Home size={13} className="text-green-400" />
          ) : showFavicon ? (
            <img src={tab.faviconUrl} alt="" className="w-4 h-4 object-contain"
              onError={() => handleFaviconError(tab.id)} />
          ) : (
            <span className="w-3 h-3 rounded-full bg-white/20 inline-block" />
          )}
        </span>
        <span className={`text-xs truncate flex-1 ${isActive ? "text-white font-medium" : "text-white/60"}`}>
          {tab.title || "…"}
        </span>
        {!tab.isHome && (
          <button
            className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-white/20 transition-all"
            onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
            aria-label="Fermer l'onglet"
          >
            <X size={10} strokeWidth={3} className="text-white/70" />
          </button>
        )}
        {isHovered && tab.url && !tab.isHome && (
          <div className={`
            absolute z-[100] px-2 py-1 rounded-md text-white text-[10px] whitespace-nowrap shadow-lg pointer-events-none
            bg-black/80 backdrop-blur-sm border border-white/10
            ${position === "top" ? "top-full mt-1 left-0" : "left-full ml-2 top-0"}
          `}>
            {tab.url.length > 60 ? tab.url.slice(0, 60) + "…" : tab.url}
          </div>
        )}
      </div>
    );
  };

  // ── Style commun des boutons de flèche ────────────────────────────────────
  const arrowBtnClass = "flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-all";

  // ── TOP layout ────────────────────────────────────────────────────────────
  if (position === "top") {
    return (
      <div className="fixed z-50 top-0 left-0 h-[6vh] w-screen flex items-center gap-1 px-2 bg-black/40 backdrop-blur-md border-b border-white/10">

        {/* ✅ Flèche gauche — visible seulement si débordement à gauche */}
        {canScrollLeft && (
          <button onClick={scrollLeft} className={arrowBtnClass} title="Onglets précédents" aria-label="Défiler les onglets vers la gauche">
            <ChevronLeft size={14} strokeWidth={2.5} />
          </button>
        )}

        {/* Zone de scroll — cache la scrollbar native via hide-scrollbar */}
        <div
          ref={scrollRef}
          className="flex items-center gap-1 flex-1 overflow-x-auto overflow-y-hidden hide-scrollbar"
          style={{ scrollbarWidth: "none" }}
        >
          {tabs.map((tab, i) => renderTab(tab, i))}
        </div>

        {/* ✅ Flèche droite — visible seulement si débordement à droite */}
        {canScrollRight && (
          <button onClick={scrollRight} className={arrowBtnClass} title="Onglets suivants" aria-label="Défiler les onglets vers la droite">
            <ChevronRight size={14} strokeWidth={2.5} />
          </button>
        )}

        <button
          onClick={() => addTab("https://hnaya.dz")}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all ml-1"
          title={t("TabBar.newTab")}
        >
          <Plus size={15} strokeWidth={2.5} />
        </button>

        <button
          onClick={togglePosition}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-all"
          title={t("TabBar.tabsSide")}
        >
          <PanelRight size={15} />
        </button>
      </div>
    );
  }

  // ── RIGHT layout — scroll vertical déjà géré par overflow-y-auto ─────────
  return (
    <div className="fixed z-50 top-0 right-0 h-screen w-[200px] flex flex-col gap-1 p-2 bg-black/40 backdrop-blur-md border-l border-white/10 overflow-y-auto overflow-x-hidden hide-scrollbar">
      <button
        onClick={togglePosition}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-all mb-1 text-xs"
        title={t("TabBar.tabsTop")}
      >
        <PanelTop size={14} />
        <span>{t("TabBar.tabsTop")}</span>
      </button>
      {tabs.map((tab, i) => renderTab(tab, i))}
      <button
        onClick={() => addTab("https://hnaya.dz")}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all mt-1 text-xs"
        title={t("TabBar.newTab")}
      >
        <Plus size={14} strokeWidth={2.5} />
        <span>{t("TabBar.newTab")}</span>
      </button>
    </div>
  );
}
