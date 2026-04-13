# Changelog - HelpGames Blocker

## [1.2.1] - 2026-04-13

### 🐛 Correções
- **Logs detalhados de debug**: Rastreamento completo do fluxo de sincronização
- **Opções de debug no tray**: "Atualizar Status Agora" e "Ver Logs de Debug"
- Melhor visibilidade do estado de bloqueio para diagnóstico

### 🔧 Melhorias
- Console mostra estado completo a cada verificação
- Menu do tray permite forçar verificação manual
- Facilita identificação de problemas de sincronização

---

## [1.2.0] - 2026-04-12

### ✨ Novidades
- **Integração completa com backend**: App agora reporta tentativas bloqueadas para o dashboard
- Estatísticas de bloqueio em tempo real no dashboard web
- Melhor sincronização entre app desktop e plataforma web

### 🔧 Melhorias
- Sistema de callback para detecção de bloqueios
- Logs aprimorados para debug
- Comunicação otimizada com API

### 🛡️ Segurança
- Content Security Policy (CSP) implementado
- Validação de sessão aprimorada

---

## [1.1.0] - 2026-04-11

### Recursos
- Bloqueio via arquivo hosts
- Firewall do Windows
- Página de bloqueio customizada
- Tray icon com status
- Auto-start no Windows

---

## [1.0.0] - 2026-04-10

### Release Inicial
- Primeira versão do HelpGames Blocker
- Bloqueio de 5,632 sites de apostas
- Login integrado com HelpGames
- Polling automático a cada 30 segundos
