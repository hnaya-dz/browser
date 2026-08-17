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
  const [localOpacity, setLocalOpacity] = useState(overlayOpacity);

  const themeName = getThemeName();
  const dir = isRTL ? "rtl" : "ltr";

  const processFile = useCallback((file: File) => {
    setError("");
    // ✅ Sur Windows, file.type peut être vide ou incorrect pour certains
    // fichiers (déjà constaté pour le JPEG — voir docs/DEV-RETOUR-EXPERIENCE.md).
    // On garde la vérification MIME stricte, mais avec un repli sur
    // l'extension du nom de fichier si le MIME est absent ou incorrect,
    // pour ne pas rejeter des PNG/JPG/WEBP valides.
    const allowedMime = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    const allowedExt = ["jpg", "jpeg", "png", "webp"];
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const mimeOk = allowedMime.includes(file.type);
    const extOk = allowedExt.includes(ext);
    if (!mimeOk && !extOk) {
      setError(t("Theme.formatError") + " " + t("Theme.supportedFormats"));
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(t("Theme.sizeError").replace("{max}", String(MAX_SIZE_MB)));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl || !dataUrl.startsWith("data:image/")) {
        setError(t("Theme.formatError"));
        return;
      }
      setPreview(dataUrl);
      setError("");
    };
    reader.onerror = () => setError(t("Theme.formatError"));
    reader.readAsDataURL(file);
  }, [t]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
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
    onClose();
  }, [setCustomBg, setTheme, onClose]);

  const handleApply = useCallback(() => {
    if (preview) {
      setCustomBg(preview);
      setOverlayOpacity(localOpacity);
      setTheme("custom");
    }
    onClose();
  }, [preview, localOpacity, setCustomBg, setOverlayOpacity, setTheme, onClose]);

  // Couleurs selon le thème actif
  const isDark = themeName === "dark" || themeName === "custom";
  const bg     = isDark ? "rgba(10,25,15,0.97)" : themeName === "light" ? "#fff" : "rgba(20,3,0,0.97)";
  const border = isDark ? "rgba(255,255,255,0.1)" : themeName === "light" ? "rgba(0,99,65,0.2)" : "rgba(255,80,20,0.2)";
  const text   = isDark ? "#fff" : themeName === "light" ? "#1a2e22" : "#ffd4a0";
  const muted  = isDark ? "rgba(255,255,255,0.45)" : themeName === "light" ? "rgba(0,60,30,0.5)" : "rgba(255,150,80,0.6)";
  const accent = themeName === "sunset" ? "#c83200" : "#006341";

  return (
    // ✅ Overlay positionné avec inset:0 mais paddingTop pour respecter tabbar+navbar
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",       // ✅ aligner en haut pour contrôler via paddingTop
        justifyContent: "center",
        paddingTop: "14vh",              // ✅ tabbar(6vh) + navbar(6vh) + marge(2vh)
        paddingLeft: "16px",
        paddingRight: "16px",
        paddingBottom: "16px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div dir={dir} style={{
        width: 420,
        maxWidth: "92vw",
        maxHeight: "80vh",
        overflowY: "auto",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 20,
        padding: 22,
        color: text,
        boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>🖼️ {t("Theme.customLabel")}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        {/* Zone dépôt / aperçu */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !preview && inputRef.current?.click()}
          style={{
            position: "relative", borderRadius: 12,
            border: `2px dashed ${dragging ? accent : border}`,
            background: dragging ? `${accent}18` : "rgba(255,255,255,0.04)",
            minHeight: 120,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: preview ? "default" : "pointer",
            overflow: "hidden", transition: "all 0.15s",
          }}
        >
          {preview ? (
            <img src={preview} alt="aperçu" style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ textAlign: "center", padding: "0 20px" }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>🖼️</div>
              <div style={{ fontSize: 13, color: muted }}>{t("Theme.dropHere")}</div>
              <div style={{ fontSize: 11, color: muted, marginTop: 3 }}>{t("Theme.supportedFormats")} · max {MAX_SIZE_MB} Mo</div>
            </div>
          )}
        </div>

        {error && <div style={{ fontSize: 12, color: "#ff6060", textAlign: "center" }}>{error}</div>}

        {/* Boutons choisir / supprimer */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => inputRef.current?.click()}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 10,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.07)", color: text,
              fontWeight: 600, fontSize: 13, cursor: "pointer"
            }}
          >
            {preview ? t("Theme.changeImage") : t("Theme.chooseImage")}
          </button>
          {preview && (
            <button onClick={handleRemove} style={{
              padding: "9px 14px", borderRadius: 10,
              border: "1px solid rgba(255,80,80,0.3)",
              background: "rgba(255,80,80,0.1)", color: "#ff8080",
              fontWeight: 600, fontSize: 13, cursor: "pointer"
            }}>
              {t("Theme.removeImage")}
            </button>
          )}
        </div>

        {/* Curseur opacité */}
        {preview && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: muted, marginBottom: 6 }}>
              <span>{t("Theme.overlayOpacity")}</span>
              <span>{Math.round(localOpacity * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={0.9} step={0.05}
              value={localOpacity}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setLocalOpacity(v);
                setOverlayOpacity(v); // aperçu temps réel
              }}
              style={{ width: "100%", accentColor: accent }}
            />
          </div>
        )}

        {/* ✅ Boutons Appliquer + Fermer côte à côte */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: 11, borderRadius: 10,
              border: `1px solid ${border}`,
              background: "rgba(255,255,255,0.07)", color: text,
              fontWeight: 600, fontSize: 13, cursor: "pointer"
            }}
          >
            {t("Theme.close")}
          </button>
          <button
            onClick={handleApply}
            style={{
              flex: 2, padding: 11, borderRadius: 10, border: "none",
              background: preview
                ? `linear-gradient(135deg,${accent},${accent}bb)`
                : "rgba(128,128,128,0.25)",
              color: preview ? "#fff" : muted,
              fontWeight: 700, fontSize: 13, cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {preview ? t("Theme.apply") : t("Theme.apply")}
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={handleFile}
        />
      </div>
    </div>
  );
}
