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

import { useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Paperclip, Mic, Square, X } from "lucide-react";

// Une photo de téléphone fait 3 à 8 Mo ; réduite à 1600 px de côté et
// réencodée en JPEG, elle tombe à 300-800 Ko sans différence visible à
// l'écran. Le réseau local et le disque de l'hôte s'en portent mieux.
const IMAGE_MAX_SIDE = 1600;
const IMAGE_QUALITY = 0.82;
const THUMB_MAX_SIDE = 220;
const THUMB_QUALITY = 0.6;

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

const dataUrlToBytes = (dataUrl: string) => {
  const b64 = dataUrl.split(",")[1] || "";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
};

/** Prépare un fichier choisi : les images sont recompressées, le reste
 *  part tel quel (le serveur refusera tout type hors de sa liste). */
export async function prepareFile(file: File): Promise<PreparedMedia> {
  if (file.type.startsWith("image/")) {
    const img = await loadImage(file);
    const full = drawTo(img, IMAGE_MAX_SIDE, IMAGE_QUALITY);
    const thumb = drawTo(img, THUMB_MAX_SIDE, THUMB_QUALITY);
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
  const buf = await file.arrayBuffer();
  // ⚠️ Un WAV/MP3/M4A choisi via le trombone (donc PAS enregistré au
  // micro) tombait ici avec kind:"file" alors que son type est bien
  // audio/* — l'hôte refuse ce mélange par construction (server.js,
  // sanitizeMedia : kind:"file" exclut explicitement les MIME audio/image,
  // ce sont des catégories mutuellement exclusives). Un fichier audio
  // existant est donc un « vocal » au même titre qu'un enregistrement en
  // direct — même règle déjà appliquée côté page mobile (mobile/index.html,
  // fonction preparer).
  const estAudio = file.type.startsWith("audio/");
  return {
    kind: estAudio ? "voice" : "file",
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
}

export default function ChatComposerMedia({ accent, muted, border, disabled, onPrepared, onError }: Props) {
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
    try {
      onPrepared(await prepareFile(file));
    } catch {
      onError(t("Chat.mediaFailed"));
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
        style={{ ...btn, color: recording ? "#ff5252" : muted, borderColor: recording ? "#ff5252" : border }}
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
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: 7,
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
    </div>
  );
}
