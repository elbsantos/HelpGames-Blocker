const http = require('http');
const url  = require('url');

// ============================================================
// SERVIDOR HTTP LOCAL - Serve a página de bloqueio
// Corre em 127.0.0.1:80 (e :443 redirect)
// ============================================================

let server = null;

const PAGE_HTML = `<!DOCTYPE html>
<html lang="pt-PT">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* https://helpgames.pt https://helpgames-production.up.railway.app;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Site Bloqueado – HelpGames</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e1a3a 100%);
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      max-width: 480px;
      width: 90%;
      background: rgba(30,41,59,0.9);
      border: 1px solid rgba(148,163,184,0.15);
      border-radius: 20px;
      padding: 48px 40px;
      text-align: center;
      box-shadow: 0 25px 60px rgba(0,0,0,0.5);
    }
    .shield {
      font-size: 72px;
      margin-bottom: 20px;
      display: block;
      filter: drop-shadow(0 0 20px rgba(59,130,246,0.5));
    }
    .badge {
      display: inline-block;
      background: rgba(239,68,68,0.2);
      border: 1px solid rgba(239,68,68,0.4);
      color: #fca5a5;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      padding: 4px 14px;
      border-radius: 20px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 26px;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 10px;
    }
    .domain {
      font-size: 16px;
      color: #ef4444;
      font-weight: 600;
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.2);
      border-radius: 8px;
      padding: 8px 16px;
      margin: 14px 0 20px;
      display: inline-block;
      word-break: break-all;
    }
    p {
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.7;
      margin-bottom: 28px;
    }
    .timer-box {
      background: rgba(59,130,246,0.1);
      border: 1px solid rgba(59,130,246,0.2);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 28px;
    }
    .timer-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .timer-value { font-size: 28px; font-weight: 700; color: #60a5fa; font-variant-numeric: tabular-nums; }
    .btn {
      display: inline-block;
      padding: 12px 28px;
      background: linear-gradient(135deg,#3b82f6,#8b5cf6);
      border: none;
      border-radius: 10px;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.85; }
    .footer {
      margin-top: 28px;
      font-size: 11px;
      color: #475569;
    }
    .footer a { color: #3b82f6; text-decoration: none; }
  </style>
</head>
<body>
<div class="card">
  <span class="shield">🛡️</span>
  <div class="badge">Bloqueado pelo HelpGames</div>
  <h1>Acesso Bloqueado</h1>
  <div class="domain" id="domainName">site de apostas</div>
  <p>
    Activaste um período de protecção contra apostas.<br>
    Este site está temporariamente bloqueado para te ajudar a manter o controlo.
  </p>
  <div class="timer-box">
    <div class="timer-label">Tempo restante</div>
    <div class="timer-value" id="timer">--:--</div>
  </div>
  <a href="DASHBOARD_URL" class="btn">
    Ver Dashboard HelpGames
  </a>
  <div class="footer">
    Bloqueio activado por ti em <a href="DASHBOARD_URL">helpgames.pt</a>
  </div>
</div>
<script>
  // Mostrar domínio que tentou aceder
  const params = new URLSearchParams(window.location.search);
  const domain = params.get('site') || document.referrer || window.location.hostname;
  if (domain && domain !== '127.0.0.1' && domain !== 'localhost') {
    document.getElementById('domainName').textContent = domain;
  }

  // Countdown (atualiza a cada segundo, busca tempo do servidor local)
  async function updateTimer() {
    try {
      const r = await fetch('http://127.0.0.1:52731/remaining');
      const d = await r.json();
      const secs = d.remainingSeconds || 0;
      if (secs <= 0) {
        document.getElementById('timer').textContent = 'Expirado';
        return;
      }
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      document.getElementById('timer').textContent =
        String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    } catch {
      document.getElementById('timer').textContent = '--:--';
    }
  }

  updateTimer();
  setInterval(updateTimer, 1000);
</script>
</body>
</html>`;

// Endpoint de estado (chamado pelo countdown da página)
let remainingSecondsGetter = () => 0;

function setRemainingSecondsGetter(fn) {
  remainingSecondsGetter = fn;
}

function startBlockedPageServer() {
  if (server) return;

  server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);

    // Endpoint JSON para o timer
    if (parsed.pathname === '/remaining') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(JSON.stringify({ remainingSeconds: remainingSecondsGetter() }));
      return;
    }

    // Página de bloqueio para qualquer outro pedido
    const site = parsed.query.site || req.headers.host || '';
    const html = PAGE_HTML.replace(/DASHBOARD_URL/g, 'https://helpgames-production.up.railway.app');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(html);
  });

  server.on('error', (err) => {
    if (err.code === 'EACCES') {
      console.error('[BlockedPage] Porta 80 requer admin. Usar porta 8080.');
      startOnPort(8080);
    } else if (err.code === 'EADDRINUSE') {
      console.warn('[BlockedPage] Porta ja em uso, a tentar 8080...');
      startOnPort(8080);
    } else {
      console.error('[BlockedPage] Erro:', err.message);
    }
  });

  server.listen(80, '127.0.0.1', () => {
    console.log('[BlockedPage] Servidor na porta 80');
  });
}

function startOnPort(port) {
  server = http.createServer((req, res) => {
    const html = PAGE_HTML.replace(/DASHBOARD_URL/g, 'https://helpgames-production.up.railway.app');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('[BlockedPage] Servidor na porta', port);
  });
}

function stopBlockedPageServer() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = { startBlockedPageServer, stopBlockedPageServer, setRemainingSecondsGetter };
