"use client";
// ═══════════════════════════════════════════════════════════════
// Étape K — bandeau d'une demande qualifiée et de son issue
// ═══════════════════════════════════════════════════════════════
// Le besoin, tel qu'il a été formulé : un chargé de projet demande au
// Directeur de valider un rapport, et TOUTE l'équipe doit savoir s'il a
// validé. D'où trois exigences que ce composant doit tenir à l'écran :
//
//  1. La NATURE de l'envoi se voit d'un coup d'œil — « pour info » ne se
//     confond pas avec « approbation ».
//  2. Le DESTINATAIRE désigné est nommé. Une demande adressée à quelqu'un
//     en particulier ne doit pas donner à un tiers l'impression qu'on
//     attend quelque chose de lui.
//  3. L'ISSUE porte le nom de qui l'a prise. C'est l'exigence centrale :
//     aucune confusion sur la personne qui valide.
//
// ⚠️ Ne JAMAIS afficher une décision sans son auteur, même par manque de
// place. Un « Validé » anonyme dans un circuit d'approbation vaut moins
// que rien : il donne une certitude que rien ne fonde.
import { useTranslation } from "@/hooks/useTranslation";
import { CheckCircle2, XCircle, AlertCircle, Info } from "lucide-react";
import { store, type ChatMessage, type Decision } from "@/context/chatstore";

interface Props {
  message: ChatMessage;
  decisions: Decision[];
  accent: string;
  muted: string;
  border: string;
  onDecide: (issue: "valide" | "refuse" | "reserve") => void;
}

// Couleur par nature d'envoi. « Pour info » reste neutre : la couleur doit
// signaler qu'on attend quelque chose, sinon elle ne signale plus rien.
const TON: Record<string, string> = {
  info: "#8a8a8a",
  avis: "#4a9eff",
  validation: "#00c853",
  approbation: "#ffa726",
};

const ISSUE_TON: Record<string, string> = {
  valide: "#00c853",
  refuse: "#ff5252",
  reserve: "#ffa726",
};

export default function ChatDemandeCard({ message, decisions, accent, muted, border, onDecide }: Props) {
  const { t } = useTranslation();
  const tag = message.tag || "info";
  const ton = TON[tag] || muted;

  // Qui est désigné, et est-ce moi ? L'annuaire donne le nom ; à défaut on
  // affiche l'empreinte tronquée plutôt que rien — mieux vaut un
  // identifiant obscur qu'une demande qui semble n'être adressée à
  // personne.
  const vise = message.destinataire
    ? store.roster.find((p) => p.fingerprint === message.destinataire)
    : null;
  const nomVise = message.destinataire
    ? (vise?.name || message.destinataire.slice(0, 8))
    : null;
  const cestMoi = !!message.destinataire && message.destinataire === store.myFingerprint;

  // Qui peut se prononcer : le destinataire désigné s'il y en a un, sinon
  // n'importe qui du fil. Même règle que l'hôte (voir server.js) — la
  // dupliquer ici n'autorise rien, elle évite d'afficher des boutons qui
  // seraient refusés.
  const peutDecider = tag !== "info" && (message.destinataire ? cestMoi : true);
  const maDecision = decisions.find((d) => d.fingerprint === store.myFingerprint);

  const dateFr = (ts: number) => new Date(ts).toLocaleString();

  return (
    <div style={{
      alignSelf: "stretch", borderRadius: 8, padding: "8px 10px",
      background: `${ton}12`, border: `1px solid ${ton}55`,
    }}>
      {/* Nature de l'envoi, et à qui elle s'adresse */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
        {tag === "info" ? <Info size={12} style={{ color: ton }} />
          : <AlertCircle size={12} style={{ color: ton }} />}
        <span style={{ fontSize: 10, fontWeight: 700, color: ton, letterSpacing: 0.4, textTransform: "uppercase" }}>
          {t(`Chat.tag_${tag}`)}
        </span>
        {nomVise && (
          <span style={{ fontSize: 10.5, color: muted }}>
            → <b style={{ color: cestMoi ? accent : "inherit" }}>
              {cestMoi ? t("Chat.demandeYou") : nomVise}
            </b>
          </span>
        )}
      </div>

      {/* Issues prises, chacune avec son auteur. C'est le cœur du besoin. */}
      {decisions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 5 }}>
          {decisions.map((d) => {
            const c = ISSUE_TON[d.issue] || muted;
            return (
              <div key={d.fingerprint} style={{ fontSize: 10.5, lineHeight: 1.5 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: c, fontWeight: 700 }}>
                  {d.issue === "valide" ? <CheckCircle2 size={11} />
                    : d.issue === "refuse" ? <XCircle size={11} />
                    : <AlertCircle size={11} />}
                  {t(`Chat.issue_${d.issue}`)}
                </span>
                <span style={{ color: muted }}>
                  {" — "}{d.sender || "?"}
                  {" · "}{dateFr(d.ts)}
                </span>
                {d.comment && (
                  <div style={{ color: muted, paddingInlineStart: 15, fontStyle: "italic" }}>
                    « {d.comment} »
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* En attente : le dire explicitement plutôt que de laisser un vide
          qu'on interprétera comme « personne n'a rien demandé ». */}
      {tag !== "info" && decisions.length === 0 && (
        <div style={{ fontSize: 10, color: muted, marginTop: 3 }}>
          {nomVise ? t("Chat.demandePendingFrom").replace("{name}", nomVise) : t("Chat.demandePending")}
        </div>
      )}

      {peutDecider && (
        <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
          {(["valide", "refuse", "reserve"] as const).map((issue) => {
            const actif = maDecision?.issue === issue;
            const c = ISSUE_TON[issue];
            return (
              <button
                key={issue}
                onClick={() => onDecide(issue)}
                disabled={store.licenceReadOnly}
                style={{
                  flex: 1, minWidth: 78, padding: "5px 8px", fontSize: 10.5, fontWeight: 600,
                  borderRadius: 5, cursor: store.licenceReadOnly ? "default" : "pointer",
                  background: actif ? `${c}28` : "transparent",
                  border: `1px solid ${actif ? c : border}`,
                  color: actif ? c : "inherit",
                  opacity: store.licenceReadOnly ? 0.5 : 1,
                }}
              >
                {t(`Chat.issue_${issue}`)}
              </button>
            );
          })}
        </div>
      )}
      {/* Se rétracter est permis, mais doit être dit : sinon on croit avoir
          ajouté une position là où on a remplacé la sienne. */}
      {maDecision && (
        <div style={{ fontSize: 9.5, color: muted, marginTop: 4 }}>{t("Chat.demandeChangeable")}</div>
      )}
    </div>
  );
}
