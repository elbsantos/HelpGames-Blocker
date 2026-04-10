// ============================================================
// RENDERER – Interface do HelpGames Blocker
// ============================================================

const loginScreen     = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const loadingScreen   = document.getElementById('loadingScreen');
const loginForm       = document.getElementById('loginForm');
const loginError      = document.getElementById('loginError');
const logoutBtn       = document.getElementById('logoutBtn');

// ============================================================
// LOGIN
// ============================================================
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const submitBtn = loginForm.querySelector('button[type="submit"]');

  // Limpar erro anterior
  if (loginError) loginError.textContent = '';

  // Mostrar loading
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

    const msg = result.error || 'Email ou senha incorrectos';
    if (loginError) {
      loginError.textContent = msg;
    } else {
      alert('Erro ao fazer login: ' + msg);
    }
  }
});

// ============================================================
// MOSTRAR DASHBOARD
// ============================================================
function showDashboard(user) {
  loginScreen.classList.add('hidden');
  loadingScreen.classList.add('hidden');
  dashboardScreen.style.display = 'block';
  dashboardScreen.classList.remove('hidden');

  // Mostrar info do utilizador no header
  const headerRight = document.getElementById('headerRight');
  if (headerRight) headerRight.style.display = 'flex';

  if (user) {
    const userEl = document.getElementById('userEmail');
    if (userEl) userEl.textContent = user.email;

    const planEl = document.getElementById('userPlan');
    if (planEl) {
      planEl.textContent = user.plan === 'premium' ? '⭐ Premium' : '🆓 Gratuito';
    }
  }

  updateDashboard();
  setInterval(updateDashboard, 10000);
}

// ============================================================
// LOGOUT
// ============================================================
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (!confirm('Tens a certeza que queres sair? O bloqueio será desactivado.')) return;

    dashboardScreen.style.display = 'none';
    loadingScreen.classList.remove('hidden');

    await window.electronAPI.logout();

    const headerRight = document.getElementById('headerRight');
    if (headerRight) headerRight.style.display = 'none';

    dashboardScreen.style.display = 'none';
    loadingScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    document.getElementById('email').value    = '';
    document.getElementById('password').value = '';
  });
}

// ============================================================
// ABRIR DASHBOARD WEB
// ============================================================
const webDashBtn = document.getElementById('openWebDashboard');
if (webDashBtn) {
  webDashBtn.addEventListener('click', () => {
    window.electronAPI.openWebDashboard();
  });
}

// ============================================================
// ACTUALIZAR DASHBOARD
// ============================================================
async function updateDashboard() {
  try {
    const status   = await window.electronAPI.getStatus();
    const attempts = await window.electronAPI.getRecentAttempts();

    // Contador de sites
    const totalEl = document.getElementById('totalSites');
    if (totalEl) totalEl.textContent = (status.totalSites || 0).toLocaleString('pt-PT');

    // Bloqueados hoje
    const todayEl = document.getElementById('blockedToday');
    if (todayEl) todayEl.textContent = status.blockedToday || 0;

    // Status VPN (Firewall)
    const vpnEl = document.getElementById('vpnStatus');
    if (vpnEl) vpnEl.textContent = status.vpnActive ? '✅ Activo' : '⚪ Inactivo';

    // Status DNS (Hosts)
    const dnsEl = document.getElementById('dnsStatus');
    if (dnsEl) dnsEl.textContent = status.dnsActive ? '✅ Activo' : '❌ Inactivo';

    // Ícone de status geral
    const statusIcon  = document.getElementById('statusIcon');
    const statusTitle = document.getElementById('statusTitle');
    const statusDesc  = document.getElementById('statusDescription');

    if (status.dnsActive) {
      if (statusIcon) { statusIcon.textContent = '🛡️'; statusIcon.classList.remove('inactive'); }
      if (statusTitle) statusTitle.textContent = 'Proteção Activa';
      if (statusDesc) statusDesc.textContent = `${(status.totalSites || 0).toLocaleString('pt-PT')} sites de apostas bloqueados`;
    } else {
      if (statusIcon) { statusIcon.textContent = '⚠️'; statusIcon.classList.add('inactive'); }
      if (statusTitle) statusTitle.textContent = 'Protecção Inactiva';
      if (statusDesc) statusDesc.textContent = 'A inicializar ou sem permissões de administrador';
    }

    // Lista de tentativas
    updateAttemptsList(attempts);

    // Buscar estatísticas do servidor (sem bloquear UI)
    updateServerStats();
  } catch (error) {
    console.error('[Renderer] Erro ao actualizar dashboard:', error);
  }
}

// ============================================================
// ESTATÍSTICAS DO SERVIDOR
// ============================================================
async function updateServerStats() {
  try {
    const stats = await window.electronAPI.getServerStats();
    if (!stats) return;

    const serverTodayEl = document.getElementById('serverBlockedToday');
    if (serverTodayEl) serverTodayEl.textContent = stats.blockedToday || 0;

    const serverTotalEl = document.getElementById('serverBlockedTotal');
    if (serverTotalEl) serverTotalEl.textContent = stats.blockedTotal || 0;
  } catch {
    // silencioso
  }
}

// ============================================================
// LISTA DE TENTATIVAS RECENTES
// ============================================================
function updateAttemptsList(attempts) {
  const list = document.getElementById('attemptsList');
  if (!list) return;

  if (!attempts || attempts.length === 0) {
    list.innerHTML = `
      <p style="color:#94a3b8;text-align:center;padding:20px;">
        Nenhuma tentativa bloqueada ainda
      </p>`;
    return;
  }

  list.innerHTML = attempts.map(a => {
    const time = new Date(a.timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const date = new Date(a.timestamp).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
    return `
      <div class="attempt-item">
        <div>
          <div class="attempt-domain">🚫 ${a.domain}</div>
        </div>
        <div class="attempt-time">${date} ${time}</div>
      </div>`;
  }).join('');
}

// ============================================================
// EVENTOS DO MAIN PROCESS
// ============================================================

// Nova tentativa bloqueada (em tempo real)
window.electronAPI.onAttemptBlocked((domain) => {
  console.log('[Bloqueado em tempo real]', domain);
  updateDashboard();

  // Flash visual
  const icon = document.getElementById('statusIcon');
  if (icon) {
    icon.textContent = '🚫';
    setTimeout(() => { icon.textContent = '🛡️'; }, 2000);
  }
});

// Já logado (sessão restaurada no arranque)
window.electronAPI.onLoggedIn((user) => {
  loginScreen.classList.add('hidden');
  loadingScreen.classList.add('hidden');
  showDashboard(user);
});

// ============================================================
// INICIALIZAÇÃO
// ============================================================
console.log('[HelpGames Blocker] Interface carregada ✅');

// Mostrar/esconder info do utilizador no header
const _originalShowDashboard = showDashboard;
function patchHeader(user) {
  const hr = document.getElementById('headerRight');
  if (hr) hr.style.display = 'flex';
}
// Patch já está inline no showDashboard acima
