"use client";
// ═══════════════════════════════════════════════════════════════
// Étape P — réunion annoncée, épinglée avec son compte à rebours
// ═══════════════════════════════════════════════════════════════
// ⚠️ Épingler NE SUFFIT PAS à rendre une réunion visible, et c'était la
// condition posée. Le dock est fermé la plupart du temps : un bandeau à
// l'intérieur d'un panneau fermé n'est vu que par quelqu'un qui regardait
// déjà. La visibilité vient d'ailleurs — d'une notification Windows native
// programmée dans le PROCESS PRINCIPAL, et d'une entrée dans le centre de
// notifications. Cette carte est le rappel de celui qui a le dock ouvert,
// pas le dispositif de visibilité à elle seule.

import { useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { CalendarClock, MapPin, Download } from "lucide-react";
import { getApi, type ChatMessage } from "@/context/chatstore";
import { composerIcs, nomFichierIcs } from "@/context/ics";

interface Props {
  message: ChatMessage;
  accent: string;
  muted: string;
  border: string;
  compact?: boolean;
}

/** « dans 1 h 20 », « dans 3 min », « en cours ». On ne descend pas sous la
 *  minute : une seconde qui défile attire l'œil en permanence, ce qui est
 *  exactement ce qu'il ne faut pas dans un outil de travail. */
function restant(debut: number, dureeMin: number, t: (k: string) => string): string {
  const maintenant = Date.now();
  if (maintenant >= debut) {
    return maintenant < debut + dureeMin * 60000 ? t("Chat.meetingNow") : t("Chat.meetingOver");
  }
  const min = Math.ceil((debut - maintenant) / 60000);
  if (min < 60) return `${t("Chat.meetingIn")} ${min} min`;
  const h = Math.floor(min / 60);
  const reste = min % 60;
  if (h < 24) return `${t("Chat.meetingIn")} ${h} h${reste ? " " + reste : ""}`;
  return `${t("Chat.meetingIn")} ${Math.floor(h / 24)} j`;
}

export default function ChatMeetingCard({ message, accent, muted, border, compact }: Props) {
  const { t } = useTranslation();
  const e = (message.extra || {}) as { title?: string; startsAt?: number; durationMin?: number; location?: string | null };
  const debut = Number(e.startsAt) || 0;
  const duree = Number(e.durationMin) || 60;

  // Rafraîchi à la minute : la carte doit vieillir toute seule, sinon
  // « dans 5 min » resterait affiché une heure après.
  const [, tic] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tic((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Chemin du .ics une fois produit. On le garde affiché : l'ouverture
  // peut « réussir » sans que rien n'apparaisse — le gestionnaire .ics de
  // Windows peut pointer vers une application retirée du système, cas
  // rencontré en test réel. L'utilisateur doit toujours pouvoir mettre la
  // main sur le fichier.
  const [fichierIcs, setFichierIcs] = useState<string | null>(null);

  const exporter = async () => {
    const contenu = composerIcs({
      id: message.id, title: e.title || "", startsAt: debut, durationMin: duree,
      location: e.location, description: message.text || null, organisateur: message.from,
    });
    const r = await getApi()?.invoke?.("chat-export-ics", {
      filename: nomFichierIcs(e.title || "reunion", debut), content: contenu,
    });
    if (r?.ok && r.path) setFichierIcs(String(r.path));
  };

  const imminent = debut - Date.now() < 15 * 60000 && Date.now() < debut + duree * 60000;

  // ⚠️ ÉPINGLÉE = UNE SEULE LIGNE.
  // La version épinglée reprenait la carte entière — titre, date, lieu,
  // ordre du jour, auteur, bouton d'export : trois à quatre lignes en
  // permanence en tête du fil, au point de rendre les échanges illisibles
  // dans un dock de 340 px. Signalé en usage réel.
  // L'épingle n'est qu'un rappel : l'objet et le temps restant. Tout le
  // reste, y compris l'export, vit dans la carte du fil, où la réunion
  // figure de toute façon. Le survol donne le détail.
  if (compact) {
    return (
      <div
        title={`${e.title}\n${new Date(debut).toLocaleString()} · ${duree} min${e.location ? " · " + e.location : ""}`}
        style={{
          alignSelf: "stretch", display: "flex", alignItems: "center", gap: 6,
          borderRadius: 6, padding: "4px 8px", cursor: "default",
          background: imminent ? "rgba(0,200,83,0.16)" : `${accent}12`,
          border: `1px solid ${imminent ? "rgba(0,200,83,0.55)" : accent + "44"}`,
        }}
      >
        <CalendarClock size={11} style={{ color: accent, flexShrink: 0 }} />
        <b style={{
          fontSize: 10.5, flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{e.title}</b>
        <span style={{
          fontSize: 9.5, fontWeight: 700, flexShrink: 0,
          color: imminent ? "#00c853" : muted,
        }}>{restant(debut, duree, t)}</span>
      </div>
    );
  }

  return (
    <div style={{
      alignSelf: "stretch", borderRadius: 8, padding: "9px 11px",
      background: imminent ? "rgba(0,200,83,0.16)" : `${accent}12`,
      border: `1px solid ${imminent ? "rgba(0,200,83,0.55)" : accent + "44"}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <CalendarClock size={13} style={{ color: accent, flexShrink: 0 }} />
        <b style={{ fontSize: 12, flex: 1, minWidth: 0 }}>{e.title}</b>
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: imminent ? "#00c853" : muted,
        }}>{restant(debut, duree, t)}</span>
      </div>
      <div style={{ fontSize: 10.5, color: muted, marginTop: 3, lineHeight: 1.5 }}>
        {new Date(debut).toLocaleString()} · {duree} min
        {e.location && (
          <> · <MapPin size={9} style={{ display: "inline", verticalAlign: -1 }} /> {e.location}</>
        )}
      </div>
      {message.text && !compact && (
        <div style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>{message.text}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 9.5, color: muted, flex: 1 }}>
          {t("Chat.meetingBy")} {message.from}
        </span>
        <button
          onClick={exporter}
          title={t("Chat.meetingExportHelp")}
          style={{
            display: "flex", alignItems: "center", gap: 4, fontSize: 10,
            background: "transparent", border: `1px solid ${border}`, borderRadius: 4,
            color: "inherit", cursor: "pointer", padding: "3px 7px",
          }}
        >
          <Download size={10} /> {t("Chat.meetingExport")}
        </button>
      </div>
      {fichierIcs && (
        <div style={{ fontSize: 9.5, color: muted, marginTop: 4, lineHeight: 1.45 }}>
          {t("Chat.meetingIcsDone")}{" "}
          <button
            onClick={() => getApi()?.send?.("chat-reveal-file", { path: fichierIcs })}
            style={{
              background: "transparent", border: "none", color: accent,
              cursor: "pointer", padding: 0, fontSize: 9.5, textDecoration: "underline",
            }}
          >
            {t("Chat.meetingIcsShow")}
          </button>
        </div>
      )}
    </div>
  );
}
