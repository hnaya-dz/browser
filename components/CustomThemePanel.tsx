"use client";
import { useRef, useState, useCallback } from "react";
import { useTheme } from "next-themes";
import { useCustomTheme } from "@/context/customthemecontext";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/context/langcontext";

const MAX_SIZE_MB = 5;

function getThemeName(): "dark" | "light" | "sunset" | "custom" {
  if (typeof document === "undefined") return "dark";
  const cls = document.documentElement.classList;
  if (cls.contains("custom")) return "custom";
  if (cls.contains("sunset")) return "sunset";
  if (cls.contains("light")) return "light";
  return "dark";
}

interface CustomThemePanelProps {
  onClose: () => void;
}

export default function CustomThemePanel({ onClose }: CustomThemePanelProps) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { setTheme } = useTheme();
  const { customBg, overlayOpacity, setCustomBg, setOverlayOpacity } = useCustomTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(customBg);

  const themeName = getThemeName();

  const processFile = useCallback((file: File) => {
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Format non supporté. " + t("Theme.supportedFormats"));
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`Image trop grande (max ${MAX_SIZE_MB} Mo).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setPreview(dataUrl);
      setCustomBg(dataUrl);
      setTheme("custom");
    };
    reader.readAsDataURL(file);
  }, [setCustomBg, setTheme, t]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleRemove = useCallback(() => {
    setPreview(null);
    setCustomBg(null);
    setTheme("dark");
    if (inputRef.current) inputRef.current.value = "";
  }, [setCustomBg, setTheme]);

  // Couleurs selon le thème actif
  const isDark = themeName === "dark" || themeName === "custom";
  const bg = isDark ? "rgba(10,25,15,0.97)" : themeName === "light" ? "#fff" : "rgba(20,3,0,0.97)";
  const border = isDark ? "rgba(255,255,255,0.1)" : themeName === "light" ? "rgba(0,99,65,0.2)" : "rgba(255,80,20,0.2)";
  const text = isDark ? "#fff" : themeName === "light" ? "#1a2e22" : "#ffd4a0";
  const muted = isDark ? "rgba(255,255,255,0.45)" : themeName === "light" ? "rgba(0,60,30,0.5)" : "rgba(255,150,80,0.6)";
  const accent = themeName === "sunset" ? "#c83200" : "#006341";

  return (
    <>
      {/* Overlay */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      {/* Panneau */}
      <div dir={isRTL ? "rtl" : "ltr"} style={{
        position: "fixed",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 10000,
        width: 420, maxWidth: "92vw",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 20,
        padding: 24,
        color: text,
        boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
        display: "flex", flexDirection: "column", gap: 18,
      }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>🖼️ {t("Theme.customLabel")}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {/* Zone de dépôt / aperçu */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !preview && inputRef.current?.click()}
          style={{
            position: "relative",
            borderRadius: 12,
            border: `2px dashed ${dragging ? accent : border}`,
            background: dragging ? `${accent}18` : "rgba(255,255,255,0.04)",
            minHeight: 160,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: preview ? "default" : "pointer",
            overflow: "hidden",
            transition: "all 0.15s",
          }}
        >
          {preview ? (
            <>
              <img
                src={preview}
                alt="aperçu"
                style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }}
              />
              {/* Badge actif */}
              {themeName === "custom" && (
                <div style={{
                  position: "absolute", top: 8, left: 8,
                  background: accent, color: "#fff",
                  fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 99
                }}>✓ Actif</div>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "0 20px" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🖼️</div>
              <div style={{ fontSize: 13, color: muted }}>{t("Theme.dropHere")}</div>
              <div style={{ fontSize: 11, color: muted, marginTop: 4 }}>{t("Theme.supportedFormats")} · max {MAX_SIZE_MB} Mo</div>
            </div>
          )}
        </div>

        {error && (
          <div style={{ fontSize: 12, color: "#ff6060", textAlign: "center" }}>{error}</div>
        )}

        {/* Boutons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => inputRef.current?.click()}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 10, border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.07)", color: text,
              fontWeight: 600, fontSize: 13, cursor: "pointer"
            }}
          >
            {preview ? t("Theme.changeImage") : t("Theme.chooseImage")}
          </button>

          {preview && (
            <button
              onClick={handleRemove}
              style={{
                padding: "9px 14px", borderRadius: 10, border: "1px solid rgba(255,80,80,0.3)",
                background: "rgba(255,80,80,0.1)", color: "#ff8080",
                fontWeight: 600, fontSize: 13, cursor: "pointer"
              }}
            >
              {t("Theme.removeImage")}
            </button>
          )}
        </div>

        {/* Curseur opacité — visible seulement si image choisie */}
        {preview && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: muted, marginBottom: 6 }}>
              <span>{t("Theme.overlayOpacity")}</span>
              <span>{Math.round(overlayOpacity * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={0.9} step={0.05}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: accent }}
            />
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={handleFile}
        />
      </div>
    </>
  );
}
