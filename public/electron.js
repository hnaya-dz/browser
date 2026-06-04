import { app, BrowserWindow, BrowserView, ipcMain } from "electron";
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

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  scrollBounce: true,
}
  });
  if (app.isPackaged) {
    appServe(mainWindow).then(() => {
      mainWindow.loadURL("app://index.html");
    });
  } else {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.on("did-fail-load", (e, code, desc) => {
      mainWindow.webContents.reloadIgnoringCache();
    });
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

app.on("ready", () => {
  createWindow();
});

app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler((details) => {
    console.log('Window open handler executed for URL:', details.url);
    mainWindow.webContents.send('new-tab-url', details.url);
    return { action: 'deny' };
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

const updateBrowserViewSize = () => {
  if (mainWindow && activeTabId) {
    const browserView = browserViews.get(activeTabId);
    if (browserView) {
      const { width, height } = mainWindow.getContentBounds();
      const marginTop = Math.round(height * 0.12);
      const viewHeight = Math.round(height * 0.88);
      browserView.setBounds({ x: 0, y: marginTop, width, height: viewHeight });
    }
  }
};

////////////////////////////////////////////////////////////////////////////////
// Tabs Management

ipcMain.on("open-tab", (event, newTab) => {
  const { id, url } = newTab;
  if (!url) {
    console.error(`Invalid URL received for tab ${id}:`, url);
    return;
  }

  if (!browserViews.has(id)) {
    const browserView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        scrollBounce: true,
        transparent: false,
        preload: join(__dirname, "preload.js"),
        // contextIsolation: true
      }
    });
    browserViews.set(id, browserView);

    const updateTabInfo = () => {
      const currentUrl = browserView.webContents.getURL();
      const title = browserView.webContents.getTitle();

      mainWindow.webContents.send("update-url", id, currentUrl);

      // Only send title update if it's different from the current URL's domain
      if (title && title !== currentUrl) {
        try {
          const domain = new URL(currentUrl).hostname.replace('www.', '');
          if (title !== domain) {
            mainWindow.webContents.send("update-tab-title", { id, title });
          }
        } catch (e) {
          mainWindow.webContents.send("update-tab-title", { id, title });
        }
      }
    };

    // Set up all event listeners
    browserView.webContents.on('page-title-updated', (event, title) => {
      mainWindow.webContents.send("update-tab-title", { id, title });
    });

    const navigationEvents = [
      'did-start-loading',
      'did-stop-loading',
      'did-finish-load',
      'did-navigate',
      'did-navigate-in-page'
    ];

    navigationEvents.forEach(event => {
      browserView.webContents.on(event, updateTabInfo);
    });

    browserView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      mainWindow.webContents.send("update-url", id, validatedURL);
      updateTabInfo();
    });

    // Favicon handling
    browserView.webContents.on('did-finish-load', () => {
      browserView.webContents.executeJavaScript(`
        const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        favicon ? favicon.href : null;
      `).then(faviconUrl => {
        mainWindow.webContents.send("update-tab-favicon", { id, faviconUrl });
      }).catch(console.error);
    });

    browserView.webContents.loadURL(url);
  }

  switchTab(id);
});

const switchTab = (tabId) => {
  if (!mainWindow) return;
  if (browserViews.has(activeTabId)) {
    mainWindow.removeBrowserView(browserViews.get(activeTabId));
  }
  if (browserViews.has(tabId)) {
    activeTabId = tabId;
    const browserView = browserViews.get(tabId);
    mainWindow.setBrowserView(browserView);
    updateBrowserViewSize();
  }
};

ipcMain.on("get-current-url", (event, tabId) => {
  if (browserViews.has(tabId)) {
    const view = browserViews.get(tabId);
    const currentUrl = view.webContents.getURL();
    event.sender.send("current-url", tabId, currentUrl);
  }
});

ipcMain.on("switch-tab", (event, tabId) => {
  switchTab(tabId);
});

ipcMain.on("close-tab", (event, tabId) => {
  if (browserViews.has(tabId)) {
    const browserView = browserViews.get(tabId);
    browserView.webContents.destroy();
    browserViews.delete(tabId);

    if (activeTabId === tabId) {
      activeTabId = 1;
      switchTab(activeTabId);
    }
  }
});

////////////////////////////////////////////////////////////////////////////////
// Navigation Controls

// Update the navigation handlers to work with tabs:
ipcMain.on("go-back", () => {
  if (activeTabId && browserViews.has(activeTabId)) {
    const view = browserViews.get(activeTabId);
    if (view?.webContents?.canGoBack()) {
      view.webContents.goBack();
    } else {
      mainWindow.webContents.send("close-browser-view-and-go-home");
    }
  }
});

ipcMain.on("go-forward", () => {
  if (activeTabId && browserViews.has(activeTabId)) {
    const view = browserViews.get(activeTabId);
    if (view?.webContents?.canGoForward()) {
      view.webContents.goForward();
    }
  }
});

ipcMain.on("refresh", () => {
  if (activeTabId && browserViews.has(activeTabId)) {
    const view = browserViews.get(activeTabId);
    view?.webContents?.reload();
  }
});

ipcMain.on("navigate", (event, url) => {
  if (activeTabId && browserViews.has(activeTabId)) {
    const view = browserViews.get(activeTabId);
    if (view?.webContents) {
      // Ensure URL has protocol
      let finalUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        finalUrl = `https://${url}`;
      }
      view.webContents.loadURL(finalUrl);

      // Immediately update the URL in the UI
      mainWindow.webContents.send("update-url", activeTabId, finalUrl);
    }
  }
});
