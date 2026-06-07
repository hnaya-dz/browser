"use client";
import { useEffect, useState, useCallback } from "react";

type DlState = "fetching" | "ready" | "downloading" | "done" | "error";

interface VideoInfo {
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  extractor: string | null;
}

interface DownloadPanelProps {
  url: string;
  onClose: () => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Détecter le thème actif depuis la classe sur <html>
function getTheme(): "dark" | "light" | "sunset" {
  if (typeof document === "undefined") return "dark";
  const cls = document.documentElement.classList;
  if (cls.contains("sunset")) return "sunset";
  if (cls.contains("light")) return "light";
  return "dark";
}

// Palettes selon le thème
const THEMES = {
  dark: {
    overlay: "rgba(0,0,0,0.65)",
    panel: "#0d1a12",
    border: "rgba(255,255,255,0.1)",
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.5)",
    inputBg: "rgba(255,255,255,0.08)",
    inputBorder: "rgba(255,255,255,0.15)",
    inputColor: "#fff",
    btnPrimary: "linear-gradient(135deg,#006341,#004d30)",
    btnPrimaryColor: "#fff",
    btnSecondaryBg: "rgba(255,255,255,0.08)",
    btnSecondaryBorder: "rgba(255,255,255,0.15)",
    btnSecondaryColor: "#fff",
    progressBg: "rgba(255,255,255,0.1)",
    progressFill: "linear-gradient(90deg,#006341,#00a86b)",
    folderBg: "rgba(255,255,255,0.06)",
    folderBorder: "rgba(255,255,255,0.12)",
  },
  light: {
    overlay: "rgba(0,0,0,0.4)",
    panel: "#ffffff",
    border: "rgba(0,99,65,0.15)",
    text: "#1a2e22",
    textMuted: "rgba(0,60,30,0.5)",
    inputBg: "rgba(0,99,65,0.05)",
    inputBorder: "rgba(0,99,65,0.2)",
    inputColor: "#1a2e22",
    btnPrimary: "linear-gradient(135deg,#006341,#004d30)",
    btnPrimaryColor: "#fff",
    btnSecondaryBg: "rgba(0,99,65,0.08)",
    btnSecondaryBorder: "rgba(0,99,65,0.2)",
    btnSecondaryColor: "#006341",
    progressBg: "rgba(0,99,65,0.1)",
    progressFill: "linear-gradient(90deg,#006341,#00a86b)",
    folderBg: "rgba(0,99,65,0.04)",
    folderBorder: "rgba(0,99,65,0.15)",
  },
  sunset: {
    overlay: "rgba(0,0,0,0.7)",
    panel: "#1a0500",
    border: "rgba(255,80,20,0.25)",
    text: "#ffd4a0",
    textMuted: "rgba(255,150,80,0.55)",
    inputBg: "rgba(60,5,0,0.5)",
    inputBorder: "rgba(255,80,20,0.25)",
    inputColor: "#ffd4a0",
    btnPrimary: "linear-gradient(135deg,#c83200,#8a1a00)",
    btnPrimaryColor: "#fff",
    btnSecondaryBg: "rgba(255,80,20,0.1)",
    btnSecondaryBorder: "rgba(255,80,20,0.2)",
    btnSecondaryColor: "#ffb060",
    progressBg: "rgba(255,80,20,0.15)",
    progressFill: "linear-gradient(90deg,#c83200,#ff6030)",
    folderBg: "rgba(60,5,0,0.4)",
    folderBorder: "rgba(255,80,20,0.2)",
  },
};

