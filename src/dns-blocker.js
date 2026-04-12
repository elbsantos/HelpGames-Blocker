const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

// ============================================================
// DNS BLOCKER via ficheiro HOSTS
//
// PORQUÊ hosts em vez de servidor DNS na porta 53?
//   - Porta 53 requer privilégios de root/admin
//   - O ficheiro hosts funciona em TODOS os sistemas sem VPN
//   - É o método mais fiável, usado por apps como Pi-hole, etc.
// ============================================================

const HOSTS_MARKER_BEGIN = '# === HelpGames Blocker BEGIN ===';
const HOSTS_MARKER_END   = '# === HelpGames Blocker END ===';

const HOSTS_PATH = {
  win32:  'C:\\Windows\\System32\\drivers\\etc\\hosts',
  darwin: '/etc/hosts',
  linux:  '/etc/hosts',
};

class DNSBlocker {
  constructor() {
    this.blockedSites = new Set();
    this.active = false;
    this.platform = os.platform();
    this.hostsPath = HOSTS_PATH[this.platform] || '/etc/hosts';
    this._onBlocked = null; // callback: (domain) => void
  }

  // ============================================================
  // INICIALIZAR
  // ============================================================
  async initialize() {
    console.log('[DNS] 🚀 Inicializando DNS Blocker (método hosts)...');

    // Limpar entradas antigas que possam ter ficado de sessões anteriores
    await this.removeHostsEntries();

    this.active = false;
    console.log('[DNS] ✅ DNS Blocker pronto (aguarda lista de sites)');
  }

  // ============================================================
  // SETAR SITES BLOQUEADOS E ACTIVAR
  // ============================================================
  async setBlockedSites(sites) {
    this.blockedSites.clear();
    for (const s of sites) {
      const clean = s.toLowerCase().replace(/^www\./, '');
      this.blockedSites.add(clean);
      this.blockedSites.add('www.' + clean); // bloquear também o www
    }
    console.log('[DNS] 📋 Lista actualizada:', this.blockedSites.size, 'entradas');

    // Reescrever o ficheiro hosts
    await this.writeHostsEntries();

    this.active = true;
    console.log('[DNS] ✅ Hosts actualizado – bloqueio activo');
  }

  // ============================================================
  // ESCREVER ENTRADAS NO FICHEIRO HOSTS
  // ============================================================
  async writeHostsEntries() {
    try {
      // Ler conteúdo actual
      let content = '';
      try {
        content = await fs.readFile(this.hostsPath, 'utf-8');
      } catch {
        content = '';
      }

      // Remover bloco anterior do HelpGames
      content = this.removeOurBlock(content);

      // Construir novo bloco
      const lines = [HOSTS_MARKER_BEGIN];
      for (const site of this.blockedSites) {
        lines.push(`127.0.0.1 ${site}`);
      }
      lines.push(HOSTS_MARKER_END);

      const newContent = content.trimEnd() + '\n\n' + lines.join('\n') + '\n';

      // Escrever
      if (this.platform === 'win32') {
        await this.writeFileWindows(newContent);
      } else {
        await this.writeFileUnix(newContent);
      }

      console.log('[DNS] ✅ Ficheiro hosts actualizado com', this.blockedSites.size, 'entradas');
    } catch (error) {
      console.error('[DNS] ❌ Erro ao escrever hosts:', error.message);
      console.error('[DNS] ℹ️  Certifica-te de que o app corre como Administrador');
      throw error;
    }
  }

  // ============================================================
  // REMOVER ENTRADAS DO FICHEIRO HOSTS
  // ============================================================
  async removeHostsEntries() {
    try {
      let content = '';
      try {
        content = await fs.readFile(this.hostsPath, 'utf-8');
      } catch {
        return; // ficheiro não existe, nada a fazer
      }

      const cleaned = this.removeOurBlock(content);

      if (cleaned !== content) {
        if (this.platform === 'win32') {
          await this.writeFileWindows(cleaned);
        } else {
          await this.writeFileUnix(cleaned);
        }
        console.log('[DNS] ✅ Entradas do HelpGames removidas do hosts');
      }
    } catch (error) {
      console.error('[DNS] ❌ Erro ao limpar hosts:', error.message);
    }
  }

  removeOurBlock(content) {
    const begin = content.indexOf(HOSTS_MARKER_BEGIN);
    const end   = content.indexOf(HOSTS_MARKER_END);
    if (begin === -1 || end === -1) return content;
    return (content.slice(0, begin) + content.slice(end + HOSTS_MARKER_END.length)).replace(/\n{3,}/g, '\n\n');
  }

  // ============================================================
  // ESCREVER FICHEIRO - WINDOWS (precisa de admin)
  // ============================================================
  async writeFileWindows(content) {
    // Gravar para temp primeiro e depois copiar
    const tmp = path.join(os.tmpdir(), 'helpgames-hosts.tmp');
    await fs.writeFile(tmp, content, 'utf-8');
    try {
      await execAsync(`copy /Y "${tmp}" "${this.hostsPath}"`);
    } catch {
      // Tentar com cmd elevado (vai falhar se não for admin, mas dá mensagem clara)
      await execAsync(`cmd /c copy /Y "${tmp}" "${this.hostsPath}"`);
    }
  }

  // ============================================================
  // ESCREVER FICHEIRO - UNIX (precisa de sudo)
  // ============================================================
  async writeFileUnix(content) {
    const tmp = path.join(os.tmpdir(), 'helpgames-hosts.tmp');
    await fs.writeFile(tmp, content, 'utf-8');
    try {
      await execAsync(`sudo cp "${tmp}" "${this.hostsPath}"`);
    } catch {
      // Sem sudo – tentar escrever directamente (se o utilizador for root)
      await fs.writeFile(this.hostsPath, content, 'utf-8');
    }
  }

  // ============================================================
  // VERIFICAR SE DOMÍNIO ESTÁ BLOQUEADO (para logs locais)
  // ============================================================
  isDomainBlocked(domain) {
    const clean = domain.replace(/^www\./, '').toLowerCase();
    if (this.blockedSites.has(clean)) return true;
    if (this.blockedSites.has('www.' + clean)) return true;

    // Verificar subdomínios (ex: mobile.bet365.com)
    const parts = clean.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (this.blockedSites.has(parent)) return true;
    }
    return false;
  }

  // ============================================================
  // PARAR DNS BLOCKER (remover entradas)
  // ============================================================
  async stop() {
    console.log('[DNS] ⏹️ Parando DNS Blocker...');
    await this.removeHostsEntries();
    this.active = false;
    this.blockedSites.clear();
    console.log('[DNS] ✅ DNS Blocker parado, hosts restaurado');
  }

  // ============================================================
  // GETTERS
  // ============================================================
  isActive() {
    return this.active;
  }

  getBlockedSitesCount() {
    // Dividir por 2 porque guardamos "dominio" e "www.dominio"
    return Math.floor(this.blockedSites.size / 2);
  }
}

module.exports = DNSBlocker;
