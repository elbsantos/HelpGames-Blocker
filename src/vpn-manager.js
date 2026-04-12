const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execAsync = promisify(exec);

const RULE_NAME = 'HelpGames-Blocker';

class VPNManager {
  constructor() {
    this.blockedSites = new Set();
    this.active = false;
    this.platform = os.platform();
  }

  // INICIALIZAR - limpa regras antigas no arranque
  async initialize() {
    console.log('[Firewall] Inicializando - a limpar regras antigas...');
    await this.removeFirewallRules();
    this.active = false;
    console.log('[Firewall] Pronto (regras limpas)');
  }

  // ACTIVAR com lista de sites
  async setBlockedSites(sites) {
    this.blockedSites.clear();
    sites.forEach(s => this.blockedSites.add(s.toLowerCase()));

    if (this.platform === 'win32') {
      await this.applyWindowsFirewall();
    }

    this.active = true;
    console.log('[Firewall] Regras aplicadas para', this.blockedSites.size, 'sites');
  }

  // WINDOWS FIREWALL
  async applyWindowsFirewall() {
    try {
      await this.removeFirewallRules();

      const dns = require('dns').promises;
      const ips = new Set();

      const topSites = [...this.blockedSites].slice(0, 50);
      const results = await Promise.allSettled(
        topSites.map(site => dns.resolve4(site).catch(() => []))
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          for (const ip of r.value) ips.add(ip);
        }
      }

      if (ips.size === 0) {
        console.log('[Firewall] ⚠️ Nenhum IP resolvido, pulando firewall');
        return;
      }

      console.log('[Firewall] Criando regra com', ips.size, 'IPs...');
      const ipList = [...ips].join(',');
      await execAsync(
        'netsh advfirewall firewall add rule' +
        ' name="' + RULE_NAME + '"' +
        ' dir=out action=block' +
        ' remoteip=' + ipList +
        ' enable=yes profile=any'
      );

      console.log('[Firewall] ✅ Regra criada com sucesso!', ips.size, 'IPs bloqueados');
    } catch (error) {
      console.error('[Firewall] ❌ ERRO ao criar regra:', error.message);
      console.error('[Firewall] App precisa rodar como Administrador!');
    }
  }

  // REMOVER REGRAS
  async removeFirewallRules() {
    if (this.platform !== 'win32') return;
    try {
      await execAsync('netsh advfirewall firewall delete rule name="' + RULE_NAME + '"');
      console.log('[Firewall] Regras removidas');
    } catch (e) {
      // Ignora se não existe
    }
  }

  // PARAR - limpa tudo
  async stop() {
    console.log('[Firewall] A parar...');
    await this.removeFirewallRules();
    this.active = false;
    this.blockedSites.clear();
    console.log('[Firewall] Parado');
  }

  isActive() {
    return this.active;
  }
}

module.exports = VPNManager;
