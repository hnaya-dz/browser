"use client";
// ═══════════════════════════════════════════════════════════════
// Bloc d'identité — le pseudo ET la photo, au même endroit
// ═══════════════════════════════════════════════════════════════
// Les deux disaient la même chose — qui vous êtes — et vivaient pourtant
// à deux endroits séparés : le pseudo en champ de saisie sur l'écran
// d'accueil, la photo dans l'en-tête de l'annuaire. Réunis ici, ils
// tiennent sur une ligne et libèrent les deux écrans.
//
// ⚠️ LA PHOTO EXIGE UNE CONNEXION POUR PARTIR, PAS POUR ÊTRE CHOISIE.
// Elle est téléversée vers l'hôte du salon (chat-media-upload) puis
// rattachée à la personne (chat-set-avatar) : hors salon, il n'y a nulle
// part où l'envoyer. Le bouton était donc masqué — et l'on cherchait où
// régler sa photo, retour d'usage à l'appui. Elle est désormais RETENUE
// (CLE_AVATAR_ATTENTE), et ChatPanel l'applique à l'entrée dans un salon.
//
// Le fichier choisi ne part JAMAIS tel quel : il est recadré et réencodé
// en JPEG par le navigateur (preparerPhoto), ce qui écarte au passage les
// métadonnées EXIF — position GPS comprise.

import { useRef, useState } from "react";
import { Camera, User } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { getApi, store } from "@/context/chatstore";
import ChatAvatar, { preparerPhoto } from "./ChatAvatar";

// ⚠️ PHOTO CHOISIE HORS SALON : RETENUE, PUIS APPLIQUÉE À L'ENTRÉE.
// Elle doit être téléversée vers l'hôte du salon ; hors salon, il n'y a
// nulle part où l'envoyer. Plutôt que de masquer le bouton — et de laisser
// chercher où règler sa photo, ce qui est arrivé — on retient l'image et
// on l'applique dès qu'un salon est rejoint.
// Le format s'y prête : 128×128 en JPEG, quelques kilo-octets, très en
// dessous de ce que localStorage accepte. Ce sont les octets DÉJÀ recadrés
// et réencodés par preparerPhoto qu'on garde — jamais le fichier d'origine.
export const CLE_AVATAR_ATTENTE = "hnaya-chat-avatar-attente";

/** Les octets en attente, ou null. Exporté : c'est ChatPanel qui les
 *  applique, une fois l'annuaire reçu (donc une fois vraiment dans le salon). */
export function avatarEnAttente(): Uint8Array | null {
  try {
    const b64 = localStorage.getItem(CLE_AVATAR_ATTENTE);
    if (!b64) return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

export function oublierAvatarEnAttente() {
  try { localStorage.removeItem(CLE_AVATAR_ATTENTE); } catch { /* quota, mode privé */ }
}

function retenirAvatar(bytes: Uint8Array): string | null {
  try {
    // Boucle indexée et non `for…of` : la cible TypeScript du projet
    // n'autorise pas l'itération directe d'un Uint8Array.
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    localStorage.setItem(CLE_AVATAR_ATTENTE, b64);
    return "data:image/jpeg;base64," + b64;
  } catch { return null; }
}

interface Props {
  pseudo: string;
  /** Absent = pas de lien « Modifier ». Dans un salon, le pseudo est celui
   *  sous lequel on s'est raccordé : le changer suppose de ressortir, on ne
   *  propose donc pas un lien qui mentirait sur ce qu'il fait. */
  onChangerPseudo?: () => void;
  /** Dans un salon : la photo part tout de suite. Sinon : retenue, puis
   *  appliquée à l'entrée. Le bouton est présent dans les deux cas. */
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
  // Aperçu local de la photo retenue hors salon : sans lui, on cliquerait
  // sans rien voir se produire, et l'on croirait que ça n'a pas marché.
  const [apercu, setApercu] = useState<string | null>(() => {
    try {
      const b64 = localStorage.getItem(CLE_AVATAR_ATTENTE);
      return b64 ? "data:image/jpeg;base64," + b64 : null;
    } catch { return null; }
  });

  const moi = store.roster.find((p) => p.isMe);
  const maPhoto = moi?.avatarSha || null;

  const deposerPhoto = async (fichier: File) => {
    setOccupe(true); setErreur("");
    try {
      const bytes = await preparerPhoto(fichier);
      // Hors salon : on retient, et ChatPanel appliquera à l'entrée.
      if (!connecte) {
        const apercuData = retenirAvatar(bytes);
        if (!apercuData) { setErreur(t("Chat.avatarFailed")); return; }
        setApercu(apercuData);
        return;
      }
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
        ) : apercu ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={apercu} alt="" width={26} height={26}
               style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <User size={14} style={{ color: muted, flexShrink: 0 }} />
        )}

        <span style={{
          flex: 1, minWidth: 0, fontSize: 11.5, color: muted,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {t("Chat.identityAs")} <b style={{ color: text }}>{pseudo}</b>
        </span>

        {/* Le bouton est là DANS LES DEUX CAS. Hors salon, la photo est
            simplement retenue jusqu'à l'entrée — voir CLE_AVATAR_ATTENTE.
            Le masquer poussait à la chercher ailleurs. */}
        {(
          <button
            onClick={() => fichierRef.current?.click()}
            disabled={occupe}
            title={connecte ? t("Chat.avatarChange") : t("Chat.avatarPending")}
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

      {/* Le dock ne fait que 340 px : cette mention vit sous la ligne,
          pas dedans, sinon elle pousse le lien « Modifier » hors du champ. */}
      {!connecte && apercu && (
        <span style={{ fontSize: 9.5, color: muted, lineHeight: 1.4 }}>{t("Chat.avatarPending")}</span>
      )}

      {(connecte ? maPhoto : apercu) && (
        <button
          onClick={() => {
            if (connecte) { retirerPhoto(); return; }
            oublierAvatarEnAttente();
            setApercu(null);
          }}
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
