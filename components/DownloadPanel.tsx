"use client";
import { useEffect, useState, useCallback } from "react";

type DlState = "fetching" | "ready" | "downloading" | "done" | "error";
type Quality = "fast" | "hq";

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

function getTheme(): "dark" | "light" | "sunset" {
  if (typeof document === "undefined") return "dark";
  const cls = document.documentElement.classList;
  if (cls.contains("sunset")) return "sunset";
  if (cls.contains("light")) return "light";
  return "dark";
}

const THEMES = {
  dark: {
    overlay: "rgba(0,0,0,0.65)",
    panel: "#0d1a12",
    border: "rgba(255,255,255,0.1)",
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.5)",
    btnPrimary: "linear-gradient(135deg,#006341,#004d30)",
    btnPrimaryColor: "#fff",
    btnSecondaryBg: "rgba(255,255,255,0.08)",
    btnSecondaryBorder: "rgba(255,255,255,0.15)",
    btnSecondaryColor: "#fff",
    progressBg: "rgba(255,255,255,0.1)",
    progressFill: "linear-gradient(90deg,#006341,#00a86b)",
    folderBg: "rgba(255,255,255,0.06)",
    folderBorder: "rgba(255,255,255,0.12)",
    qualityActiveBg: "rgba(0,99,65,0.3)",
    qualityActiveBorder: "rgba(0,180,100,0.5)",
    qualityBg: "rgba(255,255,255,0.05)",
    qualityBorder: "rgba(255,255,255,0.1)",
  },
  light: {
    overlay: "rgba(0,0,0,0.4)",
    panel: "#ffffff",
    border: "rgba(0,99,65,0.15)",
    text: "#1a2e22",
    textMuted: "rgba(0,60,30,0.5)",
    btnPrimary: "linear-gradient(135deg,#006341,#004d30)",
    btnPrimaryColor: "#fff",
    btnSecondaryBg: "rgba(0,99,65,0.08)",
    btnSecondaryBorder: "rgba(0,99,65,0.2)",
    btnSecondaryColor: "#006341",
    progressBg: "rgba(0,99,65,0.1)",
    progressFill: "linear-gradient(90deg,#006341,#00a86b)",
    folderBg: "rgba(0,99,65,0.04)",
    folderBorder: "rgba(0,99,65,0.15)",
    qualityActiveBg: "rgba(0,99,65,0.12)",
    qualityActiveBorder: "rgba(0,99,65,0.4)",
    qualityBg: "rgba(0,99,65,0.03)",
    qualityBorder: "rgba(0,99,65,0.12)",
  },
  sunset: {
    overlay: "rgba(0,0,0,0.7)",
    panel: "#1a0500",
    border: "rgba(255,80,20,0.25)",
    text: "#ffd4a0",
    textMuted: "rgba(255,150,80,0.55)",
    btnPrimary: "linear-gradient(135deg,#c83200,#8a1a00)",
    btnPrimaryColor: "#fff",
    btnSecondaryBg: "rgba(255,80,20,0.1)",
    btnSecondaryBorder: "rgba(255,80,20,0.2)",
    btnSecondaryColor: "#ffb060",
    progressBg: "rgba(255,80,20,0.15)",
    progressFill: "linear-gradient(90deg,#c83200,#ff6030)",
    folderBg: "rgba(60,5,0,0.4)",
    folderBorder: "rgba(255,80,20,0.2)",
    qualityActiveBg: "rgba(200,50,0,0.25)",
    qualityActiveBorder: "rgba(255,80,20,0.5)",
    qualityBg: "rgba(60,5,0,0.3)",
    qualityBorder: "rgba(255,80,20,0.15)",
  },
};

const QUALITY_OPTIONS: { id: Quality; label: string; desc: string; icon: string; note: string }[] = [
  {
    id: "fast",
    label: "Rapide",
    desc: "MP4 720p — un seul fichier",
    icon: "⚡",
    note: "Visionnage normal, compatible partout",
  },
  {
    id: "hq",
    label: "Haute qualité",
    desc: "Meilleure vidéo + meilleur audio",
    icon: "🎬",
    note: "Nécessite ffmpeg · pour créateurs de contenu",
  },
];

