"use client";
// ═══════════════════════════════════════════════════════════════
// Bandeau « ouvert dans votre navigateur système »
// ═══════════════════════════════════════════════════════════════
// Google refuse l'authentification depuis un navigateur Electron
// (« this browser or app may not be secure ») : la connexion Google est
// donc déléguée au navigateur par défaut du poste (voir electron.js,
// openExternallyWithNotice). Sans explication, la fenêtre qui surgit
// passe pour un dysfonctionnement — retour terrain : « un onglet s'était
// détaché dans une autre fenêtre » lors d'une connexion LinkedIn.
//
// ⚠️ Ce composant est monté dans le LAYOUT, pas dans la barre d'adresse :
// celle-ci se remonte à chaque changement d'onglet, ce qui effaçait
// l'état du bandeau avant même son affichage (l'ouverture externe crée
// justement un onglet). Ici, il survit.

import { useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

const AUTO_HIDE_MS = 9000;

export default function ExternalOpenNotice() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.receive) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onExternal = () => {
      setVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    };
    api.receive("external-open-notice", onExternal);
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  if (!visible) return null;

  return (
    <div
      onClick={() => setVisible(false)}
      role="status"
      style={{
        position: "fixed", top: "7vh", left: "50%", transform: "translateX(-50%)",
        zIndex: 10000, maxWidth: "min(560px, 92vw)",
        background: "rgba(20,20,20,0.96)", color: "#fff",
        border: "1px solid rgba(255,180,0,0.5)", borderRadius: 8,
        padding: "10px 14px", fontSize: 12, lineHeight: 1.5,
        boxShadow: "0 8px 30px rgba(0,0,0,0.45)", cursor: "pointer",
        display: "flex", alignItems: "flex-start", gap: 8,
      }}
    >
      <span style={{ flexShrink: 0 }}>🔐</span>
      <span style={{ flex: 1 }}>{t("URLBar.externalAuthNotice")}</span>
      <span style={{ flexShrink: 0, opacity: 0.5 }}>✕</span>
    </div>
  );
}
