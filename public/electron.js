import { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, session } from "electron";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "child_process";
import { existsSync } from "fs";
import serve from "electron-serve";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appServe = app.isPackaged ? serve({
  directory: join(__dirname, "../out"),
}) : null;

let mainWindow = null;
const browserViews = new Map();
let activeTabId = null;
let tabSideWidth = 0;

// ── Chemin vers yt-dlp.exe ───────────────────────────────────────────────────
const ytDlpPath = app.isPackaged
  ? join(process.resourcesPath, "bin", "yt-dlp.exe")
  : join(__dirname, "bin", "yt-dlp.exe");

// ── Sites supportés par yt-dlp (liste indicative pour la détection UI) ───────
const SUPPORTED_HOSTS = [
  "youtube.com", "youtu.be",
  "facebook.com", "fb.watch",
  "instagram.com",
  "tiktok.com",
  "dailymotion.com",
  "twitter.com", "x.com",
  "vimeo.com",
  "twitch.tv",
  "reddit.com",
];

function isDownloadableUrl(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    return SUPPORTED_HOSTS.some(h => host === h || host.endsWith("." + h));
  } catch { return false; }
}

const createWindow = () => {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
      // sandbox retiré : bloquait ipcRenderer.invoke depuis le preload
      // Sécurité maintenue par contextIsolation + contextBridge
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

app.on("ready", () => {
  // ✅ Vider le cache Chromium au démarrage
  session.defaultSession.clearCache().then(() => {
    createWindow();
  });
});

app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler((details) => {
    if (mainWindow) mainWindow.webContents.send('new-tab-url', details.url);
    return { action: 'deny' };
  });

  // ✅ Activer Ctrl+R et Ctrl+Shift+R dans toutes les WebContentsViews
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.control && input.shift && input.key === "R") {
      contents.reloadIgnoringCache();
    } else if (input.control && input.key === "r") {
      contents.reload();
    }
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
// Envoie des événements IPC au renderer : "download-progress" et "download-done"
ipcMain.on("download-video", (event, { url, outputFolder }) => {
  if (!existsSync(ytDlpPath)) {
    event.sender.send("download-done", { success: false, error: "yt-dlp introuvable." });
    return;
  }

  const outputTemplate = join(outputFolder, "%(title)s.%(ext)s");

  const proc = spawn(ytDlpPath, [
    "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--output", outputTemplate,
    "--no-playlist",
    "--newline",           // une ligne par mise à jour de progression
    "--progress",
    url,
  ]);

  // Parser la progression depuis la sortie yt-dlp
  // Format typique : [download]  45.3% of   123.45MiB at    1.23MiB/s ETA 00:45
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
    if (code === 0) {
      event.sender.send("download-done", { success: true, folder: outputFolder });
    } else {
      event.sender.send("download-done", { success: false, error: "Téléchargement échoué (code " + code + ")." });
    }
  });

  proc.on("error", (err) => {
    event.sender.send("download-done", { success: false, error: err.message });
  });
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

    const updateTabInfo = () => {
      const currentUrl = view.webContents.getURL();
      const title = view.webContents.getTitle();
      mainWindow.webContents.send("update-url", id, currentUrl);
      if (title && title !== currentUrl) {
        try {
          const domain = new URL(currentUrl).hostname.replace("www.", "");
          if (title !== domain) mainWindow.webContents.send("update-tab-title", { id, title });
        } catch {
          mainWindow.webContents.send("update-tab-title", { id, title });
        }
      }
    };

    view.webContents.on("page-title-updated", (event, title) => {
      mainWindow.webContents.send("update-tab-title", { id, title });
    });

    view.webContents.setWindowOpenHandler((details) => {
      mainWindow.webContents.send("new-tab-url", details.url);
      return { action: "deny" };
    });

    // Intercepter hnaya-dl:// pour ouvrir le panneau de téléchargement
    // (les WebContentsViews sandbox ne peuvent pas appeler electronAPI directement)
    view.webContents.on("will-navigate", (event, navUrl) => {
      if (navUrl.startsWith("hnaya-dl://")) {
        event.preventDefault();
        try {
          const ytUrl = decodeURIComponent(navUrl.replace("hnaya-dl://", ""));
          mainWindow.webContents.send("open-download-panel", ytUrl);
        } catch (e) {
          console.error("hnaya-dl:// parse error:", e);
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
      view.webContents.executeJavaScript(`
        const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        favicon ? favicon.href : null;
      `).then(faviconUrl => {
        mainWindow.webContents.send("update-tab-favicon", { id, faviconUrl });
      }).catch(console.error);

      // ── Injection HnayaTube : boutons ⬇️ sur les cartes de la grille ──
      // Détecte les liens vidéo du snippet [hnayatube] et [hnayatube_watch]
      const currentUrl = view.webContents.getURL();
      if (currentUrl.includes("hnaya.dz") && currentUrl.includes("hnayatube")) {
        view.webContents.executeJavaScript(`
          (function injectHnayaDownloadButtons() {
            // Éviter la double injection
            if (document.querySelector('[data-hnaya-dl-injected]')) return;
            document.body.setAttribute('data-hnaya-dl-injected', '1');

            const style = document.createElement('style');
            style.textContent = \`
              .hnaya-dl-btn {
                position: absolute;
                bottom: 8px;
                right: 8px;
                z-index: 999;
                background: rgba(0,0,0,0.75);
                color: #fff;
                border: none;
                border-radius: 6px;
                padding: 4px 8px;
                font-size: 13px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 4px;
                backdrop-filter: blur(4px);
                transition: background 0.2s;
              }
              .hnaya-dl-btn:hover { background: rgba(0,99,65,0.9); }
              .hnaya-dl-card-wrap { position: relative; display: inline-block; }
            \`;
            document.head.appendChild(style);

            // Injection sur la page watch ([hnayatube_watch])
            const watchEl = document.querySelector('[data-video-id]');
            if (watchEl) {
              const videoId = watchEl.getAttribute('data-video-id');
              if (videoId) {
                const ytUrl = 'https://www.youtube.com/watch?v=' + videoId;
                const existing = watchEl.querySelector('.hnaya-dl-btn');
                if (!existing) {
                  const btn = document.createElement('button');
                  btn.className = 'hnaya-dl-btn';
                  btn.innerHTML = '⬇️ Télécharger';
                  btn.style.cssText = 'position:relative;bottom:auto;right:auto;margin:8px 0;';
                  btn.setAttribute('data-yt-url', ytUrl);
                  btn.setAttribute('title', 'Télécharger cette vidéo');
                  btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = 'hnaya-dl://' + encodeURIComponent(ytUrl);
                  });
                  watchEl.insertAdjacentElement('afterend', btn);
                }
              }
            }

            // Injection sur la grille ([hnayatube]) — liens <a> vers la page watch
            const cards = document.querySelectorAll('a[href*="hnayatube"][href*="?v="], a[href*="/watch?v="], a[href*="?v="]');
            cards.forEach(card => {
              if (card.querySelector('.hnaya-dl-btn')) return;
              const href = card.getAttribute('href') || '';
              const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
              if (!match) return;
              const videoId = match[1];
              const ytUrl = 'https://www.youtube.com/watch?v=' + videoId;

              // S'assurer que la carte a position:relative
              const style = window.getComputedStyle(card);
              if (style.position === 'static') card.style.position = 'relative';

              const btn = document.createElement('button');
              btn.className = 'hnaya-dl-btn';
              btn.innerHTML = '⬇️';
              btn.setAttribute('data-yt-url', ytUrl);
              btn.setAttribute('title', 'Télécharger cette vidéo');
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Naviguer vers un schéma personnalisé intercepté par Electron
                // (window.electronAPI n'est pas disponible dans les WebContentsViews sandbox)
                window.location.href = 'hnaya-dl://' + encodeURIComponent(ytUrl);
              });
              card.appendChild(btn);
            });

            // Observer les nouveaux éléments (lazy loading)
            const observer = new MutationObserver(() => injectHnayaDownloadButtons());
            observer.observe(document.body, { childList: true, subtree: true });
          })();
        `).catch(console.error);
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
    if (view?.webContents?.canGoBack()) view.webContents.goBack();
    else mainWindow.webContents.send("close-browser-view-and-go-home");
  }
});

ipcMain.on("go-forward", () => {
  if (activeTabId && browserViews.has(activeTabId)) {
    const view = browserViews.get(activeTabId);
    if (view?.webContents?.canGoForward()) view.webContents.goForward();
  }
});

ipcMain.on("refresh", () => {
  if (activeTabId && browserViews.has(activeTabId)) {
    browserViews.get(activeTabId)?.webContents?.reload();
  }
});

ipcMain.on("reload-ignore-cache", () => {
  if (activeTabId && browserViews.has(activeTabId)) {
    browserViews.get(activeTabId)?.webContents?.reloadIgnoringCache();
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
