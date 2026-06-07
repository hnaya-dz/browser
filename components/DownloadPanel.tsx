"use client";
import { useEffect, useState, useCallback } from "react";

type DlState = "idle" | "fetching" | "ready" | "downloading" | "done" | "error";

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

export default function DownloadPanel({ url, onClose }: DownloadPanelProps) {
  const [state, setState] = useState<DlState>("fetching");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [folder, setFolder] = useState<string>("");
  const [progress, setProgress] = useState<{ percent: number; size: string; speed: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [doneFolder, setDoneFolder] = useState<string>("");

  // Récupérer les infos vidéo au montage
  useEffect(() => {
    setState("fetching");
    const api = (window as any).electronAPI;
    api.invoke("get-video-info", url).then((result: any) => {
      if (result.error) {
        setErrorMsg(result.error);
        setState("error");
      } else {
        setInfo(result);
        setState("ready");
      }
    });
  }, [url]);

  // Écouter la progression et la fin du téléchargement
  useEffect(() => {
    const api = (window as any).electronAPI;

    const onProgress = (data: { percent: number; size: string; speed: string }) => {
      setProgress(data);
    };
    const onDone = (data: { success: boolean; folder?: string; error?: string }) => {
      if (data.success) {
        setDoneFolder(data.folder || "");
        setState("done");
      } else {
        setErrorMsg(data.error || "Erreur inconnue.");
        setState("error");
      }
    };

    api.receive("download-progress", onProgress);
    api.receive("download-done", onDone);

    return () => {
      api.removeListener("download-progress", onProgress);
      api.removeListener("download-done", onDone);
    };
  }, []);

  const handleChooseFolder = useCallback(async () => {
    const api = (window as any).electronAPI;
    const chosen = await api.invoke("choose-download-folder");
    if (chosen) setFolder(chosen);
  }, []);

  const handleDownload = useCallback(() => {
    if (!folder) return;
    setState("downloading");
    setProgress(null);
    (window as any).electronAPI.send("download-video", { url, outputFolder: folder });
  }, [url, folder]);

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .dl-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: rgba(0,0,0,0.55);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .dl-panel {
          width: 480px;
          max-width: 92vw;
          border-radius: 20px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: 0 24px 80px rgba(0,0,0,0.6);
        }
        .dark .dl-panel {
          background: rgba(10,20,14,0.95);
          border: 1px solid rgba(255,255,255,0.1);
          color: #fff;
        }
        .light .dl-panel {
          background: rgba(255,255,255,0.96);
          border: 1px solid rgba(0,99,65,0.15);
          color: #1a2e22;
        }
        .sunset .dl-panel {
          background: rgba(25,3,0,0.95);
          border: 1px solid rgba(255,80,20,0.2);
          color: #ffd4a0;
        }
        .dl-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .dl-title-text {
          font-size: 15px;
          font-weight: 700;
          flex: 1;
        }
        .dl-close {
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
          opacity: 0.5;
          transition: opacity 0.15s;
          line-height: 1;
          padding: 4px;
        }
        .dl-close:hover { opacity: 1; }
        .dl-thumbnail {
          width: 100%;
          border-radius: 12px;
          object-fit: cover;
          max-height: 200px;
        }
        .dl-meta {
          font-size: 12px;
          opacity: 0.55;
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .dl-folder-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .dl-folder-display {
          flex: 1;
          font-size: 12px;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          opacity: 0.7;
        }
        .light .dl-folder-display {
          background: rgba(0,99,65,0.06);
          border-color: rgba(0,99,65,0.15);
          color: #1a2e22;
        }
        .sunset .dl-folder-display {
          background: rgba(60,5,0,0.4);
          border-color: rgba(255,80,20,0.2);
        }
        .dl-btn {
          padding: 8px 16px;
          border-radius: 10px;
          border: none;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }
        .dl-btn:hover { transform: translateY(-1px); opacity: 0.9; }
        .dl-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
        .dl-btn-primary { background: linear-gradient(135deg, #006341, #004d30); color: #fff; }
        .sunset .dl-btn-primary { background: linear-gradient(135deg, #c83200, #8a1a00); }
        .dl-btn-secondary { background: rgba(255,255,255,0.1); color: inherit; border: 1px solid rgba(255,255,255,0.15); }
        .light .dl-btn-secondary { background: rgba(0,99,65,0.08); border-color: rgba(0,99,65,0.2); color: #006341; }
        .dl-progress-bar-bg {
          width: 100%;
          height: 8px;
          border-radius: 99px;
          background: rgba(255,255,255,0.1);
          overflow: hidden;
        }
        .light .dl-progress-bar-bg { background: rgba(0,99,65,0.1); }
        .dl-progress-bar {
          height: 100%;
          border-radius: 99px;
          background: linear-gradient(90deg, #006341, #00a86b);
          transition: width 0.3s ease;
        }
        .sunset .dl-progress-bar { background: linear-gradient(90deg, #c83200, #ff6030); }
        .dl-progress-info {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          opacity: 0.6;
        }
        .dl-spinner {
          width: 28px; height: 28px;
          border: 3px solid rgba(255,255,255,0.15);
          border-top-color: #006341;
          border-radius: 50%;
          animation: dl-spin 0.8s linear infinite;
          margin: 0 auto;
        }
        @keyframes dl-spin { to { transform: rotate(360deg); } }
        .dl-success-icon { font-size: 40px; text-align: center; }
        .dl-error-icon   { font-size: 40px; text-align: center; }
      `}</style>

      <div className="dl-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="dl-panel">

          {/* Header */}
          <div className="dl-header">
            <span className="dl-title-text">
              {state === "fetching" && "Analyse de la vidéo…"}
              {state === "ready" && "Télécharger la vidéo"}
              {state === "downloading" && "Téléchargement en cours…"}
              {state === "done" && "Téléchargement terminé !"}
              {state === "error" && "Erreur"}
            </span>
            <button className="dl-close" onClick={onClose} aria-label="Fermer">✕</button>
          </div>

          {/* FETCHING */}
          {state === "fetching" && (
            <div className="py-6"><div className="dl-spinner" /></div>
          )}

          {/* READY */}
          {state === "ready" && info && (
            <>
              {info.thumbnail && (
                <img src={info.thumbnail} alt="" className="dl-thumbnail" />
              )}
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.4 }}>{info.title}</div>
              <div className="dl-meta">
                {info.uploader && <span>📺 {info.uploader}</span>}
                {info.duration && <span>⏱ {formatDuration(info.duration)}</span>}
                {info.extractor && <span>🌐 {info.extractor}</span>}
                <span>🎬 MP4</span>
              </div>

              {/* Sélection du dossier */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, opacity: 0.6 }}>
                  DOSSIER DE DESTINATION
                </div>
                <div className="dl-folder-row">
                  <div className="dl-folder-display">
                    {folder || "Aucun dossier sélectionné"}
                  </div>
                  <button className="dl-btn dl-btn-secondary" onClick={handleChooseFolder}>
                    📁 Choisir
                  </button>
                </div>
              </div>

              <button
                className="dl-btn dl-btn-primary"
                onClick={handleDownload}
                disabled={!folder}
                style={{ width: "100%", padding: "12px" }}
              >
                ⬇️ Télécharger en MP4
              </button>
            </>
          )}

          {/* DOWNLOADING */}
          {state === "downloading" && (
            <>
              {info && (
                <div style={{ fontWeight: 600, fontSize: 13, opacity: 0.8 }}>{info.title}</div>
              )}
              <div className="dl-progress-bar-bg">
                <div
                  className="dl-progress-bar"
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
              <div className="dl-progress-info">
                <span>{progress ? `${progress.percent.toFixed(1)}%` : "Démarrage…"}</span>
                <span>{progress ? `${progress.speed} · ${progress.size}` : ""}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.4, textAlign: "center" }}>
                Ne fermez pas ce panneau pendant le téléchargement
              </div>
            </>
          )}

          {/* DONE */}
          {state === "done" && (
            <>
              <div className="dl-success-icon">✅</div>
              <div style={{ textAlign: "center", fontSize: 14, fontWeight: 600 }}>
                Vidéo téléchargée avec succès !
              </div>
              {doneFolder && (
                <div style={{ fontSize: 11, opacity: 0.5, textAlign: "center" }}>
                  Enregistré dans : {doneFolder}
                </div>
              )}
              <button className="dl-btn dl-btn-primary" onClick={onClose} style={{ width: "100%", padding: "12px" }}>
                Fermer
              </button>
            </>
          )}

          {/* ERROR */}
          {state === "error" && (
            <>
              <div className="dl-error-icon">⚠️</div>
              <div style={{ fontSize: 13, opacity: 0.7, textAlign: "center" }}>{errorMsg}</div>
              {!existsYtDlp() && (
                <div style={{ fontSize: 11, opacity: 0.5, textAlign: "center" }}>
                  Assurez-vous que <strong>yt-dlp.exe</strong> est présent dans <code>public/bin/</code>
                </div>
              )}
              <button className="dl-btn dl-btn-secondary" onClick={onClose} style={{ width: "100%", padding: "10px" }}>
                Fermer
              </button>
            </>
          )}

        </div>
      </div>
    </>
  );
}

// Helper client-side (affichage uniquement)
function existsYtDlp() { return true; }
