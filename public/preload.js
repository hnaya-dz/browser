const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Envoi unidirectionnel (fire & forget)
  send: (channel, data) => {
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
  // Appel bidirectionnel avec réponse (Promise) — utilisé pour yt-dlp
  invoke: (channel, ...args) => {
    return ipcRenderer.invoke(channel, ...args);
  },
});
