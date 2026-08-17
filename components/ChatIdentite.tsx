"use client";
// ═══════════════════════════════════════════════════════════════
// Bloc d'identité — le pseudo ET la photo, au même endroit
// ═══════════════════════════════════════════════════════════════
// Les deux disaient la même chose — qui vous êtes — et vivaient pourtant
// à deux endroits séparés : le pseudo en champ de saisie sur l'écran
// d'accueil, la photo dans l'en-tête de l'annuaire. Réunis ici, ils
// tiennent sur une ligne et libèrent les deux écrans.
//
// ⚠️ LA PHOTO EXIGE UNE CONNEXION. Elle est téléversée vers l'hôte du
// salon (chat-media-upload), puis rattachée à la personne (chat-set-avatar).
// Hors salon, il n'y a nulle part où l'envoyer : le bouton est alors
// absent plutôt que présent et inopérant. C'est aussi pourquoi ce bloc
// s'emploie aux deux endroits avec `connecte` différent.
//
// Le fichier choisi ne part JAMAIS tel quel : il est recadré et réencodé
// en JPEG par le navigateur (preparerPhoto), ce qui écarte au passage les
// métadonnées EXIF — position GPS comprise.

import { useRef, useState } from "react";
import { Camera, User } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { getApi, store } from "@/context/chatstore";
import ChatAvatar, { preparerPhoto } from "./ChatAvatar";

interface Props {
  pseudo: string;
  /** Absent = pas de lien « Modifier ». Dans un salon, le pseudo est celui
   *  sous lequel on s'est raccordé : le changer suppose de ressortir, on ne
   *  propose donc pas un lien qui mentirait sur ce qu'il fait. */
  onChangerPseudo?: () => void;
  /** Dans un salon : la photo peut être envoyée. Sinon, elle est masquée. */
  connecte: boolean;
  accent: string;
  muted: string;
  border: string;
  text: string;
}

export default function ChatIdentite({ pseudo, onChangerPseudo, connecte, accent, muted, border, text }: Props) {
  const { t } = useTranslation();
  const fichierRef = useRef<HTMLInputElement>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");

  const moi = store.roster.find((p) => p.isMe);
  const maPhoto = moi?.avatarSha || null;

  const deposerPhoto = async (fichier: File) => {
    setOccupe(true); setErreur("");
    try {
      const bytes = await preparerPhoto(fichier);
      const up = await getApi()?.invoke?.("chat-media-upload", {
        bytes, kind: "image", mime: "image/jpeg", thumb: null,
      });
      if (!up?.ok) { setErreur(t("Chat.avatarFailed")); return; }
      getApi()?.send?.("chat-set-avatar", { sha256: up.sha256 });
      // L'hôte prévient tout le salon ; on redemande l'annuaire pour se
      // voir soi-même changer sans attendre.
      setTimeout(() => getApi()?.send?.("chat-roster"), 400);
    } catch {
      setErreur(t("Chat.avatarFailed"));
    } finally {
      setOccupe(false);
    }
  };

  const retirerPhoto = () => {
    getApi()?.send?.("chat-set-avatar", { sha256: null });
    setTimeout(() => getApi()?.send?.("chat-roster"), 400);
  };

  const lienStyle: React.CSSProperties = {
    background: "transparent", border: "none", color: accent, cursor: "pointer",
    padding: 0, fontSize: 11, textDecoration: "underline", flexShrink: 0,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {connecte && moi ? (
          <ChatAvatar personId={moi.personId || moi.fingerprint} name={pseudo} avatarSha={maPhoto} size={26} />
        ) : (
          <User size={14} style={{ color: muted, flexShrink: 0 }} />
        )}

        <span style={{
          flex: 1, minWidth: 0, fontSize: 11.5, color: muted,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {t("Chat.identityAs")} <b style={{ color: text }}>{pseudo}</b>
        </span>

        {connecte && (
          <button
            onClick={() => fichierRef.current?.click()}
            disabled={occupe}
            title={t("Chat.avatarChange")}
            style={{
              background: "transparent", border: `1px solid ${border}`, borderRadius: 4,
              color: "inherit", cursor: occupe ? "default" : "pointer", fontSize: 10,
              padding: "3px 6px", display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
            }}
          >
            <Camera size={11} /> {occupe ? "…" : t("Chat.avatarChange")}
          </button>
        )}

        {onChangerPseudo && (
          <button onClick={onChangerPseudo} style={lienStyle}>
            {t("Chat.nicknameChange")}
          </button>
        )}
      </div>

      {connecte && maPhoto && (
        <button
          onClick={retirerPhoto}
          disabled={occupe}
          style={{ ...lienStyle, color: muted, alignSelf: "flex-start", fontSize: 10 }}
        >
          {t("Chat.avatarRemove")}
        </button>
      )}

      {erreur && <div style={{ fontSize: 10, color: "#ff5252" }}>{erreur}</div>}

      <input
        ref={fichierRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) deposerPhoto(f);
        }}
      />
    </div>
  );
}
