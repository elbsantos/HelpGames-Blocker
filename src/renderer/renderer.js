const loginScreen     = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const loadingScreen   = document.getElementById('loadingScreen');
const loginForm       = document.getElementById('loginForm');
const loginError      = document.getElementById('loginError');
const logoutBtn       = document.getElementById('logoutBtn');

// LOGIN
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const submitBtn = loginForm.querySelector('button[type="submit"]');

  if (loginError) loginError.textContent = '';
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
    if (loginError) loginError.textContent = result.error || 'Email ou senha incorrectos';
  }
});

// MOSTRAR DASHBOARD
function showDashboard(user) {
  loginScreen.classList.add('hidden');
  loadingScreen.classList.add('hidden');
  dashboardScreen.style.display = 'block';

  const headerRight = document.getElementById('headerRight');
  if (headerRight) headerRight.style.display = 'flex';

  if (user) {
    const emailEl = document.getElementById('userEmail');
    if (emailEl) emailEl.textContent = user.email;
    const planEl = document.getElementById('userPlan');
    if (planEl) planEl.textContent = user.plan === 'premium' ? 'Premium' : 'Gratuito';
  }

  updateStatus();
}

// LOGOUT
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (!confirm('Sair? O bloqueio sera desactivado.')) return;
    dashboardScreen.style.display = 'none';
    loadingScreen.classList.remove('hidden');
    await window.electronAPI.logout();
    const headerRight = document.getElementById('headerRight');
    if (headerRight) headerRight.style.display = 'none';
    loadingScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
  });
}

// ABRIR DASHBOARD WEB
const webBtn = document.getElementById('openWebDashboard');
if (webBtn) webBtn.addEventListener('click', () => window.electronAPI.openWebDashboard());

// ACTUALIZAR STATUS
async function updateStatus() {
  const status = await window.electronAPI.getStatus();
  renderStatus(status.isBlocked, 0, status.totalSites);
}

function renderStatus(isBlocked, remainingMinutes, totalSites) {
  const icon  = document.getElementById('statusIcon');
  const title = document.getElementById('statusTitle');
  const desc  = document.getElementById('statusDescription');
  const badge = document.getElementById('statusBadge');
  const timerEl = document.getElementById('timerBlock');
  const timerVal = document.getElementById('timerValue');
  const sitesEl = document.getElementById('totalSites');

  if (sitesEl) sitesEl.textContent = (totalSites || 0).toLocaleString('pt-PT');

  if (isBlocked) {
    if (icon)  { icon.textContent = '🛡️'; icon.className = 'status-icon active'; }
    if (title) title.textContent = 'Bloqueio Activo';
    if (desc)  desc.textContent = 'Sites de apostas estao bloqueados neste dispositivo';
    if (badge) { badge.textContent = 'PROTEGIDO'; badge.className = 'badge badge-active'; }
    if (timerEl) timerEl.style.display = 'block';
    if (timerVal && remainingMinutes > 0) {
      timerVal.textContent = remainingMinutes + ' min restantes';
    }
  } else {
    if (icon)  { icon.textContent = '⚪'; icon.className = 'status-icon inactive'; }
    if (title) title.textContent = 'Aguardando Activacao';
    if (desc)  desc.textContent = 'Active o bloqueio no dashboard web do HelpGames';
    if (badge) { badge.textContent = 'INACTIVO'; badge.className = 'badge badge-inactive'; }
    if (timerEl) timerEl.style.display = 'none';
  }
}

// EVENTOS DO MAIN PROCESS
window.electronAPI.onStatusUpdate((data) => {
  renderStatus(data.isBlocked, data.remainingMinutes, null);
});

window.electronAPI.onBlockageActivated((data) => {
  renderStatus(true, data.remainingMinutes || 0, null);
  updateStatus();
});

window.electronAPI.onBlockageDeactivated(() => {
  renderStatus(false, 0, null);
  updateStatus();
});

window.electronAPI.onLoggedIn((user) => {
  loadingScreen.classList.add('hidden');
  loginScreen.classList.add('hidden');
  showDashboard(user);
});

console.log('[HelpGames Blocker] Interface carregada');

// Actualizar campo "Estado" na stats row
function updateStateShort(isBlocked) {
  const el = document.getElementById('stateShort');
  if (el) el.textContent = isBlocked ? '🟢 ON' : '⚪ OFF';
}

// Patch renderStatus para incluir stateShort
const _origRender = renderStatus;
function renderStatus(isBlocked, remainingMinutes, totalSites) {
  _origRender(isBlocked, remainingMinutes, totalSites);
  updateStateShort(isBlocked);
}
