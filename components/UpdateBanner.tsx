"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/context/langcontext";

interface UpdateInfo {
  available: boolean;
  currentVersion?: string;
  newVersion?: string;
  url?: string;
  notes?: string;
  throttled?: boolean;
}

const DISMISS_KEY_PREFIX = "hnaya-update-dismissed-";

export default function UpdateBanner() {
  const { t } = useTranslation();
  const { language, isRTL } = useLanguage();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.invoke) return;

    // ✅ Une seule vérification au démarrage ; le throttle hebdomadaire
    // est géré côté Electron (userData/last-update-check.json) — si moins
    // de 7 jours se sont écoulés, l'appel retourne { available: false, throttled: true }
    // sans requête réseau.
    api.invoke("check-for-update", language).then((res: UpdateInfo) => {
      if (res?.available && res.newVersion) {
        const alreadyDismissed = localStorage.getItem(DISMISS_KEY_PREFIX + res.newVersion);
        if (!alreadyDismissed) {
          setUpdate(res);
        }
      }
      // res.throttled === true → rien à afficher, c'est normal, pas une erreur
    }).catch(() => {});
  }, [language]);

  const handleDismiss = () => {
    if (update?.newVersion) {
      localStorage.setItem(DISMISS_KEY_PREFIX + update.newVersion, "1");
    }
    setDismissed(true);
  };

  const handleDownload = () => {
    if (update?.url) window.open(update.url, "_blank");
  };

  // ✅ Ne s'affiche que si une mise à jour est réellement disponible
  if (!update?.available || dismissed) return null;

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9997,
        background: "rgba(10,25,15,0.97)",
        border: "1px solid rgba(0,180,100,0.3)",
        borderRadius: 14,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        maxWidth: "90vw",
        color: "#fff",
      }}
    >
      <span style={{ fontSize: 20 }}>🚀</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 360 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          {t("Update.available")} — v{update.newVersion}
        </span>
        {/* ✅ Résumé des nouveautés dans la langue active */}
        {update.notes && (
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.4 }}>
            {update.notes}
          </span>
        )}
      </div>
      <button
        onClick={handleDownload}
        style={{
          padding: "7px 14px", borderRadius: 8, border: "none",
          background: "linear-gradient(135deg,#006341,#004d30)",
          color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer",
          whiteSpace: "nowrap", flexShrink: 0,
        }}
      >
        {t("Update.download")}
      </button>
      <button
        onClick={handleDismiss}
        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 16, cursor: "pointer", padding: 4, flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
}
