# HelpGames Blocker v1.1.0

App desktop Electron que bloqueia sites de apostas via **ficheiro hosts** + **Windows Firewall**.

---

## ⚡ Instalação rápida

```bash
cd HelpGames-Blocker
npm install
npm run dev       # testar em desenvolvimento
npm run build:win # gerar instalador .exe
```

---

## 🔧 Como funciona

### Camada 1 – Ficheiro Hosts (principal)
Adiciona entradas `0.0.0.0 dominio.com` no ficheiro hosts do sistema:
- Windows: `C:\Windows\System32\drivers\etc\hosts`
- Mac/Linux: `/etc/hosts`

Quando o utilizador tenta aceder a `bet365.com`, o sistema operativo
resolve o domínio para `0.0.0.0` antes de fazer qualquer pedido de rede.
O browser mostra "Esta página não está disponível".

### Camada 2 – Windows Firewall (complementar)
Resolve os IPs dos principais domínios e adiciona regras de bloqueio
outbound no Windows Firewall (`netsh advfirewall`).

---

## ⚠️ Permissões necessárias

O app **precisa de ser executado como Administrador** para:
1. Editar o ficheiro `hosts` (protegido pelo sistema)
2. Criar regras no Windows Firewall

O `package.json` já inclui `"requestedExecutionLevel": "requireAdministrator"`
no electron-builder, por isso o instalador vai pedir elevação automaticamente.

---

## 🌐 Ligação à API (helpgames.pt)

O app liga-se a `https://helpgames.pt/api/trpc` usando:
- **tRPC** com cookie de sessão (igual ao website)
- Login via `auth.login` mutation
- Lista de sites via `blockerSites.list` (pública)
- Sync via `blockerSync.sync` (autenticada)
- Registo de tentativas via `blockerAttempts.create`

A sessão é persistida localmente em `electron-store` e restaurada
automaticamente no próximo arranque.

---

## 📁 Estrutura

```
src/
  main.js          – Processo principal Electron
  api.js           – Cliente tRPC para Railway
  dns-blocker.js   – Bloqueio via ficheiro hosts
  vpn-manager.js   – Bloqueio via Windows Firewall
  preload.js       – Bridge IPC seguro
  blocked-sites.json – Lista local de 5.632 sites (fallback)
  renderer/
    index.html     – Interface do utilizador
    renderer.js    – Lógica da UI
```

---

## 🐛 Resolução de problemas

**"Não consegue editar o hosts"**
→ Certifica-te de que o app corre como Administrador (clica com botão direito → Executar como administrador)

**"Login falhou"**
→ Usa as mesmas credenciais do website helpgames.pt

**"Sites continuam acessíveis"**
→ Limpa a cache DNS: `ipconfig /flushdns` (Windows) ou `sudo dscacheutil -flushcache` (Mac)
→ Verifica se o browser não tem VPN/extensão própria que ignore o hosts

**"App não sincroniza"**
→ Verifica a ligação à internet
→ O bloqueio local funciona mesmo sem ligação (usa lista offline de 5.632 sites)
