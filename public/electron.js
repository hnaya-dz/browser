import { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, screen } from "electron";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "child_process";
import { existsSync } from "fs";
import serve from "electron-serve";
// ✅ PATCH 1 — import depuis shared/ (supprime la duplication avec urlbar.tsx)
import { isDownloadableUrl } from "../shared/supportedHosts.js";
import { registerVaultIpc } from "./vault-ipc.js";
import { checkForUpdate } from "./update-check.js";

// ✅ Détecte les URLs d'authentification Google qu'Electron ne peut pas gérer
// (Google bloque volontairement l'OAuth dans les WebViews embarquées depuis 2021)
function isGoogleAuthUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "accounts.google.com";
  } catch { return false; }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appServe = app.isPackaged ? serve({
  directory: join(__dirname, "../out"),
}) : null;

let mainWindow = null;
const browserViews = new Map();
let activeTabId = null;
let tabSideWidth = 0;
// Référence au process yt-dlp en cours (pour l'annulation)
let activeDownloadProc = null;

// ── Chemin vers yt-dlp (multi-OS) ────────────────────────────────────────────
// ⚠️ NE PAS modifier sans relire TECHNIQUES.md — affecte Windows/macOS/Linux
function getYtDlpBinaryName() {
  if (process.platform === "win32") return "yt-dlp.exe";
  return "yt-dlp"; // macOS et Linux utilisent le même binaire universel sans extension
}

const ytDlpBinDir = app.isPackaged
  ? join(process.resourcesPath, "bin")
  : join(__dirname, "bin");

const ytDlpPath = join(ytDlpBinDir, getYtDlpBinaryName());

// URL de téléchargement officielle selon l'OS — yt-dlp publie un binaire par plateforme
function getYtDlpDownloadUrl() {
  const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
  if (process.platform === "win32") return base + "yt-dlp.exe";
  if (process.platform === "darwin") return base + "yt-dlp_macos";
  return base + "yt-dlp"; // Linux
}

// Télécharge yt-dlp au premier lancement si absent (gère redirections GitHub)
async function ensureYtDlp() {
  if (existsSync(ytDlpPath)) return true;

  const https = await import("https");
  const { mkdirSync, chmodSync, createWriteStream } = await import("fs");
  mkdirSync(ytDlpBinDir, { recursive: true });

  const url = getYtDlpDownloadUrl();

  return new Promise((resolve) => {
    const download = (downloadUrl, redirectCount = 0) => {
      if (redirectCount > 5) { resolve(false); return; }
      https.default.get(downloadUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          download(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) { resolve(false); return; }
        const file = createWriteStream(ytDlpPath);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          // macOS/Linux nécessitent le bit d'exécution
          if (process.platform !== "win32") {
            try { chmodSync(ytDlpPath, 0o755); } catch {}
          }
          resolve(true);
        });
      }).on("error", () => resolve(false));
    };
    download(url);
  });
}

// ── SUPPRIMÉ : SUPPORTED_HOSTS et isDownloadableUrl (maintenant dans shared/supportedHosts.ts) ──

const createWindow = () => {
  Menu.setApplicationMenu(null);
// ✅ Dimensions adaptatives — s'ajuste à l'écran de l'utilisateur
// 92% de la surface disponible, minimum 900×600 pour que l'interface reste utilisable
const primaryDisplay = screen.getPrimaryDisplay();
const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
const winWidth  = Math.max(900, Math.round(screenW  * 0.92));
const winHeight = Math.max(600, Math.round(screenH * 0.92));

mainWindow = new BrowserWindow({
  width:     winWidth,
  height:    winHeight,
  center:    true,
  minWidth:  900,
  minHeight: 600,
  icon: join(__dirname, "../public/icons/icon.ico"),
  webPreferences: {
    preload: join(__dirname, "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    webviewTag: false,
  },
});

  // ✅ User-Agent Chrome pour compatibilité avec les sites WordPress
  const chromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  mainWindow.webContents.setUserAgent(chromeUA);

  if (app.isPackaged) {
    appServe(mainWindow).then(() => mainWindow.loadURL("app://index.html"));
  } else {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.on("did-fail-load", () => mainWindow.webContents.reloadIgnoringCache());
  }
  mainWindow.on("closed", () => { mainWindow = null; });
};

app.on("ready", async () => {
  createWindow();
  // ✅ Initialiser le gestionnaire de mots de passe
  registerVaultIpc(
    () => mainWindow,
    () => browserViews,
    () => activeTabId
  );
  // ✅ Télécharger yt-dlp en arrière-plan si absent (premier lancement uniquement)
  if (!existsSync(ytDlpPath)) {
    mainWindow?.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send("ytdlp-setup-status", { status: "downloading" });
    });
  }
  ensureYtDlp().then(ok => {
    mainWindow?.webContents.send("ytdlp-setup-status", { status: ok ? "ready" : "error" });
    if (!ok) console.error("[yt-dlp] Échec du téléchargement automatique.");
  });
});

