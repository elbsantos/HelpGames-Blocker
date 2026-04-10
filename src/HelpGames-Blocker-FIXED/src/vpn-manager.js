const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execAsync = promisify(exec);

// ============================================================
// VPN MANAGER (simplificado)
//
// O bloqueio principal é feito via ficheiro hosts (dns-blocker.js).
// Este módulo adiciona uma 2ª camada via Firewall do Windows para
// bloquear por endereço IP (complementar ao hosts).
//
// No Windows: usa Windows Firewall (netsh advfirewall)
// No Mac/Linux: apenas reporta como activo (hosts é suficiente)
// ============================================================

class VPNManager {
  constructor() {
    this.blockedSites = new Set();
    this.active = false;
    this.platform = os.platform();
    this.RULE_NAME = 'HelpGames-Blocker';
  }

  // ============================================================
  // INICIALIZAR
  // ============================================================
  async initialize() {
    console.log('[Firewall] 🚀 Inicializando camada de firewall...');

    // Limpar regras antigas
    await this.removeFirewallRules();

    console.log('[Firewall] ✅ Pronto');
  }

  // ============================================================
  // SETAR SITES BLOQUEADOS
  // ============================================================
  async setBlockedSites(sites) {
    this.blockedSites.clear();
    sites.forEach(s => this.blockedSites.add(s.toLowerCase()));

    if (this.platform === 'win32') {
      await this.applyWindowsFirewall();
    }
    // Mac e Linux: hosts file é suficiente para nosso caso de uso

    this.active = true;
    console.log('[Firewall] ✅ Regras aplicadas para', this.blockedSites.size, 'sites');
  }

  // ============================================================
  // WINDOWS FIREWALL - bloqueia IPs resolvidos dos domínios
  // ============================================================
  async applyWindowsFirewall() {
    try {
      // Remover regra anterior
      await this.removeFirewallRules();

      // Resolver IPs dos principais domínios para bloquear
      const dns = require('dns').promises;
      const ips = new Set();

      // Resolve apenas os top 50 domínios para não demorar muito
      const topSites = [...this.blockedSites].slice(0, 50);
      const resolvePromises = topSites.map(site =>
        dns.resolve4(site).catch(() => [])
      );

      const results = await Promise.allSettled(resolvePromises);
      for (const r of results) {
        if (r.status === 'fulfilled') {
          for (const ip of r.value) {
            ips.add(ip);
          }
        }
      }

      if (ips.size === 0) {
        console.log('[Firewall] ℹ️ Nenhum IP resolvido (offline?), a saltar firewall');
        return;
      }

      const ipList = [...ips].join(',');

      // Criar regra de bloqueio outbound
      await execAsync(
        `netsh advfirewall firewall add rule` +
        ` name="${this.RULE_NAME}"` +
        ` dir=out action=block` +
        ` remoteip=${ipList}` +
        ` enable=yes profile=any`
      );

      console.log('[Firewall] ✅ Regra Windows Firewall criada com', ips.size, 'IPs');
    } catch (error) {
      console.error('[Firewall] ⚠️ Erro ao criar regra firewall:', error.message);
      console.error('[Firewall] ℹ️ O bloqueio via hosts continua activo');
      // Não lançar erro – o hosts é suficiente
    }
  }

  // ============================================================
  // REMOVER REGRAS DE FIREWALL
  // ============================================================
  async removeFirewallRules() {
    if (this.platform !== 'win32') return;
    try {
      await execAsync(`netsh advfirewall firewall delete rule name="${this.RULE_NAME}"`);
    } catch {
      // Ignora se não existe
    }
  }

  // ============================================================
  // PARAR
  // ============================================================
  async stop() {
    console.log('[Firewall] ⏹️ Removendo regras...');
    await this.removeFirewallRules();
    this.active = false;
    console.log('[Firewall] ✅ Regras removidas');
  }

  // ============================================================
  // GETTERS
  // ============================================================
  isActive() {
    return this.active;
  }
}

module.exports = VPNManager;
