"use client";
// ═══════════════════════════════════════════════════════════════
// Pièces jointes — préparation côté navigateur (étape E)
// ═══════════════════════════════════════════════════════════════
// Toute la préparation se fait ICI, dans le moteur de rendu :
//   • images : redimensionnement + compression via Canvas ;
//   • vocaux : enregistrement via MediaRecorder.
// C'est ce qui permet de n'ajouter AUCUNE dépendance au projet — pas de
// sharp, pas de binaire natif (ces 19 Mio venaient justement d'être
// retirés du paquet). Chromium sait déjà tout faire.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Paperclip, Mic, Square, X } from "lucide-react";

// Une photo de téléphone fait 3 à 8 Mo ; réduite à 1600 px de côté et
// réencodée en JPEG, elle tombe à 300-800 Ko sans différence visible à
// l'écran. Le réseau local et le disque de l'hôte s'en portent mieux.
const IMAGE_MAX_SIDE = 1600;
const IMAGE_QUALITY = 0.82;
const THUMB_MAX_SIDE = 220;
const THUMB_QUALITY = 0.6;

// Types audio déjà acceptés TELS QUELS par l'hôte (chat-module/src/media.js,
// ALLOWED_MIME) — dupliqué ici volontairement : le renderer n'importe pas
// le code du module serveur. Tout fichier audio HORS de cette liste (FLAC,
// AIFF, un conteneur AAC inhabituel…) passe par convertToOpus ci-dessous
// plutôt que d'être rejeté par l'hôte sans recours.
const AUDIO_PASSTHROUGH = new Set([
  "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav",
]);

/**
 * Convertit un fichier audio QUELCONQUE (que Chromium sait décoder — WAV,
 * FLAC, AAC, MP3, la plupart des conteneurs courants) en webm/opus, déjà
 * accepté par l'hôte. Aucune dépendance ajoutée : AudioContext.decodeAudioData
 * décode, MediaRecorder ré-encode — les deux fonctionnent SANS microphone et
 * SANS contexte sécurisé (vérifié : même la page mobile, servie en http://
 * sur une IP privée, peut les utiliser).
 *
 * ⚠️ Le ré-encodage passe par une lecture en TEMPS RÉEL (MediaRecorder ne
 * sait capturer qu'un flux qui joue réellement) : convertir un fichier de
 * 3 minutes prend environ 3 minutes. Pour les formats déjà dans
 * AUDIO_PASSTHROUGH, aucune conversion n'a lieu — ce coût ne touche que les
 * formats vraiment hors liste.
 */
async function convertToOpus(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ bytes: ArrayBuffer; size: number; duration: number }> {
  const arrayBuf = await file.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuf);
  } catch {
    await ctx.close();
    throw new Error("decode");
  }

  const dest = ctx.createMediaStreamDestination();
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(dest);

  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus" : "audio/webm";
  const recorder = new MediaRecorder(dest.stream, { mimeType: mime });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" }));
    recorder.onerror = () => reject(new Error("encode"));
  });

  const duration = audioBuffer.duration;
  if (onProgress && duration > 0) {
    const t0 = Date.now();
    const timer = setInterval(() => {
      onProgress(Math.min(0.99, (Date.now() - t0) / 1000 / duration));
    }, 200);
    done.finally(() => clearInterval(timer));
  }

  recorder.start();
  source.start();
  // La conversion dure aussi longtemps que l'audio source : source.onended
  // arrive exactement quand la lecture (silencieuse — rien n'est routé vers
  // les haut-parleurs) se termine.
  await new Promise<void>((resolve) => { source.onended = () => resolve(); });
  recorder.stop();
  const blob = await done;
  await ctx.close();
  onProgress?.(1);

  const bytes = await blob.arrayBuffer();
  return { bytes, size: bytes.byteLength, duration };
}

export interface PreparedMedia {
  kind: "image" | "voice" | "file";
  mime: string;
  bytes: ArrayBuffer;
  size: number;
  name?: string;
  w?: number;
  h?: number;
  duration?: number;
  thumb?: string | null;
  previewUrl?: string;
}

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });

