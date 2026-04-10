const axios = require('axios');

// ============================================================
// API CLIENT - Comunicação com Railway (helpgames.pt)
// usa tRPC sobre HTTP + cookie de sessão
// ============================================================

const API_BASE_URL = process.env.API_URL || 'https://helpgames.pt/api/trpc';

// Axios instance com cookie jar
const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Guarda o cookie de sessão entre requests
let sessionCookie = null;

function setSessionCookie(cookieHeader) {
  if (!cookieHeader) return;
  const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
  for (const c of cookies) {
    if (c.includes('helpgames_session') || c.includes('session')) {
      sessionCookie = c.split(';')[0]; // ex: "helpgames_session=abc123"
    }
  }
}

function getAuthHeaders() {
  if (!sessionCookie) return {};
  return { Cookie: sessionCookie };
}

// ============================================================
// tRPC helper - query (GET)
// ============================================================
async function trpcQuery(procedure, input) {
  const params = input !== undefined
    ? { input: JSON.stringify(input) }
    : {};

  const response = await http.get(`/${procedure}`, {
    params,
    headers: getAuthHeaders(),
  });

  if (response.headers['set-cookie']) {
    setSessionCookie(response.headers['set-cookie']);
  }

  const data = response.data;
  if (data?.error) {
    throw new Error(data.error.message || 'Erro na API');
  }
  return data?.result?.data ?? data;
}

// ============================================================
// tRPC helper - mutation (POST)
// ============================================================
async function trpcMutate(procedure, input) {
  const response = await http.post(`/${procedure}`, input, {
    headers: getAuthHeaders(),
  });

  if (response.headers['set-cookie']) {
    setSessionCookie(response.headers['set-cookie']);
  }

  const data = response.data;
  if (data?.error) {
    throw new Error(data.error.message || 'Erro na API');
  }
  return data?.result?.data ?? data;
}

class API {
  // ============================================================
  // LOGIN - usa auth.login (tRPC mutation)
  // ============================================================
  static async login(email, password) {
    try {
      // Reset cookie before login
      sessionCookie = null;

      const result = await trpcMutate('auth.login', { email, password });

      // result.success === true, result.user = { id, email, name, plan }
      if (!result?.success) {
        throw new Error('Login falhou');
      }

      return {
        success: true,
        user: result.user,
      };
    } catch (error) {
      const msg = error?.response?.data?.error?.message
        || error?.message
        || 'Email ou senha incorretos';
      throw new Error(msg);
    }
  }

  // ============================================================
  // VERIFICAR SESSÃO ACTUAL - auth.me
  // ============================================================
  static async getMe() {
    try {
      const user = await trpcQuery('auth.me');
      return user;
    } catch {
      return null;
    }
  }

  // ============================================================
  // LOGOUT
  // ============================================================
  static async logout() {
    try {
      await trpcMutate('auth.logout', {});
    } catch {
      // ignora erros de logout
    } finally {
      sessionCookie = null;
    }
  }

  // ============================================================
  // SINCRONIZAR com servidor - blockerSync.sync
  // ============================================================
  static async sync() {
    try {
      const result = await trpcQuery('blockerSync.sync');
      return result || { success: true, sitesUpdated: false };
    } catch (error) {
      console.error('[API] ❌ Erro ao sincronizar:', error.message);
      return { success: false, sitesUpdated: false };
    }
  }

  // ============================================================
  // BUSCAR LISTA DE SITES BLOQUEADOS - blockerSites.list
  // ============================================================
  static async getBlockedSites() {
    try {
      const result = await trpcQuery('blockerSites.list');
      if (result?.sites && result.sites.length > 0) {
        console.log('[API] ✅ Sites recebidos do servidor:', result.sites.length);
        return result.sites;
      }
      // fallback local
      return await this.getLocalBlockedSites();
    } catch (error) {
      console.error('[API] ❌ Erro ao buscar sites, usando lista local:', error.message);
      return await this.getLocalBlockedSites();
    }
  }

  // ============================================================
  // Lista local de sites (fallback)
  // ============================================================
  static async getLocalBlockedSites() {
    const fs = require('fs').promises;
    const path = require('path');

    try {
      const filePath = path.join(__dirname, 'blocked-sites.json');
      const data = await fs.readFile(filePath, 'utf-8');
      const sites = JSON.parse(data);
      console.log('[API] 📋 Lista local carregada:', sites.length, 'sites');
      return sites;
    } catch {
      console.log('[API] ⚠️ Ficheiro local não encontrado, usando lista mínima');
      return [
        'bet365.com', 'bet365.pt', 'betano.com', 'betano.pt', 'betano.com.br',
        'pixbet.com', '1xbet.com', '22bet.com', 'betfair.com', 'betfair.pt',
        'sportingbet.com', 'bwin.com', 'bwin.pt', 'betway.com', '888sport.com',
        'pokerstars.com', 'stake.com', 'roobet.com', 'betclic.pt', 'solverde.pt',
        'blaze.com', 'galera.bet', 'vaidebet.com', 'estrela.bet',
      ];
    }
  }

  // ============================================================
  // ENVIAR TENTATIVAS BLOQUEADAS - blockerAttempts.create
  // ============================================================
  static async sendBlockedAttempts(attempts) {
    if (!attempts || attempts.length === 0) return;

    try {
      const result = await trpcMutate('blockerAttempts.create', { attempts });
      console.log('[API] ✅ Tentativas enviadas:', result?.saved || attempts.length);
      return result;
    } catch (error) {
      console.error('[API] ❌ Erro ao enviar tentativas:', error.message);
    }
  }

  // ============================================================
  // ESTATÍSTICAS DE BLOQUEIOS - blockerAttempts.stats
  // ============================================================
  static async getStats() {
    try {
      return await trpcQuery('blockerAttempts.stats');
    } catch {
      return { blockedToday: 0, blockedTotal: 0 };
    }
  }

  // ============================================================
  // VERIFICAR SE SESSÃO É VÁLIDA
  // ============================================================
  static hasSession() {
    return sessionCookie !== null;
  }

  // ============================================================
  // RESTAURAR SESSÃO a partir de cookie guardado
  // ============================================================
  static restoreSession(cookie) {
    if (cookie) {
      sessionCookie = cookie;
    }
  }

  // ============================================================
  // OBTER COOKIE ACTUAL (para persistir no electron-store)
  // ============================================================
  static getSessionCookie() {
    return sessionCookie;
  }
}

module.exports = API;
