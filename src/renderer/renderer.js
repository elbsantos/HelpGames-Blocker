const loginScreen     = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const loadingScreen   = document.getElementById('loadingScreen');
const loginForm       = document.getElementById('loginForm');
const loginError      = document.getElementById('loginError');
const logoutBtn       = document.getElementById('logoutBtn');

// ─── LOGIN ────────────────────────────────────────────────────────────────────

// Botão de ligação via browser — abre a página de autorização no browser do utilizador
document.getElementById('linkBrowserBtn').addEventListener('click', () => {
  window.electronAPI.openWebDashboard('/auth/device');
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const submitBtn = loginForm.querySelector('button[type="submit"]');

  loginError.textContent = '';
  loginError.classList.remove('show');
  loginScreen.classList.add('hidden');
  loadingScreen.classList.remove('hidden');
  if (submitBtn) submitBtn.disabled = true;

  const result = await window.electronAPI.login({ email, password });

  if (result.success) {
    loadingScreen.classList.add('hidden');
    showDashboard(result.user);
  } else {
    loadingScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    if (submitBtn) submitBtn.disabled = false;
    loginError.textContent = result.error || 'Email ou palavra-passe incorrectos';
    loginError.classList.add('show');
  }
});

document.getElementById('registerLink').addEventListener('click', () => {
  window.electronAPI.openWebDashboard();
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

function showDashboard(user) {
  loginScreen.classList.add('hidden');
  loadingScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  document.getElementById('headerRight').style.display = 'flex';

  if (user) {
    document.getElementById('userEmail').textContent = user.email || '';
    document.getElementById('userPlan').textContent  =
      user.plan === 'premium' ? '⭐ Premium' : 'Plano Gratuito';
  }

  updateStatus();
  startTimerTick();
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (!confirm('Terminar sessão? O bloqueio será desactivado.')) return;
    dashboardScreen.classList.add('hidden');
    loadingScreen.classList.remove('hidden');
    await window.electronAPI.logout();
    loadingScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    document.getElementById('email').value    = '';
    document.getElementById('password').value = '';
    stopTimerTick();
  });
}

document.getElementById('openWebDashboard').addEventListener('click', () => {
  window.electronAPI.openWebDashboard();
});

// ─── STATUS ───────────────────────────────────────────────────────────────────

async function updateStatus() {
  const status = await window.electronAPI.getStatus();
  renderStatus(status.isBlocked, status.remainingSeconds || 0, status.totalSites);
}

function renderStatus(isBlocked, remainingSeconds, totalSites) {
  const icon  = document.getElementById('statusIcon');
  const title = document.getElementById('statusTitle');
  const desc  = document.getElementById('statusDescription');
  const badge = document.getElementById('statusBadge');
  const timerEl  = document.getElementById('timerBlock');
  const sitesEl  = document.getElementById('totalSites');
  const stateEl  = document.getElementById('stateShort');

  if (sitesEl && totalSites != null)
    sitesEl.textContent = Number(totalSites).toLocaleString('pt-PT');

  if (isBlocked) {
    icon.textContent = '🛡️'; icon.className = 'status-icon active';
    title.textContent = 'Bloqueio Activo';
    desc.textContent  = 'Sites de apostas estão bloqueados neste dispositivo';
    badge.textContent = 'PROTEGIDO'; badge.className = 'badge badge-active';
    timerEl.classList.remove('hidden');
    if (stateEl) stateEl.textContent = '🟢 ON';
    updateTimerDisplay(remainingSeconds);
  } else {
    icon.textContent = '⚪'; icon.className = 'status-icon inactive';
    title.textContent = 'Aguardando Activação';
    desc.textContent  = 'Active o bloqueio no dashboard web do HelpGames';
    badge.textContent = 'INACTIVO'; badge.className = 'badge badge-inactive';
    timerEl.classList.add('hidden');
    if (stateEl) stateEl.textContent = '⚪ OFF';
  }
}

// ─── TIMER LOCAL (conta regressiva baseada nos segundos recebidos do main) ────

let timerInterval = null;
let timerRemaining = 0;

function startTimerTick() {
  stopTimerTick();
  timerInterval = setInterval(() => {
    if (timerRemaining > 0) {
      timerRemaining--;
      updateTimerDisplay(timerRemaining);
      if (timerRemaining === 0) updateStatus(); // revalidar estado no servidor
    }
  }, 1000);
}

function stopTimerTick() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateTimerDisplay(secs) {
  timerRemaining = secs;
  const el = document.getElementById('timerValue');
  if (!el) return;
  if (secs <= 0) { el.textContent = 'Expirado'; return; }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  el.textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

// ─── EVENTOS DO MAIN PROCESS ──────────────────────────────────────────────────

window.electronAPI.onLoggedIn((user) => {
  loadingScreen.classList.add('hidden');
  showDashboard(user);
});

window.electronAPI.onStatusUpdate((data) => {
  renderStatus(data.isBlocked, data.remainingSeconds || 0, null);
});

window.electronAPI.onBlockageActivated((data) => {
  renderStatus(true, data.remainingSeconds || 0, null);
  startTimerTick();
});

window.electronAPI.onBlockageDeactivated(() => {
  renderStatus(false, 0, null);
  stopTimerTick();
});

console.log('[HelpGames Blocker] Interface carregada');
