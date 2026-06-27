"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "hnaya-custom-bg";
const OPACITY_KEY = "hnaya-custom-opacity";

interface CustomThemeContextProps {
  customBg: string | null;
  overlayOpacity: number;
  setCustomBg: (dataUrl: string | null) => void;
  setOverlayOpacity: (v: number) => void;
  isCustomActive: boolean;
}

const CustomThemeContext = createContext<CustomThemeContextProps>({
  customBg: null,
  overlayOpacity: 0.45,
  setCustomBg: () => {},
  setOverlayOpacity: () => {},
  isCustomActive: false,
});

export function CustomThemeProvider({ children }: { children: React.ReactNode }) {
  const [customBg, setCustomBgState] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacityState] = useState(0.45);

  // Charger depuis localStorage au montage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setCustomBgState(saved);
      const op = localStorage.getItem(OPACITY_KEY);
      if (op) setOverlayOpacityState(parseFloat(op));
    } catch {}
  }, []);

  const setCustomBg = useCallback((dataUrl: string | null) => {
    setCustomBgState(dataUrl);
    // Appliquer immédiatement la variable CSS (sans attendre le useEffect)
    const html = document.documentElement;
    if (dataUrl) {
      html.style.setProperty("--custom-bg", `url("${dataUrl}")`);
    } else {
      html.style.removeProperty("--custom-bg");
    }
    try {
      if (dataUrl) localStorage.setItem(STORAGE_KEY, dataUrl);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const setOverlayOpacity = useCallback((v: number) => {
    setOverlayOpacityState(v);
    // ✅ Appliquer immédiatement pour que le curseur soit réactif en temps réel
    document.documentElement.style.setProperty("--custom-overlay-opacity", String(v));
    try { localStorage.setItem(OPACITY_KEY, String(v)); } catch {}
  }, []);

  // Synchroniser au changement de customBg (chargement localStorage)
  useEffect(() => {
    const html = document.documentElement;
    if (customBg) {
      html.style.setProperty("--custom-bg", `url("${customBg}")`);
    } else {
      html.style.removeProperty("--custom-bg");
    }
  }, [customBg]);

  // Synchroniser l'opacité au chargement
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--custom-overlay-opacity",
      String(overlayOpacity)
    );
  }, [overlayOpacity]);

  return (
    <CustomThemeContext.Provider value={{
      customBg,
      overlayOpacity,
      setCustomBg,
      setOverlayOpacity,
      isCustomActive: !!customBg,
    }}>
      {children}
    </CustomThemeContext.Provider>
  );
}

export function useCustomTheme() {
  return useContext(CustomThemeContext);
}
