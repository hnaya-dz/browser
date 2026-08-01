"use client";
// ═══════════════════════════════════════════════════════════════
// Affichage d'une pièce jointe reçue (étape E)
// ═══════════════════════════════════════════════════════════════
// La VIGNETTE arrive dans le message lui-même : une image s'affiche donc
// instantanément, y compris dans l'historique, sans aucun aller-retour
// réseau. Le fichier complet n'est demandé à l'hôte que si l'utilisateur
// l'ouvre — c'est tout l'intérêt de n'avoir mis que des métadonnées dans
// le message (voir chat-module/src/media.js).

import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Download, Play, FileText, ImageOff } from "lucide-react";
import { getApi } from "@/context/chatstore";

export interface MediaMeta {
  kind: "image" | "voice" | "file";
  mime: string;
  sha256: string;
  size: number;
  thumb?: string | null;
  w?: number | null;
  h?: number | null;
  duration?: number | null;
  name?: string | null;
}

const humanSize = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`;

const humanDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function ChatMediaBubble({ media, muted, border, accent }: {
  media: MediaMeta; muted: string; border: string; accent: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  // Télécharge le contenu réel depuis l'hôte, à la demande.
  const load = async (): Promise<string | null> => {
    if (objectUrl) return objectUrl;
    setBusy(true); setError("");
    try {
      const res = await getApi()?.invoke?.("chat-media-download", { sha256: media.sha256, mime: media.mime });
      if (!res?.ok) {
        setError(res?.error === "gone" ? t("Chat.mediaGone")
          : res?.error === "integrity" ? t("Chat.mediaIntegrity")
          : t("Chat.mediaFailed"));
        return null;
      }
      const url = URL.createObjectURL(new Blob([res.bytes], { type: media.mime }));
      setObjectUrl(url);
      return url;
    } catch {
      setError(t("Chat.mediaFailed"));
      return null;
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setError("");
    try {
      const res = await getApi()?.invoke?.("chat-media-save", {
        sha256: media.sha256, mime: media.mime, name: media.name || undefined,
      });
      if (!res?.ok && res?.error !== "canceled") setError(t("Chat.mediaFailed"));
    } finally { setBusy(false); }
  };

  const box: React.CSSProperties = {
    marginTop: 5, border: `1px solid ${border}`, borderRadius: 4, overflow: "hidden",
  };

  // ── Image : vignette immédiate, plein format au clic ──────────────
  if (media.kind === "image") {
    return (
      <div style={{ marginTop: 5 }}>
        {media.thumb ? (
          <img
            src={objectUrl || media.thumb}
            alt=""
            onClick={async () => { const u = await load(); if (u) window.open(u, "_blank"); }}
            style={{
              maxWidth: "100%", maxHeight: 220, borderRadius: 4, display: "block",
              cursor: "pointer", border: `1px solid ${border}`,
              opacity: busy ? 0.6 : 1, transition: "opacity .15s",
            }}
            title={t("Chat.mediaOpenFull")}
          />
        ) : (
          <div style={{ ...box, padding: 10, display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: muted }}>
            <ImageOff size={14} /> {t("Chat.mediaNoPreview")}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
          <span style={{ fontSize: 10, color: muted }}>{humanSize(media.size)}</span>
          <button
            onClick={save} disabled={busy}
            style={{ background: "transparent", border: "none", color: muted, cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", gap: 3, padding: 0 }}
            title={t("Chat.mediaSave")}
          >
            <Download size={11} /> {t("Chat.mediaSave")}
          </button>
        </div>
        {error && <div style={{ fontSize: 10.5, color: "#ff8080", marginTop: 3 }}>{error}</div>}
      </div>
    );
  }

  // ── Vocal : lecteur audio natif, chargé au premier clic ───────────
  if (media.kind === "voice") {
    return (
      <div style={{ ...box, padding: 8 }}>
        {objectUrl ? (
          <audio controls src={objectUrl} style={{ width: "100%", height: 32 }} />
        ) : (
          <button
            onClick={load} disabled={busy}
            style={{
              display: "flex", alignItems: "center", gap: 7, width: "100%",
              background: "transparent", border: "none", cursor: "pointer",
              color: accent, fontSize: 12, padding: 0,
            }}
          >
            <Play size={14} />
            <span>{t("Chat.mediaVoiceMessage")}</span>
            <span style={{ color: muted, fontSize: 11 }}>
              {media.duration ? humanDuration(media.duration) : humanSize(media.size)}
            </span>
            {busy && <span style={{ color: muted, fontSize: 11 }}>…</span>}
          </button>
        )}
        {error && <div style={{ fontSize: 10.5, color: "#ff8080", marginTop: 4 }}>{error}</div>}
      </div>
    );
  }

  // ── Document : carte téléchargeable, jamais d'ouverture automatique ──
  // L'application n'ouvre PAS le fichier elle-même : elle l'enregistre et
  // laisse Windows décider, avec ses propres protections (un .docx peut
  // contenir des macros).
  return (
    <div style={{ ...box, padding: 9, display: "flex", alignItems: "center", gap: 9 }}>
      <FileText size={18} style={{ flexShrink: 0, color: accent }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {media.name || t("Chat.mediaAttachment")}
        </div>
        <div style={{ fontSize: 10, color: muted }}>{humanSize(media.size)}</div>
        {error && <div style={{ fontSize: 10.5, color: "#ff8080", marginTop: 2 }}>{error}</div>}
      </div>
      <button
        onClick={save} disabled={busy}
        style={{
          background: "transparent", border: `1px solid ${border}`, borderRadius: 4,
          padding: "5px 9px", cursor: busy ? "default" : "pointer", color: muted,
          fontSize: 10.5, display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
        }}
        title={t("Chat.mediaSave")}
      >
        <Download size={12} /> {busy ? "…" : t("Chat.mediaSave")}
      </button>
    </div>
  );
}
