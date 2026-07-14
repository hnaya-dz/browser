import { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, screen, clipboard } from "electron";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "child_process";
import { existsSync } from "fs";
import serve from "electron-serve";
// ✅ PATCH 1 — import depuis shared/ (supprime la duplication avec urlbar.tsx)
import { isDownloadableUrl } from "./shared/supportedHosts.js";
import { registerVaultIpc } from "./vault-ipc.js";
import { registerFavoritesIpc } from "./favorites-ipc.js";
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
  // ✅ Menu invisible mais fonctionnel — restaure Ctrl+C/V/Z/R et clic droit
  // setApplicationMenu(null) désactivait copier/coller/raccourcis standard
  const template = [
    {
      label: "Edit",
      submenu: [
        { role: "undo",      accelerator: "CmdOrCtrl+Z" },
        { role: "redo",      accelerator: "CmdOrCtrl+Y" },
        { type: "separator" },
        { role: "cut",       accelerator: "CmdOrCtrl+X" },
        { role: "copy",      accelerator: "CmdOrCtrl+C" },
        { role: "paste",     accelerator: "CmdOrCtrl+V" },
        { role: "selectAll", accelerator: "CmdOrCtrl+A" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload",         accelerator: "CmdOrCtrl+R" },
        { role: "forceReload",    accelerator: "CmdOrCtrl+Shift+R" },
        // ✅ F12 remplacé par Ctrl+Shift+I — évite conflit avec touche HP
        { role: "toggleDevTools", accelerator: "CmdOrCtrl+Shift+I" },
        { type: "separator" },
        { role: "resetZoom",      accelerator: "CmdOrCtrl+0" },
        // ✅ Zoom interface — QWERTY: Ctrl+= / AZERTY: Ctrl+Shift+= (même touche physique)
        { role: "zoomIn",         accelerator: "CmdOrCtrl+Equal" },
        { role: "zoomIn",         accelerator: "CmdOrCtrl+numadd" },
        { role: "zoomOut",        accelerator: "CmdOrCtrl+Minus" },
        { role: "zoomOut",        accelerator: "CmdOrCtrl+numsub" },
        // ✅ Zoom page web — fonctionne sur QWERTY et AZERTY
        { label: "Zoom page +",   accelerator: "CmdOrCtrl+Shift+Equal", click: () => {
          if (activeTabId && browserViews.has(activeTabId)) {
            const wc = browserViews.get(activeTabId).webContents;
            wc.setZoomLevel(wc.getZoomLevel() + 0.5);
          }
        }},
        { label: "Zoom page + (pavé)",   accelerator: "CmdOrCtrl+numadd", click: () => {
          if (activeTabId && browserViews.has(activeTabId)) {
            const wc = browserViews.get(activeTabId).webContents;
            wc.setZoomLevel(wc.getZoomLevel() + 0.5);
          }
        }},
        { label: "Zoom page -",   accelerator: "CmdOrCtrl+Shift+Minus", click: () => {
          if (activeTabId && browserViews.has(activeTabId)) {
            const wc = browserViews.get(activeTabId).webContents;
            wc.setZoomLevel(wc.getZoomLevel() - 0.5);
          }
        }},
        { label: "Zoom page - (pavé)",   accelerator: "CmdOrCtrl+numsub", click: () => {
          if (activeTabId && browserViews.has(activeTabId)) {
            const wc = browserViews.get(activeTabId).webContents;
            wc.setZoomLevel(wc.getZoomLevel() - 0.5);
          }
        }},
        { label: "Zoom page 100%", accelerator: "CmdOrCtrl+Shift+0", click: () => {
          if (activeTabId && browserViews.has(activeTabId)) {
            browserViews.get(activeTabId).webContents.setZoomLevel(0);
          }
        }},
        { type: "separator" },
        // ✅ F11 remplacé par Ctrl+Shift+F — évite conflit avec touche HP
        { role: "togglefullscreen", accelerator: "CmdOrCtrl+Shift+F" },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

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

  // ✅ Masquer la barre de menu — raccourcis clavier restent actifs
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);

  // ═══════════════════════════════════════════════════════════
  // ✅ CONFIDENTIALITÉ — DNS-over-HTTPS
  // ═══════════════════════════════════════════════════════════
  // Chiffre les requêtes DNS (le FAI ne voit plus en clair les domaines
  // consultés). Aucun coût de performance notable, aucun impact sur
  // Zoom/Teams (ce sont des apps qui gèrent leur propre résolution/relais).
  try {
    app.configureHostResolver({
      secureDnsMode: "secure",
      secureDnsServers: [
        "https://cloudflare-dns.com/dns-query",
        "https://dns.quad9.net/dns-query",
      ],
    });
  } catch (e) {
    console.warn("DNS-over-HTTPS non configuré :", e?.message);
  }

  // ═══════════════════════════════════════════════════════════
  // ✅ CONFIDENTIALITÉ — Fuite d'IP locale via WebRTC
  // ═══════════════════════════════════════════════════════════
  // "default_public_interface_only" : n'expose que l'IP publique dans les
  // candidats ICE WebRTC, jamais les IP locales (192.168.x.x, etc.) — ce qui
  // bloque une technique de fingerprinting/tracking classique. Contrairement
  // à "disable_non_proxied_udp", ce mode laisse les connexions UDP directes
  // fonctionner normalement (donc pas de relais TURN forcé) : aucune perte
  // de qualité/latence pour les appels vidéo (Zoom web, Teams web, Meet…).
  mainWindow.webContents.session.setWebRTCIPHandlingPolicy("default_public_interface_only");

  // ═══════════════════════════════════════════════════════════
  // ✅ CONFIDENTIALITÉ — En-tête Do Not Track
  // ═══════════════════════════════════════════════════════════
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders["DNT"] = "1";
    callback({ requestHeaders: details.requestHeaders });
  });

  // ═══════════════════════════════════════════════════════════
  // ✅ CONFIDENTIALITÉ — Blocage traqueurs/analytics connus
  // ═══════════════════════════════════════════════════════════
  // Liste volontairement restreinte à des domaines d'analytics/tracking
  // sans ambiguïté (pas de réseaux publicitaires larges qui pourraient
  // casser la mise en page ou des fonctionnalités de sites légitimes).
  // ⚠️ ALLOWLIST vérifiée en premier : garde-fou explicite pour ne jamais
  // bloquer Zoom/Teams/Meet même si la blocklist est étendue plus tard.
  const PRIVACY_ALLOWLIST = [
    "zoom.us", "zoomgov.com",
    "teams.microsoft.com", "teams.live.com", "microsoftteams.com",
    "meet.google.com", "gstatic.com", "googleapis.com",
    "hnaya.dz", "startpage.com",
  ];
  const TRACKER_BLOCKLIST = [
    "google-analytics.com", "googletagmanager.com", "analytics.google.com",
    "doubleclick.net", "facebook.com/tr", "connect.facebook.net",
    "hotjar.com", "mixpanel.com", "segment.io", "segment.com",
    "amplitude.com", "fullstory.com", "clarity.ms", "scorecardresearch.com",
  ];
  function isAllowlisted(host) {
    return PRIVACY_ALLOWLIST.some(h => host === h || host.endsWith("." + h));
  }
  function isTracker(url) {
    try {
      const { hostname } = new URL(url);
      if (isAllowlisted(hostname)) return false;
      return TRACKER_BLOCKLIST.some(h => hostname === h || hostname.endsWith("." + h) || url.includes(h));
    } catch { return false; }
  }
  mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (isTracker(details.url)) {
      callback({ cancel: true });
      return;
    }
    // ✅ Nettoie les paramètres de tracking de clic (utm_*, fbclid, gclid…)
    // uniquement sur la navigation de page principale — ne touche jamais
    // aux requêtes d'API/ressources (donc aucun risque de casser un site).
    if (details.resourceType === "mainFrame") {
      try {
        const u = new URL(details.url);
        const trackingParams = ["fbclid", "gclid", "msclkid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
        let changed = false;
        trackingParams.forEach(p => { if (u.searchParams.has(p)) { u.searchParams.delete(p); changed = true; } });
        if (changed) {
          callback({ redirectURL: u.toString() });
          return;
        }
      } catch { /* URL non standard (ex: about:blank) — on laisse passer */ }
    }
    callback({});
  });

  if (app.isPackaged) {
    appServe(mainWindow).then(() => mainWindow.loadURL("app://index.html"));
  } else {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.on("did-fail-load", () => mainWindow.webContents.reloadIgnoringCache());
  }
  mainWindow.on("closed", () => { mainWindow = null; });
};

