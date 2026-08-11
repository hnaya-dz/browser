"use client";
// ═══════════════════════════════════════════════════════════════
// Étape Q — la prochaine réunion, HORS de la console
// ═══════════════════════════════════════════════════════════════
// Épingler à l'intérieur du dock ne suffit pas : il est fermé la plupart
// du temps, et un bandeau dans un panneau fermé n'est vu que par quelqu'un
// qui regardait déjà. Cette pastille vit dans la barre du navigateur, à
// côté de l'icône de messagerie, et elle est là même quand la console ne
// l'est pas.
//
// Elle ne s'affiche QUE s'il y a une réunion à venir. Un emplacement
// occupé en permanence par « rien » cesse d'être regardé — c'est déjà la
// règle du centre de notifications, et elle vaut ici aussi.

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  prochaineReunion, patchStore, setPanelOpen, useChatSnapshot,
  type ChatMessage, type MeetingExtra,
} from "@/context/chatstore";

/** Compact : « 12 min », « 2 h », « en cours ». Pas de secondes — un
 *  chiffre qui défile dans une barre d'outils attire l'œil en permanence,
 *  ce qui est exactement l'inverse du but. */
function restant(debut: number, dureeMin: number): string {
  const maintenant = Date.now();
  if (maintenant >= debut) return maintenant < debut + dureeMin * 60000 ? "•" : "";
  const min = Math.ceil((debut - maintenant) / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

export default function ChatMeetingChip({ compact }: { compact?: boolean }) {
  // Abonnement au store : sans lui, la pastille n'apparaîtrait qu'au
  // prochain rendu déclenché par autre chose — donc pas à l'annonce de la
  // réunion, précisément quand on l'attend.
  useChatSnapshot();
  // Et rafraîchie à la minute : elle doit vieillir toute seule.
  const [, tic] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tic((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const m: ChatMessage | null = prochaineReunion();
  if (!m) return null;
  const e = m.extra as MeetingExtra;
  const texte = restant(e.startsAt, e.durationMin || 0);
  // Vert franc dans le dernier quart d'heure et pendant la réunion : c'est
  // le moment où la pastille doit accrocher le regard, pas avant.
  const imminent = e.startsAt - Date.now() < 15 * 60000;

  return (
    <button
      onClick={() => { patchStore({ activeThread: m.groupId || "all" }); setPanelOpen(true); }}
      title={`${e.title}\n${new Date(e.startsAt).toLocaleString()}`
        + (e.location ? `\n${e.location}` : "")}
      style={{
        display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
        border: `1px solid ${imminent ? "rgba(0,200,83,0.6)" : "rgba(128,128,128,0.35)"}`,
        background: imminent ? "rgba(0,200,83,0.18)" : "transparent",
        color: imminent ? "#00c853" : "inherit",
        borderRadius: 6, padding: compact ? "2px 6px" : "3px 8px",
        fontSize: compact ? 10 : 11, fontWeight: 600, cursor: "pointer",
        maxWidth: 150, overflow: "hidden",
      }}
    >
      <CalendarClock size={compact ? 12 : 13} style={{ flexShrink: 0 }} />
      {/* Le titre s'efface avant le compte à rebours quand la place
          manque : savoir QUAND prime sur savoir QUOI, le survol et le clic
          donnant le reste. */}
      <span style={{
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        opacity: 0.85, minWidth: 0,
      }}>{e.title}</span>
      {texte && <span style={{ flexShrink: 0 }}>{texte}</span>}
    </button>
  );
}
