import { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, screen, clipboard } from "electron";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn, fork } from "child_process";
import { existsSync, createReadStream, statSync, readFileSync, writeFileSync } from "fs";
import http from "http";
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

// ═══════════════════════════════════════════════════════════════
// Serveur statique local pour la version packagée
// ═══════════════════════════════════════════════════════════════
// ⚠️ REMPLACE electron-serve (protocole app://). Raison : sous l'origine
// opaque « app:// », Google Custom Search (recherche « Algérie » de la
// page d'accueil) REFUSE de s'initialiser — referrer vide, origine non
// http(s). Résultat : la recherche Algérie ne rendait aucun résultat dans
// le .exe alors qu'elle marche en dev (http://localhost:3000). En servant
// out/ sur http://127.0.0.1, la version packagée retrouve une vraie
// origine http et se comporte comme le dev (bonus : localhost est un
// « secure context » Chromium — WebCrypto/PWA disponibles pour le futur).
// Diagnostic complet : origine app:// prouvée bloquante au débogage distant.
//
// ⚠️ PORT FIXE OBLIGATOIRE : localStorage (thème, image de fond, langue,
// pseudo chat) est indexé par ORIGINE = scheme://host:PORT. Un port
// aléatoire changerait l'origine à chaque lancement → réglages remis à
// zéro à chaque démarrage. Le port fixe garantit une origine stable, donc
// des réglages persistants. (Vault et favoris sont stockés en fichier via
// app.getPath — eux ne dépendent pas de l'origine.)
const STATIC_PORT = 47823; // port local fixe, arbitraire et peu courant

// ═══════════════════════════════════════════════════════════════
// CONFIDENTIALITÉ — interrupteurs utilisateur
// ═══════════════════════════════════════════════════════════════
// Les protections « toujours actives » (DNS-over-HTTPS, anti-fuite WebRTC,
// Do Not Track, anti-bruit Chromium) ne présentent aucun risque fonctionnel
// et n'ont pas d'interrupteur. Les DEUX protections qui PEUVENT casser un
// site légitime (ex. « Login with Facebook » via connect.facebook.net, ou
// des fonctionnalités chargées par googletagmanager.com) sont désactivables
// par l'utilisateur depuis le panneau Confidentialité :
//   - blockTrackers : blocage de la TRACKER_BLOCKLIST
//   - cleanLinks    : suppression des paramètres de suivi (utm_*, fbclid…)
// Défaut : activées (cohérent avec le positionnement privacy-first).
// L'état vit ici (main process, là où tourne le filtre réseau) et persiste
// dans userData/privacy-settings.json. Le filtre consulte l'objet EN DIRECT
// à chaque requête → un changement s'applique immédiatement, sans
// redémarrage. Chargé dans app.on("ready") AVANT createWindow pour que la
// toute première requête respecte déjà le choix de l'utilisateur.
let privacySettings = { blockTrackers: true, cleanLinks: true };
const privacySettingsPath = () => join(app.getPath("userData"), "privacy-settings.json");

function loadPrivacySettings() {
  try {
    const saved = JSON.parse(readFileSync(privacySettingsPath(), "utf8"));
    if (typeof saved?.blockTrackers === "boolean") privacySettings.blockTrackers = saved.blockTrackers;
    if (typeof saved?.cleanLinks === "boolean") privacySettings.cleanLinks = saved.cleanLinks;
  } catch { /* premier lancement ou fichier corrompu — on garde les défauts */ }
}

function savePrivacySettings() {
  try {
    writeFileSync(privacySettingsPath(), JSON.stringify(privacySettings, null, 2), "utf8");
  } catch (e) {
    console.warn("Réglages confidentialité non sauvegardés :", e?.message);
  }
}
const STATIC_MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".map": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

