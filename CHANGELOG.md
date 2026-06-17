# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- `/health` passa a reportar o estado da sessão WhatsApp (#27).
- Monitoramento de erros no frontend via Sentry, *gated* por `VITE_SENTRY_DSN` (#27).
- Cap configurável de destinatários no broadcast do scheduler (#34).
- `resolveJsonModule` no `tsconfig` do backend (#35).

### Alterado
- Dev server do backend passa a usar `tsx` no lugar de `ts-node` (#35).

### Removido
- `dump/` deixa de ser versionado (#32).
- Credenciais hardcoded e stores com segredo deixam de ser versionados (#364).

## [1.0.0] - 2026-04
- Primeira versão consolidada: ERP/CRM CoolGroove com integração Dolibarr e WhatsApp.
