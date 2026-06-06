import { app, BrowserWindow, WebContentsView, ipcMain, Menu } from "electron";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import serve from "electron-serve";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appServe = app.isPackaged ? serve({
  directory: join(__dirname, "../out"),
}) : null;

let mainWindow = null;
const browserViews = new Map();
let activeTabId = null;
let tabSideWidth = 0;   // 0 = onglets en haut | 200 = onglets latéraux

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
      sandbox: true,
    },
  });
  if (app.isPackaged) {
    appServe(mainWindow).then(() => mainWindow.loadURL("app://index.html"));
  } else {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.on("did-fail-load", () => mainWindow.webContents.reloadIgnoringCache());
  }
  mainWindow.on("closed", () => { mainWindow = null; });
};

app.on("ready", () => { createWindow(); });

app.on("web-contents-created", (event, contents) => {
  contents.setWindowOpenHandler((details) => {
    if (mainWindow) mainWindow.webContents.send("new-tab-url", details.url);
    return { action: "deny" };
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── Calcul des bounds selon le mode ──────────────────────────────────────────
//
// MODE HAUT (tabSideWidth = 0) :
//   TabBar (6vh) + Navbar/URLBar (6vh) = ~12% du haut réservé
//   → y = 12%, height = 88%, width = 100%
//
// MODE LATÉRAL (tabSideWidth = 200) :
//   TabBar à droite (200px), Navbar reste en haut (6vh) mais URLBar aussi (6vh)
//   → La WebContentsView couvre TOUT depuis le haut (y=0)
//     car la TabBar n'est plus en haut
//   → width = 100% - 200px, height = 100%, x = 0
//   Note : Navbar et URLBar flottent au-dessus en position fixed React,
//          donc la WebContentsView les verra passer dessous — acceptable
//          car marginTop React gère l'espace visible
//
const updateBrowserViewSize = () => {
  if (!mainWindow || !activeTabId) return;
  const view = browserViews.get(activeTabId);
  if (!view) return;

  const { width, height } = mainWindow.getContentBounds();

  if (tabSideWidth > 0) {
    // ✅ MODE LATÉRAL : couvre tout depuis le haut, laisse 200px à droite
    view.setBounds({
      x: 0,
      y: 0,
      width: width - tabSideWidth,
      height: height,
    });
  } else {
    // ✅ MODE HAUT : laisse 12% en haut pour TabBar + Navbar/URLBar
    const marginTop = Math.round(height * 0.12);
    view.setBounds({
      x: 0,
      y: marginTop,
      width: width,
      height: height - marginTop,
    });
  }
};

// IPC : le renderer informe Electron de la position des onglets
ipcMain.on("set-tab-position", (event, position) => {
  tabSideWidth = position === "right" ? 200 : 0;
  updateBrowserViewSize();
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

////////////////////////////////////////////////////////////////////////////////
// Navigation Controls

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
