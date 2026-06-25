const { contextBridge, ipcRenderer } = require("electron");

// ✅ PATCH 7 — whitelist explicite des canaux IPC autorisés
// Empêche tout code web malveillant d'envoyer des commandes arbitraires au main process
const ALLOWED_INVOKE = [
  "get-video-info",
  "choose-download-folder",
  "check-downloadable",
  "hide-active-view-sync",  // PATCH 2 — remplace hide-active-view + setTimeout
];

const ALLOWED_SEND = [
  "navigate",
  "hnaya-dl",
  "go-back",
  "go-forward",
  "refresh",
  "open-tab",
  "close-tab",
  "switch-tab",
  "hide-active-view",
  "show-active-view",
  "set-tab-position",
  "close-browser-view",
  "get-current-url",
  "download-video",
  "cancel-download",        // PATCH 9 — annulation du process yt-dlp
];

contextBridge.exposeInMainWorld("electronAPI", {
  // Envoi unidirectionnel (fire & forget)
  send: (channel, data) => {
    if (!ALLOWED_SEND.includes(channel)) {
      console.warn(`[preload] Canal send non autorisé : ${channel}`);
      return;
    }
    ipcRenderer.send(channel, data);
  },
  // Écoute des événements du main process
  receive: (channel, func) => {
    ipcRenderer.on(channel, (event, ...args) => func(...args));
  },
  // Suppression d'un listener
  removeListener: (channel, func) => {
    ipcRenderer.removeListener(channel, func);
  },
  // Appel bidirectionnel avec réponse (Promise)
  invoke: (channel, ...args) => {
    if (!ALLOWED_INVOKE.includes(channel)) {
      console.warn(`[preload] Canal invoke non autorisé : ${channel}`);
      return Promise.reject(new Error(`Canal non autorisé : ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
});
