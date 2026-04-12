# 🛡️ HelpGames Blocker

**App desktop para bloqueio local de sites de apostas**

Aplicação Electron que bloqueia 5.632+ sites de apostas através de modificação do arquivo `hosts` e regras de Firewall do Windows. Integrado com a plataforma [HelpGames](https://github.com/elbsantos/HelpGames).

[![Version](https://img.shields.io/github/v/release/elbsantos/HelpGames-Blocker)](https://github.com/elbsantos/HelpGames-Blocker/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)](https://github.com/elbsantos/HelpGames-Blocker/releases)
[![License](https://img.shields.io/github/license/elbsantos/HelpGames-Blocker)](LICENSE)

---

## 📥 Download

**[⬇️ Baixar Instalador (Windows)](https://github.com/elbsantos/HelpGames-Blocker/releases/latest)**

Versão atual: **v1.2.0** | Requer: **Windows 10+** | Permissões: **Administrador**

---

## ✨ Funcionalidades

### 🔒 Bloqueio em Duas Camadas

**Camada 1: Arquivo Hosts (Principal)**
- Modifica `C:\Windows\System32\drivers\etc\hosts`
- Redireciona domínios bloqueados para `127.0.0.1`
- Bloqueio instantâneo ao nível do sistema operativo
- Funciona em todos os browsers e aplicações

**Camada 2: Windows Firewall (Complementar)**
- Cria regras de bloqueio outbound
- Resolve IPs dos top 50 sites de apostas
- Bloqueia conexões mesmo se DNS for alterado
- Proteção adicional contra proxies/VPNs

### 🔄 Sincronização com HelpGames

- **Login integrado** com conta HelpGames
- **Polling automático** a cada 30 segundos
- **Bloqueio temporário** ativado pelo dashboard web (30min/1h/2h)
- **Estatísticas em tempo real** de tentativas bloqueadas
- **Sincronização bidirecional** de status

### 🎯 Recursos Adicionais

- **Tray icon** com status visual e menu rápido
- **Notificações desktop** de ativação/expiração de bloqueio
- **Página de bloqueio customizada** exibida ao tentar acessar sites
- **Auto-start** com Windows (opcional)
- **Logs detalhados** para debug
- **Modo offline** com lista local de 5.632 sites

---

## 🚀 Como Funciona

```
┌─────────────────────────────────────────────────┐
│  1. Usuário ativa bloqueio no Dashboard Web    │
│     (30 minutos / 1 hora / 2 horas)             │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  2. App Desktop detecta via polling (30s)       │
│     GET /api/trpc/betsBlockage.getStatus        │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  3. App ativa bloqueio local:                   │
│     • DNS Blocker → Modifica arquivo hosts      │
│     • VPN Manager → Cria regras de firewall     │
│     • Blocked Server → Inicia servidor HTTP:80  │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  4. Usuário tenta acessar bet365.com            │
│     • Sistema resolve para 127.0.0.1            │
│     • Exibe página customizada de bloqueio      │
│     • App reporta tentativa ao backend          │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  5. Dashboard mostra estatísticas em tempo real │
│     POST /api/trpc/blockerAttempts.create       │
└─────────────────────────────────────────────────┘
```

---

## 🛠️ Instalação

### Para Usuários Finais

1. **Download do instalador:** [Releases](https://github.com/elbsantos/HelpGames-Blocker/releases/latest)
2. **Execute como Administrador** (botão direito → Executar como Administrador)
3. **Siga o assistente de instalação**
4. **Faça login** com sua conta HelpGames
5. **Ative o bloqueio** pelo dashboard web: https://helpgames-production.up.railway.app

### Para Desenvolvedores

```bash
# Clonar repositório
git clone https://github.com/elbsantos/HelpGames-Blocker.git
cd HelpGames-Blocker

# Instalar dependências
npm install

# Modo desenvolvimento
npm run dev

# Gerar build de produção
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
```

---

## 📁 Estrutura do Projeto

```
HelpGames-Blocker/
├── src/
│   ├── main.js                 # Processo principal Electron
│   ├── api.js                  # Cliente tRPC para Railway API
│   ├── dns-blocker.js          # Bloqueio via arquivo hosts
│   ├── vpn-manager.js          # Bloqueio via Windows Firewall
│   ├── blocked-page-server.js  # Servidor HTTP local (porta 80)
│   ├── preload.js              # Bridge IPC seguro
│   ├── blocked-sites.json      # Lista offline (5,632 sites)
│   └── renderer/
│       ├── index.html          # UI de login
│       └── renderer.js         # Lógica da interface
├── assets/
│   ├── icon.png               # Ícone da aplicação (256x256)
│   ├── icon.ico               # Ícone Windows
│   └── blocked.html           # Página exibida ao bloquear
├── package.json
├── CHANGELOG.md
└── README.md
```

---

## 🔌 API Endpoints Utilizados

O app comunica com a API HelpGames através de tRPC:

### Autenticação
```typescript
auth.login({ email, password })
// Retorna: { success, user, sessionCookie }
```

### Lista de Sites Bloqueados
```typescript
blockList.getDomains()
// Retorna: { domains: string[], total: number, source: 'database' | 'fallback' }
```

### Status do Bloqueio
```typescript
betsBlockage.getStatus()
// Retorna: { isBlocked: boolean, remainingSeconds: number, remainingMinutes: number }
```

### Reportar Tentativas Bloqueadas
```typescript
blockerAttempts.create({
  attempts: [{ domain: string, timestamp: number, blocked: boolean }]
})
// Retorna: { success: boolean, saved: number }
```

---

## ⚙️ Configuração

### Variáveis de Ambiente

Não há `.env` - a configuração é feita via código:

```javascript
// src/api.js
const API_URL = 'https://helpgames-production.up.railway.app/api/trpc';
```

### Armazenamento Local

O app usa `electron-store` para persistir:

```javascript
{
  user: { id, email, name, plan },
  sessionCookie: 'connect.sid=...',
  autoStart: boolean
}
```

Local: `%APPDATA%\helpgames-blocker\config.json`

---

## 🔐 Segurança e Permissões

### Por que precisa de Administrador?

1. **Modificar arquivo hosts** (`C:\Windows\System32\drivers\etc\hosts`)
   - Protegido pelo Windows para evitar malware
   - Necessário para bloqueio ao nível do sistema

2. **Criar regras de Firewall** (`netsh advfirewall`)
   - Requer permissões elevadas
   - Bloqueia IPs específicos

### Segurança da Aplicação

- ✅ **Content Security Policy (CSP)** implementado
- ✅ **Context Isolation** ativado
- ✅ **Node Integration** desativado no renderer
- ✅ **Cookies httpOnly** para sessões
- ✅ **Sem eval()** ou código dinâmico
- ✅ **Validação de inputs** via Zod no backend

---

## 🐛 Resolução de Problemas

### Bloqueio não funciona

**Sintomas:** Sites de apostas continuam acessíveis após ativar bloqueio

**Soluções:**
1. **Verificar permissões:**
   - App está rodando como Administrador?
   - Clique direito no atalho → "Executar como Administrador"

2. **Limpar cache DNS:**
   ```cmd
   ipconfig /flushdns
   ```

3. **Verificar arquivo hosts:**
   - Abrir: `C:\Windows\System32\drivers\etc\hosts`
   - Procurar por `# BEGIN HELPGAMES BLOCKER`
   - Deve conter linhas como `127.0.0.1 bet365.com`

4. **Verificar firewall:**
   ```cmd
   netsh advfirewall firewall show rule name="HelpGames Blocker"
   ```

5. **Ver logs:**
   - Abrir DevTools: `Ctrl + Shift + I` no app
   - Verificar console por erros

### Janela de login não fecha

**Sintoma:** Após login bem-sucedido, janela permanece aberta

**Solução:** Atualizar para v1.2.0+ (fix incluído)

### Notificação "Bloqueio Expirou" sem motivo

**Sintoma:** Logo após login, aparece notificação de expiração

**Solução:** Atualizar para v1.2.0+ (fix incluído)

### Erro ao instalar

**Sintoma:** Instalador falha ou não executa

**Soluções:**
- Desabilitar antivírus temporariamente
- Baixar novamente (arquivo pode estar corrompido)
- Verificar se tem .NET Framework instalado

---

## 📊 Logs e Debug

### Ver logs em tempo real

```cmd
# Abrir DevTools no app
Ctrl + Shift + I

# Ou via linha de comando
"C:\Program Files\HelpGames Blocker\HelpGames Blocker.exe" --enable-logging
```

### Prefixos de log

```
[DNS]      - DNS Blocker (arquivo hosts)
[Firewall] - VPN Manager (regras de firewall)
[API]      - Comunicação com backend
[HelpGames] - Lógica principal do app
```

---

## 🗺️ Roadmap

### v1.2.0 ✅ (Atual)
- [x] Integração completa com backend
- [x] Reportar tentativas bloqueadas
- [x] Logs detalhados
- [x] Fix bugs de login e notificações

### v1.3.0 (Próximo)
- [ ] Suporte para macOS
- [ ] Interface gráfica para configurações
- [ ] Whitelist customizada
- [ ] Estatísticas offline

### v2.0.0 (Futuro)
- [ ] Suporte para Linux
- [ ] Bloqueio de VPNs conhecidas
- [ ] Análise de tráfego em tempo real
- [ ] Auto-update integrado

---

## 🤝 Contribuir

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -m 'feat: adicionar X'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

---

## 📄 Licença

MIT License - Consulte o arquivo [LICENSE](LICENSE) para detalhes.

---

## 🔗 Links Relacionados

- **Plataforma Web:** [HelpGames](https://github.com/elbsantos/HelpGames)
- **Dashboard:** [helpgames-production.up.railway.app](https://helpgames-production.up.railway.app)
- **Issues:** [GitHub Issues](https://github.com/elbsantos/HelpGames-Blocker/issues)
- **Releases:** [GitHub Releases](https://github.com/elbsantos/HelpGames-Blocker/releases)

---

## 👨‍💻 Autor

**Emerson Santos** - [@elbsantos](https://github.com/elbsantos)

---

## 🆘 Suporte

Encontrou um bug? Tem uma sugestão?

- **Abra uma issue:** [GitHub Issues](https://github.com/elbsantos/HelpGames-Blocker/issues)
- **Consulte o FAQ:** [Wiki](https://github.com/elbsantos/HelpGames-Blocker/wiki)

---

**Desenvolvido com ❤️ para ajudar pessoas a recuperar o controlo das suas vidas.**
