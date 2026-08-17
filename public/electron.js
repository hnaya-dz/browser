import { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, screen, clipboard, powerMonitor, Notification } from "electron";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn, fork } from "child_process";
import { existsSync, createReadStream, statSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import http from "http";
// ✅ PATCH 1 — import depuis shared/ (supprime la duplication avec urlbar.tsx)
import { isDownloadableUrl } from "./shared/supportedHosts.js";

// ⚠️ EN DÉVELOPPEMENT, ELECTRON N'A PAS LE MÊME PROFIL QUE L'APPLICATION
// INSTALLÉE — et c'est invisible tant qu'on ne le cherche pas.
// `yarn dev` lance `electron public/electron.js`. Electron déduit le nom de
// l'application du package.json trouvé dans le répertoire de l'application
// — ici `public/`, qui n'en a pas. Il retombe donc sur son nom par défaut,
// « Electron », et écrit dans %APPDATA%\Electron : autre historique, autre
// identité d'appareil, autre licence, autres réglages.
// Symptôme constaté en usage réel : « la version de développement n'a pas
// d'historique et ne crée pas de salon ». Deux mondes parallèles, sans le
// moindre message pour l'expliquer.
// On force donc le nom hors paquet. En paquet, Electron le lit déjà
// correctement : on n'y touche pas.
//
// ⚠️ Ne PAS lancer la version installée et la version de développement en
// même temps : elles écriraient dans la même base.
if (!app.isPackaged) app.setName("hnaya-dz-browser");

// URL du rendu en développement. Configurable : le port 3000 est parfois
// déjà pris par un autre serveur, et une URL codée en dur envoyait alors
// la fenêtre vers l'application d'à côté — sans que rien ne le signale.
const URL_DEV = process.env.HNAYA_DEV_URL || "http://localhost:3000";
import { registerVaultIpc } from "./vault-ipc.js";
import {
  getChatSession, saveChatSession, forgetChatSession,
  listChatSessions, clearChatSessions,
} from "./chat-session.js";
import { registerFavoritesIpc } from "./favorites-ipc.js";
import { checkForUpdate } from "./update-check.js";
import net from "node:net";

// ✅ Détecte les URLs d'authentification Google qu'Electron ne peut pas gérer
// (Google bloque volontairement l'OAuth dans les WebViews embarquées depuis 2021)
function isGoogleAuthUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "accounts.google.com";
  } catch { return false; }
}

// ✅ Ouverture dans le navigateur SYSTÈME + information de l'utilisateur.
// Google refuse l'authentification depuis un navigateur Electron
// (« this browser may not be secure ») : la connexion Google est donc
// déléguée au navigateur par défaut du poste. Sans message, l'utilisateur
// voit une fenêtre surgir sans comprendre (retour terrain : « un onglet
// s'était détaché dans une autre fenêtre » lors d'une connexion LinkedIn
// via Google). On prévient donc explicitement.
function openExternallyWithNotice(url) {
  shell.openExternal(url);
  try { mainWindow?.webContents.send("external-open-notice", url); } catch {}
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
        noSuggestions: "لا توجد اقتراحات", addToDictionary: "إضافة إلى القاموس",
        adminExportTitle: "تصدير سجل المراسلة" },
  fr: { copy: "Copier", cut: "Couper", paste: "Coller", selectAll: "Tout sélectionner",
        saveImage: "Enregistrer l'image", copyImageUrl: "Copier l'adresse de l'image",
        openLinkNewTab: "Ouvrir le lien dans un nouvel onglet", copyLinkUrl: "Copier l'adresse du lien",
        reloadPage: "Recharger la page", back: "Précédent", forward: "Suivant",
        copyPageUrl: "Copier l'URL de la page", images: "Images", allFiles: "Tous les fichiers",
        chooseFolder: "Choisir le dossier de téléchargement",
        noSuggestions: "Aucune suggestion", addToDictionary: "Ajouter au dictionnaire",
        adminExportTitle: "Exporter l'historique de la messagerie" },
  en: { copy: "Copy", cut: "Cut", paste: "Paste", selectAll: "Select all",
        saveImage: "Save image", copyImageUrl: "Copy image address",
        openLinkNewTab: "Open link in new tab", copyLinkUrl: "Copy link address",
        reloadPage: "Reload page", back: "Back", forward: "Forward",
        copyPageUrl: "Copy page URL", images: "Images", allFiles: "All files",
        chooseFolder: "Choose download folder",
        noSuggestions: "No suggestions", addToDictionary: "Add to dictionary",
        adminExportTitle: "Export messaging history" },
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
// ⚠️ NE PAS modifier sans relire docs/DEV-INVARIANTS.md — affecte Windows/macOS/Linux
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
        // ✅ Zoom INTERFACE (fenêtre principale) — handlers explicites plutôt
        // que les rôles zoomIn/zoomOut : après un zoom d'interface, la
        // colonne du dock/sidebar (px CSS) change de taille en DIP, il FAUT
        // recalculer les bounds de la vue web, sinon elle déborde sous le
        // dock (retour terrain). uiZoom(delta) applique puis resynchronise.
        { label: "Zoom interface 100%", accelerator: "CmdOrCtrl+0", click: () => uiZoom(0, true) },
        { label: "Zoom interface +",    accelerator: "CmdOrCtrl+Equal",  click: () => uiZoom(+0.5) },
        { label: "Zoom interface + (pavé)", accelerator: "CmdOrCtrl+numadd", click: () => uiZoom(+0.5) },
        { label: "Zoom interface -",    accelerator: "CmdOrCtrl+Minus",  click: () => uiZoom(-0.5) },
        { label: "Zoom interface - (pavé)", accelerator: "CmdOrCtrl+numsub", click: () => uiZoom(-0.5) },
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
  // ⚠️ AUCUNE ICÔNE IMPOSÉE EN VERSION INSTALLÉE — et c'est délibéré.
  //
  // Sans cette ligne, Windows prend l'icône de l'EXÉCUTABLE, qu'electron-
  // builder y grave à toutes les tailles utiles. Avec elle, la fenêtre
  // reçoit ce que nativeImage sait produire d'un .ico : UNE SEULE image,
  // la plus grande, soit 256×256 — vérifié, y compris sur un fichier qui
  // en contient sept. Windows doit alors la rétrécir lui-même pour un
  // bouton de 32 px, et échoue : icône générique.
  //
  // Cela n'a longtemps rien cassé parce que le bouton de la barre des
  // tâches suivait l'exécutable. C'est `setAppUserModelId`, ajouté en
  // 0.7.0 pour que les notifications Windows paraissent, qui l'a fait
  // suivre l'icône de la FENÊTRE — révélant un défaut présent depuis
  // toujours mais jusque-là sans conséquence. Trois corrections
  // successives ont porté sur le FICHIER, qui n'était pas en cause.
  //
  // En développement, le processus est electron.exe : son icône est celle
  // d'Electron, donc on impose la nôtre, faute de mieux.
  ...(app.isPackaged ? {} : { icon: join(__dirname, "../public/icons/icon.ico") }),
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
  // ⚠️ Chromium ne fournit AUCUN dictionnaire Hunspell arabe intégré —
  // demander "ar" fait échouer TOUT l'appel (pas seulement l'arabe), ce
  // qui désactivait silencieusement aussi le correcteur FR/EN. On filtre
  // donc sur les langues réellement disponibles avant d'appliquer.
  try {
    const desired = ["ar", "fr", "en-US"];
    const available = mainWindow.webContents.session.availableSpellCheckerLanguages || [];
    const supported = desired.filter((l) => available.includes(l));
    if (supported.length) {
      mainWindow.webContents.session.setSpellCheckerLanguages(supported);
    }
    const missing = desired.filter((l) => !supported.includes(l));
    if (missing.length) {
      console.warn("Dictionnaire(s) correcteur indisponible(s) dans Chromium :", missing.join(", "));
    }
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
    mainWindow.loadURL(URL_DEV);
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
  // ⚠️ SANS CECI, AUCUNE NOTIFICATION WINDOWS N'APPARAÎT.
  // Windows n'affiche une notification que si l'application déclare un
  // AppUserModelID correspondant à un raccourci installé. Electron ne le
  // fait pas tout seul : sans cet appel, `new Notification(...).show()`
  // réussit sans erreur et il ne se passe RIEN — ni bandeau, ni son.
  // C'est exactement ce qu'a produit le premier rappel de réunion en test
  // réel : aucun message d'erreur, aucun indice, rien à l'écran.
  // La valeur doit être identique à l'`appId` d'electron-builder.
  app.setAppUserModelId("dz.hnaya.browser");

  // Interrupteurs confidentialité : lus AVANT createWindow pour que le
  // filtre réseau respecte le choix de l'utilisateur dès la 1re requête
  loadPrivacySettings();
  // Démarre le serveur statique AVANT de créer la fenêtre (packagé seulement)
  if (app.isPackaged) {
    staticServerUrl = await startStaticServer();
  }
  createWindow();
  // ✅ Recalculer la vue web à CHAQUE changement de taille de la fenêtre.
  // ⚠️ Attaché DIRECTEMENT à mainWindow, PAS via app.on("browser-window-
  // created") : ce dernier était enregistré APRÈS createWindow(), donc il
  // ne se déclenchait jamais pour la fenêtre principale — le plein écran
  // ne redimensionnait pas la page web (retour terrain). enter/leave-full-
  // screen couvrent le vrai plein écran ; maximize/unmaximize le bouton
  // Agrandir de Windows ; resize le glissement de bordure.
  if (mainWindow) {
    const relayout = (delay) => () => setTimeout(updateBrowserViewSize, delay);
    mainWindow.on("enter-full-screen", relayout(100));
    mainWindow.on("leave-full-screen", relayout(100));
    mainWindow.on("maximize",          relayout(80));
    mainWindow.on("unmaximize",        relayout(80));
    mainWindow.on("resize",            relayout(50));
    // Zoom d'interface à la molette (Ctrl+molette) : réaligner la vue web
    mainWindow.webContents.on("zoom-changed", relayout(30));
  }
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
      openExternallyWithNotice(details.url);
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
  // ⚠️ getContentBounds() est en DIP ; la barre latérale (tabSideWidth) et
  // le dock (chatDockWidth) sont réservés en PIXELS CSS du renderer. Quand
  // l'interface est zoomée (Ctrl+= « Zoom interface »), 1 px CSS ≠ 1 DIP :
  // il faut convertir par le facteur de zoom de la FENÊTRE PRINCIPALE,
  // sinon la vue web déborde sous le dock et laisse voir l'accueil derrière
  // (retour terrain). La marge haute (12vh) est proportionnelle : elle
  // reste correcte sans conversion.
  const zoomFactor = mainWindow.webContents.getZoomFactor() || 1;
  const sideDip = Math.round(tabSideWidth * zoomFactor);
  const dockDip = Math.round(chatDockWidth * zoomFactor);
  if (tabSideWidth > 0) {
    // Mode sidebar — la vue prend toute la hauteur à gauche de la sidebar
    // (et du dock messagerie s'il est ouvert)
    view.setBounds({ x: 0, y: 0, width: width - sideDip - dockDip, height });
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
      width: width - dockDip,
      height: height - marginTop
    });
  }
};

