const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const DNSBlocker = require('./dns-blocker');
const VPNManager = require('./vpn-manager');
const API = require('./api');
const { startBlockedPageServer, stopBlockedPageServer, setRemainingSecondsGetter } = require('./blocked-page-server');

const store = new Store();
const isDev = process.argv.includes('--dev');

let tray;
let loginWindow;
let dnsBlocker;
let vpnManager;
let pollInterval;
let currentlyBlocked = false;
let remainingSeconds = 0;

// Iniciar com o Windows
if (!isDev) {
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
    name: 'HelpGames Blocker',
  });
}

// Passar tempo restante para a página de bloqueio
setRemainingSecondsGetter(() => remainingSeconds);

// ============================================================
// JANELA DE LOGIN
// ============================================================
function createLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 420,
    height: 480,
    resizable: false,
    center: true,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#0f172a',
    title: 'HelpGames Blocker',
    maximizable: false,
  });

  loginWindow.loadFile('src/renderer/index.html');
  if (isDev) loginWindow.webContents.openDevTools();
  loginWindow.on('closed', () => { loginWindow = null; });
}

// ============================================================
// TRAY
// ============================================================
function createTray() {
  try {
    tray = new Tray(path.join(__dirname, '../assets/tray-icon.png'));
  } catch (e) {
    console.warn('[Tray] Icone nao encontrado');
    return;
  }
  updateTrayMenu();
  tray.on('double-click', openDashboardWeb);
}