app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler((details) => {
    // ✅ Google OAuth → navigateur système (Electron est bloqué par Google)
    if (isGoogleAuthUrl(details.url)) {
      shell.openExternal(details.url);
      return { action: 'deny' };
    }
    if (mainWindow) mainWindow.webContents.send('new-tab-url', details.url);
    return { action: 'deny' };
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

const updateBrowserViewSize = () => {
  if (!mainWindow || !activeTabId) return;
  const view = browserViews.get(activeTabId);
  if (!view) return;
  const { width, height } = mainWindow.getContentBounds();
  if (tabSideWidth > 0) {
    view.setBounds({ x: 0, y: 0, width: width - tabSideWidth, height });
  } else {
    const marginTop = Math.round(height * 0.12);
    view.setBounds({ x: 0, y: marginTop, width, height: height - marginTop });
  }
};

// ✅ Masquer/afficher la WebContentsView active (pour laisser les modales React visibles)
ipcMain.on("hide-active-view", () => {
  if (activeTabId && browserViews.has(activeTabId) && mainWindow) {
    mainWindow.contentView.removeChildView(browserViews.get(activeTabId));
  }
});

// ✅ PATCH 2 — version synchrone avec confirmation Promise
// urlbar.tsx attend ce retour avant d'afficher le panneau (remplace le setTimeout 150ms)
// ✅ Retourner la vraie URL de la WebContentsView active (pas localhost)
ipcMain.handle("check-for-update", async (event, lang) => {
  return checkForUpdate(lang || "fr");
});

ipcMain.handle("get-app-version", async () => {
  return app.getVersion();
});

ipcMain.handle("get-active-tab-url", async () => {
  if (activeTabId && browserViews.has(activeTabId)) {
    const url = browserViews.get(activeTabId).webContents.getURL();
    // ✅ Ne jamais retourner une URL Google Auth — yt-dlp ne doit jamais la recevoir
    if (isGoogleAuthUrl(url)) return null;
    return url;
  }
  return null;
});

ipcMain.handle("hide-active-view-sync", async () => {
  if (activeTabId && browserViews.has(activeTabId) && mainWindow) {
    mainWindow.contentView.removeChildView(browserViews.get(activeTabId));
  }
  return true;
});

ipcMain.on("show-active-view", () => {
  if (activeTabId && browserViews.has(activeTabId) && mainWindow) {
    const view = browserViews.get(activeTabId);
    mainWindow.contentView.addChildView(view);
    updateBrowserViewSize();
  }
});

ipcMain.on("set-tab-position", (event, position) => {
  tabSideWidth = position === "right" ? 200 : 0;
  updateBrowserViewSize();
});

////////////////////////////////////////////////////////////////////////////////
// ── TÉLÉCHARGEMENT (yt-dlp) ──────────────────────────────────────────────────

// 1. Vérifier si l'URL est téléchargeable
ipcMain.handle("check-downloadable", async (event, url) => {
  return {
    downloadable: isDownloadableUrl(url),
    ytdlpAvailable: existsSync(ytDlpPath),
  };
});

// 2. Récupérer les infos vidéo (titre + miniature) via yt-dlp --dump-json
ipcMain.handle("get-video-info", async (event, url) => {
  if (!existsSync(ytDlpPath)) {
    return { error: "yt-dlp introuvable dans public/bin/yt-dlp.exe" };
  }
  return new Promise((resolve) => {
    let output = "";
    let errOutput = "";
    const proc = spawn(ytDlpPath, [
      "--dump-json",
      "--no-playlist",
      "--socket-timeout", "15",
      url,
    ]);
    proc.stdout.on("data", d => { output += d.toString(); });
    proc.stderr.on("data", d => { errOutput += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({ error: errOutput || "Impossible d'obtenir les informations vidéo." });
        return;
      }
      try {
        const info = JSON.parse(output);
        resolve({
          title: info.title || "Vidéo sans titre",
          thumbnail: info.thumbnail || null,
          duration: info.duration || null,
          uploader: info.uploader || info.channel || null,
          extractor: info.extractor_key || null,
        });
      } catch {
        resolve({ error: "Erreur de parsing des informations vidéo." });
      }
    });
    proc.on("error", () => resolve({ error: "Impossible de lancer yt-dlp." }));
  });
});

// 3. Choisir le dossier de destination (dialogue natif Windows)
ipcMain.handle("choose-download-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choisir le dossier de téléchargement",
    properties: ["openDirectory"],
    defaultPath: app.getPath("downloads"),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// 4. Lancer le téléchargement avec progression
ipcMain.on("download-video", (event, { url, outputFolder, quality }) => {
  if (!existsSync(ytDlpPath)) {
    event.sender.send("download-done", { success: false, error: "yt-dlp introuvable." });
    return;
  }

  const outputTemplate = join(outputFolder, "%(title)s.%(ext)s");

  // ⚡ Mode rapide : MP4 720p préemballé, un seul fichier, sans ffmpeg
  // 🎬 Haute qualité : meilleure vidéo + meilleur audio (nécessite ffmpeg pour fusionner)
  const formatArgs = quality === "hq"
    ? ["--format", "bestvideo+bestaudio/best", "--merge-output-format", "mp4"]
    : ["--format", "best[ext=mp4][vcodec!*=av01]/bestvideo[ext=mp4][height<=720][vcodec!*=av01]+bestaudio[ext=m4a]/best[height<=720]", "--no-part"];

  const proc = spawn(ytDlpPath, [
    ...formatArgs,
    "--output", outputTemplate,
    "--no-playlist",
    "--newline",
    "--progress",
    url,
  ]);

  // ✅ PATCH 9 — stocker la référence pour pouvoir annuler
  activeDownloadProc = proc;

  const progressRegex = /\[download\]\s+([\d.]+)%\s+of\s+([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)/;

  proc.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      const match = line.match(progressRegex);
      if (match) {
        event.sender.send("download-progress", {
          percent: parseFloat(match[1]),
          size: match[2],
          speed: match[3],
        });
      }
    }
  });

  proc.stderr.on("data", (data) => {
    console.error("[yt-dlp stderr]", data.toString());
  });

  proc.on("close", (code) => {
    activeDownloadProc = null;
    if (code === 0) {
      event.sender.send("download-done", { success: true, folder: outputFolder });
    } else if (code === null) {
      // Annulé par cancel-download — ne pas envoyer d'erreur
    } else {
      event.sender.send("download-done", { success: false, error: "Téléchargement échoué (code " + code + ")." });
    }
  });

  proc.on("error", (err) => {
    activeDownloadProc = null;
    event.sender.send("download-done", { success: false, error: err.message });
  });
});

