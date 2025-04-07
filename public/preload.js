const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  send: (channel, data) => {
    console.log(`Sending to ${channel} with args:`, data);
    ipcRenderer.send(channel, data)
  },
  receive: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
  removeListener: (channel, func) => {
    ipcRenderer.removeListener(channel, func);
  }
});