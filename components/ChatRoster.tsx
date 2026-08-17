"use client";
// ═══════════════════════════════════════════════════════════════
// Annuaire du salon (étape F) — qui est là, et comment lui écrire
// ═══════════════════════════════════════════════════════════════
// Répond au besoin exprimé : joindre quelqu'un SANS créer de salon ni
// partager un PIN. Chaque personne du salon y figure avec sa fonction
// (DRH, DGA… posée par l'admin) et une pastille verte si elle est en
// ligne. Un clic ouvre le fil privé — voir chat-module/src/direct.js
// pour le cloisonnement côté serveur.

import { useTranslation } from "@/hooks/useTranslation";
import { MessageSquare, Users, Smartphone } from "lucide-react";
import { store, directThreadId, getApi, type RosterPerson } from "@/context/chatstore";
import ChatAvatar from "./ChatAvatar";
import ChatIdentite from "./ChatIdentite";

interface Props {
  accent: string;
  muted: string;
  border: string;
  text: string;
  onOpenThread: (threadId: string, person: RosterPerson) => void;
  unreadByThread: Record<string, number>;
}

const depuis = (ts: number, t: (k: string) => string) => {
  if (!ts) return "";
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return t("Chat.rosterJustNow");
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
};

export default function ChatRoster({ accent, muted, border, text, onOpenThread, unreadByThread }: Props) {
  const { t } = useTranslation();
  const me = store.myFingerprint;

  // Soi-même en dernier : on n'écrit pas à son propre appareil, mais le
  // voir confirme qu'on est bien inscrit. Pour joindre son AUTRE appareil,
  // voir « Mes appareils » plus bas.
  const gens = [...store.roster].sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? 1 : -1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "");
  });

  // Mes autres appareils : ceux de MA personne, moins celui-ci. La liste
  // n est envoyee que pour soi (voir server.js) — pour autrui, elle est
  // absente, et un fil se compose alors avec l appareil representatif.
  const mesAutresAppareils = (store.roster.find((x) => x.isMe)?.appareils || [])
    .filter((fp) => fp && fp !== me);

  if (!gens.length) {
    return (
      <div style={{ fontSize: 11.5, color: muted, textAlign: "center", padding: "18px 10px", lineHeight: 1.6 }}>
        {t("Chat.rosterEmpty")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Soi d abord : le pseudo et la photo, reunis. Le pseudo ne se
          change pas ici — c est celui sous lequel on s est raccorde — donc
          aucun lien « Modifier » qui mentirait sur son effet. */}
      {store.roster.some((x) => x.isMe) && (
        <ChatIdentite
          pseudo={store.roster.find((x) => x.isMe)?.name || ""}
          connecte
          accent={accent} muted={muted} border={border} text={text}
        />
      )}
      <div style={{ fontSize: 10.5, color: muted, display: "flex", alignItems: "center", gap: 5, padding: "6px 2px 6px" }}>
        <Users size={12} /> {t("Chat.rosterTitle")} — {gens.length}
        {/* Étape M — la photo a rejoint le bloc d IDENTITE, sous la liste :
            elle disait la meme chose que le pseudo et vivait ailleurs. Voir
            ChatIdentite. L en-tete retrouve sa ligne. */}
      </div>
      {/* ── MES APPAREILS — s'envoyer un fichier à soi-même ─────────────
          Un fil privé se route par empreinte d'APPAREIL. Le poste et le
          téléphone d'une même personne en ont deux, distinctes, et ne
          partagent que leur personId : le fil poste↔téléphone est donc un
          fil privé ORDINAIRE, déjà pris en charge de bout en bout. Rien à
          ajouter au protocole — il manquait seulement le moyen de
          l'ouvrir, l'annuaire ne montrant qu'une entrée par personne.
          Ne paraît qu'à partir de deux appareils appairés : sans mobile
          rattaché, la ligne n'aurait aucun sens. */}
      {mesAutresAppareils.map((fp, i) => {
        const fil = me ? directThreadId(me, fp) : null;
        if (!fil) return null;
        const nonLus = unreadByThread[fil] || 0;
        const moi = store.roster.find((x) => x.isMe);
        return (
          <button
            key={"moi-" + fp}
            onClick={() => moi && onOpenThread(fil, moi)}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              background: `${accent}10`, border: `1px solid ${accent}40`, borderRadius: 4,
              padding: "7px 9px", cursor: "pointer", color: "inherit", textAlign: "start",
            }}
            title={t("Chat.myDevicesHint")}
          >
            <Smartphone size={16} style={{ color: accent, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12 }}>
                {t("Chat.myDevices")}
                {mesAutresAppareils.length > 1 && (
                  <span style={{ color: muted, fontSize: 10 }}> · {i + 1}</span>
                )}
              </span>
              <span style={{ display: "block", fontSize: 10, color: muted, marginTop: 1 }}>
                {t("Chat.myDevicesHint")}
              </span>
            </span>
            {nonLus > 0 && (
              <span style={{
                background: accent, color: "#fff", fontSize: 9.5, fontWeight: 700,
                borderRadius: 9, minWidth: 17, padding: "1px 5px", textAlign: "center", flexShrink: 0,
              }}>{nonLus}</span>
            )}
          </button>
        );
      })}

      {gens.map((p) => {
        const fil = me && !p.isMe ? directThreadId(me, p.fingerprint) : null;
        const nonLus = fil ? (unreadByThread[fil] || 0) : 0;
        return (
          <button
            key={p.fingerprint}
            onClick={() => fil && onOpenThread(fil, p)}
            disabled={!fil}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              background: "transparent", border: `1px solid ${border}`, borderRadius: 4,
              padding: "7px 9px", cursor: fil ? "pointer" : "default",
              color: "inherit", textAlign: "start", opacity: p.isMe ? 0.65 : 1,
            }}
            title={fil ? t("Chat.rosterWriteTo") : undefined}
          >
            {/* Étape M — la pastille de présence est désormais portée par
                l'avatar : deux ronds côte à côte, l'un pour la couleur de
                la personne et l'autre pour sa présence, se disputaient le
                regard sans que l'on sache lequel lire. */}
            <ChatAvatar
              personId={p.personId || p.fingerprint}
              name={p.name}
              avatarSha={p.avatarSha}
              online={p.online}
              size={30}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name || t("Chat.rosterUnnamed")}
                {p.isMe && <span style={{ color: muted, fontSize: 10 }}> · {t("Chat.rosterMe")}</span>}
              </span>
              <span style={{ display: "block", fontSize: 10, color: muted, marginTop: 1 }}>
                {/* La fonction prime sur l'horodatage : c'est elle qui
                    permet de trouver « le DRH » sans connaître son nom. */}
                {p.role
                  ? <b style={{ color: accent, fontWeight: 700 }}>{p.role}</b>
                  : (p.online ? t("Chat.rosterOnline") : depuis(p.lastSeen, t))}
                {p.role && !p.online && ` · ${depuis(p.lastSeen, t)}`}
              </span>
            </span>
            {nonLus > 0 && (
              <span style={{
                background: "#ff5252", color: "#fff", borderRadius: 9, minWidth: 17,
                height: 17, fontSize: 10, fontWeight: 700, display: "flex",
                alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0,
              }}>{nonLus}</span>
            )}
            {fil && <MessageSquare size={13} style={{ color: muted, flexShrink: 0 }} />}
          </button>
        );
      })}
    </div>
  );
}