const drawTo = (img: HTMLImageElement, maxSide: number, quality: number, type = "image/jpeg") => {
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL(type, quality), w, h };
};

// L'hôte refuse toute vignette dépassant MAX_THUMB_BYTES (24 Ko —
// chat-module/src/media.js), et elle voyage en base64, donc gonflée d'un
// tiers. Mesuré sur ce moteur : une photo carrée très détaillée atteint
// 23,4 Ko pour 24 Ko autorisés. La marge est trop mince pour être laissée
// au hasard — une seule photo un peu plus dense et l'envoi entier est
// refusé, sans que l'utilisateur puisse comprendre pourquoi.
// On redescend donc la qualité tant que nécessaire plutôt que d'échouer.
const THUMB_MAX_BYTES = 24 * 1024;
const vignetteSousPlafond = (img: HTMLImageElement) => {
  let sortie = drawTo(img, THUMB_MAX_SIDE, THUMB_QUALITY);
  for (const q of [0.45, 0.32, 0.2]) {
    if (sortie.dataUrl.length <= THUMB_MAX_BYTES) break;
    sortie = drawTo(img, THUMB_MAX_SIDE, q);
  }
  // Dernier recours : réduire aussi les dimensions. Une vignette laide
  // vaut mieux qu'une pièce jointe refusée.
  if (sortie.dataUrl.length > THUMB_MAX_BYTES) sortie = drawTo(img, 140, 0.4);
  return sortie;
};

const dataUrlToBytes = (dataUrl: string) => {
  const b64 = dataUrl.split(",")[1] || "";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
};

/** Prépare un fichier choisi : les images sont recompressées, l'audio hors
 *  liste est converti en opus, le reste part tel quel (le serveur refusera
 *  tout type hors de sa liste). */
export async function prepareFile(
  file: File,
  onConvertProgress?: (fraction: number) => void,
): Promise<PreparedMedia> {
  if (file.type.startsWith("image/")) {
    const img = await loadImage(file);
    const full = drawTo(img, IMAGE_MAX_SIDE, IMAGE_QUALITY);
    const thumb = vignetteSousPlafond(img);
    const bytes = dataUrlToBytes(full.dataUrl);
    return {
      kind: "image", mime: "image/jpeg",
      bytes: bytes.buffer as ArrayBuffer, size: bytes.length,
      w: full.w, h: full.h, thumb: thumb.dataUrl,
      previewUrl: full.dataUrl,
      // Le nom doit décrire les octets RÉELLEMENT envoyés : on recompresse
      // toujours en JPEG, donc « photo.png » deviendrait « photo.png.jpg »
      // à l'enregistrement. On remplace l'extension d'origine.
      name: file.name.replace(/\.[^.\\/]{1,8}$/, "") + ".jpg",
    };
  }

  // ⚠️ Un WAV/MP3/M4A choisi via le trombone (donc PAS enregistré au
  // micro) tombait ici avec kind:"file" alors que son type est bien
  // audio/* — l'hôte refuse ce mélange par construction (server.js,
  // sanitizeMedia : kind:"file" exclut explicitement les MIME audio/image,
  // ce sont des catégories mutuellement exclusives). Un fichier audio
  // existant est donc un « vocal » au même titre qu'un enregistrement en
  // direct — même règle déjà appliquée côté page mobile (mobile/index.html,
  // fonction preparer).
  if (file.type.startsWith("audio/")) {
    // Déjà dans un format accepté : envoyé tel quel, aucune conversion —
    // seuls les formats VRAIMENT hors liste (FLAC, AIFF…) paient le coût
    // du décodage/ré-encodage.
    if (AUDIO_PASSTHROUGH.has(file.type)) {
      const buf = await file.arrayBuffer();
      return {
        kind: "voice", mime: file.type,
        bytes: buf, size: buf.byteLength, name: file.name, thumb: null,
        // previewUrl sur les OCTETS retenus, pas sur le fichier d'origine :
        // c'est ce qui part réellement qu'on doit pouvoir réécouter.
        previewUrl: URL.createObjectURL(new Blob([buf], { type: file.type })),
      };
    }
    const { bytes, size, duration } = await convertToOpus(file, onConvertProgress);
    return {
      kind: "voice", mime: "audio/webm",
      bytes, size, duration: Math.round(duration),
      name: file.name.replace(/\.[^.\\/]{1,8}$/, "") + ".webm",
      thumb: null,
      // Après conversion, réécouter est encore plus utile : c'est le seul
      // moyen de constater qu'un format exotique a été correctement décodé.
      previewUrl: URL.createObjectURL(new Blob([bytes], { type: "audio/webm" })),
    };
  }

  const buf = await file.arrayBuffer();
  return {
    kind: "file",
    // Un type vide (extension inconnue de Windows) serait refusé par
    // l'hôte : on le laisse tel quel, le message d'erreur sera explicite.
    mime: file.type || "application/octet-stream",
    bytes: buf, size: buf.byteLength, name: file.name, thumb: null,
  };
}

