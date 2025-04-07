// Update the TabContext.tsx file
"use client";
import { createContext, useContext, useState, useEffect } from "react";
import { useLoading } from "@/context/loadingcontext";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "./langcontext";
import { v4 as uuidv4 } from 'uuid';

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



    // In your TabContext.tsx
    useEffect(() => {
        const updateTitle = (event: any, { id, title }: { id: number; title: string }) => {
            setTabs(prevTabs => prevTabs.map(tab =>
                tab.id === id ? { ...tab, title: title || tab.url || "New Tab" } : tab
            ));
        };

        const updateFavicon = (event: any, { id, faviconUrl }: { id: number; faviconUrl: string }) => {
            setTabs(prevTabs => prevTabs.map(tab =>
                tab.id === id ? { ...tab, faviconUrl } : tab
            ));
        };

        const updateUrl = (event: any, tabId: number, newUrl: string) => {
            setTabs(prevTabs => prevTabs.map(tab => {
                if (tab.id === tabId) {
                    let title = tab.title;
                    try {
                        if (newUrl) {
                            const domain = new URL(newUrl).hostname.replace('www.', '');
                            // Only update title if it's not a home tab and the current title is the same as the previous domain
                            if (!tab.isHome && (tab.title === "New Tab" || tab.title === tab.url?.replace('www.', ''))) {
                                title = domain;
                            }
                        }
                    } catch (e) {
                        console.error("Invalid URL:", newUrl);
                    }
                    return {
                        ...tab,
                        url: newUrl,
                        title: tab.isHome ? tab.title : title
                    };
                }
                return tab;
            }));
        };

        window.electronAPI?.receive("update-tab-title", updateTitle);
        window.electronAPI?.receive("update-tab-favicon", updateFavicon);
        window.electronAPI?.receive("update-url", updateUrl);
    }, []);

    const addTab = (url: string) => {
        try {
            if (url) {
                let title = "New Tab";
                const domain = new URL(url).hostname.replace('www.', '');
                title = domain;
                const newTab: Tab = {
                    id: Date.now(),
                    title,
                    url,
                };
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

    return (
        <TabContext.Provider value={{ tabs, activeTab, addTab, switchTab, closeTab, updateTab }}>
            {children}
        </TabContext.Provider>
    );
}

export function useTabContext() {
    const context = useContext(TabContext);
    if (!context) {
        throw new Error("useTabContext must be used within a TabProvider");
    }
    return context;
}