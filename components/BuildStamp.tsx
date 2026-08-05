"use client";
// ═══════════════════════════════════════════════════════════════
// Identification du build installé — mention discrète en bas d'accueil
// ═══════════════════════════════════════════════════════════════
// Le numéro de version seul ne distingue pas deux paquets successifs :
// « 0.7.0 » a désigné quatre contenus différents en une seule journée
// pendant la mise au point du serveur permanent. Un poste testé sur le
// mauvais binaire fait alors chercher un défaut déjà corrigé.
// La date vient de l'horodatage de l'exécutable (voir "get-build-info"
// dans electron.js) : rien à générer, donc rien qui puisse mentir.

import { useEffect, useState } from "react";
import { useLanguage } from "@/context/langcontext";
import { useTranslation } from "@/hooks/useTranslation";

interface Info {
  version: string;
  date: string | null;
  packaged: boolean;
}

export default function BuildStamp() {
  const { language, isRTL } = useLanguage();
  const { t } = useTranslation();
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    // Hors Electron (page ouverte dans un navigateur ordinaire), il n'y a
    // rien à afficher — même convention d'appel optionnel que partout.
    (window as any)?.electronAPI?.invoke?.("get-build-info")
      .then((r: Info) => setInfo(r))
      .catch(() => {});
  }, []);

  if (!info) return null;

  const locale = language === "ar" ? "ar-DZ" : language === "en" ? "en-GB" : "fr-FR";
  let quand = t("Update.buildDev");
  if (info.date) {
    try {
      quand = new Date(info.date).toLocaleString(locale, {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch {
      quand = info.date.slice(0, 16).replace("T", " ");
    }
  }

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      title={t("Update.buildHint")}
      style={{
        marginTop: 18,
        fontSize: 10.5,
        // ⚠️ L'accueil se lit par-dessus une PHOTO, et le thème « custom »
        // laisse l'utilisateur en choisir n'importe laquelle : un simple
        // gris clair devient illisible sur un fond clair. L'ombre porte le
        // texte quel que soit ce qu'il y a derrière — même problème que les
        // icônes autrefois invisibles sur fond sombre.
        color: "rgba(255,255,255,0.55)",
        textShadow: "0 1px 3px rgba(0,0,0,0.85)",
        letterSpacing: 0.2,
        // Chiffres à chasse fixe : deux dates s'alignent et se comparent
        // d'un coup d'oeil, ce qui est tout l'intérêt de cette mention.
        fontVariantNumeric: "tabular-nums",
        userSelect: "text",
      }}
    >
      v{info.version} · {quand}
    </div>
  );
}
