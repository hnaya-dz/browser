"use client";
import { createContext, useContext, useState, useEffect } from "react";
import { useLoading } from "@/context/loadingcontext";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "./langcontext";

interface Tab {
    id: number;
    title: string;
    isHome?: boolean;
    url?: string;
    faviconUrl?: string;
}

interface TabContextProps {
    tabs: Tab[];
    activeTab: number;
    addTab: (url: string) => void;
    switchTab: (id: number) => void;
    closeTab: (id: number) => void;
    updateTab: (id: number, updates: Partial<Tab>) => void;
    reorderTabs: (fromIndex: number, toIndex: number) => void;
}

const TabContext = createContext<TabContextProps | undefined>(undefined);

export function TabProvider({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation();
    const { language } = useLanguage();
    const [tabs, setTabs] = useState<Tab[]>([{ id: 1, title: t("TabBar.home"), isHome: true }]);
    const [activeTab, setActiveTab] = useState<number>(1);
    const { setIsLoading } = useLoading();

    useEffect(() => {
        const currentTab = tabs.find((tab) => tab.id === activeTab);
        if (currentTab?.url) {
            window.electronAPI?.send("open-tab", { id: activeTab, url: currentTab.url });
        }
    }, [activeTab, tabs]);

    useEffect(() => {
        if (tabs[0].isHome) {
            setTabs(prevTabs => prevTabs.map(tab =>
                tab.isHome ? { ...tab, title: t("TabBar.home") } : tab
            ));
        }
    }, [language]);

    useEffect(() => {
        // ✅ PATCH 5a — updateTitle : ne jamais écraser le titre de l'onglet home
        // Accepte tout vrai titre envoyé par page-title-updated
        const updateTitle = ({ id, title }: { id: number; title: string }) => {
            setTabs(prevTabs => prevTabs.map(tab => {
                if (tab.id !== id) return tab;
                if (tab.isHome) return tab; // l'onglet home garde toujours son titre traduit
                return { ...tab, title: title || tab.url || "New Tab" };
            }));
        };

        const updateFavicon = (event: any, { id, faviconUrl }: { id: number; faviconUrl: string }) => {
            setTabs(prevTabs => prevTabs.map(tab =>
                tab.id === id ? { ...tab, faviconUrl } : tab
            ));
        };

        // ✅ PATCH 5b — updateUrl : toujours mettre le domaine comme titre temporaire
        // L'ancienne condition (title === "New Tab" || title === domain) était trop restrictive
        // et bloquait la mise à jour quand le titre initial était déjà "hnaya.dz"
        const updateUrl = (event: any, tabId: number, newUrl: string) => {
            setTabs(prevTabs => prevTabs.map(tab => {
                if (tab.id !== tabId) return tab;
                if (tab.isHome) return { ...tab, url: newUrl };
                try {
                    // Domaine = titre temporaire en attendant que page-title-updated arrive
                    const domain = new URL(newUrl).hostname.replace('www.', '');
                    return { ...tab, url: newUrl, title: domain };
                } catch {
                    return { ...tab, url: newUrl };
                }
            }));
        };

        window.electronAPI?.receive("update-tab-title", updateTitle);
        window.electronAPI?.receive("update-tab-favicon", updateFavicon);
        window.electronAPI?.receive("update-url", updateUrl);
    }, []);

    const addTab = (url: string) => {
        try {
            if (url) {
                const domain = new URL(url).hostname.replace('www.', '');
                const newTab: Tab = { id: Date.now(), title: domain, url };
                setTabs((prevTabs) => [...prevTabs, newTab]);
                setActiveTab(newTab.id);
                window.electronAPI?.send("open-tab", newTab);
            }
        } catch (e) {
            console.error("Invalid URL:", url);
        }
    };

    const switchTab = (id: number) => {
        setActiveTab(id);
        window.electronAPI?.send("switch-tab", id);
    };

    const closeTab = (id: number) => {
        setTabs((prevTabs) => prevTabs.filter((tab) => tab.id !== id));
        window.electronAPI?.send("close-tab", id);
        if (activeTab === id && tabs.length > 1) {
            setIsLoading(false);
            setActiveTab(tabs[0].id);
        }
    };

    const updateTab = (id: number, updates: Partial<Tab>) => {
        setTabs(prevTabs => prevTabs.map(tab =>
            tab.id === id ? { ...tab, ...updates } : tab
        ));
    };

    // ✅ Réordonne les onglets après drag & drop
    const reorderTabs = (fromIndex: number, toIndex: number) => {
        setTabs(prevTabs => {
            const updated = [...prevTabs];
            const [moved] = updated.splice(fromIndex, 1);
            updated.splice(toIndex, 0, moved);
            return updated;
        });
    };

    return (
        <TabContext.Provider value={{ tabs, activeTab, addTab, switchTab, closeTab, updateTab, reorderTabs }}>
            {children}
        </TabContext.Provider>
    );
}

export function useTabContext() {
    const context = useContext(TabContext);
    if (!context) throw new Error("useTabContext must be used within a TabProvider");
    return context;
}
