"use client";
// ═══════════════════════════════════════════════════════════════
// Étape M — pastille d'identité : initiales, ou photo si elle existe
// ═══════════════════════════════════════════════════════════════
// L'avatar par défaut n'est PAS un fichier : ni image générique livrée
// avec l'application, ni silhouette grise identique pour tout le monde —
// qui ne distingue personne et n'aide donc à rien.
//
// Les initiales sur une couleur DÉRIVÉE de l'identifiant de la personne
// donnent trois choses gratuitement : c'est toujours disponible (aucun
// réseau, aucun octet stocké), c'est stable (la même personne garde sa
// couleur d'une session à l'autre, d'un poste à l'autre), et c'est
// distinctif (deux collègues se repèrent du coin de l'œil).
//
// ⚠️ La couleur vient de l'identifiant de PERSONNE, jamais du pseudo :
// quelqu'un qui corrige une faute dans son nom ne doit pas changer de
// couleur, sinon le repère visuel ne vaut rien.

import { useEffect, useState } from "react";
import { getApi } from "@/context/chatstore";

// ── Cache des photos, partagé par tous les avatars ─────────────────────
// L'annuaire ne transporte que des empreintes : chaque photo est
// téléchargée UNE fois puis gardée. Sans ce cache, une liste de trente
// personnes redemanderait trente fichiers à chaque changement de présence
// — plusieurs fois par minute dans un service actif.
//
// La clé est l'empreinte du contenu : une photo remplacée a une empreinte
// différente, donc l'ancienne entrée n'est jamais servie à tort. Rien à
// invalider, jamais.
const cachePhotos = new Map<string, string>();   // sha256 -> URL d'objet
const enCours = new Map<string, Promise<string | null>>();

async function chargerPhoto(sha: string): Promise<string | null> {
  if (cachePhotos.has(sha)) return cachePhotos.get(sha)!;
  if (enCours.has(sha)) return enCours.get(sha)!;
  const p = (async () => {
    try {
      const res = await getApi()?.invoke?.("chat-media-download", { sha256: sha, mime: "image/jpeg" });
      if (!res?.ok) return null;
      const url = URL.createObjectURL(new Blob([res.bytes], { type: "image/jpeg" }));
      cachePhotos.set(sha, url);
      return url;
    } catch {
      return null;
    } finally {
      enCours.delete(sha);
    }
  })();
  enCours.set(sha, p);
  return p;
}

/** URL locale de la photo, ou null tant qu'elle n'est pas là. Les
 *  initiales s'affichent pendant ce temps : jamais de trou. */
export function usePhotoDeProfil(sha: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (sha ? cachePhotos.get(sha) || null : null));
  useEffect(() => {
    if (!sha) { setUrl(null); return; }
    const dejaLa = cachePhotos.get(sha);
    if (dejaLa) { setUrl(dejaLa); return; }
    let vivant = true;
    chargerPhoto(sha).then((u) => { if (vivant) setUrl(u); });
    return () => { vivant = false; };
  }, [sha]);
  return url;
}

// ── Préparation d'une photo choisie par l'utilisateur ──────────────────
/** Recadre au carré (centre), redimensionne et RÉENCODE en JPEG.
 *
 *  ⚠️ On ne transmet JAMAIS le fichier d'origine. Le réencodage par Canvas
 *  garantit qu'on ne sert que des octets qu'on a fabriqués : ni métadonnées
 *  EXIF (qui portent souvent la position GPS de la prise de vue), ni charge
 *  utile cachée dans un format mal formé. Et 128 px suffisent largement à
 *  une pastille de 30 px, y compris sur un écran à forte densité. */
export const TAILLE_AVATAR = 128;

