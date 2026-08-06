"use client";
// ═══════════════════════════════════════════════════════════════
// Carte de vote dans le fil (étape H)
// ═══════════════════════════════════════════════════════════════
// Répond à une question posée en test réel : « si l'un valide et deux
// émettent des réserves, comment saurais-je qui a apposé quoi ? ». Une
// citation ne pouvait pas y répondre — texte libre indénombrable, aucune
// trace de ceux qui n'ont pas répondu, aucune révision possible.
//
// ⚠️ Ne JAMAIS écrire « anonyme » ni « secret » pour le mode non
// nominatif : l'hôte voit la réponse arriver, et l'hôte est la machine de
// l'organisation. Ce qui est tenu, c'est que le lien personne → choix
// n'est écrit nulle part en base. C'est déjà beaucoup, ce n'est pas un
// scrutin secret, et le promettre serait un vrai problème pour un client
// d'administration.

import { useTranslation } from "@/hooks/useTranslation";
import { CheckCircle2, Users } from "lucide-react";
import type { ChatMessage, VoteTally, RosterPerson, VoteExtra } from "@/context/chatstore";

interface Props {
  message: ChatMessage;
  tally: VoteTally | undefined;
  roster: RosterPerson[];
  myFingerprint: string | null;
  onAnswer: (choice: number) => void;
  accent: string;
  muted: string;
  border: string;
}

export default function ChatVoteCard({
  message, tally, roster, myFingerprint, onAnswer, accent, muted, border,
}: Props) {
  const { t } = useTranslation();
  // Rétrécissement explicite : l'appelant n'instancie cette carte que pour
  // un message de type "vote", et c'est l'hôte qui construit `extra` selon
  // le type. TypeScript ne peut pas le déduire d'un `type` optionnel.
  const def = message.extra as VoteExtra | undefined;
  const options: string[] = def?.options || [];
  const nominatif = def?.nominatif !== false;
  const decompte = tally?.decompte || {};
  const voters = tally?.voters || [];
  const detail = tally?.detail || [];

  // Ai-je déjà répondu ? Se lit dans `voters`, seule liste renseignée dans
  // les DEUX modes — `detail` est vide en non nominatif.
  const jaiRepondu = !!myFingerprint && voters.some((v) => v.fingerprint === myFingerprint);
  const monChoix = detail.find((d) => d.fingerprint === myFingerprint)?.choice;

  // Les absents : c'est précisément ce qu'une citation ne saura jamais
  // dire. On les déduit de l'annuaire du salon, pas des seuls connectés —
  // quelqu'un de déconnecté doit rester dans les attendus.
  const ontRepondu = new Set(voters.map((v) => v.fingerprint));
  const absents = roster.filter((p) => !ontRepondu.has(p.fingerprint));

  return (
    <div style={{
      alignSelf: "center", width: "97%",
      background: `${accent}12`, border: `1px solid ${accent}55`,
      borderRadius: 8, padding: "9px 11px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
        <CheckCircle2 size={12} style={{ color: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 9.5, color: accent, fontWeight: 700, letterSpacing: 0.3 }}>
          {t("Chat.voteLabel")}
        </span>
        {!nominatif && (
          <span style={{ fontSize: 9, color: muted, border: `1px solid ${border}`, borderRadius: 3, padding: "0 4px" }}>
            {t("Chat.voteNotNamed")}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7, lineHeight: 1.4 }}>
        {message.text}
      </div>

      {options.map((opt, i) => {
        const n = decompte[i] || 0;
        const part = tally?.total ? Math.round((n / tally.total) * 100) : 0;
        const cestMoi = monChoix === i;
        return (
          <div key={i} style={{ marginBottom: 4 }}>
            <button
              onClick={() => onAnswer(i)}
              // En non nominatif le bulletin est définitif : on désactive
              // plutôt que de laisser cliquer pour un refus de l'hôte.
              disabled={jaiRepondu && !nominatif}
              style={{
                width: "100%", textAlign: "start", position: "relative",
                background: cestMoi ? `${accent}35` : "rgba(255,255,255,0.05)",
                border: `1px solid ${cestMoi ? accent : border}`,
                borderRadius: 5, padding: "5px 8px", color: "inherit",
                fontSize: 11.5, cursor: jaiRepondu && !nominatif ? "default" : "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {/* Jauge de fond : proportion des voix, lisible d'un coup d'œil */}
              <span style={{
                position: "absolute", insetInlineStart: 0, top: 0, bottom: 0,
                width: `${part}%`, background: `${accent}20`, borderRadius: 4,
                pointerEvents: "none",
              }} />
              <span style={{ flex: 1, position: "relative" }}>{opt}</span>
              <span style={{ position: "relative", fontVariantNumeric: "tabular-nums", color: muted }}>
                {n}
              </span>
            </button>
            {/* Qui a choisi quoi — uniquement si le vote est nominatif */}
            {nominatif && detail.some((d) => d.choice === i) && (
              <div style={{ fontSize: 9.5, color: muted, paddingInlineStart: 8, marginTop: 1 }}>
                {detail.filter((d) => d.choice === i).map((d, k) => (
                  <span key={k}>
                    {k > 0 ? ", " : ""}{d.sender}
                    {d.comment ? ` (${d.comment})` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 9.5, color: muted }}>
        <Users size={10} style={{ flexShrink: 0 }} />
        <span>{voters.length} {t("Chat.voteAnswered")}</span>
        {absents.length > 0 && (
          <span title={absents.map((a) => a.name || a.fingerprint.slice(0, 8)).join(", ")}>
            · {absents.length} {t("Chat.votePending")}
          </span>
        )}
      </div>
      {jaiRepondu && !nominatif && (
        <div style={{ fontSize: 9.5, color: muted, marginTop: 3 }}>{t("Chat.voteFinal")}</div>
      )}
    </div>
  );
}
