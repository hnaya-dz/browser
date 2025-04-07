"use client";

import { useEffect, useState } from "react";
import { ThemeSwitch } from "@/components/theme-switch";
import { useRouter } from "next/navigation";
import { useTabContext } from "@/context/tabcontext";
import LangSwitch from "./lang-switch";

export default function URLBar() {
    const [url, setUrl] = useState("");
    const router = useRouter();
    const { activeTab, tabs } = useTabContext();

    useEffect(() => {
        if (typeof window !== "undefined" && window.electronAPI) {
            // Listen for URL updates for the active tab
            window.electronAPI.receive("update-url", (tabId, newUrl) => {
                if (tabId === activeTab) {
                    setUrl(newUrl);
                }
            });
        }
    }, [activeTab, router]);

    useEffect(() => {
        if (typeof window !== "undefined" && window.electronAPI) {
            // Request the current URL when the tab changes
            window.electronAPI.send("get-current-url", activeTab);

            // Listen for the response and update the input field
            window.electronAPI.receive("current-url", (tabId, currentUrl) => {
                if (tabId === activeTab) {
                    setUrl(currentUrl);
                }
            });
        }
    }, [activeTab]);

    const isValidURL = (input: string) => {
        try {
            const parsedURL = new URL(input);
            return parsedURL.protocol === "http:" || parsedURL.protocol === "https:";
        } catch (error) {
            return false;
        }
    };

    const handleEnterKey = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleNavigation();
        }
    };

    const handleNavigation = () => {
        if (isValidURL(url)) {
            // Navigate using Electron
            window?.electronAPI?.send("navigate", url);
            // Update the tab's URL
            const currentTab = tabs.find(tab => tab.id === activeTab);
            if (currentTab) {
                window?.electronAPI?.send("update-tab", {
                    id: activeTab,
                    updates: { url }
                });
            }
        } else {
            // Treat it as a search query and go to the results page
            window?.electronAPI?.send("close-browser-view");
            router.push(`/results?q=${encodeURIComponent(url)}`);
        }
    };

    // Only show URL bar for non-home tabs
    const currentTab = tabs.find(tab => tab.id === activeTab);
    if (!currentTab || currentTab.isHome) return null;

    return (
        <nav className="fixed mt-[6vh] h-[6vh] bg-white dark:bg-black z-50 w-screen flex items-center px-4 gap-4">
            <div
                role="button"
                tabIndex={0}
                onClick={() => window?.electronAPI?.send("go-back")}
            >
                <img
                    className="invert dark:invert-0 hover:cursor-pointer hover:scale-110 w-[2vw] h-[3vh]"
                    src="/icons/arrow.left.svg"
                    alt="Back"
                />
            </div>
            <div
                role="button"
                tabIndex={0}
                onClick={() => window?.electronAPI?.send("go-forward")}
            >
                <img
                    className="invert dark:invert-0 hover:cursor-pointer hover:scale-110 w-[2vw] h-[3vh]"
                    src="/icons/arrow.right.svg"
                    alt="Forward"
                />
            </div>
            <div
                role="button"
                tabIndex={0}
                onClick={() => window?.electronAPI?.send("refresh")}
            >
                <img
                    className="invert dark:invert-0 hover:cursor-pointer hover:scale-110 w-[2vw] h-[3vh]"
                    src="/icons/arrow.clockwise.svg"
                    alt="Reload"
                />
            </div>
            {/* <div
                role="button"
                tabIndex={0}
                onClick={() => { window?.electronAPI?.send("go-home"); router.push("/") }}
            >
                <img
                    className="invert dark:invert-0 hover:cursor-pointer hover:scale-110 w-[2vw] h-[3vh]"
                    src="/icons/house.svg"
                    alt="Home"
                />
            </div> */}
            <input
                className="flex-grow p-2 rounded-lg bg-gray-300 text-black h-[3vh]"
                placeholder="Enter URL or search..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleEnterKey}
            />
            <div
                role="button"
                tabIndex={0}
                onClick={handleNavigation}
            >
                <img
                    className="invert dark:invert-0 hover:cursor-pointer hover:scale-110 w-[2vw] h-[3vh]"
                    src="/icons/magnifyingglass.svg"
                    alt="Search"
                />
            </div>
            <LangSwitch />
            <ThemeSwitch />
        </nav>
    );
}