function updateTrayMenu() {
  if (!tray) return;
  const user = store.get('user');
  const isLoggedIn = API.hasSession() && user;

  const statusLabel = currentlyBlocked
    ? '🛡️  Bloqueio Activo' + (remainingSeconds > 0 ? ' (' + Math.ceil(remainingSeconds / 60) + 'min)' : '')
    : '⚪  Aguardando activação';

  const menu = Menu.buildFromTemplate([
    { label: 'HelpGames Blocker', enabled: false },
    { type: 'separator' },
    { label: statusLabel, enabled: false },
    isLoggedIn
      ? { label: '👤  ' + user.email, enabled: false }
      : { label: '⚠️  Não ligado', enabled: false },
    { type: 'separator' },
    { label: '🌐  Abrir Dashboard Web', click: openDashboardWeb },
    !isLoggedIn
      ? { label: '🔑  Fazer Login', click: createLoginWindow }
      : { label: '🚪  Terminar Sessão', click: doLogout },
    { type: 'separator' },
    {
      label: '❌  Sair do HelpGames Blocker',
      click: async () => {
        const choice = dialog.showMessageBoxSync({
          type: 'question',
          buttons: ['Cancelar', 'Sair'],
          defaultId: 0,
          title: 'Sair',
          message: 'Ao sair, os sites de apostas deixarão de estar bloqueados.',
        });
        if (choice === 1) { app.isQuitting = true; app.quit(); }
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(currentlyBlocked ? 'HelpGames – 🛡️ Bloqueio Activo' : 'HelpGames – Aguardando');
}

function openDashboardWeb() {
  require('electron').shell.openExternal('https://helpgames-production.up.railway.app');
}

// ============================================================
// LOGOUT
// ============================================================
async function doLogout() {
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Cancelar', 'Terminar Sessão'],
    defaultId: 0,
    title: 'Terminar Sessão',
    message: 'Terminar sessão irá desactivar o bloqueio.',
  });
  if (choice !== 1) return;

  if (pollInterval) clearInterval(pollInterval);
  await API.logout();
  store.delete('user');
  store.delete('sessionCookie');
  if (dnsBlocker) await dnsBlocker.stop();
  if (vpnManager) await vpnManager.stop();
  stopBlockedPageServer();
  currentlyBlocked = false;
  remainingSeconds = 0;
  updateTrayMenu();
  showNotification('Sessão terminada', 'O bloqueio foi desactivado.');
}

// ============================================================
// NOTIFICAÇÃO
// ============================================================
function showNotification(title, body) {
  try { new Notification({ title, body, silent: false }).show(); } catch (e) {}
}

// ============================================================
// POLLING
// ============================================================
async function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  await checkBlockageStatus();
  pollInterval = setInterval(checkBlockageStatus, 30 * 1000);
  console.log('[HelpGames] Polling iniciado (30s)');
}

async function checkBlockageStatus() {
  try {
    if (!API.hasSession()) {
      showNotification('⚠️ HelpGames', 'Sessão expirada. Faz login novamente.');
      createLoginWindow();
      if (pollInterval) clearInterval(pollInterval);
      return;
    }

    const status = await API.getBlockageStatus();

    // Se getBlockageStatus retornou null (ex: 401), sessão expirou
    if (!status) {
      store.delete('sessionCookie');
      createLoginWindow();
      if (pollInterval) clearInterval(pollInterval);
      return;
    }

    remainingSeconds = status.remainingSeconds || 0;

    if (status.isBlocked && !currentlyBlocked) {
      // ACTIVAR bloqueio
      const sites = await API.getBlockedSites();
      await dnsBlocker.setBlockedSites(sites);
      await vpnManager.setBlockedSites(sites);
      startBlockedPageServer();
      currentlyBlocked = true;
      updateTrayMenu();
      showNotification('🛡️ Bloqueio Activado', 'Sites de apostas estão bloqueados.');
      console.log('[HelpGames] Bloqueio activo!', dnsBlocker.getBlockedSitesCount(), 'sites');

    } else if (!status.isBlocked && currentlyBlocked) {
      // DESACTIVAR bloqueio
      await dnsBlocker.stop();
      await vpnManager.stop();
      stopBlockedPageServer();
      currentlyBlocked = false;
      remainingSeconds = 0;
      updateTrayMenu();
      showNotification('⏱️ Bloqueio Expirou', 'O período de protecção terminou.');
      console.log('[HelpGames] Bloqueio removido.');

    } else if (status.isBlocked) {
      updateTrayMenu();
    }

  } catch (error) {
    console.error('[HelpGames] Erro no polling:', error.message);
  }
}

// ============================================================
// IPC
// ============================================================
ipcMain.handle('login', async (event, { email, password }) => {
  try {
    const result = await API.login(email, password);
    if (!result.success) return { success: false, error: 'Login falhou' };

    store.set('user', result.user);
    store.set('sessionCookie', API.getSessionCookie());

    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();

    updateTrayMenu();
    await startPolling();

    showNotification('✅ HelpGames Blocker activo', 'A monitorizar o teu estado de protecção.');
    return { success: true, user: result.user };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-status', async () => ({
  isLoggedIn: API.hasSession(),
  user: store.get('user', null),
  isBlocked: currentlyBlocked,
  totalSites: dnsBlocker ? dnsBlocker.getBlockedSitesCount() : 0,
}));

ipcMain.handle('open-web-dashboard', openDashboardWeb);

// ============================================================
// LIFECYCLE
// ============================================================
app.whenReady().then(async () => {
  if (app.dock) app.dock.hide();

  createTray();

  dnsBlocker = new DNSBlocker();
  await dnsBlocker.initialize();

  vpnManager = new VPNManager();
  await vpnManager.initialize(); // limpa regras antigas do firewall

  // Configurar callback para reportar tentativas bloqueadas
  dnsBlocker._onBlocked = async (domain) => {
    if (!API.hasSession()) return;
    try {
      await API.reportBlockedAttempt(domain);
      console.log('[HelpGames] Tentativa bloqueada reportada:', domain);
    } catch (err) {
      console.error('[HelpGames] Erro ao reportar tentativa:', err.message);
    }
  };

  const savedCookie = store.get('sessionCookie');
  const savedUser   = store.get('user');

  if (savedCookie && savedUser) {
    API.restoreSession(savedCookie);
    const me = await API.getMe();
    if (me && me.id) {
      console.log('[HelpGames] Sessao restaurada:', me.email);
      store.set('user', me);
      updateTrayMenu();
      await startPolling();
    } else {
      store.delete('user');
      store.delete('sessionCookie');
      createLoginWindow();
    }
  } else {
    createLoginWindow();
  }
});

app.on('window-all-closed', () => { /* continua em background */ });
app.on('activate', () => { if (!API.hasSession()) createLoginWindow(); });
app.on('before-quit', async () => {
  if (pollInterval) clearInterval(pollInterval);
  stopBlockedPageServer();
  if (dnsBlocker) await dnsBlocker.stop().catch(() => {});
  if (vpnManager) await vpnManager.stop().catch(() => {});
});

module.exports = {};
