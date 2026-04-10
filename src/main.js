const { app, BrowserWindow, ipcMain, Tray, Menu, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');
const DNSBlocker = require('./dns-blocker');
const VPNManager = require('./vpn-manager');
const API = require('./api');

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const store = new Store();
const isDev = process.argv.includes('--dev');

let mainWindow;
let tray;
let dnsBlocker;
let vpnManager;
let syncInterval;

// ============================================================
// CRIAR JANELA PRINCIPAL
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    frame: true,
    backgroundColor: '#0f172a',
  });

  mainWindow.loadFile('src/renderer/index.html');

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Minimizar para bandeja ao fechar
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// ============================================================
// CRIAR TRAY ICON
// ============================================================
function createTray() {
  try {
    tray = new Tray(path.join(__dirname, '../assets/tray-icon.png'));
  } catch {
    // Se não tiver ícone, cria sem
    console.warn('[Tray] ⚠️ Ícone não encontrado, usando padrão');
  }

  function buildMenu() {
    const isActive = dnsBlocker?.isActive() || false;
    const count = dnsBlocker?.getBlockedSitesCount() || 0;
    const user = store.get('user');

    return Menu.buildFromTemplate([
      { label: 'HelpGames Blocker', enabled: false },
      { type: 'separator' },
      { label: `Status: ${isActive ? '✅ Activo' : '⚠️ Inactivo'}`, enabled: false },
      { label: `Sites bloqueados: ${count.toLocaleString()}`, enabled: false },
      user ? { label: `Utilizador: ${user.email}`, enabled: false } : { type: 'separator' },
      { type: 'separator' },
      {
        label: 'Abrir Dashboard',
        click: () => { mainWindow?.show(); },
      },
      {
        label: 'Abrir helpgames.pt',
        click: () => { require('electron').shell.openExternal('https://helpgames.pt'); },
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
  }

  if (tray) {
    tray.setToolTip('HelpGames Blocker – Proteção Activa');
    tray.setContextMenu(buildMenu());
    tray.on('click', () => { mainWindow?.show(); });

    // Actualizar menu a cada 30s
    setInterval(() => {
      if (tray) tray.setContextMenu(buildMenu());
    }, 30000);
  }
}

// ============================================================
// INICIALIZAR BLOQUEIO
// ============================================================
async function initializeBlocking() {
  console.log('[HelpGames] 🚀 Inicializando bloqueio...');

  if (!dnsBlocker) {
    dnsBlocker = new DNSBlocker();
    await dnsBlocker.initialize();
  }

  if (!vpnManager) {
    vpnManager = new VPNManager();
    await vpnManager.initialize();
  }

  // Carregar lista de sites
  const sites = await API.getBlockedSites();
  await dnsBlocker.setBlockedSites(sites);
  await vpnManager.setBlockedSites(sites);

  console.log('[HelpGames] ✅ Bloqueio activo!', dnsBlocker.getBlockedSitesCount(), 'domínios');

  // Sincronizar a cada 5 minutos
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(syncWithServer, 5 * 60 * 1000);

  // Primeira sincronização após 10s
  setTimeout(syncWithServer, 10 * 1000);
}

// ============================================================
// SINCRONIZAR COM SERVIDOR
// ============================================================
async function syncWithServer() {
  try {
    if (!API.hasSession()) return;

    // Buscar estado do servidor
    const updates = await API.sync();

    // Enviar tentativas bloqueadas acumuladas
    const pending = store.get('pendingAttempts', []);
    if (pending.length > 0) {
      await API.sendBlockedAttempts(pending);
      store.set('pendingAttempts', []);
      console.log('[HelpGames] 📤 Enviadas', pending.length, 'tentativas ao servidor');
    }

    // Se lista de sites foi actualizada, recarregar
    if (updates?.sitesUpdated) {
      const newSites = await API.getBlockedSites();
      await dnsBlocker?.setBlockedSites(newSites);
      await vpnManager?.setBlockedSites(newSites);
      console.log('[HelpGames] 🔄 Lista de sites actualizada');
    }

    console.log('[HelpGames] 🔄 Sincronização OK');
  } catch (error) {
    console.error('[HelpGames] ❌ Erro ao sincronizar:', error.message);
  }
}

// ============================================================
// REGISTAR TENTATIVA BLOQUEADA
// ============================================================
function registerBlockedAttempt(domain) {
  // Guardar localmente para sincronizar depois
  const attempts = store.get('blockedAttempts', []);
  const pending  = store.get('pendingAttempts', []);

  const entry = { domain, timestamp: Date.now(), blocked: true };

  // Histórico local (max 100)
  attempts.unshift(entry);
  store.set('blockedAttempts', attempts.slice(0, 100));

  // Fila para enviar ao servidor
  pending.push(entry);
  store.set('pendingAttempts', pending);

  // Notificar janela se estiver aberta
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('attempt-blocked', domain);
  }

  // Notificação do sistema
  try {
    new Notification({
      title: '🚫 HelpGames Blocker',
      body: `Acesso bloqueado: ${domain}`,
      silent: true,
    }).show();
  } catch { /* Notificações podem não estar disponíveis */ }

  console.log('[HelpGames] 🚫 BLOQUEADO:', domain);
}

// ============================================================
// IPC HANDLERS
// ============================================================

ipcMain.handle('get-status', async () => {
  const user = store.get('user', null);
  const attempts = store.get('blockedAttempts', []);
  const today = new Date().toDateString();

  return {
    isLoggedIn: API.hasSession() && user !== null,
    user,
    dnsActive:   dnsBlocker?.isActive()  || false,
    vpnActive:   vpnManager?.isActive()  || false,
    totalSites:  dnsBlocker?.getBlockedSitesCount() || 0,
    blockedToday: attempts.filter(a => new Date(a.timestamp).toDateString() === today).length,
    blockedTotal: attempts.length,
  };
});

ipcMain.handle('get-recent-attempts', async () => {
  return store.get('blockedAttempts', []).slice(0, 20);
});

ipcMain.handle('login', async (event, { email, password }) => {
  try {
    const result = await API.login(email, password);

    if (!result.success) {
      return { success: false, error: 'Login falhou' };
    }

    // Persistir sessão e utilizador
    store.set('user', result.user);
    store.set('sessionCookie', API.getSessionCookie());

    // Iniciar bloqueio
    await initializeBlocking();

    return { success: true, user: result.user };
  } catch (error) {
    console.error('[Login] ❌', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('logout', async () => {
  try {
    if (syncInterval) clearInterval(syncInterval);

    await API.logout();
    store.delete('user');
    store.delete('sessionCookie');

    if (dnsBlocker) {
      await dnsBlocker.stop();
      dnsBlocker = null;
    }
    if (vpnManager) {
      await vpnManager.stop();
      vpnManager = null;
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-web-dashboard', async () => {
  require('electron').shell.openExternal('https://helpgames.pt');
});

ipcMain.handle('get-server-stats', async () => {
  if (!API.hasSession()) return null;
  return await API.getStats();
});

// ============================================================
// APP LIFECYCLE
// ============================================================
app.whenReady().then(async () => {
  createWindow();
  createTray();

  // Tentar restaurar sessão guardada
  const savedCookie = store.get('sessionCookie');
  const savedUser   = store.get('user');

  if (savedCookie && savedUser) {
    API.restoreSession(savedCookie);

    // Verificar se sessão ainda é válida
    const me = await API.getMe();

    if (me && me.id) {
      console.log('[HelpGames] ✅ Sessão restaurada para:', me.email);
      store.set('user', me);

      try {
        await initializeBlocking();
        mainWindow.webContents.on('did-finish-load', () => {
          mainWindow.webContents.send('logged-in', me);
        });
      } catch (error) {
        console.error('[HelpGames] ❌ Erro ao inicializar bloqueio:', error.message);
      }
    } else {
      // Sessão expirou
      store.delete('user');
      store.delete('sessionCookie');
      console.log('[HelpGames] ℹ️ Sessão expirada, é necessário fazer login');
    }
  }
});

app.on('window-all-closed', () => {
  // Não sair – continua em background na bandeja
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  console.log('[HelpGames] 👋 Encerrando...');
  if (syncInterval) clearInterval(syncInterval);

  // Tentar enviar tentativas pendentes antes de sair
  try {
    const pending = store.get('pendingAttempts', []);
    if (pending.length > 0 && API.hasSession()) {
      await API.sendBlockedAttempts(pending);
      store.set('pendingAttempts', []);
    }
  } catch { /* ignora erros no fecho */ }

  if (dnsBlocker) await dnsBlocker.stop().catch(() => {});
  if (vpnManager) await vpnManager.stop().catch(() => {});
});

// Exportar para dns-blocker.js poder chamar
module.exports = { registerBlockedAttempt };
