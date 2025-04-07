// Update TabBar.tsx
"use client";
import { X, Plus } from "lucide-react";
import { Button } from "@heroui/button";
import { useTabContext } from "@/context/tabcontext";
import Image from "next/image";
import { useLoading } from "@/context/loadingcontext";
import { useEffect, useRef } from "react";


export default function TabBar() {
    const { tabs, activeTab, switchTab, closeTab, addTab } = useTabContext();
    const { setIsLoading } = useLoading();
    const isListenerSet = useRef(false); // ✅ Only register once

    useEffect(() => {
        if (isListenerSet.current) return; // Prevent double registration
        isListenerSet.current = true;

        const handleNewTabUrl = (url: string) => {
            console.log('Received new tab URL:', url);
            addTab(url);
        };

        window.electronAPI?.receive("new-tab-url", handleNewTabUrl);

        return () => {
            window.electronAPI?.removeListener("new-tab-url", handleNewTabUrl);
        };
    }, []);

    return (
        <div className="fixed z-50 h-[6vh] flex items-center gap-2 p-2 bg-gray-200 dark:bg-gray-900 w-screen overflow-auto">
            {tabs.map((tab) => (
                <div
                    key={tab.id}
                    role="button"
                    tabIndex={0}
                    className={`flex items-center gap-2 px-4 py-1 rounded-md cursor-pointer shadow-lg ${activeTab === tab.id
                        ? "bg-white dark:bg-black border-blue-500"
                        : "border-transparent hover:border-gray-500"
                        }
                        ${tab.isHome ? "font-bold" : "border"}
                        `}
                    onClick={() => {
                        switchTab(tab.id)
                        if (tab.isHome) {
                            setIsLoading(false);
                        } else setIsLoading(true);

                    }}
                >
                    {tab.faviconUrl && (
                        <img
                            src={tab.faviconUrl}
                            alt="favicon"
                            className="w-4 h-4"
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                            }}
                        />
                    )}
                    <span className="max-w-[150px] truncate">{tab.title}</span>
                    {!tab.isHome && (
                        <X
                            size={20}
                            className="cursor-pointer text-gray-500 hover:text-red-500"
                            onClick={(e) => {
                                e.stopPropagation();
                                closeTab(tab.id);
                            }}
                            strokeWidth={4}
                        />
                    )}
                </div>
            ))
            }
            {/* <Button size="sm" onPress={() => addTab("https://www.google.com")}>
                <Plus size={16} />
            </Button> */}
        </div >
    );
}