const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Acções (invoke → resposta assíncrona do main process)
  login:            (credentials) => ipcRenderer.invoke('login', credentials),
  logout:           ()            => ipcRenderer.invoke('logout'),
  getStatus:        ()            => ipcRenderer.invoke('get-status'),
  openWebDashboard: (path)        => ipcRenderer.invoke('open-web-dashboard', path),

  // Eventos enviados pelo main process → renderer
  onLoggedIn:            (cb) => ipcRenderer.on('logged-in',            (_e, data) => cb(data)),
  onStatusUpdate:        (cb) => ipcRenderer.on('status-update',        (_e, data) => cb(data)),
  onBlockageActivated:   (cb) => ipcRenderer.on('blockage-activated',   (_e, data) => cb(data)),
  onBlockageDeactivated: (cb) => ipcRenderer.on('blockage-deactivated', ()         => cb()),
});
