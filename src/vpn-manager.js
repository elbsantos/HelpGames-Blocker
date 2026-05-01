const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execAsync = promisify(exec);

const RULE_NAME     = 'HelpGames-Blocker';
const RULE_NAME_DOH = 'HelpGames-Blocker-DoH';

// Servidores DoH/DoT conhecidos. Bloquear porta 443 (DoH) e 853 (DoT) para
// estes IPs impede que Chrome/Firefox/Edge bypassem o ficheiro hosts via
// DNS-over-HTTPS mesmo com a opção "Usar DNS seguro" activa no browser.
const DOH_SERVERS = [
  '1.1.1.1',           // Cloudflare
  '1.0.0.1',           // Cloudflare secundário
  '8.8.8.8',           // Google
  '8.8.4.4',           // Google secundário
  '9.9.9.9',           // Quad9
  '149.112.112.112',   // Quad9 secundário
  '208.67.222.222',    // OpenDNS
  '208.67.220.220',    // OpenDNS secundário
  '94.140.14.14',      // AdGuard DNS
  '94.140.15.15',      // AdGuard DNS secundário
];

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
      await this.applyDoHBlock();
    }

    this.active = true;
    console.log('[Firewall] Regras aplicadas para', this.blockedSites.size, 'sites');
  }

  // WINDOWS FIREWALL — bloqueia IPs dos sites de apostas
  async applyWindowsFirewall() {
    try {
      await this.removeGamblingRules();

      const dns = require('dns').promises;
      const ips = new Set();
      const BATCH = 100;
      const allSites = [...this.blockedSites];

      console.log('[Firewall] A resolver IPs de', allSites.length, 'domínios em lotes de', BATCH, '...');

      for (let i = 0; i < allSites.length; i += BATCH) {
        const batch = allSites.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(site => dns.resolve4(site).catch(() => []))
        );
        for (const r of results) {
          if (r.status === 'fulfilled') {
            for (const ip of r.value) ips.add(ip);
          }
        }
      }

      if (ips.size === 0) {
        console.log('[Firewall] ⚠️ Nenhum IP resolvido, pulando regra de IPs');
        return;
      }

      // netsh tem limite por comando — dividir em lotes de 200 IPs
      const ipArray = [...ips];
      const IP_BATCH = 200;
      for (let i = 0; i < ipArray.length; i += IP_BATCH) {
        const chunk = ipArray.slice(i, i + IP_BATCH).join(',');
        await execAsync(
          'netsh advfirewall firewall add rule' +
          ' name="' + RULE_NAME + '"' +
          ' dir=out action=block' +
          ' remoteip=' + chunk +
          ' enable=yes profile=any'
        );
      }

      console.log('[Firewall] ✅ Regra de IPs criada:', ips.size, 'IPs bloqueados');
    } catch (error) {
      console.error('[Firewall] ❌ ERRO ao criar regra de IPs:', error.message);
      console.error('[Firewall] App precisa rodar como Administrador!');
    }
  }

  // WINDOWS FIREWALL — bloqueia DoH/DoT para impedir bypass via browser
  async applyDoHBlock() {
    try {
      await this.removeDoHRules();

      const ipList = DOH_SERVERS.join(',');

      // Bloquear DoH (HTTPS, porta 443) para os servidores conhecidos
      await execAsync(
        'netsh advfirewall firewall add rule' +
        ' name="' + RULE_NAME_DOH + '"' +
        ' dir=out action=block' +
        ' remoteip=' + ipList +
        ' remoteport=443' +
        ' protocol=TCP' +
        ' enable=yes profile=any'
      );

      // Bloquear DoT (DNS-over-TLS, porta 853) para os mesmos servidores
      await execAsync(
        'netsh advfirewall firewall add rule' +
        ' name="' + RULE_NAME_DOH + '-DoT"' +
        ' dir=out action=block' +
        ' remoteip=' + ipList +
        ' remoteport=853' +
        ' protocol=TCP' +
        ' enable=yes profile=any'
      );

      console.log('[Firewall] ✅ Regra DoH/DoT criada —', DOH_SERVERS.length, 'servidores bloqueados nas portas 443 e 853');
    } catch (error) {
      console.error('[Firewall] ❌ ERRO ao criar regra DoH:', error.message);
    }
  }

  // REMOVER REGRAS — todas
  async removeFirewallRules() {
    await this.removeGamblingRules();
    await this.removeDoHRules();
  }

  async removeGamblingRules() {
    if (this.platform !== 'win32') return;
    try {
      await execAsync('netsh advfirewall firewall delete rule name="' + RULE_NAME + '"');
      console.log('[Firewall] Regras de IPs removidas');
    } catch (e) { /* ignora se não existe */ }
  }

  async removeDoHRules() {
    if (this.platform !== 'win32') return;
    try {
      await execAsync('netsh advfirewall firewall delete rule name="' + RULE_NAME_DOH + '"');
      await execAsync('netsh advfirewall firewall delete rule name="' + RULE_NAME_DOH + '-DoT"');
      console.log('[Firewall] Regras DoH/DoT removidas');
    } catch (e) { /* ignora se não existe */ }
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
