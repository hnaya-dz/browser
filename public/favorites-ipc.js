// public/favorites-ipc.js
// Canaux IPC pour le gestionnaire de favoris et groupes d'onglets

import { ipcMain, dialog } from "electron";
import { writeFileSync, readFileSync } from "fs";
import {
  favoritesRead, favoriteAdd, favoriteRemove, favoriteUpdate, favoriteIsSaved,
  tabGroupsRead, tabGroupSave, tabGroupDelete,
  exportAll, importAll,
} from "./favorites.js";

export function registerFavoritesIpc(getMainWindow, getBrowserViews, getActiveTabId) {

  // ── Favoris ───────────────────────────────────────────────────

  ipcMain.handle("favorites-list", async () => {
    return favoritesRead();
  });

  ipcMain.handle("favorites-is-saved", async (event, url) => {
    return favoriteIsSaved(url);
  });

  ipcMain.handle("favorites-add", async (event, entry) => {
    return favoriteAdd(entry);
  });

  ipcMain.handle("favorites-remove", async (event, id) => {
    return favoriteRemove(id);
  });

  ipcMain.handle("favorites-update", async (event, { id, updates }) => {
    return favoriteUpdate(id, updates);
  });

  // ── Groupes d'onglets ─────────────────────────────────────────

  ipcMain.handle("tabgroups-list", async () => {
    return tabGroupsRead();
  });

  ipcMain.handle("tabgroups-save", async (event, { name, tabs }) => {
    return tabGroupSave({ name, tabs });
  });

  ipcMain.handle("tabgroups-delete", async (event, id) => {
    return tabGroupDelete(id);
  });

  // ── Export chiffré ────────────────────────────────────────────
  ipcMain.handle("favorites-export", async () => {
    const mainWindow = getMainWindow();
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: "Exporter favoris et groupes d'onglets",
      defaultPath: `hnaya-favorites-${Date.now()}.json`,
      filters: [{ name: "Favoris Hnaya", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false };
    try {
      const data = exportAll();
      writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Import ────────────────────────────────────────────────────
  ipcMain.handle("favorites-import", async () => {
    const mainWindow = getMainWindow();
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: "Importer favoris",
      filters: [{ name: "Favoris Hnaya", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths[0]) return { ok: false };
    try {
      const raw  = readFileSync(filePaths[0], "utf8");
      const data = JSON.parse(raw);
      return importAll(data);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}