// ✅ PATCH 9 — annuler le téléchargement en cours (depuis DownloadPanel.tsx cleanup)
ipcMain.on("cancel-download", () => {
  if (activeDownloadProc) {
    activeDownloadProc.kill();
    activeDownloadProc = null;
  }
});

////////////////////////////////////////////////////////////////////////////////
// Tabs Management

ipcMain.on("open-tab", (event, newTab) => {
  const { id, url } = newTab;
  if (!url) { console.error(`Invalid URL for tab ${id}`); return; }

  if (!browserViews.has(id)) {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        scrollBounce: true,
      }
    });
    browserViews.set(id, view);

    // ✅ PATCH 6 — updateTabInfo simplifié : envoyer le titre sans double filtre
    // Le filtre "title !== domain" bloquait les vrais titres de page
    const updateTabInfo = () => {
      const currentUrl = view.webContents.getURL();
      const title = view.webContents.getTitle();
      // ✅ Ne jamais propager une URL Google Auth au renderer — pollue
      // realViewUrl côté React (urlbar.tsx) et casse isDownloadable/téléchargement
      if (!isGoogleAuthUrl(currentUrl)) {
        mainWindow.webContents.send("update-url", id, currentUrl);
      }
      if (title && title !== currentUrl) {
        mainWindow.webContents.send("update-tab-title", { id, title });
      }
    };

    view.webContents.on("page-title-updated", (event, title) => {
      // ✅ Intercepter hnaya-dl:: pour ouvrir le panneau depuis la WebContentsView sandbox
      if (title.startsWith("hnaya-dl::")) {
        const ytUrl = title.replace("hnaya-dl::", "");
        if (mainWindow) mainWindow.contentView.removeChildView(view);
        setTimeout(() => {
          mainWindow.webContents.send("open-download-panel", ytUrl);
        }, 150);
        return;
      }
      mainWindow.webContents.send("update-tab-title", { id, title });
    });

    view.webContents.setWindowOpenHandler((details) => {
      // ✅ Google OAuth → navigateur système
      if (isGoogleAuthUrl(details.url)) {
        shell.openExternal(details.url);
        return { action: "deny" };
      }
      mainWindow.webContents.send("new-tab-url", details.url);
      return { action: "deny" };
    });

    // Intercepter hnaya-dl:// pour ouvrir le panneau de téléchargement
    // (les WebContentsViews sandbox ne peuvent pas appeler electronAPI directement)
    view.webContents.on("will-navigate", (event, navUrl) => {
  // ✅ Google OAuth en navigation directe (pas une popup) → navigateur système
  if (isGoogleAuthUrl(navUrl)) {
    event.preventDefault();
    shell.openExternal(navUrl);
    return;
  }
  if (navUrl.startsWith("hnaya-dl://")) {
    event.preventDefault();
    try {
      const ytUrl = decodeURIComponent(navUrl.replace("hnaya-dl://", ""));
      // ✅ Cacher la WebContentsView AVANT d'afficher le panneau (même logique que urlbar.tsx)
      if (mainWindow) mainWindow.contentView.removeChildView(view);
      setTimeout(() => {
        mainWindow.webContents.send("open-download-panel", ytUrl);
      }, 150);
    } catch (e) {
      console.error("hnaya-dl:// parse error:", e);
    }
  }
});
// ✅ Intercepter postMessage depuis la WebContentsView (sandbox)
view.webContents.on("ipc-message", (event, channel, ...args) => {
  if (channel === "hnaya-dl") {
    const ytUrl = args[0];
    if (mainWindow) mainWindow.contentView.removeChildView(view);
    setTimeout(() => {
      mainWindow.webContents.send("open-download-panel", ytUrl);
    }, 150);
  }
});
view.webContents.on("did-navigate", (event, navUrl) => {
  // ✅ Filet de sécurité — Google peut rediriger en cascade et échapper à will-navigate
  // (cas observé : accounts.google.com/v3/signin/rejected via gsi/select popup)
  if (isGoogleAuthUrl(navUrl)) {
    shell.openExternal(navUrl);
    if (view.webContents.navigationHistory?.canGoBack()) {
      view.webContents.navigationHistory.goBack();
    } else {
      view.webContents.loadURL("about:blank");
    }
    return;
  }
  if (navUrl.startsWith("hnaya-dl://")) {
    try {
      const ytUrl = decodeURIComponent(navUrl.replace("hnaya-dl://", ""));
      // ✅ Même correction pour did-navigate
      if (mainWindow) mainWindow.contentView.removeChildView(view);
      setTimeout(() => {
        mainWindow.webContents.send("open-download-panel", ytUrl);
        view.webContents.goBack();
      }, 150);
    } catch (e) {
      console.error("hnaya-dl:// did-navigate parse error:", e);
    }
  }
});
    ["did-start-loading","did-stop-loading","did-finish-load","did-navigate","did-navigate-in-page"]
      .forEach(ev => view.webContents.on(ev, updateTabInfo));

    view.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
      mainWindow.webContents.send("update-url", id, validatedURL);
      updateTabInfo();
    });