export function preparerPhoto(fichier: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error("lecture"));
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("image"));
      img.onload = () => {
        const cote = Math.min(img.width, img.height);
        const cnv = document.createElement("canvas");
        cnv.width = TAILLE_AVATAR;
        cnv.height = TAILLE_AVATAR;
        const ctx = cnv.getContext("2d");
        if (!ctx) { reject(new Error("canvas")); return; }
        // Carré central : un portrait recadré par le haut couperait les
        // visages, un recadrage centré les garde dans la plupart des cas.
        ctx.drawImage(img, (img.width - cote) / 2, (img.height - cote) / 2, cote, cote,
                      0, 0, TAILLE_AVATAR, TAILLE_AVATAR);
        cnv.toBlob((blob) => {
          if (!blob) { reject(new Error("encodage")); return; }
          blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))).catch(reject);
        }, "image/jpeg", 0.85);
      };
      img.src = String(lecteur.result);
    };
    lecteur.readAsDataURL(fichier);
  });
}

interface Props {
  /** Identifiant stable de la personne — source de la couleur. */
  personId: string;
  /** Pseudo affiché, source des initiales. */
  name: string | null;
  /** Empreinte de la photo. Absente, ou pas encore téléchargée = initiales.
   *  Le composant va chercher les octets lui-même, une seule fois. */
  avatarSha?: string | null;
  size?: number;
  /** Pastille de présence, si l'appelant veut la montrer ici. */
  online?: boolean;
}

// ⚠️ PALETTE DISCRÈTE, et non une teinte calculée librement sur 360°.
// Première version : hue = hachage % 360. Sur quatre personnes réelles,
// trois ont reçu des turquoises presque identiques (168°, 172°, 176°) —
// impossibles à distinguer d'un coup d'œil, ce qui vide l'avatar de son
// intérêt. Deux couleurs IDENTIQUES sont moins gênantes que deux couleurs
// PRESQUE identiques : la quasi-ressemblance fait douter, la ressemblance
// franche fait lire le nom.
//
// Douze teintes écartées d'au moins 25°, sur deux niveaux de clarté : 24
// pastilles nettement séparées. La clarté reste basse pour que du texte
// blanc passe dessus, thème sombre comme thème clair.
const TEINTES = [0, 30, 60, 95, 130, 160, 190, 215, 245, 275, 305, 335];
const CLARTES = [38, 29];

/** Couleur stable tirée de l'identifiant. FNV-1a plutôt qu'un
 *  `h * 31 + c` : les empreintes sont hexadécimales, donc des caractères
 *  d'une plage étroite, que le hachage naïf disperse mal. */
export function couleurDePersonne(personId: string): string {
  const s = String(personId || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = Math.abs(h);
  return `hsl(${TEINTES[n % TEINTES.length]} 45% ${CLARTES[(n >>> 8) % CLARTES.length]}%)`;
}

/** Une ou deux initiales. Fonctionne aussi en arabe, où toUpperCase ne
 *  fait rien de nuisible — on ne prend que le premier caractère de chaque
 *  mot, sans supposer d'alphabet. */
export function initialesDe(name: string | null): string {
  const mots = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return "?";
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return (mots[0][0] + mots[1][0]).toUpperCase();
}

export default function ChatAvatar({ personId, name, avatarSha, size = 30, online }: Props) {
  const fond = couleurDePersonne(personId);
  const src = usePhotoDeProfil(avatarSha);
  return (
    <span style={{ position: "relative", flexShrink: 0, lineHeight: 0 }}>
      <span
        aria-hidden
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: size, height: size, borderRadius: "50%", overflow: "hidden",
          background: src ? "transparent" : fond,
          color: "#fff", fontSize: Math.round(size * 0.38), fontWeight: 700,
          letterSpacing: 0.2, userSelect: "none",
        }}
      >
        {src
          ? <img src={src} alt="" width={size} height={size}
                 style={{ width: size, height: size, objectFit: "cover", display: "block" }} />
          : initialesDe(name)}
      </span>
      {online !== undefined && (
        <span style={{
          position: "absolute", right: -1, bottom: -1,
          width: Math.max(8, Math.round(size * 0.28)),
          height: Math.max(8, Math.round(size * 0.28)),
          borderRadius: "50%", background: online ? "#00c853" : "#6b6b6b",
          border: "2px solid rgba(0,0,0,0.45)",
        }} />
      )}
    </span>
  );
}