interface Props {
  accent: string;
  muted: string;
  border: string;
  disabled?: boolean;
  onPrepared: (m: PreparedMedia) => void;
  onError: (msg: string) => void;
  // Étape E (audio hors liste) — conversion en cours, avec avancement
  // 0..1 : un fichier de plusieurs minutes prend un temps comparable à
  // convertir (voir le commentaire près de convertToOpus), l'utilisateur
  // doit savoir que quelque chose se passe.
  onConverting?: (fraction: number | null) => void;
}

export default function ChatComposerMedia({ accent, muted, border, disabled, onPrepared, onError, onConverting }: Props) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const pick = () => fileInput.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-choisir le même fichier
    if (!file) return;
    // Hors liste ET pas une image : passera par convertToOpus, donc
    // potentiellement long — on prévient l'appelant pour qu'il affiche un
    // état « conversion en cours » plutôt qu'un aperçu qui semble figé.
    const vaConvertir = file.type.startsWith("audio/") && !AUDIO_PASSTHROUGH.has(file.type);
    try {
      if (vaConvertir) onConverting?.(0);
      const prepared = await prepareFile(file, vaConvertir ? (f) => onConverting?.(f) : undefined);
      onPrepared(prepared);
    } catch (err) {
      // Un échec de décodage d'IMAGE mérite son propre message. Chromium
      // déduit le type d'un fichier de son EXTENSION, pas de son contenu :
      // une photo iPhone (HEIC) enregistrée « .jpg » est donc annoncée
      // image/jpeg, puis refuse de se décoder. L'ancien message unique
      // (« l'envoi a échoué ») ne permettait à personne de comprendre —
      // ni à l'utilisateur, ni à moi.
      const motif = (err as Error)?.message;
      onError(
        motif === "decode" ? t("Chat.mediaDecodeFailed")
        : motif === "image" ? t("Chat.mediaImageFailed")
        : t("Chat.mediaFailed"),
      );
    } finally {
      if (vaConvertir) onConverting?.(null);
    }
  };

  const stopRecording = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    try { recorder.current?.stop(); } catch { /* déjà arrêté */ }
    recorder.current?.stream.getTracks().forEach((tr) => tr.stop());
    setRecording(false);
  };

  const toggleRecord = async () => {
    if (recording) { stopRecording(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // webm/opus est le format natif de Chromium — aucune conversion,
      // et il figure dans la liste des types acceptés par l'hôte.
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunks.current = [];
      startedAt.current = Date.now();
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.current.push(ev.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        if (!blob.size) return;
        const buf = await blob.arrayBuffer();
        onPrepared({
          kind: "voice", mime: "audio/webm",
          bytes: buf, size: buf.byteLength,
          duration: Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)),
          thumb: null, previewUrl: URL.createObjectURL(blob),
        });
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      // Micro refusé ou absent — message clair plutôt qu'un bouton inerte.
      onError(t("Chat.mediaMicDenied"));
    }
  };

  const btn: React.CSSProperties = {
    background: "transparent", border: `1px solid ${border}`, borderRadius: 4,
    padding: "7px 8px", cursor: disabled ? "default" : "pointer",
    color: muted, display: "flex", alignItems: "center", gap: 4,
    opacity: disabled ? 0.4 : 1, flexShrink: 0,
  };

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        onChange={onFile}
        style={{ display: "none" }}
        accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.txt,.csv,.zip"
      />
      <button onClick={pick} disabled={disabled} style={btn} title={t("Chat.mediaAttach")} aria-label={t("Chat.mediaAttach")}>
        <Paperclip size={15} />
      </button>
      <button
        onClick={toggleRecord}
        disabled={disabled}
        style={{ ...btn, color: recording ? "#ff5252" : muted, border: `1px solid ${recording ? "#ff5252" : border}` }}
        title={recording ? t("Chat.mediaStopRecording") : t("Chat.mediaRecord")}
        aria-label={recording ? t("Chat.mediaStopRecording") : t("Chat.mediaRecord")}
      >
        {recording ? <Square size={13} /> : <Mic size={15} />}
        {recording && (
          <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
        )}
      </button>
    </>
  );
}

