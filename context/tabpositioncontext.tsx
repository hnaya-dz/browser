"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type TabPosition = "top" | "right";

interface TabPositionContextType {
  position: TabPosition;
  togglePosition: () => void;
}

const TabPositionContext = createContext<TabPositionContextType>({
  position: "top",
  togglePosition: () => {},
});

export function TabPositionProvider({ children }: { children: ReactNode }) {
  const [position, setPosition] = useState<TabPosition>("top");

  useEffect(() => {
    const saved = localStorage.getItem("tabPosition") as TabPosition | null;
    if (saved === "top" || saved === "right") setPosition(saved);
  }, []);

  const togglePosition = () => {
    const next: TabPosition = position === "top" ? "right" : "top";
    setPosition(next);
    localStorage.setItem("tabPosition", next);
  };

  return (
    <TabPositionContext.Provider value={{ position, togglePosition }}>
      {children}
    </TabPositionContext.Provider>
  );
}

export function useTabPosition() {
  return useContext(TabPositionContext);
}
