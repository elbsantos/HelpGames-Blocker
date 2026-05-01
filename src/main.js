const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const DNSBlocker = require('./dns-blocker');
const VPNManager = require('./vpn-manager');
const CertManager = require('./cert-manager');
const API = require('./api');
const { startBlockedPageServer, stopBlockedPageServer, setRemainingSecondsGetter, setCertManager } = require('./blocked-page-server');
const setup = require('./elevation-setup');

const store = new Store();
const isDev = process.argv.includes('--dev');
const isSetupMode = process.argv.includes('--setup');

// Single-instance guard — second launch just focuses the existing window
if (!app.requestSingleInstanceLock()) { app.quit(); }
else { app.on('second-instance', () => { if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.show(); loginWindow.focus(); } }); }

let tray;
let loginWindow;
let dnsBlocker;
let vpnManager;
let pollInterval;
let currentlyBlocked = false;
let remainingSeconds = 0;
let blockageActivatedAt = 0;

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
  tray.on('double-click', () => {
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.show();
      loginWindow.focus();
    } else {
      createLoginWindow();
    }
  });
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
    ...(isLoggedIn ? [
      {
        label: '🔄  Atualizar Status Agora',
        click: async () => {
          console.log('[Tray] ⚡ Atualização manual solicitada');
          await checkBlockageStatus();
          showNotification('✅ Status Atualizado', 'Verificação manual executada com sucesso.');
        },
      },
      {
        label: '🐛  Ver Logs de Debug',
        click: () => {
          console.log('\n' + '='.repeat(60));
          console.log('📊 DEBUG STATUS:');
          console.log('  - currentlyBlocked:', currentlyBlocked);
          console.log('  - remainingSeconds:', remainingSeconds);
          console.log('  - Total sites:', dnsBlocker ? dnsBlocker.getBlockedSitesCount() : 0);
          console.log('  - Session:', API.getSessionCookie() ? '✅ Presente' : '❌ Ausente');
          console.log('  - User:', user ? user.email : '❌ Nenhum');
          console.log('='.repeat(60) + '\n');
          showNotification('🐛 Debug', 'Logs escritos no console.');
        },
      },
    ] : []),
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