/** Aperçu de la pièce jointe en attente, au-dessus du champ de saisie. */
export function MediaPreview({ media, onCancel, muted, border, accent }: {
  media: PreparedMedia; onCancel: () => void; muted: string; border: string; accent: string;
}) {
  const { t } = useTranslation();
  const ko = media.size < 1024 * 1024
    ? `${Math.max(1, Math.round(media.size / 1024))} Ko`
    : `${(media.size / 1024 / 1024).toFixed(1)} Mo`;

  // Une URL d'objet retient les octets en mémoire tant qu'elle n'est pas
  // révoquée. Un vocal de plusieurs mégaoctets abandonné puis refait
  // dix fois de suite finirait par peser lourd dans une session longue.
  // On la libère quand l'aperçu disparaît — envoi ou annulation.
  // ⚠️ Uniquement les URL d'OBJET : les images passent par une URL de
  // données (data:), que revokeObjectURL ne concerne pas.
  useEffect(() => {
    const url = media.previewUrl;
    if (!url || !url.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(url);
  }, [media.previewUrl]);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: 7, flexWrap: "wrap",
      border: `1px solid ${border}`, borderRadius: 4, marginBottom: 6,
    }}>
      {media.kind === "image" && media.previewUrl ? (
        <img src={media.previewUrl} alt="" style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 3, flexShrink: 0 }} />
      ) : (
        <span style={{ fontSize: 17, flexShrink: 0 }}>{media.kind === "voice" ? "🎤" : "📄"}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {media.kind === "voice"
            ? `${t("Chat.mediaVoiceMessage")} · ${media.duration}s`
            : media.name || t("Chat.mediaAttachment")}
        </div>
        <div style={{ fontSize: 10, color: muted }}>{ko}</div>
      </div>
      <button
        onClick={onCancel}
        style={{ background: "transparent", border: "none", color: muted, cursor: "pointer", padding: 3, flexShrink: 0 }}
        title={t("Chat.mediaRemove")}
        aria-label={t("Chat.mediaRemove")}
      >
        <X size={14} />
      </button>
      {/* Se réécouter AVANT d'envoyer. Sans cela, on dicte une consigne de
          deux minutes sans savoir si le micro a capté — et un vocal, une
          fois parti, ne se rattrape pas. Après une conversion de format,
          c'est en outre le seul moyen de constater que le décodage a
          réellement abouti.
          Sur toute la largeur, sous la ligne : un lecteur comprimé entre
          l'icône et le bouton de suppression serait inutilisable. */}
      {media.kind === "voice" && media.previewUrl && (
        <audio
          controls
          src={media.previewUrl}
          preload="metadata"
          style={{ width: "100%", height: 32, marginTop: 2 }}
        />
      )}
    </div>
  );
}
