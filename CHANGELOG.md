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
- Rate limit dedicado de login (`rateLimiters.login`, 5 tentativas / 15min,
  chaveado por `IP+email`) substitui o limite permissivo anterior (#1541).
- Persistência de runtime config em `config/runtime.json` (sugestão da issue
  #1541) — NUNCA `.env`. Defesa em profundidade: `assertSafeConfigPath()`
  bloqueia nome de arquivo `.env` E `setConfig()` rejeita chaves contendo
  `.env` (#1541).

### Alterado (BREAKING)
- `POST /api/login` deixa de retornar `apiKey` no JSON e passa a emiti-lo em
  cookie `httpOnly, secure, sameSite=Strict, path=/` com `maxAge` configurável
  via `AUTH_COOKIE_MAX_AGE_MS` (#1541). **Migration**: clients que liam
  `body.apiKey` devem ler `document.cookie` (automatizado via
  `credentials: 'include'` no `fetch`) e usar a chave em `Authorization:
  Bearer <token>` ou header `DOLAPIKEY`. O middleware `requireDolibarrLogin`
  já aceita o cookie `apiKey` automaticamente.
- Schema do body de `/api/login` restrito a `email+senha` (Zod) — remove a
  alternativa `login` (username) que ampliava superfície de enumeração (#1541).

### Alterado
- Dev server do backend passa a usar `tsx` no lugar de `ts-node` (#35).
- `buildIssueBody` foi extraído de `githubRoutes.ts` para `utils/issueBodyBuilder.ts`
  e ganhou defesa contra injeção de markdown (backticks/fences adaptativos) (#1560).
- `adminRoutes.POST /config/llm`: agora propaga mudanças de provider/model apenas
  via `configService.setConfig()` (fonte de verdade única); a mutação direta
  de `config.llmProvider`/`config.localLlmUrl`/etc. foi removida (#1541).

### Removido
- `dump/` deixa de ser versionado (#32).
- Credenciais hardcoded e stores com segredo deixam de ser versionados (#364).

### Notas
- A issue #1560 citava `src/components/ReportProblemButton.tsx` como arquivo
  novo; a feature foi estendida em `src/components/ReportButton.tsx` (já
  existente, FAB "Reportar problema"), evitando duplicação. O nome do
  componente permanece `ReportButton` por consistência com o resto do app.
- Issue #1541 (adminRoutes + authRoutes): validação `validateBody(ZodSchema)`
  aplicada em todos os endpoints POST/PUT (`/restart`, `/config/llm/*`,
  `/integration/test`, `/config/features/provider`,
  `/users/:userId/permissions`, `/users/:userId/enable-app-access`,
  `/login`, `/admin-login`). `require()` dinâmicos removidos dos imports
  estáticos (`axios`, `@google/genai`). Playground ganha blacklist de
  padrões perigosos + cap 4000 chars + rejeição de caracteres de controle.

## [1.0.0] - 2026-04
- Primeira versão consolidada: ERP/CRM CoolGroove com integração Dolibarr e WhatsApp.
