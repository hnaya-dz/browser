"use client";
// ═══════════════════════════════════════════════════════════════
// Centre de notifications — la présentation, unique
// ═══════════════════════════════════════════════════════════════
// Voir context/notifications.ts pour le modèle et le pourquoi. Ce
// composant ne connaît AUCUN module : il affiche des titres, des heures et
// exécute l'action que le module a fournie. C'est ce qui permet d'ajouter
// un outil de productivité sans rouvrir ce fichier.

import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/context/langcontext";
import { MessageSquare, KeyRound, CalendarClock, Info, Check, X, Bell } from "lucide-react";

// Même détection que les autres panneaux modaux : le thème est porté par
// une classe sur <html>, pas par un contexte React.
function getThemeName() {
  if (typeof document === "undefined") return "dark";
  const cls = document.documentElement.classList;
  if (cls.contains("sunset")) return "sunset";
  if (cls.contains("light")) return "light";
  return "dark";
}
import {
  useNotifications, marquerLue, toutMarquerLu, retirer,
  type Notification, type SourceNotif,
} from "@/context/notifications";

const ICONES: Record<SourceNotif, typeof Info> = {
  messagerie: MessageSquare,
  licence: KeyRound,
  agenda: CalendarClock,
  systeme: Info,
};

const TONS: Record<SourceNotif, string> = {
  messagerie: "#4a9eff",
  licence: "#ffa726",
  agenda: "#00c853",
  systeme: "#8a8a8a",
};

const depuis = (ts: number, t: (k: string) => string) => {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return t("Notifications.justNow");
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return new Date(ts).toLocaleDateString();
};

export default function NotificationCenter({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { liste } = useNotifications();

  // Mêmes teintes que les autres panneaux modaux (confidentialité, coffre)
  const theme = getThemeName();
  const isDark = theme === "dark";
  const bg = isDark ? "#0d1a12" : theme === "light" ? "#fff" : "#1a0500";
  const border = isDark ? "rgba(255,255,255,0.1)" : theme === "light" ? "rgba(0,99,65,0.2)" : "rgba(255,80,20,0.2)";
  const text = isDark ? "#fff" : theme === "light" ? "#1a2e22" : "#ffd4a0";
  const muted = isDark ? "rgba(255,255,255,0.45)" : theme === "light" ? "rgba(0,60,30,0.5)" : "rgba(255,150,80,0.6)";
  const accent = theme === "sunset" ? "#c83200" : "#006341";

  const ouvrir = (n: Notification) => {
    marquerLue(n.id);
    // L'action peut fermer le centre elle-même (ouvrir le dock, par
    // exemple) : on ferme d'abord pour ne pas laisser deux panneaux
    // superposés à l'écran.
    onClose();
    try { n.action?.(); } catch { /* le module a disparu entre-temps */ }
  };

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
      <div dir={isRTL ? "rtl" : "ltr"} style={{
        width: 440, maxWidth: "92vw", maxHeight: "70vh",
        background: bg, border: `1px solid ${border}`, borderRadius: 20,
        padding: 20, color: text, boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
        <Bell size={18} style={{ color: accent, flexShrink: 0 }} />
        <strong style={{ fontSize: 15, flex: 1 }}>{t("Notifications.title")}</strong>
        {liste.some((n) => !n.lue) && (
          <button
            onClick={() => toutMarquerLu()}
            style={{
              background: "transparent", border: "none", color: muted,
              cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 3,
            }}
          >
            <Check size={12} /> {t("Notifications.markAllRead")}
          </button>
        )}
        <button onClick={onClose} style={{ background: "none", border: "none", color: muted, fontSize: 20, cursor: "pointer" }}>✕</button>
      </div>

      {liste.length === 0 ? (
        <div style={{ fontSize: 12, color: muted, textAlign: "center", padding: "30px 10px", lineHeight: 1.6 }}>
          {t("Notifications.empty")}
        </div>
      ) : (
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
          {liste.map((n) => {
            const Icone = ICONES[n.source] || Info;
            const ton = TONS[n.source] || "#8a8a8a";
            return (
              <div
                key={n.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "8px 9px", borderRadius: 6,
                  // Non lue = fond marqué. C'est le seul repère qui compte
                  // dans une liste : ce qu'on n'a pas encore vu.
                  background: n.lue ? "transparent" : `${ton}14`,
                  border: `1px solid ${n.lue ? "rgba(128,128,128,0.22)" : ton + "44"}`,
                }}
              >
                <Icone size={13} style={{ color: ton, flexShrink: 0, marginTop: 1 }} />
                <button
                  onClick={() => ouvrir(n)}
                  style={{
                    flex: 1, minWidth: 0, background: "transparent", border: "none",
                    color: "inherit", textAlign: "start",
                    cursor: n.action ? "pointer" : "default", padding: 0,
                  }}
                >
                  <div style={{ fontSize: 11.5, lineHeight: 1.45, fontWeight: n.lue ? 400 : 600 }}>
                    {n.titre}
                  </div>
                  {n.detail && (
                    <div style={{ fontSize: 10.5, opacity: 0.7, lineHeight: 1.45, marginTop: 1 }}>
                      {n.detail}
                    </div>
                  )}
                  <div style={{ fontSize: 9.5, color: muted, marginTop: 2 }}>{depuis(n.ts, t)}</div>
                </button>
                <button
                  onClick={() => retirer(n.id)}
                  title={t("Notifications.dismiss")}
                  aria-label={t("Notifications.dismiss")}
                  style={{
                    background: "transparent", border: "none", color: muted,
                    cursor: "pointer", padding: 2, flexShrink: 0, lineHeight: 0,
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