// Zoom de l'INTERFACE (fenêtre principale) puis resynchronisation des
// bounds de la vue web. delta en niveaux de zoom (0,5) ; reset=true remet
// à 100 %. Bornes ±2 niveaux pour éviter une UI inutilisable.
function uiZoom(delta, reset = false) {
  if (!mainWindow) return;
  const wc = mainWindow.webContents;
  const level = reset ? 0 : Math.max(-2, Math.min(2, wc.getZoomLevel() + delta));
  wc.setZoomLevel(level);
  updateBrowserViewSize();
}

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

// Identification PRÉCISE du build installé.
//
// Le seul numéro de version ne suffit pas : plusieurs paquets successifs
// portent le même (« 0.7.0 » a désigné quatre contenus différents en une
// journée pendant la mise au point du serveur permanent), et il devient
// alors impossible de dire quels correctifs tourne réellement un poste.
// Un test de terrain sur le mauvais binaire fait chercher un défaut déjà
// corrigé — c'est arrivé, et cela a coûté une nuit.
//
// La date vient de l'horodatage de l'exécutable lui-même : aucune étape
// de génération, aucun fichier à produire ni à déclarer dans
// build.files, donc rien qui puisse se désynchroniser en silence.
ipcMain.handle("get-build-info", async () => {
  let date = null;
  try {
    // En production, l'exécutable EST le paquet. En développement, ce
    // chemin pointe l'electron.exe de node_modules : la date n'a alors
    // aucun sens, on ne la renvoie pas plutôt que d'induire en erreur.
    if (app.isPackaged) date = statSync(process.execPath).mtime.toISOString();
  } catch { /* horodatage illisible : on renvoie null */ }
  return { version: app.getVersion(), date, packaged: app.isPackaged };
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
  // ✅ Étape D — données persistantes du chat (base SQLite + identité
  // Ed25519 de l'appareil) dans userData : survivent aux mises à jour de
  // l'app, jamais dans Program Files (non inscriptible), jamais dans le
  // dossier du module (écrasé à chaque installation).
  chatWorker = fork(chatModulePath, [], {
    silent: false,
    env: { ...process.env, HNAYA_CHAT_DATA: join(app.getPath("userData"), "chat-data") },
  });

  // Relaie chaque événement du worker vers le renderer via un seul canal
  // ("chat-event") — évite d'avoir à whitelister un canal par type
  // d'événement dans preload.js (voir docs/DEV-INVARIANTS.md section 1).
  chatWorker.on("message", (msg) => {
    // Étape E — réponses de transfert : elles répondent à une promesse
    // précise (chatMediaRequest) et n'ont rien à faire dans le flux
    // d'événements général du renderer.
    if (msg?.reqId && chatMediaPending.has(msg.reqId)) {
      const pending = chatMediaPending.get(msg.reqId);
      chatMediaPending.delete(msg.reqId);
      clearTimeout(pending.timer);
      if (msg.event === "media-error") pending.reject(new Error(msg.reason || "media"));
      else pending.resolve(msg);
      return;
    }
    mainWindow?.webContents.send("chat-event", msg);
  });
  chatWorker.on("exit", () => { chatWorker = null; });
  chatWorker.on("error", (err) => {
    console.error("[hnaya-chat] Erreur worker :", err.message);
    mainWindow?.webContents.send("chat-event", { event: "error", message: err.message });
  });
  return chatWorker;
}

// ⚠️ Retour terrain (deux postes, l'un mis en veille) : après une reprise,
// des messages partaient dans un sens sans arriver dans l'autre, sans
// aucune erreur affichée — une connexion WebSocket restée « ouverte » du
// point de vue de l'objet JS peut être une prise zombie après une veille
// (le réseau, y compris le loopback de l'hôte vers SON PROPRE salon, a
// été coupé pendant la suspension), et rien ne le détecte avant le
// prochain battement de cœur (jusqu'à ~20 s) — qui de toute façon
// n'aurait fait qu'afficher une erreur, jamais reconnecté seul. On force
// donc une reconnexion propre dès que Windows signale la reprise ; voir
// le commentaire près de lastJoinMsg dans chat-module/src/worker.js.
powerMonitor.on("resume", () => {
  try { chatWorker?.send({ cmd: "network-resume" }); } catch { /* worker absent */ }
});

// D.2 : accepte soit une chaîne (compat : nom seul), soit un objet
// { sessionName, adminPin?, roomId? } — roomId = réouverture d'un salon
ipcMain.handle("chat-start-host", async (event, params) => {
  const worker = ensureChatWorker();
  if (!worker) return { ok: false, error: "module-not-found" };
  const opts = typeof params === "string" ? { sessionName: params } : (params || {});
  worker.send({
    cmd: "start-host",
    sessionName: opts.sessionName,
    adminPin: opts.adminPin,
    roomId: opts.roomId,
  });
  return { ok: true };
});

// roomId précise QUEL salon fermer (plusieurs peuvent être ouverts)
ipcMain.on("chat-stop-host", (event, roomId) => {
  chatWorker?.send({ cmd: "stop-host", roomId: roomId || null });
});

// D.2 : liste des salons hébergés par ce poste (écran « Rouvrir »)
ipcMain.on("chat-list-rooms", () => {
  ensureChatWorker()?.send({ cmd: "list-rooms" });
});

// D.2 : invitation vers un autre salon (ciblée ou à tous)
ipcMain.on("chat-send-invite", (event, { to, room }) => {
  chatWorker?.send({ cmd: "send-invite", to: to || null, room });
});

// D.2 : suppression définitive d'un salon (historique compris).
// La confirmation utilisateur est demandée côté renderer AVANT l'appel.
ipcMain.on("chat-delete-room", (event, roomId) => {
  ensureChatWorker()?.send({ cmd: "delete-room", roomId });
});

// ── Sessions « rester connecté sur ce PC » (voir chat-session.js) ──────
// Volontairement SÉPARÉ du gestionnaire de mots de passe : un code de
// salon est un secret partagé, pas un identifiant personnel.
ipcMain.handle("chat-session-get", async (event, roomKey) => getChatSession(roomKey));
ipcMain.handle("chat-session-save", async (event, { roomKey, ...rest }) => ({
  ok: saveChatSession(roomKey, rest),
}));
ipcMain.handle("chat-session-forget", async (event, roomKey) => ({ ok: forgetChatSession(roomKey) }));
ipcMain.handle("chat-session-list", async () => listChatSessions());
ipcMain.handle("chat-session-clear", async () => ({ ok: clearChatSessions() }));

ipcMain.on("chat-discover", (event, timeoutMs) => {
  ensureChatWorker()?.send({ cmd: "discover", timeoutMs });
});

ipcMain.on("chat-join", (event, joinParams) => {
  ensureChatWorker()?.send({ cmd: "join", ...joinParams });
});

ipcMain.on("chat-send-message", (event, { text, groupId, media, replyTo, demande }) => {
  chatWorker?.send({ cmd: "send-message", text, groupId, media, replyTo, demande });
});

// ── Étape P — réunion annoncée ─────────────────────────────────────────
ipcMain.on("chat-open-meeting", (event, params = {}) => {
  chatWorker?.send({ cmd: "open-meeting", ...params });
});

// Rappel de réunion : la minuterie vit dans le PROCESS PRINCIPAL, pas dans
// le renderer. Chromium ralentit les minuteries d'une fenêtre en arrière-
// plan — un rappel programmé côté interface serait arrivé en retard, ou
// pas du tout, précisément quand l'utilisateur travaille ailleurs. C'est
// là tout l'intérêt du rappel.
const rappelsReunion = new Map(); // id -> timeout
ipcMain.on("chat-schedule-reminder", (event, { id, titre, corps, atMs } = {}) => {
  if (!id) return;
  const ancien = rappelsReunion.get(id);
  if (ancien) { clearTimeout(ancien); rappelsReunion.delete(id); }
  const delai = Number(atMs) - Date.now();
  // Passé, ou au-delà de ce que setTimeout sait tenir (~24,8 jours) : on
  // ne programme rien plutôt que de déclencher immédiatement par débordement.
  if (!Number.isFinite(delai) || delai <= 0 || delai > 2147483647) return;
  const timer = setTimeout(() => {
    rappelsReunion.delete(id);
    try {
      if (Notification.isSupported()) {
        new Notification({ title: String(titre || "Réunion"), body: String(corps || "") }).show();
      }
    } catch { /* notifications refusées par le système */ }
    // On prévient AUSSI l'interface pour qu'elle joue le signal sonore de
    // la messagerie. La notification Windows a son propre son, mais il se
    // tait dès que l'assistant de concentration est actif ou que les sons
    // système sont coupés — cas fréquent sur un poste de bureau. Deux
    // canaux valent mieux qu'un pour un rappel qu'on ne doit pas manquer.
    try { mainWindow?.webContents.send("chat-event", { event: "meeting-reminder", id }); }
    catch { /* fenêtre fermée */ }
  }, delai);
  rappelsReunion.set(id, timer);
});
ipcMain.on("chat-cancel-reminder", (event, { id } = {}) => {
  const t = rappelsReunion.get(id);
  if (t) { clearTimeout(t); rappelsReunion.delete(id); }
});

// Export .ics — lien avec Outlook par le FORMAT, pas par une API : aucune
// dépendance, aucune authentification, aucun compte Microsoft, et cela
// fonctionne hors ligne. Le contenu est composé par le renderer ; ici on
// ne fait que demander où l'enregistrer.
// ⚠️ On OUVRE le fichier, on ne demande pas où l'enregistrer.
// La première version affichait un sélecteur d'emplacement : le fichier
// atterrissait n'importe où et il fallait ensuite le retrouver pour
// l'ouvrir. Sur téléphone, le même .ics ouvre directement l'application
// d'agenda — et c'est cette différence que l'usage réel a fait ressortir.
// On écrit donc dans un dossier temporaire et on laisse Windows lancer
// l'application d'agenda par défaut, qui proposera elle-même d'ajouter
// l'événement. Le fichier ne sert qu'au passage de relais.
ipcMain.handle("chat-export-ics", async (event, { filename, content } = {}) => {
  try {
    // ⚠️ PAS DANS %TEMP%.
    // Le fichier n'y valait que comme relais vers l'application d'agenda.
    // Quand aucune n'est associée — le cas sur un Windows dont Courrier et
    // Calendrier a été retiré —, il restait dans un dossier que personne ne
    // pense à ouvrir et que Windows purge de lui-même. « Ajouter à mon
    // agenda » produisait alors un fichier introuvable le lendemain.
    // Documents\Hnaya\Agenda : on le retrouve, on le rouvre, on l'envoie
    // par courriel à qui de droit. Repli sur le temporaire si le dossier
    // Documents est indisponible (profil itinérant, poste verrouillé).
    let dossier;
    try {
      dossier = join(app.getPath("documents"), "Hnaya", "Agenda");
      mkdirSync(dossier, { recursive: true });
    } catch {
      dossier = join(app.getPath("temp"), "hnaya-agenda");
    }
    mkdirSync(dossier, { recursive: true });
    const chemin = join(dossier, String(filename || "reunion.ics"));
    writeFileSync(chemin, String(content), "utf8");
    // openPath renvoie une CHAÎNE : vide si tout va bien, le message
    // d'erreur sinon. Aucune exception n'est levée quand aucune
    // application n'est associée aux .ics — d'où le test explicite.
    // ⚠️ openPath réussit même quand l'ouverture ne donne RIEN.
    // Sur le poste de test, le gestionnaire .ics enregistré est l'ancienne
    // application Courrier et Calendrier de Windows, retirée par Microsoft
    // fin 2024 : Windows lui transmet le fichier, elle n'existe plus, et
    // openPath renvoie quand même une chaîne vide — donc « succès ».
    // On ne peut pas détecter ce cas. On rend donc TOUJOURS le chemin à
    // l'interface, qui propose d'afficher le fichier : l'utilisateur garde
    // un moyen d'agir même quand rien ne s'est ouvert.
    const souci = await shell.openPath(chemin);
    return { ok: true, path: chemin, ouvert: !souci, erreur: souci || null };
  } catch (e) {
    return { ok: false, error: e?.message || "ics" };
  }
});

// Afficher un fichier dans l'Explorateur, sélectionné. Recours quand
// l'ouverture n'a rien donné — voir chat-export-ics.
ipcMain.on("chat-reveal-file", (event, { path: p } = {}) => {
  try { if (p) shell.showItemInFolder(String(p)); } catch { /* fichier disparu */ }
});

// ── Étape R — décaler ou annuler une réunion annoncée
ipcMain.on("chat-update-meeting", (event, params = {}) => {
  chatWorker?.send({ cmd: "update-meeting", ...params });
});

// ── Étape M — photo de profil : déclarer l'empreinte déjà téléversée
ipcMain.on("chat-set-avatar", (event, { sha256 } = {}) => {
  chatWorker?.send({ cmd: "set-avatar", sha256: sha256 || null });
});

// ── Étape L — jeton d'appairage, glissé dans le QR « Ajouter mon mobile »
// Demandé à chaque affichage du QR plutôt que gardé : il expire en quelques
// minutes, c'est ce qui limite la portée d'un QR photographié.
ipcMain.handle("chat-pairing-token", async () => {
  try {
    const res = await chatMediaRequest("pairing-token", {}, 10000);
    return { ok: true, token: res.token };
  } catch (e) {
    return { ok: false, error: e?.message || "jeton" };
  }
});

// ── Étape K — se prononcer sur une demande qualifiée ───────────────────
ipcMain.on("chat-decider", (event, { messageId, issue, comment }) => {
  chatWorker?.send({ cmd: "decider", messageId, issue, comment });
});

// ── Étape H — votes ────────────────────────────────────────────────────
ipcMain.on("chat-open-vote", (event, { question, options, nominatif, groupId }) => {
  chatWorker?.send({ cmd: "open-vote", question, options, nominatif, groupId });
});
ipcMain.on("chat-answer-vote", (event, { voteId, choice, comment }) => {
  chatWorker?.send({ cmd: "answer-vote", voteId, choice, comment });
});

// ── Étape E — pièces jointes : pont renderer ↔ worker ──────────────────
// Les octets ne traversent JAMAIS l'IPC du fork : ils sont écrits dans un
// fichier temporaire et seul le CHEMIN est transmis au worker. Sérialiser
// 25 Mio en JSON à travers fork() coûterait bien plus cher qu'une écriture
// disque, et ferait gonfler la mémoire des deux processus.
const chatMediaPending = new Map(); // reqId -> { resolve, reject, timer }
const chatMediaTmpDir = () => join(app.getPath("userData"), "chat-media-tmp");

function chatMediaRequest(cmd, params, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const worker = ensureChatWorker();
    if (!worker) { reject(new Error("module-absent")); return; }
    const reqId = "med_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const timer = setTimeout(() => {
      chatMediaPending.delete(reqId);
      reject(new Error("timeout"));
    }, timeoutMs);
    chatMediaPending.set(reqId, { resolve, reject, timer });
    worker.send({ cmd, reqId, ...params });
  });
}