export default function DownloadPanel({ url, onClose }: DownloadPanelProps) {
  const [state, setState] = useState<DlState>("fetching");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [folder, setFolder] = useState<string>("");
  const [quality, setQuality] = useState<Quality>("fast");
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
      if (result?.error) { setErrorMsg(result.error); setState("error"); }
      else if (result?.title) { setInfo(result); setState("ready"); }
      else { setErrorMsg("Réponse inattendue de yt-dlp."); setState("error"); }
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
      api.send("cancel-download");
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
    (window as any).electronAPI?.send("download-video", { url, outputFolder: folder, quality });
  }, [url, folder, quality]);

  return (
    <>
      <style>{`
        @keyframes dl-spin { to { transform: rotate(360deg); } }
        .dl-quality-btn { transition: all 0.15s ease; cursor: pointer; }
        .dl-quality-btn:hover { opacity: 0.85; transform: translateY(-1px); }
      `}</style>
      {/* Overlay — commence SOUS la navbar (6vh) et la sidebar si présente */}
      <div
        style={{
          position: "fixed",
          top: "6vh",   // ✅ sous la barre URL
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9998,
          background: theme.overlay,
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div style={{
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
          maxHeight: "80vh",
          overflowY: "auto",
        }}>

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
              <div style={{ width: 32, height: 32, borderRadius: "50%", border: `3px solid ${theme.progressBg}`, borderTopColor: "#006341", animation: "dl-spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 12, color: theme.textMuted }}>Connexion à yt-dlp…</span>
            </div>
          )}

          {/* READY */}
          {state === "ready" && info && (
            <>
              {info.thumbnail && (
                <img src={info.thumbnail} alt="" style={{ width: "100%", borderRadius: 12, objectFit: "cover", maxHeight: 180 }} />
              )}
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.4, color: theme.text }}>{info.title}</div>
              <div style={{ fontSize: 12, color: theme.textMuted, display: "flex", gap: 12, flexWrap: "wrap" }}>
                {info.uploader && <span>📺 {info.uploader}</span>}
                {info.duration && <span>⏱ {formatDuration(info.duration)}</span>}
                {info.extractor && <span>🌐 {info.extractor}</span>}
              </div>

              {/* ✅ Choix de qualité */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>
                  Qualité
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {QUALITY_OPTIONS.map((opt) => {
                    const isActive = quality === opt.id;
                    return (
                      <button
                        key={opt.id}
                        className="dl-quality-btn"
                        onClick={() => setQuality(opt.id)}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: `1.5px solid ${isActive ? theme.qualityActiveBorder : theme.qualityBorder}`,
                          background: isActive ? theme.qualityActiveBg : theme.qualityBg,
                          color: theme.text,
                          textAlign: "left",
                        }}
                      >
                        <div style={{ fontSize: 15, marginBottom: 3 }}>{opt.icon} <span style={{ fontSize: 13, fontWeight: 700 }}>{opt.label}</span></div>
                        <div style={{ fontSize: 11, color: theme.textMuted, fontWeight: 500 }}>{opt.desc}</div>
                        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 3, opacity: 0.7 }}>{opt.note}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dossier de destination */}
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
                {quality === "fast" ? "⚡ Télécharger en MP4 720p" : "🎬 Télécharger en haute qualité"}
              </button>
            </>
          )}

          {/* DOWNLOADING */}
          {state === "downloading" && (
            <>
              {info && <div style={{ fontWeight: 600, fontSize: 13, color: theme.textMuted }}>{info.title}</div>}
              <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>
                {quality === "fast" ? "⚡ Mode rapide — MP4 720p" : "🎬 Haute qualité"}
              </div>
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
    </>
  );
}
