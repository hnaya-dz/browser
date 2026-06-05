"use client";
import { X, Plus, Home } from "lucide-react";
import { useTabContext } from "@/context/tabcontext";
import { useLoading } from "@/context/loadingcontext";
import { useEffect, useRef, useState } from "react";

export default function TabBar() {
  const { tabs, activeTab, switchTab, closeTab, addTab } = useTabContext();
  const { setIsLoading } = useLoading();
  const isListenerSet = useRef(false);
  const [faviconErrors, setFaviconErrors] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (isListenerSet.current) return;
    isListenerSet.current = true;

    const handleNewTabUrl = (url: string) => {
      addTab(url);
    };

    window.electronAPI?.receive("new-tab-url", handleNewTabUrl);
    return () => {
      window.electronAPI?.removeListener("new-tab-url", handleNewTabUrl);
    };
  }, []);

  const handleFaviconError = (tabId: number) => {
    setFaviconErrors((prev) => ({ ...prev, [tabId]: true }));
  };

  return (
    <div className="fixed z-50 h-[6vh] flex items-center gap-1 px-2 bg-gray-100 dark:bg-gray-950 w-screen overflow-x-auto overflow-y-hidden border-b border-gray-300 dark:border-gray-800 hide-scrollbar">

      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const showFavicon = tab.faviconUrl && !faviconErrors[tab.id];

        return (
          <div
            key={tab.id}
            role="button"
            tabIndex={0}
            title={tab.title}
            className={`
              flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-t-lg cursor-pointer
              max-w-[180px] min-w-[80px] h-[5vh] flex-shrink-0
              transition-colors duration-150 select-none group
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
            {/* Icon: favicon or home icon */}
            <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
              {tab.isHome ? (
                <Home size={13} className="text-green-700 dark:text-green-500" />
              ) : showFavicon ? (
                <img
                  src={tab.faviconUrl}
                  alt=""
                  className="w-4 h-4 object-contain"
                  onError={() => handleFaviconError(tab.id)}
                />
              ) : (
                <span className="w-3 h-3 rounded-full bg-gray-300 dark:bg-gray-600 inline-block" />
              )}
            </span>

            {/* Title */}
            <span className={`text-xs truncate flex-1 ${isActive ? "text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400"}`}>
              {tab.title || "…"}
            </span>

            {/* Close button */}
            {!tab.isHome && (
              <button
                className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-gray-300 dark:hover:bg-gray-600 transition-all ml-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label="Fermer l'onglet"
              >
                <X size={10} strokeWidth={3} className="text-gray-600 dark:text-gray-300" />
              </button>
            )}
          </div>
        );
      })}

      {/* New tab button */}
      <button
        onClick={() => addTab("https://hnaya.dz")}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-800 transition-all ml-1"
        aria-label="Nouvel onglet"
      >
        <Plus size={15} strokeWidth={2.5} />
      </button>
    </div>
  );
}
