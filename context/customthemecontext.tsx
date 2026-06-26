"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "hnaya-custom-bg";
const OPACITY_KEY = "hnaya-custom-opacity";

interface CustomThemeContextProps {
  customBg: string | null;          // data URL base64 de l'image
  overlayOpacity: number;           // 0–0.9, opacité de la couche sombre par-dessus
  setCustomBg: (dataUrl: string | null) => void;
  setOverlayOpacity: (v: number) => void;
  isCustomActive: boolean;          // true si thème = "custom" ET image choisie
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
    try {
      if (dataUrl) localStorage.setItem(STORAGE_KEY, dataUrl);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const setOverlayOpacity = useCallback((v: number) => {
    setOverlayOpacityState(v);
    try { localStorage.setItem(OPACITY_KEY, String(v)); } catch {}
  }, []);

  // Appliquer le fond sur <html> quand l'image change
  useEffect(() => {
    const html = document.documentElement;
    if (customBg) {
      html.style.setProperty("--custom-bg", `url("${customBg}")`);
    } else {
      html.style.removeProperty("--custom-bg");
    }
  }, [customBg]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--custom-overlay-opacity",
      String(overlayOpacity)
    );
  }, [overlayOpacity]);

  const isCustomActive = !!customBg;

  return (
    <CustomThemeContext.Provider value={{ customBg, overlayOpacity, setCustomBg, setOverlayOpacity, isCustomActive }}>
      {children}
    </CustomThemeContext.Provider>
  );
}

export function useCustomTheme() {
  return useContext(CustomThemeContext);
}
