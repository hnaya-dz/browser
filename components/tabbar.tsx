"use client";
import { X, Plus, Home, PanelLeft, PanelTop } from "lucide-react";
import { useTabContext } from "@/context/tabcontext";
import { useLoading } from "@/context/loadingcontext";
import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type TabPosition = "top" | "right";

// ─── Drag & Drop (sans librairie externe) ───────────────────────────────────

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

// ─── Component ──────────────────────────────────────────────────────────────

export default function TabBar() {
    const { tabs, activeTab, switchTab, closeTab, addTab, reorderTabs } = useTabContext();
    const { setIsLoading } = useLoading();
    const isListenerSet = useRef(false);
    const [faviconErrors, setFaviconErrors] = useState<Record<number, boolean>>({});
    const [position, setPosition] = useState<TabPosition>("top");
    const [hoveredTab, setHoveredTab] = useState<number | null>(null);

    // Persist position in localStorage
    useEffect(() => {
        const saved = localStorage.getItem("tabPosition") as TabPosition | null;
        if (saved === "top" || saved === "right") setPosition(saved);
    }, []);

    const togglePosition = () => {
        const next: TabPosition = position === "top" ? "right" : "top";
        setPosition(next);
        localStorage.setItem("tabPosition", next);
    };

    // IPC listener for new tabs from external links
    useEffect(() => {
        if (isListenerSet.current) return;
        isListenerSet.current = true;
        const handleNewTabUrl = (url: string) => addTab(url);
        window.electronAPI?.receive("new-tab-url", handleNewTabUrl);
        return () => { window.electronAPI?.removeListener("new-tab-url", handleNewTabUrl); };
    }, []);

    // ── Keyboard shortcuts ───────────────────────────────────────────────────
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === "t") {
                e.preventDefault();
                addTab("https://hnaya.dz");
            }
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

    // ── Shared tab render ────────────────────────────────────────────────────
    const renderTab = (tab: typeof tabs[0], index: number) => {
        const isActive = activeTab === tab.id;
        const showFavicon = tab.faviconUrl && !faviconErrors[tab.id];
        const isHovered = hoveredTab === tab.id;

        return (
            <div
                key={tab.id}
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
                        ? "bg-white dark:bg-gray-900 shadow-sm border border-b-0 border-gray-300 dark:border-gray-700"
                        : "bg-transparent hover:bg-gray-200 dark:hover:bg-gray-800 border border-transparent"
                    }
                `}
                onClick={() => {
                    switchTab(tab.id);
                    if (tab.isHome) setIsLoading(false);
                    else setIsLoading(true);
                }}
                onKeyDown={(e) => e.key === "Enter" && switchTab(tab.id)}
            >
                {/* Favicon / icône */}
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                    {tab.isHome ? (
                        <Home size={13} className="text-green-700 dark:text-green-500" />
                    ) : showFavicon ? (
                        <img src={tab.faviconUrl} alt="" className="w-4 h-4 object-contain"
                            onError={() => handleFaviconError(tab.id)} />
                    ) : (
                        <span className="w-3 h-3 rounded-full bg-gray-300 dark:bg-gray-600 inline-block" />
                    )}
                </span>

                {/* Titre */}
                <span className={`text-xs truncate flex-1 ${isActive ? "text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400"}`}>
                    {tab.title || "…"}
                </span>

                {/* Bouton fermer */}
                {!tab.isHome && (
                    <button
                        className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-gray-300 dark:hover:bg-gray-600 transition-all"
                        onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                        aria-label="Fermer l'onglet"
                    >
                        <X size={10} strokeWidth={3} className="text-gray-600 dark:text-gray-300" />
                    </button>
                )}

                {/* Tooltip au survol (URL) */}
                {isHovered && tab.url && !tab.isHome && (
                    <div className={`
                        absolute z-[100] px-2 py-1 rounded-md bg-gray-900 text-white text-[10px] whitespace-nowrap shadow-lg pointer-events-none
                        ${position === "top" ? "top-full mt-1 left-0" : "left-full ml-2 top-0"}
                    `}>
                        {tab.url.length > 60 ? tab.url.slice(0, 60) + "…" : tab.url}
                    </div>
                )}
            </div>
        );
    };

    // ── Layout : TOP ─────────────────────────────────────────────────────────
    if (position === "top") {
        return (
            <div className="fixed z-50 top-0 left-0 h-[6vh] w-screen flex items-center gap-1 px-2 bg-gray-100 dark:bg-gray-950 border-b border-gray-300 dark:border-gray-800 overflow-x-auto overflow-y-hidden hide-scrollbar">
                {tabs.map((tab, i) => renderTab(tab, i))}
                <button onClick={() => addTab("https://hnaya.dz")}
                    className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-800 transition-all ml-1"
                    title="Nouvel onglet (Ctrl+T)">
                    <Plus size={15} strokeWidth={2.5} />
                </button>
                {/* Bouton bascule position */}
                <button onClick={togglePosition}
                    className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-800 transition-all ml-auto"
                    title="Déplacer les onglets à droite">
                    <PanelLeft size={15} />
                </button>
            </div>
        );
    }

    // ── Layout : RIGHT ───────────────────────────────────────────────────────
    return (
        <div className="fixed z-50 top-0 right-0 h-screen w-[200px] flex flex-col gap-1 p-2 bg-gray-100 dark:bg-gray-950 border-l border-gray-300 dark:border-gray-800 overflow-y-auto overflow-x-hidden hide-scrollbar">
            {/* Bouton bascule retour en haut */}
            <button onClick={togglePosition}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-800 transition-all mb-1 text-xs"
                title="Déplacer les onglets en haut">
                <PanelTop size={14} />
                <span>Onglets en haut</span>
            </button>

            {tabs.map((tab, i) => renderTab(tab, i))}

            <button onClick={() => addTab("https://hnaya.dz")}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-gray-500 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-800 transition-all mt-1 text-xs"
                title="Nouvel onglet (Ctrl+T)">
                <Plus size={14} strokeWidth={2.5} />
                <span>Nouvel onglet</span>
            </button>
        </div>
    );
}
