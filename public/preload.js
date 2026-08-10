const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_INVOKE = [
  "get-video-info",
  "choose-download-folder",
  "check-downloadable",
  "hide-active-view-sync",
  // ✅ Gestionnaire de mots de passe
  "vault-is-available",
  "vault-list",
  "vault-upsert",
  "vault-delete",
  "vault-find-for-current-tab",
  "vault-inject",
  "vault-save-from-page",
  "vault-export",
  "vault-import",
  "chat-session-get",
  "chat-session-save",
  "chat-session-forget",
  "chat-session-list",
  "chat-session-clear",
  "get-active-tab-url",
  "get-build-info",
  "favorites-list",
  "favorites-is-saved",
  "favorites-add",
  "favorites-remove",
  "favorites-update",
  "favorites-export",
  "favorites-import",
  "tabgroups-list",
  "tabgroups-save",
  "tabgroups-delete",
  "check-for-update",
  "get-app-version",
  // ✅ Chat local (LAN) — module complémentaire (voir chat-module/README.md)
  "chat-start-host",
  "chat-network-check",
  "chat-network-setup",
  "chat-admin-export",
  // ✅ Serveur permanent (tier premium) — déploiement depuis ce poste
  // ✅ Étape E — pièces jointes (images, vocaux, documents)
  "chat-media-upload",
  "chat-media-download",
  "chat-media-save",
  "chat-server-get-info",
  "chat-server-pick-licence",
  "chat-server-installed-licence",
  "chat-pairing-token",
  "chat-server-install",
  "chat-server-uninstall",
  // ✅ Confidentialité — interrupteurs utilisateur
  "privacy-get-settings",
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
  "set-app-language",
  "close-browser-view",
  "get-current-url",
  "download-video",
  "cancel-download",
  // ✅ Chat local (LAN) — module complémentaire (voir chat-module/README.md)
  "chat-warmup",
  "chat-dock",
  "chat-stop-host",
  "chat-discover",
  "chat-join",
  "chat-send-message",
  "chat-open-vote",
  "chat-answer-vote",
  "chat-decider",
  "chat-mark-read",
  "chat-roster",
  "chat-leave",
  "chat-admin",
  "chat-list-rooms",
  "chat-send-invite",
  "chat-delete-room",
  // ✅ Confidentialité — interrupteurs utilisateur
  "privacy-set-settings",
];

contextBridge.exposeInMainWorld("electronAPI", {
  send: (channel, data) => {
    if (!ALLOWED_SEND.includes(channel)) {
      console.warn(`[preload] Canal send non autorisé : ${channel}`);
      return;
    }
    ipcRenderer.send(channel, data);
  },
  receive: (channel, func) => {
    ipcRenderer.on(channel, (event, ...args) => func(...args));
  },
  removeListener: (channel, func) => {
    ipcRenderer.removeListener(channel, func);
  },
  invoke: (channel, ...args) => {
    if (!ALLOWED_INVOKE.includes(channel)) {
      console.warn(`[preload] Canal invoke non autorisé : ${channel}`);
      return Promise.reject(new Error(`Canal non autorisé : ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
});
