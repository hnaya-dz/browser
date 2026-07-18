"use client";
import { useState, useEffect } from "react";
import { Shield, ShieldCheck } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/context/langcontext";

interface PrivacyPanelProps {
  onClose: () => void;
}

interface PrivacySettings {
  blockTrackers: boolean;
  cleanLinks: boolean;
}

function getThemeName() {
  if (typeof document === "undefined") return "dark";
  const cls = document.documentElement.classList;
  if (cls.contains("sunset")) return "sunset";
  if (cls.contains("light")) return "light";
  return "dark";
}

// Interrupteur visuel — insetInlineStart pour que le curseur glisse dans le
// bon sens en interface arabe (RTL) comme en français/anglais (LTR)
function Toggle({ on, accent, onChange }: { on: boolean; accent: string; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      style={{
        width: 42, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
        background: on ? accent : "rgba(128,128,128,0.35)",
        position: "relative", transition: "background .15s", flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 3, insetInlineStart: on ? 21 : 3,
        width: 18, height: 18, borderRadius: "50%", background: "#fff",
        transition: "inset-inline-start .15s", boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
      }} />
    </button>
  );
}

export default function PrivacyPanel({ onClose }: PrivacyPanelProps) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const dir = isRTL ? "rtl" : "ltr";

  // Défauts affichés en attendant la lecture des réglages réels — mêmes
  // valeurs que les défauts du main process (activé/activé)
  const [settings, setSettings] = useState<PrivacySettings>({ blockTrackers: true, cleanLinks: true });

  const api = typeof window !== "undefined" ? (window as any).electronAPI : null;

  useEffect(() => {
    api?.invoke?.("privacy-get-settings")
      .then((s: PrivacySettings) => { if (s) setSettings(s); })
      .catch(() => { /* hors Electron (dev navigateur) — défauts affichés */ });
  }, [api]);

  const updateSetting = (key: keyof PrivacySettings, value: boolean) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    // Appliqué immédiatement par le filtre réseau du main process
    api?.send?.("privacy-set-settings", next);
  };

  const theme = getThemeName();
  const isDark = theme === "dark";
  const bg     = isDark ? "#0d1a12" : theme === "light" ? "#fff" : "#1a0500";
  const border = isDark ? "rgba(255,255,255,0.1)" : theme === "light" ? "rgba(0,99,65,0.2)" : "rgba(255,80,20,0.2)";
  const text   = isDark ? "#fff" : theme === "light" ? "#1a2e22" : "#ffd4a0";
  const muted  = isDark ? "rgba(255,255,255,0.45)" : theme === "light" ? "rgba(0,60,30,0.5)" : "rgba(255,150,80,0.6)";
  const accent = theme === "sunset" ? "#c83200" : "#006341";
  const rowBg  = isDark ? "rgba(255,255,255,0.04)" : theme === "light" ? "rgba(0,99,65,0.05)" : "rgba(255,80,20,0.07)";

  const rows: { key: keyof PrivacySettings; label: string; desc: string }[] = [
    { key: "blockTrackers", label: t("Privacy.blockTrackers"), desc: t("Privacy.blockTrackersDesc") },
    { key: "cleanLinks",    label: t("Privacy.cleanLinks"),    desc: t("Privacy.cleanLinksDesc") },
  ];

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "14vh 16px 16px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div dir={dir} style={{
        width: 480, maxWidth: "92vw", maxHeight: "80vh", overflowY: "auto",
        background: bg, border: `1px solid ${border}`, borderRadius: 20,
        padding: 22, color: text, boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
        display: "flex", flexDirection: "column", gap: 14,
      }}>

        {/* En-tête */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Shield size={20} style={{ color: accent, flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{t("Privacy.title")}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {/* Protections permanentes — informatif, non désactivable */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          background: rowBg, border: `1px solid ${border}`,
          borderRadius: 10, padding: "10px 14px",
        }}>
          <ShieldCheck size={16} style={{ color: accent, flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: muted, lineHeight: 1.5 }}>{t("Privacy.alwaysOn")}</div>
        </div>

        {/* Interrupteurs */}
        {rows.map(row => (
          <div key={row.key} style={{
            background: rowBg, border: `1px solid ${border}`,
            borderRadius: 10, padding: "12px 14px",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{row.label}</div>
              <div style={{ fontSize: 11.5, color: muted, lineHeight: 1.5, marginTop: 2 }}>{row.desc}</div>
            </div>
            <Toggle on={settings[row.key]} accent={accent} onChange={(v) => updateSetting(row.key, v)} />
          </div>
        ))}

        {/* Conseil dépannage */}
        <div style={{ fontSize: 11.5, color: muted, lineHeight: 1.5 }}>
          {t("Privacy.troubleshoot")}
        </div>
      </div>
    </div>
  );
}