// ✅ Codecs H.264/HTML5 — activés avant le démarrage de l'app
// Nécessaire sur certains sites médias qui vérifient le support vidéo
// Sans effet négatif si les codecs sont déjà présents
app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport,UseOzonePlatform");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// ✅ CONFIDENTIALITÉ — désactive le "bruit de fond" réseau de Chromium.
// Aucun de ces réglages ne touche au rendu de page, à la vidéo, à l'audio
// ou au WebRTC : ils coupent uniquement des requêtes internes de télémétrie
// / mise à jour de composants que Chromium envoie en arrière-plan, sans
// rapport avec les sites que tu visites (donc zéro impact Zoom/Teams).
app.commandLine.appendSwitch("disable-background-networking");   // pings de fond Chromium (mises à jour de composants, etc.)
app.commandLine.appendSwitch("disable-domain-reliability");      // rapports de fiabilité réseau envoyés à Google
app.commandLine.appendSwitch("disable-component-update");        // vérifie/télécharge des composants Chromium en tâche de fond
app.commandLine.appendSwitch("no-pings");                        // désactive l'attribut HTML <a ping> (tracking de clics natif du navigateur)

app.on("ready", async () => {
  createWindow();
  // ✅ Recalculer les vues au plein écran / sortie plein écran
  app.on("browser-window-created", (_, win) => {
    win.on("enter-full-screen", () => setTimeout(updateBrowserViewSize, 100));
    win.on("leave-full-screen",  () => setTimeout(updateBrowserViewSize, 100));
    win.on("resize",             () => setTimeout(updateBrowserViewSize, 50));
  });
  // ✅ Téléchargement images avec dialogue de sauvegarde
  // ⚠️ Verrou anti-doublon : "will-download" peut être émis deux fois pour la
  // même image lors d'un clic sur "Enregistrer l'image" (comportement Chromium
  // connu avec webContents.downloadURL — la ressource peut être re-signalée une
  // seconde fois très rapidement). Sans ce verrou, deux dialogues de sauvegarde
  // s'ouvrent pour un seul clic.
  const recentDownloadUrls = new Map(); // url -> timestamp
  mainWindow.webContents.session.on("will-download", async (event, item) => {
    const sourceUrl = item.getURL();
    const now = Date.now();
    const lastTime = recentDownloadUrls.get(sourceUrl);
    if (lastTime && now - lastTime < 1500) {
      // Doublon détecté — on annule silencieusement ce second événement
      item.cancel();
      return;
    }
    recentDownloadUrls.set(sourceUrl, now);
    // ✅ Déterminer l'extension correcte depuis le mimeType
    let filename = item.getFilename();
    const mime = item.getMimeType();
    if (mime === "image/webp" && !filename.toLowerCase().endsWith(".webp")) {
      filename = filename.replace(/\.[^/.]+$/, "") + ".webp";
    } else if (mime === "image/jpeg" && !filename.match(/\.(jpg|jpeg)$/i)) {
      filename = filename + ".jpg";
    } else if (mime === "image/png" && !filename.toLowerCase().endsWith(".png")) {
      filename = filename + ".png";
    } else if (!filename.includes(".")) {
      // Pas d'extension — en déduire depuis le mimeType
      const extMap = { "image/webp": ".webp", "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif" };
      filename = filename + (extMap[mime] || "");
    }

    // ✅ Dialogue de sauvegarde — l'utilisateur choisit le dossier et le nom
    // ⚠️ NE PAS appeler event.preventDefault() ici : sur "will-download",
    // preventDefault() annule le téléchargement IMMÉDIATEMENT et de façon
    // synchrone. Le dialogue "showSaveDialog" est asynchrone (await), donc
    // au moment où on essaie de faire item.setSavePath(), l'item est déjà
    // annulé — c'est pour ça que la fenêtre se fermait sans rien enregistrer.
    // La bonne approche : mettre l'item en pause (ce qui NE l'annule PAS),
    // attendre le dialogue, puis reprendre avec le bon chemin, ou annuler
    // explicitement seulement si l'utilisateur a cliqué "Annuler".
    item.pause();
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: "Enregistrer l'image",
      defaultPath: join(app.getPath("downloads"), filename),
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        { name: "Tous les fichiers", extensions: ["*"] },
      ],
    });

    if (!canceled && filePath) {
      item.setSavePath(filePath);
      item.once("done", (event, state) => {
        if (state === "completed") shell.showItemInFolder(filePath);
      });
      if (item.isPaused()) item.resume();
    } else {
      item.cancel();
    }
  });
  // ✅ Autoriser le partage d'écran et l'accès caméra/micro dans les onglets
mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
  const allowedPermissions = ["media", "display-capture", "screen"];
  callback(allowedPermissions.includes(permission));
});

mainWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
  // Laisser Electron gérer la sélection de source d'écran
  callback({ video: "screen" });
});
  // ✅ Initialiser le gestionnaire de mots de passe
  registerVaultIpc(
    () => mainWindow,
    () => browserViews,
    () => activeTabId
  );
  registerFavoritesIpc(
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
    // Mode sidebar — la vue prend toute la hauteur à gauche de la sidebar
    view.setBounds({ x: 0, y: 0, width: width - tabSideWidth, height });
  } else {
    // Mode top — tabbar (6vh) + navbar (6vh) = 12vh de hauteur fixe
    // On utilise des pixels calculés depuis la vraie hauteur de la fenêtre
    // plutôt que Math.round(height * 0.12) qui peut diverger de 12vh selon la résolution
    const marginTop = Math.round(height * 0.12);
    // ✅ S'assurer que la vue couvre bien toute la zone sous les barres
    view.setBounds({
      x: 0,
      y: marginTop,
      width,
      height: height - marginTop
    });
  }
};

// ✅ Recalculer la taille au redimensionnement et au plein écran
const scheduleResize = () => setTimeout(updateBrowserViewSize, 50);

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

    // ✅ Menu contextuel clic droit dans les onglets de navigation
    view.webContents.on("context-menu", (event, params) => {
      const menuItems = [];

      if (params.selectionText) {
        menuItems.push(
          { label: "Copier",           role: "copy",        accelerator: "CmdOrCtrl+C" },
          { type: "separator" },
        );
      }
      if (params.mediaType === "image" || params.srcURL) {
  menuItems.push(
    { label: "Enregistrer l'image", click: () => {
      browserViews.get(activeTabId)?.webContents.downloadURL(params.srcURL);
    }},
    { label: "Copier l'adresse de l'image", click: () => {
      clipboard.writeText(params.srcURL);
    }},
    { type: "separator" },
  );
}
      if (params.isEditable) {
        menuItems.push(
          { label: "Couper",           role: "cut",         accelerator: "CmdOrCtrl+X" },
          { label: "Copier",           role: "copy",        accelerator: "CmdOrCtrl+C" },
          { label: "Coller",           role: "paste",       accelerator: "CmdOrCtrl+V" },
          { label: "Tout sélectionner",role: "selectAll",   accelerator: "CmdOrCtrl+A" },
          { type: "separator" },
        );
      }
      if (params.linkURL) {
        menuItems.push(
          { label: "Ouvrir le lien dans un nouvel onglet", click: () => {
            mainWindow.webContents.send("new-tab-url", params.linkURL);
          }},
          { label: "Copier l'adresse du lien", click: () => {
            clipboard.writeText(params.linkURL);
          }},
          { type: "separator" },
        );
      }
      menuItems.push(
        { label: "Recharger la page",  click: () => view.webContents.reload() },
        { label: "Précédent",          click: () => { if (view.webContents.navigationHistory?.canGoBack()) view.webContents.navigationHistory.goBack(); } },
        { label: "Suivant",            click: () => { if (view.webContents.navigationHistory?.canGoForward()) view.webContents.navigationHistory.goForward(); } },
        { type: "separator" },
        { label: "Copier l'URL de la page", click: () => {
          clipboard.writeText(view.webContents.getURL());
        }},
      );

      const contextMenu = Menu.buildFromTemplate(menuItems);
      contextMenu.popup({ window: mainWindow });
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
