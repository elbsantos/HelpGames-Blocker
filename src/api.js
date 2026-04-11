const axios = require('axios');

// ============================================================
// API CLIENT - Comunicação com Railway via tRPC batch
// ============================================================

const API_BASE_URL = process.env.API_URL || 'https://helpgames-production.up.railway.app/api/trpc';

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let sessionCookie = null;

function setSessionCookie(cookieHeader) {
  if (!cookieHeader) return;
  const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
  for (const c of cookies) {
    if (c.includes('session') || c.includes('helpgames')) {
      sessionCookie = c.split(';')[0];
    }
  }
}

function getAuthHeaders() {
  if (!sessionCookie) return {};
  return { Cookie: sessionCookie };
}

// tRPC query (GET) - formato batch
async function trpcQuery(procedure, input) {
  const inputObj = { '0': { json: input !== undefined ? input : null } };

  const response = await http.get('/' + procedure, {
    params: {
      batch: '1',
      input: JSON.stringify(inputObj),
    },
    headers: getAuthHeaders(),
  });

  if (response.headers['set-cookie']) {
    setSessionCookie(response.headers['set-cookie']);
  }

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

  if (data && data.error) {
    throw new Error(data.error.message || 'Erro na API');
  }

  return data;
}

// tRPC mutation (POST) - formato batch
async function trpcMutate(procedure, input) {
  const body = { '0': { json: input } };

  const response = await http.post('/' + procedure, body, {
    params: { batch: '1' },
    headers: getAuthHeaders(),
  });

  if (response.headers['set-cookie']) {
    setSessionCookie(response.headers['set-cookie']);
  }

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

  if (data && data.error) {
    throw new Error(data.error.message || 'Erro na API');
  }

  return data;
}

class API {

  static async login(email, password) {
    try {
      sessionCookie = null;
      const result = await trpcMutate('auth.login', { email: email, password: password });

      if (!result || !result.success) {
        throw new Error('Login falhou');
      }

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

  static async getMe() {
    try {
      return await trpcQuery('auth.me');
    } catch (e) {
      return null;
    }
  }

  static async logout() {
    try {
      await trpcMutate('auth.logout', {});
    } catch (e) {
      // ignora
    } finally {
      sessionCookie = null;
    }
  }

  static async sync() {
    try {
      const result = await trpcQuery('blockerSync.sync');
      return result || { success: true, sitesUpdated: false };
    } catch (error) {
      console.error('[API] Erro ao sincronizar:', error.message);
      return { success: false, sitesUpdated: false };
    }
  }

  static async getBlockedSites() {
    try {
      const result = await trpcQuery('blockerSites.list');
      if (result && result.sites && result.sites.length > 0) {
        console.log('[API] Sites recebidos do servidor:', result.sites.length);
        return result.sites;
      }
      return await this.getLocalBlockedSites();
    } catch (error) {
      console.error('[API] Erro ao buscar sites, usando lista local:', error.message);
      return await this.getLocalBlockedSites();
    }
  }

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

  static async sendBlockedAttempts(attempts) {
    if (!attempts || attempts.length === 0) return;
    try {
      const result = await trpcMutate('blockerAttempts.create', { attempts: attempts });
      console.log('[API] Tentativas enviadas:', attempts.length);
      return result;
    } catch (error) {
      console.error('[API] Erro ao enviar tentativas:', error.message);
    }
  }

  static async getStats() {
    try {
      return await trpcQuery('blockerAttempts.stats');
    } catch (e) {
      return { blockedToday: 0, blockedTotal: 0 };
    }
  }

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