ipcMain.handle("chat-media-upload", async (event, { bytes, kind, mime, thumb }) => {
  try {
    mkdirSync(chatMediaTmpDir(), { recursive: true });
    const tmp = join(chatMediaTmpDir(), `up-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Le worker supprime ce fichier après lecture, quoi qu'il arrive.
    writeFileSync(tmp, Buffer.from(bytes));
    const res = await chatMediaRequest("media-upload", { path: tmp, kind, mime, thumb: thumb || null });
    return { ok: true, sha256: res.sha256, size: res.size };
  } catch (e) {
    return { ok: false, error: e?.message || "upload" };
  }
});

ipcMain.handle("chat-media-download", async (event, { sha256, mime }) => {
  try {
    mkdirSync(chatMediaTmpDir(), { recursive: true });
    const outPath = join(chatMediaTmpDir(), `dl-${sha256.slice(0, 16)}`);
    const res = await chatMediaRequest("media-download", { sha256, mime, outPath });
    const buf = readFileSync(res.path);
    try { unlinkSync(res.path); } catch { /* déjà retiré */ }
    // Renvoyé au renderer en Uint8Array (clone structuré natif d'Electron,
    // bien plus efficace qu'une chaîne base64) — il en fait un Blob.
    return { ok: true, bytes: new Uint8Array(buf) };
  } catch (e) {
    return { ok: false, error: e?.message || "download" };
  }
});

// Enregistrer une pièce jointe sur le disque de l'utilisateur.
ipcMain.handle("chat-media-save", async (event, { sha256, mime, name, kind }) => {
  try {
    // ⚠️ L'extension est déduite du TYPE réel, jamais laissée au hasard du
    // nom : un fichier enregistré sans extension est inouvrable sous
    // Windows (« Type du fichier : Fichier »). Le filtre la fait aussi
    // rajouter par le dialogue si l'utilisateur modifie le nom.
    const { pathToFileURL: toUrl } = await import("node:url");
    const { suggestedFilename, extensionForMime } = await import(toUrl(chatMediaJsPath).href);
    const suggested = suggestedFilename({ name, mime, sha256, kind });
    const ext = extensionForMime(mime);
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: "Enregistrer la pièce jointe",
      defaultPath: suggested,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (canceled || !filePath) return { ok: false, error: "canceled" };
    mkdirSync(chatMediaTmpDir(), { recursive: true });
    const outPath = join(chatMediaTmpDir(), `save-${sha256.slice(0, 16)}`);
    const res = await chatMediaRequest("media-download", { sha256, mime, outPath });
    writeFileSync(filePath, readFileSync(res.path));
    try { unlinkSync(res.path); } catch { /* déjà retiré */ }
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: e?.message || "save" };
  }
});

// Étape F — annuaire du salon (qui est inscrit, fonction, présence).
// La réponse revient par le canal d'événements général ("chat-event").
ipcMain.on("chat-roster", () => { chatWorker?.send({ cmd: "roster" }); });

ipcMain.on("chat-mark-read", (event, { messageId, groupId }) => {
  chatWorker?.send({ cmd: "mark-read", messageId, groupId });
});

ipcMain.on("chat-leave", () => { chatWorker?.send({ cmd: "leave" }); });

// ✅ Étape D — commandes d'administration (registre des appareils,
// historique, rétention). Le PIN admin transite vers le worker puis au
// salon via le canal chiffré — jamais stocké ici.
ipcMain.on("chat-admin", (event, params) => {
  chatWorker?.send({ cmd: "admin", ...params });
});

// Export admin (JSON/CSV) : le renderer fournit le contenu, l'utilisateur
// choisit l'emplacement. writeFileSync après validation du dialogue.
ipcMain.handle("chat-admin-export", async (event, { filename, content }) => {
  // ⚠️ L'ORDRE DES FILTRES DÉCIDE DE L'EXTENSION.
  // Windows applique le filtre ACTIF au nom de fichier, et le filtre actif
  // est le premier de la liste. JSON figurant toujours en tête, un export
  // CSV proposé sous `…​.csv` repartait en `.json` : contenu CSV, extension
  // JSON, tableur incapable de l'ouvrir. Signalé en usage réel
  // (« les deux envoient un fichier JSON »). On met donc en tête le filtre
  // correspondant à ce qui a réellement été demandé.
  const estCsv = String(filename || "").toLowerCase().endsWith(".csv");
  const fJson = { name: "JSON", extensions: ["json"] };
  const fCsv = { name: "CSV", extensions: ["csv"] };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: nativeT("adminExportTitle"),
    defaultPath: join(app.getPath("documents"), String(filename || "export.json")),
    filters: [
      ...(estCsv ? [fCsv, fJson] : [fJson, fCsv]),
      { name: nativeT("allFiles"), extensions: ["*"] },
    ],
  });
  if (canceled || !filePath) return { saved: false };
  const { writeFileSync } = await import("fs");
  // BOM UTF-8 (﻿) pour que l'arabe s'affiche correctement dans Excel.
  // On se fie au chemin RETENU, pas au nom proposé : l'utilisateur peut
  // avoir changé l'extension dans la boîte de dialogue.
  writeFileSync(filePath, filePath.toLowerCase().endsWith(".csv") ? "﻿" + content : content, "utf8");
  return { saved: true, filePath };
});

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
const FIREWALL_RULE_TCP = "Hnaya Messagerie locale (TCP 4802-4809)";
const FIREWALL_RULE_UDP = "Hnaya Messagerie locale (UDP 41234)";
// Anciennes règles à port unique (v1/v2) : la plage 4802-4809 les couvre
// désormais toutes. On les SUPPRIME à la mise à niveau, sinon elles
// resteraient en doublon dans le pare-feu de l'utilisateur.
const LEGACY_RULE_TCP = "Hnaya Messagerie locale (TCP 4802)";
const LEGACY_RULE_HTTP = "Hnaya Messagerie locale (TCP 4803 mobile)";
// Version du dispositif : incrémentée quand une NOUVELLE règle devient
// nécessaire (v2 = port mobile 4803 ; v3 = plage 4802-4809 pour héberger
// plusieurs salons à la fois). Un drapeau d'une version
// antérieure ne vaut plus « configuré » — l'utilisateur verra une nouvelle
// demande d'autorisation, une seule fois.
const NETWORK_SETUP_VERSION = 3;

// ⚠️ Les scripts élevés sont exécutés par powershell.exe — Windows
// PowerShell 5.1, PAS PowerShell 7. La 5.1 lit un fichier UTF-8 SANS BOM
// comme de l'ANSI : le moindre accent y devient du charabia, et certains
// octets ainsi produits (un tiret long donne un guillemet typographique)
// sont interprétés comme des délimiteurs de chaîne. Le script entier
// cesse alors d'être analysable et ne s'exécute JAMAIS — sans le moindre
// message, puisque rien n'a démarré. Le BOM lève l'ambiguïté une fois
// pour toutes ; les scripts n'ont plus à rester ASCII par discipline.
const ecrirePs1 = (script) => "﻿" + script;

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
    "Write-Output ('READ|' + [string]([bool]$t -and [bool]$u)) " +
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
    "Remove-NetFirewallRule -DisplayName '" + LEGACY_RULE_TCP + "' -ErrorAction SilentlyContinue",
    "Remove-NetFirewallRule -DisplayName '" + LEGACY_RULE_HTTP + "' -ErrorAction SilentlyContinue",
    "Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue | Where-Object { $dn = $_.DisplayName; ($dn -like '*hnaya*') -or ($dn -like '*electron*') -or ($dn -like '*node*') } | Where-Object { ($_ | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue).Program -ieq $exe } | Remove-NetFirewallRule -ErrorAction SilentlyContinue",
    // « Créer seulement si absent » plutôt que supprimer-puis-créer :
    // Kaspersky (observé sur poste de test) peut bloquer la SUPPRESSION
    // de règles même en élévation tout en autorisant la création — le
    // remove+create y produit des règles en double à chaque exécution.
    "if (-not (Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_TCP + "' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '" + FIREWALL_RULE_TCP + "' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4802-4809 -Program $exe -RemoteAddress LocalSubnet -Profile Any | Out-Null }",
    "if (-not (Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_UDP + "' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '" + FIREWALL_RULE_UDP + "' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 41234 -Program $exe -RemoteAddress LocalSubnet -Profile Any | Out-Null }",
    "$t = Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_TCP + "' -ErrorAction SilentlyContinue",
    "$u = Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_UDP + "' -ErrorAction SilentlyContinue",
    "if ($t -and $u) { Set-Content -LiteralPath '" + resultEsc + "' -Value 'OK' } else { Set-Content -LiteralPath '" + resultEsc + "' -Value 'FAIL' }",
    "exit 0",
  ].join("\r\n");
  writeFileSync(ps1, ecrirePs1(script), "utf8");

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

// ── Serveur permanent (tier premium) — déploiement depuis CE poste ──────────
// L'astuce qui rend le déploiement possible sans AUCUN téléchargement :
// l'exe du navigateur exécute du Node pur avec ELECTRON_RUN_AS_NODE=1, et le
// module serveur (serve.js) est déjà dans resources/chat-module. Une tâche
// planifiée « Au démarrage » (compte SYSTEM) lance donc le salon permanent
// même sans session ouverte — le vieux PC toujours allumé d'une PME devient
// le serveur, avec pour seul prérequis le navigateur déjà installé.
// La licence (fichier .hnaya-lic vendu par Hnaya DZ) est vérifiée ICI avant
// l'installation, puis revérifiée par serve.js à CHAQUE démarrage.
const chatServeJsPath = app.isPackaged
  ? join(process.resourcesPath, "chat-module", "src", "serve.js")
  : join(__dirname, "..", "chat-module", "src", "serve.js");
const chatMediaJsPath = app.isPackaged
  ? join(process.resourcesPath, "chat-module", "src", "media.js")
  : join(__dirname, "..", "chat-module", "src", "media.js");
const chatLicenceJsPath = app.isPackaged
  ? join(process.resourcesPath, "chat-module", "src", "licence.js")
  : join(__dirname, "..", "chat-module", "src", "licence.js");
const CHAT_SERVER_TASK = "Hnaya Chat Serveur";
// ProgramData et non userData : la tâche tourne en SYSTEM, hors de toute
// session — les données ne peuvent pas dépendre d'un profil utilisateur.
const chatServerDataDir = join(process.env.ProgramData || "C:\\ProgramData", "Hnaya Chat Server");

async function verifyLicenceFile(filePath) {
  const { pathToFileURL: toUrl } = await import("node:url");
  const { verifyLicence } = await import(toUrl(chatLicenceJsPath).href);
  let contenu;
  try { contenu = readFileSync(filePath, "utf8"); }
  catch { return { ok: false, error: "Fichier illisible" }; }
  return verifyLicence(contenu);
}

// Marqueur d'installation réussie, écrit par le script ÉLEVÉ seulement
// après enregistrement et vérification de la tâche. Il existe parce que la
// lecture du planificateur en session normale n'est pas fiable partout :
// sans lui, un poste dont l'antivirus refuse cette lecture affichait
// « pas installé » en boucle, obligeant à resélectionner la licence à
// chaque tentative. Il n'est PAS une preuve que la tâche tourne — juste
// qu'elle a été installée depuis ce poste.
const chatServerMarker = join(chatServerDataDir, "installed.json");

const chatServerTaskExists = async () => {
  // schtasks plutôt que Get-ScheduledTask : sortie stable, pas de CIM
  // (dont la lecture est parfois refusée en session normale — cf. pare-feu)
  const { code } = await runPowerShell(["-Command",
    `schtasks /Query /TN "${CHAT_SERVER_TASK}" *> $null; exit $LASTEXITCODE`]);
  return code === 0;
};

const chatServerPortAlive = () => new Promise((resolve) => {
  const s = net.connect({ host: "127.0.0.1", port: 4802 });
  const done = (r) => { try { s.destroy(); } catch {} resolve(r); };
  s.setTimeout(800, () => done(false));
  s.on("connect", () => done(true));
  s.on("error", () => done(false));
});

ipcMain.handle("chat-server-get-info", async () => {
  if (process.platform !== "win32") return { supported: false };
  // Deux signaux indépendants : la lecture du planificateur (fiable quand
  // elle passe) OU le marqueur posé par une installation vérifiée. Sans ce
  // « ou », un poste qui refuse la lecture repartait à zéro à chaque fois.
  const installed = (await chatServerTaskExists()) || existsSync(chatServerMarker);
  // Le port n'est sondé que si l'on se sait installé : 4802 sert AUSSI aux
  // salons ordinaires créés depuis le navigateur, un salon ouvert ferait
  // donc passer le serveur pour démarré. Le garde-fou tient maintenant que
  // « installé » ne dépend plus d'une seule lecture faillible.
  const running = installed ? await chatServerPortAlive() : false;
  let licence = null;
  if (installed) {
    const res = await verifyLicenceFile(join(chatServerDataDir, "licence.hnaya-lic"));
    if (res.licence) {
      // ⚠️ `valid` = EN COURS DE VALIDITÉ, pas « bien signée ». Depuis
      // l'étape I, verifyLicence retourne ok:true même pour une licence
      // échue (elle démarre en lecture seule) : c'est `mode` qui tranche.
      licence = { org: res.licence.org, expires: res.licence.expires,
        maxDevices: res.licence.maxDevices, daysLeft: res.daysLeft ?? -1,
        mode: res.mode || null, graceDaysLeft: res.graceDaysLeft ?? null,
        notice: res.notice || null, valid: res.mode === "active" };
    }
  }
  // Une licence déjà déposée sur ce poste (retirer le serveur ne l'efface
  // pas, c'est voulu) : l'interface peut alors proposer de la réutiliser
  // au lieu d'obliger à retrouver le fichier d'origine.
  const licenceSurDisque = existsSync(join(chatServerDataDir, "licence.hnaya-lic"));
  // Salon du serveur permanent. Il vit dans SA base, hors du profil
  // utilisateur : il n'apparaît donc pas dans « ouvrir un salon de ce
  // poste », et l'on peut le croire perdu. On le nomme ici, à partir de
  // l'état que le serveur publie à son démarrage (voir serve.js).
  // Absent = serveur jamais démarré depuis cette version ; on n'invente
  // rien plutôt que d'afficher un nom faux.
  let salon = null;
  try {
    salon = JSON.parse(readFileSync(join(chatServerDataDir, "salon-actif.json"), "utf8"));
  } catch { /* pas encore publié */ }
  return { supported: true, installed, running, dataDir: chatServerDataDir, licence, licenceSurDisque, salon };
});

ipcMain.handle("chat-server-pick-licence", async () => {
  // ⚠️ defaultPath OBLIGATOIRE. Depuis Electron 43, un showOpenDialog sans
  // chemin de départ s'ouvre dans « Téléchargements » — pas dans le dernier
  // dossier utilisé. Avec le filtre .hnaya-lic, l'utilisateur tombait sur un
  // dossier vide et croyait sa licence perdue. Constaté en usage réel après
  // la montée de version.
  // On part de la licence déjà installée si elle existe, sinon des Documents.
  const licenceInstallee = join(chatServerDataDir, "licence.hnaya-lic");
  const depart = existsSync(licenceInstallee)
    ? licenceInstallee
    : app.getPath("documents");
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: "Licence Hnaya Chat Serveur",
    defaultPath: depart,
    filters: [{ name: "Licence Hnaya", extensions: ["hnaya-lic"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths[0]) return { ok: false, error: "canceled" };
  const res = await verifyLicenceFile(filePaths[0]);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, path: filePaths[0], org: res.licence.org,
    maxDevices: res.licence.maxDevices, expires: res.licence.expires, daysLeft: res.daysLeft,
    mode: res.mode, graceDaysLeft: res.graceDaysLeft ?? null, notice: res.notice || null };
});

// Réutiliser la licence déjà déposée sur ce poste, sans repasser par le
// sélecteur de fichier. Elle est relue et REVÉRIFIÉE à chaque fois : une
// licence expirée depuis son installation doit être refusée comme une
// autre, jamais acceptée au motif qu'elle était déjà là.
ipcMain.handle("chat-server-installed-licence", async () => {
  const chemin = join(chatServerDataDir, "licence.hnaya-lic");
  if (!existsSync(chemin)) return { ok: false, error: "absente" };
  const res = await verifyLicenceFile(chemin);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, path: chemin, org: res.licence.org,
    maxDevices: res.licence.maxDevices, expires: res.licence.expires, daysLeft: res.daysLeft,
    mode: res.mode, graceDaysLeft: res.graceDaysLeft ?? null, notice: res.notice || null };
});

ipcMain.handle("chat-server-install", async (event, { licencePath, name, pin, adminPin } = {}) => {
  if (process.platform !== "win32") return { ok: false, error: "windows-only" };
  // Validations côté non-élevé — tout ce qui entre dans le script est
  // ensuite garanti inoffensif pour cmd/PowerShell.
  const licCheck = await verifyLicenceFile(licencePath || "");
  if (!licCheck.ok) return { ok: false, error: licCheck.error || "licence" };
  // Une licence échue de plus de 30 jours démarre en LECTURE SEULE : on
  // laisse ce mode à un serveur déjà en place (l'historique doit rester
  // joignable), mais on refuse d'en INSTALLER un neuf. Installer un
  // serveur incapable d'envoyer un message est un piège, pas un service.
  // Le délai de grâce, lui, passe : un renouvellement est en cours.
  if (licCheck.mode === "readonly") {
    return { ok: false, error: licCheck.notice || "Licence expirée" };
  }
  if (!/^\d{6}$/.test(String(pin || ""))) return { ok: false, error: "pin" };
  if (adminPin !== undefined && adminPin !== "" && !/^\d{6}$/.test(String(adminPin))) return { ok: false, error: "adminPin" };
  // Nom : ASCII sûr uniquement — un .cmd est lu dans la page de codes OEM,
  // les accents/arabe y seraient corrompus. Le salon peut être renommé
  // ensuite depuis l'espace admin, sans cette contrainte.
  const safeName = String(name || "").trim();
  if (safeName && !/^[A-Za-z0-9 ._-]{1,40}$/.test(safeName)) return { ok: false, error: "name" };

  const { mkdtempSync } = await import("fs");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "hnaya-srv-"));
  const ps1 = join(dir, "hnaya-server-install.ps1");
  const resultFile = join(dir, "result.txt");
  const q = (s) => String(s).replace(/'/g, "''");
  const wrapper = join(chatServerDataDir, "start-server.cmd");
  const marqueurInstall = chatServerMarker;
  const exe = process.execPath;

  const cmdArgs = [`--data "${chatServerDataDir}"`, `--licence "${join(chatServerDataDir, "licence.hnaya-lic")}"`, `--pin ${pin}`];
  if (adminPin) cmdArgs.push(`--admin-pin ${adminPin}`);
  if (safeName) cmdArgs.push(`--name "${safeName}"`);
  const cmdLine = `"${exe}" "${chatServeJsPath}" ${cmdArgs.join(" ")} >> "${join(chatServerDataDir, "server.log")}" 2>&1`;

  // Script élevé (ASCII uniquement — voir chat-network-setup) : répertoire,
  // licence, wrapper, règles pare-feu si absentes, tâche SYSTEM, démarrage
  // immédiat, verdict par fichier.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  New-Item -ItemType Directory -Force -Path '" + q(chatServerDataDir) + "' | Out-Null",
    // Copier SAUF si la source est déjà le fichier de destination : on
    // réinstalle souvent avec la licence déjà présente sur le poste, et
    // Copy-Item échouerait sur une source identique à la destination.
    "  $src = '" + q(licencePath) + "'; $dst = '" + q(join(chatServerDataDir, "licence.hnaya-lic")) + "'",
    "  if ($src -ne $dst) { Copy-Item -LiteralPath $src -Destination $dst -Force }",
    // Le wrapper est ecrit en OEM : c'est la page de codes dans laquelle
    // cmd.exe relira le fichier au demarrage de la tache.
    "  $lines = @('@echo off', 'set ELECTRON_RUN_AS_NODE=1', '" + q(cmdLine) + "')",
    "  Set-Content -LiteralPath '" + q(wrapper) + "' -Value $lines -Encoding OEM",
    "  $exe = '" + q(exe) + "'",
    "  if (-not (Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_TCP + "' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '" + FIREWALL_RULE_TCP + "' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4802-4809 -Program $exe -RemoteAddress LocalSubnet -Profile Any | Out-Null }",
    "  if (-not (Get-NetFirewallRule -DisplayName '" + FIREWALL_RULE_UDP + "' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '" + FIREWALL_RULE_UDP + "' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 41234 -Program $exe -RemoteAddress LocalSubnet -Profile Any | Out-Null }",
    // ⚠️ NE PAS revenir à `schtasks /Create` ici. Deux raisons, toutes deux
    // constatées sur un poste réel :
    // 1. schtasks est un EXÉCUTABLE, pas une cmdlet : $ErrorActionPreference
    //    ne l'intercepte pas. Un échec passait donc inaperçu, le script
    //    écrivait quand même 'OK', et l'utilisateur recevait un « task-missing »
    //    sans jamais voir la vraie erreur — avalée par le `| Out-Null`.
    // 2. Créer une tâche via schtasks.exe est un procédé de persistance
    //    classique, que les antivirus surveillent de près (Kaspersky est
    //    très répandu chez nos clients). Register-ScheduledTask passe par
    //    l'API COM du planificateur, moins souvent bloquée.
    // Les cmdlets lèvent une exception attrapée par le `catch` : le message
    // exact remonte jusqu'à l'écran.
    // Une réinstallation par-dessus un serveur qui tourne laisserait
    // l'ancien processus tenir le port 4802 : le nouveau démarrerait dans
    // le vide. Même filtre prudent qu'à la désinstallation — sur la ligne
    // de commande, jamais sur le nom d'image (partagé avec le navigateur).
    "  $anciens = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*serve.js*' -and $_.CommandLine -like '*" + q(chatServerDataDir) + "*' }",
    "  foreach ($v in $anciens) { try { Stop-Process -Id $v.ProcessId -Force -ErrorAction Stop } catch { } }",
    "  $action = New-ScheduledTaskAction -Execute '" + q(wrapper) + "'",
    "  $trigger = New-ScheduledTaskTrigger -AtStartup",
    // ExecutionTimeLimit à zéro = aucune limite. Sans cela le planificateur
    // arrête la tâche au bout de son délai par défaut : un serveur permanent
    // mourrait tout seul au bout de quelques jours.
    "  $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable",
    "  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest",
    "  Register-ScheduledTask -TaskName '" + q(CHAT_SERVER_TASK) + "' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null",
    // Vérification ICI, dans le contexte élevé : c'est le seul endroit où la
    // lecture du planificateur est fiable (en session normale elle est
    // parfois refusée — même symptôme que pour les règles de pare-feu).
    // ⚠️ Message FACTUEL : décrire ce qui a été constaté, jamais supposer la
    // cause. Une version antérieure accusait l'antivirus — hypothèse tirée
    // d'un seul poste, démentie depuis par un second poste qui échoue dans
    // des conditions toutes différentes. Un utilisateur à qui l'on désigne
    // une fausse cause perd son temps à la traiter.
    "  if (-not (Get-ScheduledTask -TaskName '" + q(CHAT_SERVER_TASK) + "' -ErrorAction SilentlyContinue)) { throw 'Le planificateur de taches Windows a accepte la creation sans erreur, mais la tache reste introuvable ensuite.' }",
    // Démarrage immédiat : un serveur n'a pas à être redémarré pour être
    // installé.
    "  Start-ScheduledTask -TaskName '" + q(CHAT_SERVER_TASK) + "'",
    // Marqueur écrit UNIQUEMENT ici, après enregistrement ET vérification.
    // Il permet à l'app de savoir qu'elle est installée sans dépendre d'une
    // lecture du planificateur, parfois refusée en session normale — c'est
    // ce qui obligeait à tout réinstaller à chaque ouverture du panneau.
    // Volontairement APRÈS le contrôle : un échec ne doit rien marquer.
    "  Set-Content -LiteralPath '" + q(marqueurInstall) + "' -Value ('{\"task\":\"' + '" + q(CHAT_SERVER_TASK) + "' + '\",\"date\":\"' + (Get-Date -Format s) + '\"}')",
    "  Set-Content -LiteralPath '" + q(resultFile) + "' -Value 'OK'",
    "} catch {",
    "  Set-Content -LiteralPath '" + q(resultFile) + "' -Value ('FAIL ' + $_.Exception.Message)",
    "}",
    "exit 0",
  ].join("\r\n");
  writeFileSync(ps1, ecrirePs1(script), "utf8");

  const { code } = await runPowerShell(["-Command",
    "try { $p = Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"" + ps1.replace(/'/g, "''") + "\"'; exit $p.ExitCode } catch { exit 125 }",
  ]);

  // Même doctrine que le pare-feu : le verdict vient du terrain, pas du
  // code de sortie. Le script élevé a DÉJÀ vérifié l'enregistrement de la
  // tâche là où la lecture est fiable ; s'il a écrit 'OK', elle existe.
  let verdict = "";
  try { verdict = readFileSync(resultFile, "utf8").trim(); } catch {}
  if (!verdict.startsWith("OK")) {
    if (code === 125 || !verdict) return { ok: false, refused: true };
    return { ok: false, error: verdict.replace(/^FAIL\s*/, "") };
  }
  // ⚠️ Cette relecture non élevée n'est PLUS un critère d'échec : sur les
  // postes où l'antivirus refuse la lecture du planificateur en session
  // normale, elle renvoyait false alors que la tâche existait — c'est ce
  // qui produisait un « task-missing » trompeur après une installation
  // pourtant réussie. Elle ne sert plus qu'à nuancer l'état affiché.
  const tacheVisible = await chatServerTaskExists();
  let running = false;
  for (let i = 0; i < 6 && !running; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    running = await chatServerPortAlive();
  }
  return { ok: true, running, tacheVisible, dataDir: chatServerDataDir };
});

ipcMain.handle("chat-server-uninstall", async () => {
  if (process.platform !== "win32") return { ok: false };
  const { mkdtempSync } = await import("fs");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "hnaya-srv-"));
  const ps1 = join(dir, "hnaya-server-uninstall.ps1");
  const resultFile = join(dir, "result.txt");
  const q = (s) => String(s).replace(/'/g, "''");
  // Les DONNÉES (historique, registre, licence) sont volontairement
  // conservées : une réinstallation reprend le salon là où il était.
  // Mêmes cmdlets qu'à l'installation, et pour les mêmes raisons : un
  // `schtasks /Delete` en échec n'aurait pas interrompu le script, qui
  // aurait écrit 'OK' malgré tout. Pire ici : le contrôle final se faisait
  // par une lecture NON élevée, or une lecture refusée se lit exactement
  // comme « tâche absente » — l'app annonçait donc une désinstallation
  // réussie sans rien avoir supprimé. Le verdict vient maintenant du
  // contexte élevé, seul endroit où la lecture est fiable.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  $t = Get-ScheduledTask -TaskName '" + q(CHAT_SERVER_TASK) + "' -ErrorAction SilentlyContinue",
    "  if ($t) {",
    "    try { Stop-ScheduledTask -TaskName '" + q(CHAT_SERVER_TASK) + "' } catch { }",
    "    Unregister-ScheduledTask -TaskName '" + q(CHAT_SERVER_TASK) + "' -Confirm:$false",
    "  }",
    // ⚠️ Arrêter la tâche ne suffit PAS : elle lance un .cmd qui lance à son
    // tour l'exécutable. Le planificateur tue le .cmd, le petit-fils survit —
    // constaté sur un poste réel, où le serveur tenait toujours le port 4802
    // après une désinstallation « réussie », jusqu'au redémarrage.
    // Le filtre porte sur la ligne de commande (serve.js ET notre répertoire
    // de données) et JAMAIS sur le seul nom d'image : celui-ci est aussi
    // celui du navigateur de l'utilisateur, qu'on fermerait sous lui.
    "  $miens = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -like '*serve.js*' -and $_.CommandLine -like '*" + q(chatServerDataDir) + "*' }",
    "  foreach ($m in $miens) { try { Stop-Process -Id $m.ProcessId -Force -ErrorAction Stop } catch { } }",
    "  if (Get-ScheduledTask -TaskName '" + q(CHAT_SERVER_TASK) + "' -ErrorAction SilentlyContinue) { throw 'La tache est toujours presente apres suppression.' }",
    // Le marqueur doit partir avec la tâche, sinon l'app continuerait de se
    // croire installée. Les DONNÉES (historique, licence) restent, elles.
    "  Remove-Item -LiteralPath '" + q(chatServerMarker) + "' -Force -ErrorAction SilentlyContinue",
    "  Set-Content -LiteralPath '" + q(resultFile) + "' -Value 'OK'",
    "} catch {",
    "  Set-Content -LiteralPath '" + q(resultFile) + "' -Value ('FAIL ' + $_.Exception.Message)",
    "}",
    "exit 0",
  ].join("\r\n");
  writeFileSync(ps1, ecrirePs1(script), "utf8");
  const { code } = await runPowerShell(["-Command",
    "try { $p = Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"" + ps1.replace(/'/g, "''") + "\"'; exit $p.ExitCode } catch { exit 125 }",
  ]);
  let verdict = "";
  try { verdict = readFileSync(resultFile, "utf8").trim(); } catch {}
  if (!verdict.startsWith("OK")) {
    if (code === 125 || !verdict) return { ok: false, refused: true };
    return { ok: false, error: verdict.replace(/^FAIL\s*/, "") };
  }
  return { ok: true };
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
    // ⚠️ Anti-clignotement (retour terrain : un onglet ouedkniss.com
    // clignotait de façon irrégulière). Le titre était envoyé par DEUX
    // sources — l'événement page-title-updated ET updateTabInfo, lui-même
    // branché sur 5 événements de navigation. Sur un site à publicités et
    // rafraîchissements fréquents, ces cycles se répètent et le libellé
    // de l'onglet oscillait entre le titre réel et une valeur transitoire.
    // Solution : mémoriser la dernière valeur envoyée et n'émettre QUE
    // sur un vrai changement (le renderer ne reçoit plus de doublons).
    let lastSentUrl = null;
    let lastSentTitle = null;
    let lastSentFavicon = null;

    const sendTabUrl = (url) => {
      // Ne jamais propager une URL Google Auth au renderer — pollue
      // realViewUrl côté React (urlbar.tsx) et casse isDownloadable
      if (isGoogleAuthUrl(url) || !url || url === lastSentUrl) return;
      lastSentUrl = url;
      mainWindow.webContents.send("update-url", id, url);
    };

    const sendTabTitle = (title) => {
      if (!title || title === lastSentTitle) return;
      lastSentTitle = title;
      mainWindow.webContents.send("update-tab-title", { id, title });
    };

    const updateTabInfo = () => {
      const currentUrl = view.webContents.getURL();
      const title = view.webContents.getTitle();
      sendTabUrl(currentUrl);
      // Pendant un chargement, getTitle() renvoie parfois l'URL elle-même :
      // on ignore ce cas transitoire plutôt que d'afficher une URL brute
      if (title !== currentUrl) sendTabTitle(title);
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
      // Même filtre anti-doublon que updateTabInfo — sans lui, les deux
      // sources se relançaient mutuellement et l'onglet clignotait
      sendTabTitle(title);
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
        openExternallyWithNotice(details.url);
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
    openExternallyWithNotice(navUrl);
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
    openExternallyWithNotice(navUrl);
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
      sendTabUrl(validatedURL);
      updateTabInfo();
    });
view.webContents.on("did-finish-load", () => {
      // Favicon
      view.webContents.executeJavaScript(`
        const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        favicon ? favicon.href : null;
      `).then(faviconUrl => {
        // Même dédoublonnage : une icône réémise à l'identique faisait
        // re-télécharger l'image et clignoter l'onglet
        if (faviconUrl === lastSentFavicon) return;
        lastSentFavicon = faviconUrl;
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