function startStaticServer() {
  const root = join(__dirname, "../out");
  // Résout un chemin de requête vers un fichier réel de l'export Next.
  // Next `output: export` génère index.html, browser.html, results.html,
  // 404.html + _next/… — on essaie fichier exact, puis .html, puis
  // /index.html, avec garde-fou anti-traversée de répertoire.
  const resolveFile = (urlPath) => {
    let p = decodeURIComponent(urlPath.split("?")[0]);
    if (p === "/" || p === "") p = "/index.html";
    const candidates = [p, p + ".html", join(p, "index.html")];
    for (const c of candidates) {
      const abs = join(root, c);
      // Anti-traversée : le chemin résolu doit rester sous root
      if (!abs.startsWith(root)) continue;
      try { if (statSync(abs).isFile()) return abs; } catch { /* n'existe pas */ }
    }
    return null;
  };

  const makeServer = () => http.createServer((req, res) => {
    let file = resolveFile(req.url);
    let status = 200;
    if (!file) {
      // Repli SPA : 404.html si présent, sinon index.html
      file = resolveFile("/404.html") || resolveFile("/index.html");
      status = file && file.endsWith("404.html") ? 404 : 200;
    }
    if (!file) { res.writeHead(404); res.end("Not found"); return; }
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    res.writeHead(status, { "Content-Type": STATIC_MIME[ext] || "application/octet-stream" });
    createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => {
    const server = makeServer();
    // Boucle locale (127.0.0.1) uniquement — jamais exposé au réseau.
    server.listen(STATIC_PORT, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${STATIC_PORT}`);
    });
    server.on("error", (err) => {
      // Port occupé (autre appli, ou instance précédente pas encore libérée).
      // Repli sur un port éphémère : l'app fonctionne toujours ; seuls les
      // réglages localStorage de CETTE session diffèreraient — cas rare et
      // dégradé proprement plutôt qu'un écran blanc.
      console.warn(`[static] Port ${STATIC_PORT} indisponible (${err.code}) — repli éphémère`);
      const fallback = makeServer();
      fallback.listen(0, "127.0.0.1", () => {
        resolve(`http://127.0.0.1:${fallback.address().port}`);
      });
    });
  });
}

let staticServerUrl = null;
let mainWindow = null;
const browserViews = new Map();
let activeTabId = null;
let tabSideWidth = 0;
// Largeur réservée au dock Messagerie locale (0 = fermé) — même principe
// que tabSideWidth : la WebContentsView est rétrécie pour laisser la
// colonne React visible à droite, l'utilisateur discute EN voyant la page
let chatDockWidth = 0;

// ── Langue des libellés NATIFS (menu contextuel, boîtes de dialogue) ───────
// Le renderer envoie la langue choisie via "set-app-language". Sans ça,
// clic droit et dialogues restaient codés en dur en français même quand
// l'interface est en arabe — pas « natif » pour la cible arabophone.
let appLang = "ar"; // même défaut que l'interface (layout lang="ar")
const NATIVE_LABELS = {
  ar: { copy: "نسخ", cut: "قص", paste: "لصق", selectAll: "تحديد الكل",
        saveImage: "حفظ الصورة", copyImageUrl: "نسخ عنوان الصورة",
        openLinkNewTab: "فتح الرابط في لسان جديد", copyLinkUrl: "نسخ عنوان الرابط",
        reloadPage: "إعادة تحميل الصفحة", back: "السابق", forward: "التالي",
        copyPageUrl: "نسخ عنوان الصفحة", images: "الصور", allFiles: "كل الملفات",
        chooseFolder: "اختر مجلد التحميل",
        noSuggestions: "لا توجد اقتراحات", addToDictionary: "إضافة إلى القاموس" },
  fr: { copy: "Copier", cut: "Couper", paste: "Coller", selectAll: "Tout sélectionner",
        saveImage: "Enregistrer l'image", copyImageUrl: "Copier l'adresse de l'image",
        openLinkNewTab: "Ouvrir le lien dans un nouvel onglet", copyLinkUrl: "Copier l'adresse du lien",
        reloadPage: "Recharger la page", back: "Précédent", forward: "Suivant",
        copyPageUrl: "Copier l'URL de la page", images: "Images", allFiles: "Tous les fichiers",
        chooseFolder: "Choisir le dossier de téléchargement",
        noSuggestions: "Aucune suggestion", addToDictionary: "Ajouter au dictionnaire" },
  en: { copy: "Copy", cut: "Cut", paste: "Paste", selectAll: "Select all",
        saveImage: "Save image", copyImageUrl: "Copy image address",
        openLinkNewTab: "Open link in new tab", copyLinkUrl: "Copy link address",
        reloadPage: "Reload page", back: "Back", forward: "Forward",
        copyPageUrl: "Copy page URL", images: "Images", allFiles: "All files",
        chooseFolder: "Choose download folder",
        noSuggestions: "No suggestions", addToDictionary: "Add to dictionary" },
};
const nativeT = (key) => (NATIVE_LABELS[appLang] || NATIVE_LABELS.fr)[key] || key;