export default function DownloadPanel({ url, onClose }: DownloadPanelProps) {
  const [state, setState] = useState<DlState>("fetching");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [folder, setFolder] = useState<string>("");
  const [progress, setProgress] = useState<{ percent: number; size: string; speed: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [doneFolder, setDoneFolder] = useState<string>("");
  const theme = THEMES[getTheme()];

  // Récupérer les infos vidéo au montage
  useEffect(() => {
    setState("fetching");
    const api = (window as any).electronAPI;
    if (!api?.invoke) {
      setErrorMsg("API Electron non disponible.");
      setState("error");
      return;
    }
    api.invoke("get-video-info", url).then((result: any) => {
      if (result?.error) {
        setErrorMsg(result.error);
        setState("error");
      } else if (result?.title) {
        setInfo(result);
        setState("ready");
      } else {
        setErrorMsg("Réponse inattendue de yt-dlp.");
        setState("error");
      }
    }).catch((err: any) => {
      setErrorMsg(err?.message || "Erreur lors de l'analyse.");
      setState("error");
    });
  }, [url]);

  // Écouter progression et fin
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    const onProgress = (data: any) => setProgress(data);
    const onDone = (data: any) => {
      if (data.success) { setDoneFolder(data.folder || ""); setState("done"); }
      else { setErrorMsg(data.error || "Erreur inconnue."); setState("error"); }
    };
    api.receive("download-progress", onProgress);
    api.receive("download-done", onDone);
    return () => {
      api.removeListener("download-progress", onProgress);
      api.removeListener("download-done", onDone);
    };
  }, []);

  const handleChooseFolder = useCallback(async () => {
    const chosen = await (window as any).electronAPI?.invoke("choose-download-folder");
    if (chosen) setFolder(chosen);
  }, []);

  const handleDownload = useCallback(() => {
    if (!folder) return;
    setState("downloading");
    setProgress(null);
    (window as any).electronAPI?.send("download-video", { url, outputFolder: folder });
  }, [url, folder]);

  // Styles inline — indépendants des classes CSS thème
  const panelStyle: React.CSSProperties = {
    width: 480,
    maxWidth: "92vw",
    borderRadius: 20,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    backgroundColor: theme.panel,
    border: `1px solid ${theme.border}`,
    color: theme.text,
    boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: theme.overlay,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={panelStyle}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, flex: 1, color: theme.text }}>
            {state === "fetching" && "Analyse de la vidéo…"}
            {state === "ready" && "Télécharger la vidéo"}
            {state === "downloading" && "Téléchargement en cours…"}
            {state === "done" && "✅ Téléchargement terminé !"}
            {state === "error" && "⚠️ Erreur"}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: theme.textMuted, lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* FETCHING */}
        {state === "fetching" && (
          <div style={{ padding: "24px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              border: `3px solid ${theme.progressBg}`,
              borderTopColor: "#006341",
              animation: "dl-spin 0.8s linear infinite",
            }} />
            <style>{`@keyframes dl-spin { to { transform: rotate(360deg); } }`}</style>
            <span style={{ fontSize: 12, color: theme.textMuted }}>Connexion à yt-dlp…</span>
          </div>
        )}

        {/* READY */}
        {state === "ready" && info && (
          <>
            {info.thumbnail && (
              <img src={info.thumbnail} alt="" style={{ width: "100%", borderRadius: 12, objectFit: "cover", maxHeight: 200 }} />
            )}
            <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.4, color: theme.text }}>{info.title}</div>
            <div style={{ fontSize: 12, color: theme.textMuted, display: "flex", gap: 12, flexWrap: "wrap" }}>
              {info.uploader && <span>📺 {info.uploader}</span>}
              {info.duration && <span>⏱ {formatDuration(info.duration)}</span>}
              {info.extractor && <span>🌐 {info.extractor}</span>}
              <span>🎬 MP4</span>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>
                Dossier de destination
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, fontSize: 12, padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.folderBorder}`, background: theme.folderBg, color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {folder || "Aucun dossier sélectionné"}
                </div>
                <button onClick={handleChooseFolder} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${theme.btnSecondaryBorder}`, background: theme.btnSecondaryBg, color: theme.btnSecondaryColor, fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                  📁 Choisir
                </button>
              </div>
            </div>

            <button
              onClick={handleDownload}
              disabled={!folder}
              style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: folder ? theme.btnPrimary : "rgba(128,128,128,0.3)", color: folder ? theme.btnPrimaryColor : "rgba(255,255,255,0.3)", fontWeight: 700, fontSize: 14, cursor: folder ? "pointer" : "not-allowed" }}
            >
              ⬇️ Télécharger en MP4
            </button>
          </>
        )}

        {/* DOWNLOADING */}
        {state === "downloading" && (
          <>
            {info && <div style={{ fontWeight: 600, fontSize: 13, color: theme.textMuted }}>{info.title}</div>}
            <div style={{ width: "100%", height: 8, borderRadius: 99, background: theme.progressBg, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 99, background: theme.progressFill, width: `${progress?.percent ?? 0}%`, transition: "width 0.3s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: theme.textMuted }}>
              <span>{progress ? `${progress.percent.toFixed(1)}%` : "Démarrage…"}</span>
              <span>{progress ? `${progress.speed} · ${progress.size}` : ""}</span>
            </div>
            <div style={{ fontSize: 11, color: theme.textMuted, textAlign: "center" }}>
              Ne fermez pas ce panneau pendant le téléchargement
            </div>
          </>
        )}

        {/* DONE */}
        {state === "done" && (
          <>
            <div style={{ fontSize: 40, textAlign: "center" }}>✅</div>
            <div style={{ textAlign: "center", fontSize: 14, fontWeight: 600, color: theme.text }}>Vidéo téléchargée avec succès !</div>
            {doneFolder && <div style={{ fontSize: 11, color: theme.textMuted, textAlign: "center" }}>Enregistré dans : {doneFolder}</div>}
            <button onClick={onClose} style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: theme.btnPrimary, color: theme.btnPrimaryColor, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Fermer
            </button>
          </>
        )}

        {/* ERROR */}
        {state === "error" && (
          <>
            <div style={{ fontSize: 40, textAlign: "center" }}>⚠️</div>
            <div style={{ fontSize: 13, color: theme.textMuted, textAlign: "center" }}>{errorMsg}</div>
            <button onClick={onClose} style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${theme.btnSecondaryBorder}`, background: theme.btnSecondaryBg, color: theme.btnSecondaryColor, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Fermer
            </button>
          </>
        )}
      </div>
    </div>
  );
}
