"use client";
import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/context/langcontext";

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

export default function DownloadPanel({ url, onClose }: DownloadPanelProps) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const [state, setState] = useState<DlState>("fetching");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [folder, setFolder] = useState<string>("");
  const [quality, setQuality] = useState<Quality>("fast");
  const [progress, setProgress] = useState<{ percent: number; size: string; speed: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [doneFolder, setDoneFolder] = useState<string>("");
  // ⚖️ Engagement légal (loi 18-07 — droit à l'image et vie privée) :
  // obligatoire avant tout téléchargement. Le choix est mémorisé sur ce
  // poste pour ne pas le redemander à chaque vidéo, mais la mention et
  // l'accès au texte complet restent toujours visibles.
  const [legalAccepted, setLegalAccepted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("hnaya-legal-download-accepted") === "1";
  });
  const [showLegal, setShowLegal] = useState(false);
  const theme = THEMES[getTheme()];

  const toggleLegal = (checked: boolean) => {
    setLegalAccepted(checked);
    try {
      if (checked) localStorage.setItem("hnaya-legal-download-accepted", "1");
      else localStorage.removeItem("hnaya-legal-download-accepted");
    } catch { /* stockage indisponible — l'engagement vaut pour cette session */ }
  };

  const dir = isRTL ? "rtl" : "ltr";

  useEffect(() => {
    setState("fetching");
    const api = (window as any).electronAPI;
    if (!api?.invoke) {
      setErrorMsg(t("Download.unavailable"));
      setState("error");
      return;
    }
    api.invoke("get-video-info", url).then((result: any) => {
      if (result?.error) { setErrorMsg(result.error); setState("error"); }
      else if (result?.title) { setInfo(result); setState("ready"); }
      else { setErrorMsg(t("Download.unexpected")); setState("error"); }
    }).catch((err: any) => {
      setErrorMsg(err?.message || t("Download.analysisError"));
      setState("error");
    });
  }, [url]);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    const onProgress = (data: any) => setProgress(data);
    const onDone = (data: any) => {
      if (data.success) { setDoneFolder(data.folder || ""); setState("done"); }
      else { setErrorMsg(data.error || t("Download.error")); setState("error"); }
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

  const headerTitle = {
    fetching: t("Download.analyzing"),
    ready: t("Download.title"),
    downloading: t("Download.downloading"),
    done: t("Download.done"),
    error: t("Download.error"),
  }[state];

  return (
    <>
      <style>{`
        @keyframes dl-spin { to { transform: rotate(360deg); } }
        .dl-quality-btn { transition: all 0.15s ease; cursor: pointer; }
        .dl-quality-btn:hover { opacity: 0.85; transform: translateY(-1px); }
      `}</style>

      {/* Overlay — sous la barre URL (6vh) */}
      <div
        style={{
          position: "fixed",
          top: "6vh",
          left: 0, right: 0, bottom: 0,
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
        <div dir={dir} style={{
          width: 460,
          maxWidth: "92vw",
          borderRadius: 20,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          backgroundColor: theme.panel,
          border: `1px solid ${theme.border}`,
          color: theme.text,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          maxHeight: "78vh",
          overflowY: "auto",
        }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{headerTitle}</span>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: theme.textMuted, lineHeight: 1, padding: 4 }}>✕</button>
          </div>

          {/* FETCHING */}
          {state === "fetching" && (
            <div style={{ padding: "20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", border: `3px solid ${theme.progressBg}`, borderTopColor: "#006341", animation: "dl-spin 0.8s linear infinite" }} />
              <span style={{ fontSize: 12, color: theme.textMuted }}>{t("Download.connecting")}</span>
            </div>
          )}

          {/* READY */}
          {state === "ready" && info && (
            <>
              {/* Miniature + infos côte à côte */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                {info.thumbnail && (
                  <img src={info.thumbnail} alt="" style={{ width: 100, height: 60, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {info.title}
                  </div>
                  <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {info.uploader && <span>📺 {info.uploader}</span>}
                    {info.duration && <span>⏱ {formatDuration(info.duration)}</span>}
                  </div>
                </div>
              </div>

              {/* Choix qualité — compact, sans titre ni note */}
              <div style={{ display: "flex", gap: 8 }}>
                {([
                  { id: "fast" as Quality, icon: "⚡", label: t("Download.fast"), desc: t("Download.fastDesc") },
                  { id: "hq" as Quality, icon: "🎬", label: t("Download.hq"), desc: t("Download.hqDesc") },
                ]).map((opt) => {
                  const isActive = quality === opt.id;
                  return (
                    <button
                      key={opt.id}
                      className="dl-quality-btn"
                      onClick={() => setQuality(opt.id)}
                      style={{
                        flex: 1,
                        padding: "9px 10px",
                        borderRadius: 10,
                        border: `1.5px solid ${isActive ? theme.qualityActiveBorder : theme.qualityBorder}`,
                        background: isActive ? theme.qualityActiveBg : theme.qualityBg,
                        color: theme.text,
                        textAlign: isRTL ? "right" : "left",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{opt.icon} {opt.label}</div>
                      <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>{opt.desc}</div>
                    </button>
                  );
                })}
              </div>

              {/* Dossier */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, fontSize: 12, padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.folderBorder}`, background: theme.folderBg, color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {folder || t("Download.noFolder")}
                </div>
                <button onClick={handleChooseFolder} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${theme.btnSecondaryBorder}`, background: theme.btnSecondaryBg, color: theme.btnSecondaryColor, fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {t("Download.choose")}
                </button>
              </div>

              {/* ⚖️ Engagement légal — loi 18-07 (droit à l'image, vie privée).
                  Obligatoire : le téléchargement reste bloqué tant que la
                  case n'est pas cochée. L'icône ouvre le texte complet. */}
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "10px 12px", borderRadius: 10,
                border: `1px solid ${legalAccepted ? theme.folderBorder : "rgba(255,180,0,0.45)"}`,
                background: legalAccepted ? theme.folderBg : "rgba(255,180,0,0.08)",
              }}>
                <input
                  id="legal-consent"
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(e) => toggleLegal(e.target.checked)}
                  style={{ marginTop: 2, cursor: "pointer", flexShrink: 0, width: 15, height: 15 }}
                />
                <label htmlFor="legal-consent" style={{ fontSize: 11.5, lineHeight: 1.5, color: theme.text, cursor: "pointer", flex: 1 }}>
                  {t("Download.legalCheckbox")}{" "}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setShowLegal(true); }}
                    title={t("Download.legalOpen")}
                    aria-label={t("Download.legalOpen")}
                    style={{
                      background: "none", border: "none", padding: 0, margin: 0,
                      cursor: "pointer", fontSize: 13, lineHeight: 1,
                      verticalAlign: "middle",
                    }}
                  >
                    ⚠️
                  </button>
                </label>
              </div>

              {/* Bouton télécharger — inactif tant que l'engagement n'est pas coché */}
              <button
                onClick={handleDownload}
                disabled={!folder || !legalAccepted}
                style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: (folder && legalAccepted) ? theme.btnPrimary : "rgba(128,128,128,0.3)", color: (folder && legalAccepted) ? theme.btnPrimaryColor : "rgba(255,255,255,0.3)", fontWeight: 700, fontSize: 14, cursor: (folder && legalAccepted) ? "pointer" : "not-allowed" }}
              >
                {quality === "fast" ? t("Download.downloadFast") : t("Download.downloadHQ")}
              </button>
            </>
          )}

          {/* DOWNLOADING */}
          {state === "downloading" && (
            <>
              {info && <div style={{ fontWeight: 600, fontSize: 13, color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{info.title}</div>}
              <div style={{ width: "100%", height: 8, borderRadius: 99, background: theme.progressBg, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 99, background: theme.progressFill, width: `${progress?.percent ?? 0}%`, transition: "width 0.3s ease" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: theme.textMuted }}>
                <span>{progress ? `${progress.percent.toFixed(1)}%` : "…"}</span>
                <span>{progress ? `${progress.speed} · ${progress.size}` : ""}</span>
              </div>
              <div style={{ fontSize: 11, color: theme.textMuted, textAlign: "center" }}>{t("Download.doNotClose")}</div>
            </>
          )}

          {/* DONE */}
          {state === "done" && (
            <>
              <div style={{ fontSize: 40, textAlign: "center" }}>✅</div>
              <div style={{ textAlign: "center", fontSize: 14, fontWeight: 600 }}>{t("Download.done")}</div>
              {doneFolder && <div style={{ fontSize: 11, color: theme.textMuted, textAlign: "center" }}>{t("Download.savedIn")} {doneFolder}</div>}
              <button onClick={onClose} style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: theme.btnPrimary, color: theme.btnPrimaryColor, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                {t("Download.close")}
              </button>
            </>
          )}

          {/* ERROR */}
          {state === "error" && (
            <>
              <div style={{ fontSize: 40, textAlign: "center" }}>⚠️</div>
              <div style={{ fontSize: 13, color: theme.textMuted, textAlign: "center" }}>{errorMsg}</div>
              <button onClick={onClose} style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${theme.btnSecondaryBorder}`, background: theme.btnSecondaryBg, color: theme.btnSecondaryColor, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                {t("Download.close")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ⚖️ Bulle de l'avertissement légal complet — au-dessus du panneau */}
      {showLegal && (
        <div
          style={{
            position: "fixed", top: "6vh", left: 0, right: 0, bottom: 0,
            zIndex: 9999, background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => e.target === e.currentTarget && setShowLegal(false)}
        >
          <div dir={dir} style={{
            width: 520, maxWidth: "94vw", maxHeight: "80vh",
            borderRadius: 16, padding: 20,
            backgroundColor: theme.panel,
            border: `1px solid ${theme.border}`,
            color: theme.text,
            boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <span style={{ fontSize: 14.5, fontWeight: 700, flex: 1, lineHeight: 1.35 }}>
                {t("Download.legalTitle")}
              </span>
              <button
                onClick={() => setShowLegal(false)}
                style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: theme.textMuted, lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>

            <div className="thin-scroll" style={{
              overflowY: "auto", display: "flex", flexDirection: "column", gap: 12,
              fontSize: 12, lineHeight: 1.65, paddingInlineEnd: 4,
            }}>
              <p style={{ color: theme.textMuted }}>{t("Download.legalIntro")}</p>

              {([
                { title: "legalS1Title", items: ["legalS1a", "legalS1b", "legalS1c"] },
                { title: "legalS2Title", items: ["legalS2a", "legalS2b"] },
                { title: "legalS3Title", items: ["legalS3a", "legalS3b"] },
                { title: "legalS4Title", items: ["legalS4a", "legalS4b", "legalS4c"] },
              ]).map((section) => (
                <div key={section.title} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>{t(`Download.${section.title}`)}</div>
                  <ul style={{ margin: 0, paddingInlineStart: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                    {section.items.map((key) => (
                      <li key={key} style={{ color: theme.textMuted }}>{t(`Download.${key}`)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowLegal(false)}
              style={{ width: "100%", padding: 11, borderRadius: 10, border: "none", background: theme.btnPrimary, color: theme.btnPrimaryColor, fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 }}
            >
              {t("Download.legalClose")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