// ✅ Correcteur orthographique — items de menu contextuel pour un mot
// souligné : suggestions du dictionnaire + « Ajouter au dictionnaire ».
// Chromium soulignait déjà les fautes, mais nos menus personnalisés
// n'exposaient PAS les corrections (retour de test terrain : « le clic
// droit ne propose pas de correction »). Utilisé pour la fenêtre
// principale (champ de la messagerie, barre d'adresse) ET les vues web.
function spellingMenuItems(webContents, params) {
  if (!params.misspelledWord) return [];
  const items = (params.dictionarySuggestions || []).slice(0, 5).map((s) => ({
    label: s,
    click: () => webContents.replaceMisspelling(s),
  }));
  if (items.length === 0) items.push({ label: nativeT("noSuggestions"), enabled: false });
  items.push(
    { label: nativeT("addToDictionary"),
      click: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
    { type: "separator" },
  );
  return items;
}
// Référence au process yt-dlp en cours (pour l'annulation)
let activeDownloadProc = null;

// ── Chat local (LAN) — module complémentaire, désactivé par défaut ─────────
// ⚠️ Ce module est un package Node séparé (chat-module/) avec sa propre
// dépendance "ws" — jamais installée dans le navigateur principal. Il n'est
// lancé (fork) que si l'utilisateur active la fonctionnalité depuis l'UI.
// Voir chat-module/README.md pour l'architecture complète.
const chatModulePath = app.isPackaged
  ? join(process.resourcesPath, "chat-module", "src", "worker.js")
  : join(__dirname, "..", "chat-module", "src", "worker.js");
let chatWorker = null; // process enfant (fork) du module de chat, null si inactif

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
  // ⚠️ API Electron : setWebRTCIPHandlingPolicy est une méthode de
  // webContents, PAS de session — l'appel via session.* jetait un
  // TypeError qui interrompait createWindow AVANT loadURL : fenêtre
  // blanche sur la version packagée (bug détecté au premier build réel).
  // La même politique est appliquée à chaque vue de navigation dans
  // "open-tab" — c'est là que la fuite d'IP se produirait réellement.
  mainWindow.webContents.setWebRTCIPHandlingPolicy("default_public_interface_only");

  // ═══════════════════════════════════════════════════════════
  // ✅ CONFIDENTIALITÉ — En-tête Do Not Track
  // ═══════════════════════════════════════════════════════════
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders["DNT"] = "1";
    callback({ requestHeaders: details.requestHeaders });
  });

  // ✅ Correcteur orthographique multilingue sur la session partagée
  // (fenêtre principale + vues web). AR/FR/EN ensemble : les utilisateurs
  // cibles alternent couramment entre les trois dans un même champ.
  try {
    mainWindow.webContents.session.setSpellCheckerLanguages(["ar", "fr", "en-US"]);
  } catch (e) {
    console.warn("Langues du correcteur non configurées :", e?.message);
  }

  // ✅ Menu contextuel de la FENÊTRE PRINCIPALE (champ de la messagerie,
  // barre d'adresse, panneaux) — sans lui, le clic droit n'affichait
  // RIEN dans l'interface de l'application : impossible de coller une
  // adresse ou d'appliquer une correction orthographique.
  mainWindow.webContents.on("context-menu", (event, params) => {
    const menuItems = [];
    if (params.isEditable) {
      menuItems.push(
        ...spellingMenuItems(mainWindow.webContents, params),
        { label: nativeT("cut"),       role: "cut",       accelerator: "CmdOrCtrl+X" },
        { label: nativeT("copy"),      role: "copy",      accelerator: "CmdOrCtrl+C" },
        { label: nativeT("paste"),     role: "paste",     accelerator: "CmdOrCtrl+V" },
        { label: nativeT("selectAll"), role: "selectAll", accelerator: "CmdOrCtrl+A" },
      );
    } else if (params.selectionText) {
      menuItems.push({ label: nativeT("copy"), role: "copy", accelerator: "CmdOrCtrl+C" });
    }
    if (menuItems.length === 0) return; // rien d'utile — pas de menu vide
    Menu.buildFromTemplate(menuItems).popup({ window: mainWindow });
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
    // Interrupteurs utilisateur (panneau Confidentialité) consultés en
    // direct — privacySettings est mis à jour par "privacy-set-settings".
    if (privacySettings.blockTrackers && isTracker(details.url)) {
      callback({ cancel: true });
      return;
    }
    // ✅ Nettoie les paramètres de tracking de clic (utm_*, fbclid, gclid…)
    // uniquement sur la navigation de page principale — ne touche jamais
    // aux requêtes d'API/ressources (donc aucun risque de casser un site).
    if (privacySettings.cleanLinks && details.resourceType === "mainFrame") {
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
    // staticServerUrl est prêt (démarré dans app.on("ready") avant createWindow)
    mainWindow.loadURL(staticServerUrl);
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
  // Interrupteurs confidentialité : lus AVANT createWindow pour que le
  // filtre réseau respecte le choix de l'utilisateur dès la 1re requête
  loadPrivacySettings();
  // Démarre le serveur statique AVANT de créer la fenêtre (packagé seulement)
  if (app.isPackaged) {
    staticServerUrl = await startStaticServer();
  }
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
      title: nativeT("saveImage"),
      defaultPath: join(app.getPath("downloads"), filename),
      filters: [
        { name: nativeT("images"), extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        { name: nativeT("allFiles"), extensions: ["*"] },
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
    // (et du dock messagerie s'il est ouvert)
    view.setBounds({ x: 0, y: 0, width: width - tabSideWidth - chatDockWidth, height });
  } else {
    // Mode top — tabbar (6vh) + navbar (6vh) = 12vh de hauteur fixe
    // On utilise des pixels calculés depuis la vraie hauteur de la fenêtre
    // plutôt que Math.round(height * 0.12) qui peut diverger de 12vh selon la résolution
    const marginTop = Math.round(height * 0.12);
    // ✅ S'assurer que la vue couvre bien toute la zone sous les barres,
    // moins la colonne du dock messagerie s'il est ouvert
    view.setBounds({
      x: 0,
      y: marginTop,
      width: width - chatDockWidth,
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

// ✅ Dock Messagerie locale — réserve/libère la colonne de droite
ipcMain.on("chat-dock", (event, width) => {
  chatDockWidth = Math.max(0, Number(width) || 0);
  updateBrowserViewSize();
});

// ✅ Langue des libellés natifs — synchronisée depuis langcontext.tsx
ipcMain.on("set-app-language", (event, lang) => {
  if (["ar", "fr", "en"].includes(lang)) appLang = lang;
});

// ✅ Interrupteurs confidentialité (panneau Confidentialité du renderer).
// Le filtre réseau lit privacySettings à chaque requête → effet immédiat.
ipcMain.handle("privacy-get-settings", () => ({ ...privacySettings }));

ipcMain.on("privacy-set-settings", (event, partial) => {
  if (!partial || typeof partial !== "object") return;
  if (typeof partial.blockTrackers === "boolean") privacySettings.blockTrackers = partial.blockTrackers;
  if (typeof partial.cleanLinks === "boolean") privacySettings.cleanLinks = partial.cleanLinks;
  savePrivacySettings();
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
    title: nativeT("chooseFolder"),
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
// Chat local (LAN) — module complémentaire, fork à la demande uniquement
// ⚠️ Voir chat-module/README.md pour l'architecture complète avant de
// modifier quoi que ce soit ici.

function ensureChatWorker() {
  if (chatWorker) return chatWorker;
  if (!existsSync(chatModulePath)) {
    console.warn("[hnaya-chat] Module introuvable :", chatModulePath);
    return null;
  }
  chatWorker = fork(chatModulePath, [], { silent: false });

  // Relaie chaque événement du worker vers le renderer via un seul canal
  // ("chat-event") — évite d'avoir à whitelister un canal par type
  // d'événement dans preload.js (voir TECHNIQUES.md section 1).
  chatWorker.on("message", (msg) => {
    mainWindow?.webContents.send("chat-event", msg);
  });
  chatWorker.on("exit", () => { chatWorker = null; });
  chatWorker.on("error", (err) => {
    console.error("[hnaya-chat] Erreur worker :", err.message);
    mainWindow?.webContents.send("chat-event", { event: "error", message: err.message });
  });
  return chatWorker;
}

ipcMain.handle("chat-start-host", async (event, sessionName) => {
  const worker = ensureChatWorker();
  if (!worker) return { ok: false, error: "module-not-found" };
  worker.send({ cmd: "start-host", sessionName });
  return { ok: true };
});

ipcMain.on("chat-stop-host", () => { chatWorker?.send({ cmd: "stop-host" }); });

ipcMain.on("chat-discover", (event, timeoutMs) => {
  ensureChatWorker()?.send({ cmd: "discover", timeoutMs });
});

ipcMain.on("chat-join", (event, joinParams) => {
  ensureChatWorker()?.send({ cmd: "join", ...joinParams });
});

ipcMain.on("chat-send-message", (event, { text, groupId, media }) => {
  chatWorker?.send({ cmd: "send-message", text, groupId, media });
});

ipcMain.on("chat-mark-read", (event, { messageId, groupId }) => {
  chatWorker?.send({ cmd: "mark-read", messageId, groupId });
});

ipcMain.on("chat-leave", () => { chatWorker?.send({ cmd: "leave" }); });

// ── Pare-feu Windows — autorisation réseau adaptative ──────────────────────
// Le poste qui HÉBERGE un salon doit accepter des connexions ENTRANTES :
// TCP 4802 (messages) et UDP 41234 (découverte). Sans règle de pare-feu,
// les autres postes VOIENT le salon (le beacon sortant passe toujours)
// mais ne peuvent pas s'y connecter — symptôme : « Connexion… » qui expire
// côté client. L'alerte Windows native ne suffit pas : (1) elle ne couvre
// que le profil coché (souvent « Privé » alors que le wifi est classé
// « Public »), (2) un clic sur « Annuler » crée une règle de BLOCAGE
// persistante qui prime sur toute autorisation ultérieure, (3) le salon
// tourne dans un process séparé du navigateur.
// Solution : vérifier nos règles nommées avant d'héberger, et les créer
// après élévation UAC (autorisation utilisateur/admin), avec une portée
// limitée au sous-réseau local (-RemoteAddress LocalSubnet) et tous
// profils (-Profile Any) — fonctionne donc aussi sur un point d'accès
// mobile classé « Public ».
const FIREWALL_RULE_TCP = "Hnaya Messagerie locale (TCP 4802)";
const FIREWALL_RULE_UDP = "Hnaya Messagerie locale (UDP 41234)";
// Accès mobile (C-bis) : page web servie aux téléphones sur le port 4803
const FIREWALL_RULE_HTTP = "Hnaya Messagerie locale (TCP 4803 mobile)";
// Version du dispositif : incrémentée quand une NOUVELLE règle devient
// nécessaire (v2 = ajout du port mobile 4803). Un drapeau d'une version
// antérieure ne vaut plus « configuré » — l'utilisateur verra une nouvelle
// demande d'autorisation, une seule fois.
const NETWORK_SETUP_VERSION = 2;

function runPowerShell(args) {
  return new Promise((resolve) => {
    const proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { windowsHide: true });
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("close", (code) => resolve({ code, out: out.trim() }));
    proc.on("error", () => resolve({ code: -1, out: "" }));
  });
}

// ⚠️ Sur certains postes (compte restreint, antivirus tiers qui verrouille
// le pare-feu), MÊME LA LECTURE des règles est refusée en session normale
// (« Accès refusé » CIM, observé en test multi-postes). Il faut donc
// distinguer « règles absentes » de « lecture impossible » — sinon l'app
// redemande l'UAC à chaque fois et signale de faux échecs.
async function checkFirewallRules() {
  if (process.platform !== "win32") return { rulesOk: true, readable: true };
  const { out } = await runPowerShell(["-Command",
    "try { " +
    "$null = Get-NetFirewallRule -ErrorAction Stop | Select-Object -First 1; " +
    "$t = Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_TCP + "' -ErrorAction SilentlyContinue; " +
    "$u = Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_UDP + "' -ErrorAction SilentlyContinue; " +
    "$m = Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_HTTP + "' -ErrorAction SilentlyContinue; " +
    "Write-Output ('READ|' + [string]([bool]$t -and [bool]$u -and [bool]$m)) " +
    "} catch { Write-Output 'DENIED|False' }",
  ]);
  const [access, ok] = (out || "DENIED|False").split("|");
  return { readable: access === "READ", rulesOk: ok === "True" };
}

// Drapeau local « configuration réseau déjà réussie sur ce poste » —
// indispensable sur les postes où la lecture du pare-feu est refusée :
// sans lui, impossible de savoir qu'une configuration a déjà eu lieu,
// et l'UAC serait redemandée à chaque création de salon.
function networkSetupFlagPath() {
  return join(app.getPath("userData"), "chat-network-setup.json");
}

// ⚠️ PowerShell est LENT à démarrer sur les machines modestes (5-10 s
// observées) — sans cache ni raccourci, chaque clic sur « Créer un salon »
// gelait l'interface pendant toute la vérification. Ordre des contrôles :
// 1) cache mémoire (instantané, une vérification max par session) ;
// 2) drapeau local d'une configuration déjà réussie (instantané —
//    compromis assumé : si l'utilisateur supprime les règles à la main,
//    il ne sera pas re-sollicité ; le message connectionTimeout côté
//    client oriente alors vers le pare-feu) ;
// 3) vérification PowerShell réelle, en dernier recours.
let networkCheckCache = null;

ipcMain.handle("chat-network-check", async () => {
  if (networkCheckCache) return networkCheckCache;
  // Le drapeau ne vaut que pour la version courante du dispositif : un
  // drapeau v1 (avant le port mobile 4803) déclenche une nouvelle
  // autorisation — sinon les téléphones ne pourraient jamais atteindre la
  // page d'invitation sur les postes configurés avant la mise à jour.
  try {
    const flag = JSON.parse(readFileSync(networkSetupFlagPath(), "utf8"));
    if (flag?.done && (flag.setupVersion || 1) >= NETWORK_SETUP_VERSION) {
      networkCheckCache = { rulesOk: true };
      return networkCheckCache;
    }
  } catch { /* pas de drapeau — vérification réelle ci-dessous */ }
  const check = await checkFirewallRules();
  if (check.rulesOk) {
    networkCheckCache = { rulesOk: true };
    return networkCheckCache;
  }
  return { rulesOk: false };
});

// Préchauffage : forker le worker dès l'ouverture du panneau plutôt qu'au
// premier clic — sur disque dur lent, le fork (chargement d'un binaire
// Electron complet en mode Node) peut prendre plusieurs secondes qui
// s'ajoutaient au délai ressenti sur « Créer » / « Rejoindre ».
ipcMain.on("chat-warmup", () => { ensureChatWorker(); });

ipcMain.handle("chat-network-setup", async () => {
  if (process.platform !== "win32") return { ok: true };
  const exe = process.execPath.replace(/'/g, "''");
  const { writeFileSync, mkdtempSync, readFileSync } = await import("fs");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "hnaya-fw-"));
  const ps1 = join(dir, "hnaya-firewall.ps1");
  // Le script élevé dépose son verdict ici — c'est LUI qui vérifie les
  // règles après création (il a toujours le droit de lecture, même quand
  // la session normale ne l'a pas — cas « Accès refusé » observé).
  const resultFile = join(dir, "result.txt");
  const resultEsc = resultFile.replace(/'/g, "''");
  // Script élevé : supprime nos anciennes règles + toute règle de BLOCAGE
  // héritée d'un refus de l'alerte Windows (un Block prime sur un Allow),
  // recrée les deux règles limitées au sous-réseau local, puis vérifie
  // et écrit OK/FAIL dans le fichier de résultat.
  // ⚠️ Contenu ASCII uniquement — PowerShell 5.1 lit les .ps1 sans BOM en
  // ANSI, des accents y seraient corrompus.
  const script = [
    "$exe = '" + exe + "'",
    "Remove-NetFirewallRule -DisplayName '" + FIREWALL_RULE_TCP + "' -ErrorAction SilentlyContinue",
    "Remove-NetFirewallRule -DisplayName '" + FIREWALL_RULE_UDP + "' -ErrorAction SilentlyContinue",
    "Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue | Where-Object { $dn = $_.DisplayName; ($dn -like '*hnaya*') -or ($dn -like '*electron*') -or ($dn -like '*node*') } | Where-Object { ($_ | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue).Program -ieq $exe } | Remove-NetFirewallRule -ErrorAction SilentlyContinue",
    // « Créer seulement si absent » plutôt que supprimer-puis-créer :
    // Kaspersky (observé sur poste de test) peut bloquer la SUPPRESSION
    // de règles même en élévation tout en autorisant la création — le
    // remove+create y produit des règles en double à chaque exécution.
    "if (-not (Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_TCP + "' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '" + FIREWALL_RULE_TCP + "' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4802 -Program $exe -RemoteAddress LocalSubnet -Profile Any | Out-Null }",
    "if (-not (Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_UDP + "' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '" + FIREWALL_RULE_UDP + "' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 41234 -Program $exe -RemoteAddress LocalSubnet -Profile Any | Out-Null }",
    "if (-not (Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_HTTP + "' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '" + FIREWALL_RULE_HTTP + "' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4803 -Program $exe -RemoteAddress LocalSubnet -Profile Any | Out-Null }",
    "$t = Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_TCP + "' -ErrorAction SilentlyContinue",
    "$u = Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_UDP + "' -ErrorAction SilentlyContinue",
    "$m = Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_HTTP + "' -ErrorAction SilentlyContinue",
    "if ($t -and $u -and $m) { Set-Content -LiteralPath '" + resultEsc + "' -Value 'OK' } else { Set-Content -LiteralPath '" + resultEsc + "' -Value 'FAIL' }",
    "exit 0",
  ].join("\r\n");
  writeFileSync(ps1, script, "utf8");

  // -Verb RunAs → invite UAC : l'utilisateur (ou l'admin du poste, si le
  // compte courant n'est pas administrateur) accorde l'autorisation.
  const { code } = await runPowerShell(["-Command",
    "try { $p = Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"" + ps1.replace(/'/g, "''") + "\"'; exit $p.ExitCode } catch { exit 125 }",
  ]);

  // ⚠️ Ne PAS conclure sur le code de sortie : avec -Verb RunAs, relire
  // $p.ExitCode depuis un process non-élevé échoue sur certaines machines
  // alors que le script a bien réussi. Deux vérités terrain, dans l'ordre :
  // 1) re-lecture directe des règles (si la session y a droit) ;
  // 2) verdict écrit par le script élevé (couvre les postes où la lecture
  //    non-élevée du pare-feu est « Accès refusé »).
  const check = await checkFirewallRules();
  let ok = check.readable && check.rulesOk;
  if (!ok) {
    try { ok = readFileSync(resultFile, "utf8").trim() === "OK"; }
    catch { /* fichier absent = le script n'a jamais tourné (UAC refusée) */ }
  }
  if (ok) {
    // Mémorise la réussite — évite de redemander l'UAC sur les postes où
    // la vérification directe restera à jamais impossible.
    try { writeFileSync(networkSetupFlagPath(), JSON.stringify({ done: true, setupVersion: NETWORK_SETUP_VERSION, ts: Date.now() })); } catch {}
    networkCheckCache = { rulesOk: true };
    return { ok: true };
  }
  return { ok: false, refused: code === 125 };
});

// ✅ Fermeture propre : le worker reçoit "disconnect" (fork() le fait
// automatiquement au kill du process parent), qui déclenche son propre
// nettoyage (voir worker.js) — mais on force l'arrêt explicitement au cas
// où l'utilisateur ferme le navigateur sans passer par app.quit().
app.on("before-quit", () => {
  if (chatWorker) {
    chatWorker.kill();
    chatWorker = null;
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

    // ✅ CONFIDENTIALITÉ — même politique WebRTC que la fenêtre principale.
    // L'API est PAR-webContents (pas par session) : chaque vue de
    // navigation doit recevoir la sienne, sinon les sites visités
    // peuvent lire l'IP locale via les candidats ICE.
    view.webContents.setWebRTCIPHandlingPolicy("default_public_interface_only");

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

      // ✅ Libellés via nativeT() — suivent la langue de l'interface (AR/FR/EN)
      if (params.selectionText) {
        menuItems.push(
          { label: nativeT("copy"),    role: "copy",        accelerator: "CmdOrCtrl+C" },
          { type: "separator" },
        );
      }
      if (params.mediaType === "image" || params.srcURL) {
  menuItems.push(
    { label: nativeT("saveImage"), click: () => {
      browserViews.get(activeTabId)?.webContents.downloadURL(params.srcURL);
    }},
    { label: nativeT("copyImageUrl"), click: () => {
      clipboard.writeText(params.srcURL);
    }},
    { type: "separator" },
  );
}
      if (params.isEditable) {
        menuItems.push(
          // Suggestions du correcteur en tête — le réflexe universel du
          // clic droit sur un mot souligné
          ...spellingMenuItems(view.webContents, params),
          { label: nativeT("cut"),       role: "cut",         accelerator: "CmdOrCtrl+X" },
          { label: nativeT("copy"),      role: "copy",        accelerator: "CmdOrCtrl+C" },
          { label: nativeT("paste"),     role: "paste",       accelerator: "CmdOrCtrl+V" },
          { label: nativeT("selectAll"), role: "selectAll",   accelerator: "CmdOrCtrl+A" },
          { type: "separator" },
        );
      }
      if (params.linkURL) {
        menuItems.push(
          { label: nativeT("openLinkNewTab"), click: () => {
            mainWindow.webContents.send("new-tab-url", params.linkURL);
          }},
          { label: nativeT("copyLinkUrl"), click: () => {
            clipboard.writeText(params.linkURL);
          }},
          { type: "separator" },
        );
      }
      menuItems.push(
        { label: nativeT("reloadPage"), click: () => view.webContents.reload() },
        { label: nativeT("back"),       click: () => { if (view.webContents.navigationHistory?.canGoBack()) view.webContents.navigationHistory.goBack(); } },
        { label: nativeT("forward"),    click: () => { if (view.webContents.navigationHistory?.canGoForward()) view.webContents.navigationHistory.goForward(); } },
        { type: "separator" },
        { label: nativeT("copyPageUrl"), click: () => {
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
