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
- Botão "Reportar problema" passa a capturar snapshot HTML sanitizado, screenshot
  da viewport (PNG base64, 5s timeout) e logs/erros do console expostos em
  `window.__errorBuffer` (#1560). Payload enviado ao backend inclui
  `htmlSnapshot`, `screenshot`, `consoleLogs` e `consoleErrors`; rotas sensíveis
  (`/login`, `/logout`, `/auth/*`, `/password*`, `/register`) são bloqueadas via
  deny-list e `input[type=password]`/`hidden[token|apikey|secret]` são
  sanitizados. Dependência nova: `html2canvas-pro`.

### Alterado
- Dev server do backend passa a usar `tsx` no lugar de `ts-node` (#35).
- `buildIssueBody` foi extraído de `githubRoutes.ts` para `utils/issueBodyBuilder.ts`
  e ganhou defesa contra injeção de markdown (backticks/fences adaptativos) (#1560).

### Removido
- `dump/` deixa de ser versionado (#32).
- Credenciais hardcoded e stores com segredo deixam de ser versionados (#364).

### Notas
- A issue #1560 citava `src/components/ReportProblemButton.tsx` como arquivo
  novo; a feature foi estendida em `src/components/ReportButton.tsx` (já
  existente, FAB "Reportar problema"), evitando duplicação. O nome do
  componente permanece `ReportButton` por consistência com o resto do app.

## [1.0.0] - 2026-04
- Primeira versão consolidada: ERP/CRM CoolGroove com integração Dolibarr e WhatsApp.
