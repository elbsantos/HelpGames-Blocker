const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  login:            (credentials) => ipcRenderer.invoke('login', credentials),
  openWebDashboard: () => ipcRenderer.invoke('open-web-dashboard'),
});
