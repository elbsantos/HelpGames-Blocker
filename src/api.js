const axios = require('axios');

const API_BASE_URL = process.env.API_URL || 'https://helpgames-production.up.railway.app/api/trpc';

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let sessionCookie = null;

function setSessionCookie(cookieHeader) {
  if (!cookieHeader) return;
  const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
  for (const c of cookies) {
    // O backend usa o cookie 'connect.sid'
    if (c.includes('connect.sid')) {
      sessionCookie = c.split(';')[0];
      console.log('[API] Cookie de sessao guardado:', sessionCookie.substring(0, 30) + '...');
    }
  }
}

function getAuthHeaders() {
  if (!sessionCookie) return {};
  return { Cookie: sessionCookie };
}

async function trpcQuery(procedure, input) {
  const inputObj = { '0': { json: input !== undefined ? input : null } };
  const response = await http.get('/' + procedure, {
    params: { batch: '1', input: JSON.stringify(inputObj) },
    headers: getAuthHeaders(),
  });
  if (response.headers['set-cookie']) setSessionCookie(response.headers['set-cookie']);
  const data = response.data;
  if (Array.isArray(data)) {
    const result = data[0];
    if (result && result.error) {
      const msg = (result.error.json && result.error.json.message) ? result.error.json.message : 'Erro na API';
      throw new Error(msg);
    }
    if (result && result.result && result.result.data) {
      return result.result.data.json !== undefined ? result.result.data.json : result.result.data;
    }
    return null;
  }
  if (data && data.error) throw new Error(data.error.message || 'Erro na API');
  return data;
}

async function trpcMutate(procedure, input) {
  const body = { '0': { json: input } };
  const response = await http.post('/' + procedure, body, {
    params: { batch: '1' },
    headers: getAuthHeaders(),
  });
  if (response.headers['set-cookie']) setSessionCookie(response.headers['set-cookie']);
  const data = response.data;
  if (Array.isArray(data)) {
    const result = data[0];
    if (result && result.error) {
      const msg = (result.error.json && result.error.json.message) ? result.error.json.message : 'Erro na API';
      throw new Error(msg);
    }
    if (result && result.result && result.result.data) {
      return result.result.data.json !== undefined ? result.result.data.json : result.result.data;
    }
    return null;
  }
  if (data && data.error) throw new Error(data.error.message || 'Erro na API');
  return data;
}

class API {

  // LOGIN
  static async login(email, password) {
    try {
      sessionCookie = null;
      const result = await trpcMutate('auth.login', { email: email, password: password });
      if (!result || !result.success) throw new Error('Login falhou');
      return { success: true, user: result.user };
    } catch (error) {
      let msg = 'Email ou senha incorrectos';
      if (error.response && error.response.data) {
        const d = error.response.data;
        if (Array.isArray(d) && d[0] && d[0].error && d[0].error.json) {
          msg = d[0].error.json.message || msg;
        }
      } else if (error.message) {
        msg = error.message;
      }
      throw new Error(msg);
    }
  }

  // VERIFICAR SESSAO
  static async getMe() {
    try {
      return await trpcQuery('auth.me');
    } catch (e) {
      return null;
    }
  }

  // LOGOUT
  static async logout() {
    try {
      await trpcMutate('auth.logout', {});
    } catch (e) {
      // ignora
    } finally {
      sessionCookie = null;
    }
  }

  // ESTADO DO BLOQUEIO
  static async getBlockageStatus() {
    try {
      const result = await trpcQuery('betsBlockage.getStatus');
      return result || { isBlocked: false, remainingMinutes: 0, remainingSeconds: 0 };
    } catch (error) {
      // 401 = sessão expirou — retornar null para main.js detectar
      if (error.response && error.response.status === 401) {
        console.log('[API] Sessao expirada (401)');
        sessionCookie = null;
        return null;
      }
      console.error('[API] Erro ao verificar bloqueio:', error.message);
      return { isBlocked: false, remainingMinutes: 0, remainingSeconds: 0 };
    }
  }

  // LISTA DE SITES BLOQUEADOS - usa blockList.getDomains (2500+ sites da BD)
  static async getBlockedSites() {
    try {
      const result = await trpcQuery('blockList.getDomains');
      if (result && result.domains && result.domains.length > 0) {
        console.log('[API] Dominios recebidos:', result.domains.length, '| Fonte:', result.source);
        return result.domains;
      }
      return await this.getLocalBlockedSites();
    } catch (error) {
      console.error('[API] Erro ao buscar dominios, usando lista local:', error.message);
      return await this.getLocalBlockedSites();
    }
  }

  // LISTA LOCAL (fallback offline)
  static async getLocalBlockedSites() {
    const fs = require('fs').promises;
    const path = require('path');
    try {
      const filePath = path.join(__dirname, 'blocked-sites.json');
      const data = await fs.readFile(filePath, 'utf-8');
      const sites = JSON.parse(data);
      console.log('[API] Lista local carregada:', sites.length, 'sites');
      return sites;
    } catch (e) {
      return [
        'bet365.com', 'bet365.pt', 'betano.com', 'betano.pt',
        'pixbet.com', '1xbet.com', '22bet.com', 'betfair.com',
        'sportingbet.com', 'bwin.com', 'betway.com', 'stake.com',
        'blaze.com', 'galera.bet', 'estrela.bet',
      ];
    }
  }

  // REGISTRAR TENTATIVA BLOQUEADA
  static async reportBlockedAttempt(domain) {
    try {
      await trpcMutate('blockerAttempts.create', {
        attempts: [{
          domain,
          timestamp: Date.now(),
          blocked: true
        }]
      });
      console.log('[API] Tentativa bloqueada registrada:', domain);
    } catch (error) {
      console.error('[API] Erro ao reportar tentativa:', error.message);
    }
  }

  // HELPERS DE SESSAO
  static hasSession() {
    return sessionCookie !== null;
  }

  static restoreSession(cookie) {
    if (cookie) sessionCookie = cookie;
  }

  static getSessionCookie() {
    return sessionCookie;
  }
}

module.exports = API;