view.webContents.on("did-finish-load", () => {
      // Favicon
      view.webContents.executeJavaScript(`
        const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        favicon ? favicon.href : null;
      `).then(faviconUrl => {
        mainWindow.webContents.send("update-tab-favicon", { id, faviconUrl });
      }).catch(console.error);

      // Injection bouton téléchargement sur hnayatube-watch
      // Stratégie : lire data-video-id directement depuis Electron (pas de navigation sandbox)
      // puis injecter un bouton qui change document.title avec le préfixe hnaya-dl::
      // Electron intercepte ce changement via page-title-updated
      const currentUrl = view.webContents.getURL();
      if (currentUrl.includes("hnaya.dz") && currentUrl.includes("hnayatube-watch")) {
        setTimeout(() => {
          view.webContents.executeJavaScript(`
            document.querySelector('[data-video-id]')?.getAttribute('data-video-id') || null;
          `).then(videoId => {
            if (!videoId) return;
            const ytUrl = 'https://www.youtube.com/watch?v=' + videoId;
            view.webContents.executeJavaScript(`
              (function() {
                if (document.querySelector('.hnaya-dl-btn')) return;
                const btn = document.createElement('button');
                btn.className = 'hnaya-dl-btn';
                btn.innerHTML = '⬇️ Télécharger';
                btn.style.cssText = [
                  'position:fixed','bottom:20px','right:20px','z-index:99999',
                  'padding:10px 16px','font-size:14px','font-weight:700',
                  'background:rgba(0,99,65,0.95)','color:#fff','border:none',
                  'border-radius:10px','cursor:pointer',
                  'box-shadow:0 4px 15px rgba(0,0,0,0.4)',
                  'font-family:system-ui,sans-serif'
                ].join(';');
                btn.addEventListener('click', () => {
                  document.title = 'hnaya-dl::${ytUrl}';
                });
                document.body.appendChild(btn);
              })();
            `).catch(console.error);
          }).catch(console.error);
        }, 2000);
      }
    });
 
    view.webContents.loadURL(url);
  }

  switchTab(id);
});

