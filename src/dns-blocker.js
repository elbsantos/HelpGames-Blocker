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
    this.canWriteHosts = null; // null = ainda não testado, true/false após selfCheckWrite
  }

  // ============================================================
  // INICIALIZAR
  // ============================================================
  async initialize() {
    console.log('[DNS] 🚀 Inicializando DNS Blocker (método hosts)...');

    await this.selfCheckWrite();

    // Limpar entradas antigas que possam ter ficado de sessões anteriores
    await this.removeHostsEntries();

    this.active = false;
    console.log('[DNS] ✅ DNS Blocker pronto (aguarda lista de sites)');
  }

  // ============================================================
  // AUTO-TESTE DE ESCRITA (chamado no initialize)
  // ============================================================
  async selfCheckWrite() {
    try {
      const probe = '# HelpGames-probe\n';
      let content = '';
      try { content = await fs.readFile(this.hostsPath, 'utf-8'); } catch {}

      await this._writeHostsRaw(content + probe);
      // Verificar se foi realmente escrito
      const readBack = await fs.readFile(this.hostsPath, 'utf-8');
      if (!readBack.includes('HelpGames-probe')) throw new Error('probe não encontrado após escrita');

      // Repor conteúdo original
      await this._writeHostsRaw(content);
      this.canWriteHosts = true;
      console.log('[DNS] ✅ Permissão de escrita no hosts confirmada');
    } catch (err) {
      this.canWriteHosts = false;
      console.warn('[DNS] ⚠️ Sem permissão de escrita no hosts:', err.message);
    }
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

    // Limpar cache DNS para que o bloqueio faça efeito imediatamente
    if (this.platform === 'win32') {
      try { await execAsync('ipconfig /flushdns'); console.log('[DNS] ✅ Cache DNS limpa'); }
      catch (e) { console.warn('[DNS] ⚠️ ipconfig /flushdns falhou:', e.message); }
    }

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
      await this._writeHostsRaw(newContent);

      // Verificar que o bloco ficou gravado
      const readBack = await fs.readFile(this.hostsPath, 'utf-8');
      if (!readBack.includes(HOSTS_MARKER_BEGIN)) {
        throw Object.assign(new Error('Verificação pós-escrita falhou'), { code: 'VERIFY_FAILED' });
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
        await this._writeHostsRaw(cleaned);
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
  // ESCREVER FICHEIRO (interno) — plataforma independente
  // ============================================================
  async _writeHostsRaw(content) {
    if (this.platform === 'win32') {
      await this._writeHostsWindows(content);
    } else {
      await this._writeHostsUnix(content);
    }
  }

  // ============================================================
  // ESCREVER FICHEIRO - WINDOWS (precisa de admin)
  // ============================================================
  async _writeHostsWindows(content) {
    console.log('[DNS] Escrevendo ficheiro hosts (Windows)...');

    // 1. Remover atributos read-only/system/hidden
    try {
      await execAsync(`attrib -R -S -H "${this.hostsPath}"`);
    } catch (e) {
      console.warn('[DNS] attrib falhou (ignorando):', e.message);
    }

    // 2. Tentativa directa via Node (funciona se app correr elevado)
    try {
      await fs.writeFile(this.hostsPath, content, 'utf-8');
      console.log('[DNS] ✅ Hosts escrito directamente');
      return;
    } catch (err1) {
      console.warn('[DNS] Escrita directa falhou:', err1.message);
    }

    // 3. Fallback via PowerShell Copy-Item (eleva implicitamente se script tiver permissão)
    const tmp = path.join(os.tmpdir(), 'helpgames-hosts.tmp');
    await fs.writeFile(tmp, content, 'utf-8');
    try {
      await execAsync(
        `powershell.exe -NonInteractive -NoProfile -Command "Copy-Item -Path '${tmp.replace(/'/g, "''")}' -Destination '${this.hostsPath.replace(/'/g, "''")}' -Force"`
      );
      console.log('[DNS] ✅ Hosts escrito via PowerShell Copy-Item');
      return;
    } catch (err2) {
      console.error('[DNS] ❌❌ ERRO CRÍTICO — app NÃO está a correr como Administrador!');
      console.error('[DNS] Detalhes:', err2.message);
      throw Object.assign(
        new Error('É necessário correr como Administrador para modificar o ficheiro hosts'),
        { code: 'NOT_ELEVATED' }
      );
    }
  }

  // ============================================================
  // ESCREVER FICHEIRO - UNIX (precisa de sudo)
  // ============================================================
  async _writeHostsUnix(content) {
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
    let isBlocked = false;
    
    if (this.blockedSites.has(clean)) isBlocked = true;
    if (this.blockedSites.has('www.' + clean)) isBlocked = true;

    // Verificar subdomínios (ex: mobile.bet365.com)
    if (!isBlocked) {
      const parts = clean.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        const parent = parts.slice(i).join('.');
        if (this.blockedSites.has(parent)) {
          isBlocked = true;
          break;
        }
      }
    }
    
    // Se bloqueado, reportar tentativa
    if (isBlocked && this._onBlocked) {
      this._onBlocked(clean).catch(() => {});
    }
    
    return isBlocked;
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