// Enviar evento para a janela se estiver aberta
function sendToWindow(channel, data) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.webContents.send(channel, data);
  }
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
    console.log('[HelpGames] 🔍 Verificando status do bloqueio...');
    
    if (!API.hasSession()) {
      console.log('[HelpGames] ❌ Sem sessão ativa');
      showNotification('⚠️ HelpGames', 'Sessão expirada. Faz login novamente.');
      createLoginWindow();
      if (pollInterval) clearInterval(pollInterval);
      return;
    }

    const status = await API.getBlockageStatus();
    console.log('[HelpGames] 📊 Status recebido:', JSON.stringify(status));

    // Se getBlockageStatus retornou null (ex: 401), sessão expirou
    if (!status) {
      console.log('[HelpGames] ❌ Status null - sessão expirada no backend');
      store.delete('sessionCookie');
      createLoginWindow();
      if (pollInterval) clearInterval(pollInterval);
      return;
    }

    remainingSeconds = status.remainingSeconds || 0;
    
    console.log('[HelpGames] 📌 Estado atual:');
    console.log('  - Backend isBlocked:', status.isBlocked);
    console.log('  - Local currentlyBlocked:', currentlyBlocked);
    console.log('  - remainingSeconds:', remainingSeconds);

    if (status.isBlocked && !currentlyBlocked) {
      // ACTIVAR bloqueio
      console.log('[HelpGames] ✅ ATIVANDO bloqueio local...');
      blockageActivatedAt = Date.now();
      const sites = await API.getBlockedSites();
      console.log('[HelpGames] 📥 Recebidos', sites.length, 'sites para bloquear');

      await dnsBlocker.setBlockedSites(sites);
      await vpnManager.setBlockedSites(sites);
      startBlockedPageServer();
      currentlyBlocked = true;
      updateTrayMenu();
      sendToWindow('blockage-activated', { isBlocked: true, remainingSeconds });
      showNotification('🛡️ Bloqueio Activado', 'Sites de apostas estão bloqueados.');
      console.log('[HelpGames] ✅ Bloqueio activo!', dnsBlocker.getBlockedSitesCount(), 'sites');

    } else if (!status.isBlocked && currentlyBlocked) {
      // DESACTIVAR bloqueio
      console.log('[HelpGames] ❌ DESATIVANDO bloqueio local...');
      const blockageDuration = Math.floor((Date.now() - blockageActivatedAt) / 1000);

      await dnsBlocker.stop();
      await vpnManager.stop();
      stopBlockedPageServer();
      currentlyBlocked = false;
      remainingSeconds = 0;
      updateTrayMenu();
      sendToWindow('blockage-deactivated', {});

      if (blockageDuration > 10) {
        showNotification('⏱️ Bloqueio Expirou', 'O período de protecção terminou.');
      }
      console.log('[HelpGames] ❌ Bloqueio removido.');

    } else if (status.isBlocked) {
      // Bloqueio continua activo — actualizar menu e janela
      console.log('[HelpGames] ⏳ Bloqueio continua ativo (', Math.floor(remainingSeconds/60), 'min restantes)');
      updateTrayMenu();
      sendToWindow('status-update', { isBlocked: true, remainingSeconds });
    } else {
      console.log('[HelpGames] ⭕ Sem bloqueio ativo');
      sendToWindow('status-update', { isBlocked: false, remainingSeconds: 0 });
    }

  } catch (error) {
    console.error('[HelpGames] ❌ Erro no polling:', error.message);
    console.error(error.stack);
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

    updateTrayMenu();
    await startPolling();

    showNotification('✅ HelpGames Blocker activo', 'A monitorizar o teu estado de protecção.');
    return { success: true, user: result.user };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('logout', async () => {
  await doLogout();
});

ipcMain.handle('get-status', async () => ({
  isLoggedIn: API.hasSession(),
  user: store.get('user', null),
  isBlocked: currentlyBlocked,
  remainingSeconds,
  totalSites: dnsBlocker ? dnsBlocker.getBlockedSitesCount() : 0,
}));

ipcMain.handle('open-web-dashboard', openDashboardWeb);

// ============================================================
// LIFECYCLE
// ============================================================
app.whenReady().then(async () => {
  if (app.dock) app.dock.hide();

  // ── One-time elevation setup (Windows, production only) ──────────────────
  if (process.platform === 'win32' && !isDev) {
    if (isSetupMode && setup.isElevated()) {
      // Running elevated via UAC — create task + install cert then relaunch via task
      await setup.createTask(process.execPath).catch(console.error);
      const dataDir = app.getPath('userData');
      await CertManager.init(dataDir);
      await setup.installCACert(dataDir).catch(console.error);
      await setup.runTask().catch(console.error);
      app.quit();
      return;
    }

    if (!setup.isElevated()) {
      const taskInstalled = await setup.isTaskInstalled();

      if (!taskInstalled) {
        // Very first run: ask user once, then relaunch elevated for setup
        const { response } = await dialog.showMessageBox({
          type: 'info',
          buttons: ['Configurar (requer admin uma vez)', 'Agora não'],
          defaultId: 0,
          title: 'HelpGames Blocker – Configuração Inicial',
          message: 'Para funcionar sem pedir permissão de administrador em cada arranque, o HelpGames Blocker precisa de uma configuração única.\n\nApenas é pedida uma vez. Depois arranca automaticamente no login sem qualquer janela de UAC.',
        });
        if (response === 0) setup.relaunchElevated('--setup');
        app.quit();
        return;
      }

      // Task exists but app was launched directly (not via task) — trigger task and exit
      await setup.runTask().catch(console.error);
      app.quit();
      return;
    }
    // If we reach here: running elevated via scheduled task → normal startup
  }
  // ─────────────────────────────────────────────────────────────────────────

  createTray();

  dnsBlocker = new DNSBlocker();
  await dnsBlocker.initialize();

  vpnManager = new VPNManager();
  await vpnManager.initialize(); // limpa regras antigas do firewall

  // Inicializar CA local para bloqueio HTTPS sem erros SSL no browser
  const dataDir = app.getPath('userData');
  await CertManager.init(dataDir);
  setCertManager(CertManager);

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