const switchTab = (tabId) => {
  if (!mainWindow) return;
  if (browserViews.has(activeTabId)) {
    mainWindow.contentView.removeChildView(browserViews.get(activeTabId));
  }
  if (browserViews.has(tabId)) {
    activeTabId = tabId;
    const view = browserViews.get(tabId);
    mainWindow.contentView.addChildView(view);
    updateBrowserViewSize();
  }
};

ipcMain.on("get-current-url", (event, tabId) => {
  if (browserViews.has(tabId)) {
    event.sender.send("current-url", tabId, browserViews.get(tabId).webContents.getURL());
  }
});

ipcMain.on("switch-tab", (event, tabId) => { switchTab(tabId); });

ipcMain.on("close-tab", (event, tabId) => {
  if (browserViews.has(tabId)) {
    const view = browserViews.get(tabId);
    if (activeTabId === tabId) mainWindow.contentView.removeChildView(view);
    view.webContents.destroy();
    browserViews.delete(tabId);
    if (activeTabId === tabId) { activeTabId = 1; switchTab(activeTabId); }
  }
});

ipcMain.on("go-back", () => {
  if (activeTabId && browserViews.has(activeTabId)) {
    const view = browserViews.get(activeTabId);
    if (view?.webContents?.navigationHistory?.canGoBack()) view.webContents.navigationHistory.goBack();
    else mainWindow.webContents.send("close-browser-view-and-go-home");
  }
});

ipcMain.on("go-forward", () => {
  if (activeTabId && browserViews.has(activeTabId)) {
    const view = browserViews.get(activeTabId);
    if (view?.webContents?.navigationHistory?.canGoForward()) view.webContents.navigationHistory.goForward();
  }
});

ipcMain.on("refresh", () => {
  if (activeTabId && browserViews.has(activeTabId)) {
    browserViews.get(activeTabId)?.webContents?.reload();
  }
});

ipcMain.on("navigate", (event, url) => {
  if (activeTabId && browserViews.has(activeTabId)) {
    const view = browserViews.get(activeTabId);
    if (view?.webContents) {
      const finalUrl = url.startsWith("http") ? url : `https://${url}`;
      view.webContents.loadURL(finalUrl);
      mainWindow.webContents.send("update-url", activeTabId, finalUrl);
    }
  }
});
