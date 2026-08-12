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
import { CalendarClock, MapPin, Download, X } from "lucide-react";
import { getApi, store, type ChatMessage } from "@/context/chatstore";
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
  // Étape R — une réunion décalée garde son heure ANNONCÉE dans l'extra
  // signé ; c'est la mise à jour, à côté, qui porte la nouvelle. On
  // affiche la nouvelle, on garde l'ancienne visible en dessous : effacer
  // ce qui avait été convoqué priverait le fil de sa trace.
  const annulee = message.meetingStatus === "cancelled";
  const decalee = message.meetingStatus === "moved";
  const debutAnnonce = Number(e.startsAt) || 0;
  const debut = decalee && message.meetingNewStart ? message.meetingNewStart : debutAnnonce;
  const duree = (decalee && message.meetingNewDuration) || Number(e.durationMin) || 60;

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
  const [reportOuvert, setReportOuvert] = useState(false);
  const [nouvelleDate, setNouvelleDate] = useState("");

  // L'organisateur se reconnaît par sa PERSONNE, pas par son pseudo : deux
  // collègues peuvent porter le même prénom, et lui-même écrit depuis deux
  // appareils. L'annuaire fait le lien empreinte → personne → « c'est moi ».
  const jeSuisOrganisateur = !!message.deviceFp
    && !!store.roster.find((p) => p.isMe && p.fingerprint === message.deviceFp);

  // ⚠️ Pas de `border` ici : chaque bouton pose le raccourci COMPLET.
  // Le style de base portait `border: "1px solid"` et chaque appel ajoutait
  // `borderColor`. React avertit alors qu'une propriété détaillée disparaît
  // pendant qu'un raccourci concurrent subsiste — cas réel ici, où les
  // boutons changent au basculement « Décaler » ↔ formulaire de report et
  // réutilisent les mêmes nœuds.
  const bouton: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 3, fontSize: 10,
    background: "transparent", borderRadius: 4,
    color: "inherit", cursor: "pointer", padding: "3px 7px",
  };
  const bordure = (couleur: string): React.CSSProperties => ({ border: `1px solid ${couleur}` });

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

  // Une réunion passée ne se décale ni ne s'annule : l'heure est écoulée,
  // il n'y a plus rien à prévenir. Laisser les boutons donnait à croire
  // qu'on pouvait encore agir sur une convocation périmée (retour terrain :
  // « les annonces fermées ont toujours les options décaler et annuler »).
  // Pour reprogrammer, on annonce une nouvelle réunion — la trace de
  // l'ancienne reste dans le fil, ce qui vaut mieux qu'un report qui
  // effacerait le fait qu'elle n'a pas eu lieu.
  // Recalculé à chaque tic (30 s), la carte vieillit donc toute seule.
  const terminee = Date.now() >= debut + duree * 60000;

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
      {/* Étape R — ce qu'il est advenu de la convocation. L'heure d'origine
          reste lisible : une réunion déplacée trois fois doit se relire,
          et « annulée » sans dire par qui ni quand ne vaut rien. */}
      {(annulee || decalee) && (
        <div style={{
          fontSize: 10.5, marginTop: 5, padding: "4px 7px", borderRadius: 4, lineHeight: 1.5,
          color: annulee ? "#ff8080" : "#ffcf8a",
          background: annulee ? "rgba(255,80,80,0.12)" : "rgba(255,180,60,0.12)",
          border: `1px solid ${annulee ? "rgba(255,80,80,0.35)" : "rgba(255,180,60,0.3)"}`,
        }}>
          <b>{annulee ? t("Chat.meetingCancelled") : t("Chat.meetingMoved")}</b>
          {message.meetingUpdatedBy ? ` — ${message.meetingUpdatedBy}` : ""}
          {message.meetingUpdatedAt ? ` · ${new Date(message.meetingUpdatedAt).toLocaleString()}` : ""}
          <div style={{ opacity: 0.75, textDecoration: "line-through" }}>
            {t("Chat.meetingWas")} {new Date(debutAnnonce).toLocaleString()}
          </div>
        </div>
      )}
      {message.text && !compact && (
        <div style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>{message.text}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 9.5, color: muted, flex: 1 }}>
          {t("Chat.meetingBy")} {message.from}
        </span>
        {/* Une réunion ANNULÉE ne s'ajoute pas à un agenda : on y inscrirait
            un rendez-vous qui n'aura pas lieu, et l'agenda deviendrait le
            dernier endroit où l'annulation n'est pas parvenue. Signalé en
            usage réel — le bouton survivait à l'annulation.
            Une réunion PASSÉE, en revanche, garde le sien : on archive
            volontiers ce qui a eu lieu. */}
        {!annulee && (
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
        )}
      </div>
      {/* Réservé à l'ORGANISATEUR. On compare la personne, pas le pseudo :
          il doit pouvoir décaler depuis son téléphone appairé. L'hôte
          applique de toute façon la même règle — ces boutons évitent
          seulement d'en proposer une qui serait refusée. */}
      {jeSuisOrganisateur && !annulee && !terminee && (
        <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
          {!reportOuvert ? (
            <>
              <button
                onClick={() => {
                  const d = new Date(debut);
                  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                  setNouvelleDate(d.toISOString().slice(0, 16));
                  setReportOuvert(true);
                }}
                style={{ ...bouton, ...bordure(border) }}
              >
                <CalendarClock size={10} /> {t("Chat.meetingMove")}
              </button>
              <button
                onClick={() => {
                  getApi()?.send?.("chat-update-meeting", { messageId: message.id, action: "cancelled" });
                }}
                style={{ ...bouton, ...bordure("rgba(255,82,82,0.5)"), color: "#ff8080" }}
              >
                <X size={10} /> {t("Chat.meetingCancel")}
              </button>
            </>
          ) : (
            <>
              <input
                type="datetime-local"
                value={nouvelleDate}
                onChange={(ev) => setNouvelleDate(ev.target.value)}
                style={{
                  flex: 1, minWidth: 130, fontSize: 10, padding: "3px 5px",
                  borderRadius: 4, border: `1px solid ${border}`,
                  background: "transparent", color: "inherit",
                }}
              />
              <button
                onClick={() => {
                  const quand = new Date(nouvelleDate).getTime();
                  if (!Number.isFinite(quand)) return;
                  getApi()?.send?.("chat-update-meeting", {
                    messageId: message.id, action: "moved",
                    startsAt: quand, durationMin: duree,
                  });
                  setReportOuvert(false);
                }}
                style={{ ...bouton, ...bordure(accent), color: accent }}
              >
                {t("Chat.meetingMoveConfirm")}
              </button>
              <button onClick={() => setReportOuvert(false)} style={{ ...bouton, ...bordure(border) }}>
                {t("Chat.inviteClose")}
              </button>
            </>
          )}
        </div>
      )}
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
