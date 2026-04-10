const { contextBridge, ipcRenderer } = require('electron');

// ============================================================
// PRELOAD – Bridge seguro entre Renderer e Main
// ============================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // Status do bloqueador
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Tentativas bloqueadas (histórico local)
  getRecentAttempts: () => ipcRenderer.invoke('get-recent-attempts'),

  // Estatísticas do servidor
  getServerStats: () => ipcRenderer.invoke('get-server-stats'),

  // Autenticação
  login:  (credentials) => ipcRenderer.invoke('login', credentials),
  logout: () => ipcRenderer.invoke('logout'),

  // Abrir dashboard web
  openWebDashboard: () => ipcRenderer.invoke('open-web-dashboard'),

  // Listeners de eventos do main process
  onAttemptBlocked: (callback) => {
    ipcRenderer.on('attempt-blocked', (event, domain) => callback(domain));
  },

  onLoggedIn: (callback) => {
    ipcRenderer.on('logged-in', (event, user) => callback(user));
  },
});
