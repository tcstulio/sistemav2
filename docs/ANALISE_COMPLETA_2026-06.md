# Análise Técnica Completa — sistemav2 (Coolgroove)

> Data: 2026-06-13 · Método: análise multi-agente (8 dimensões em paralelo) com verificação adversarial de cada achado crítico/alto (revisor cético lendo o código antes de confirmar). Severidades abaixo são as **ajustadas pela verificação**.

## Escala
- ~175k LOC: **71k backend** (Express + TypeScript, 219 arquivos) + **103k frontend** (React 19 + Vite, 400 arquivos)
- Dados: Dolibarr ERP (REST) + stores JSON; **não** usa SQLite apesar da nota de projeto
- ~2.900 testes unitários (1.837 backend + 1.054 frontend)

## Placar de saúde por dimensão

| Dimensão | Score | Veredito |
|---|---|---|
| 🔒 Segurança | 38 | Crítico — segredos reais vazados no histórico git |
| 💾 Persistência de dados | 52 | JSON em vez do SQLite anunciado; sem backup |
| ✅ Testes / CI / Build | 52 | CI não bloqueia merge; 2 suítes estavam vermelhas |
| 🤖 TaskRunner autônomo | 62 | Forte isolamento, mas gates de merge furados |
| 🏗️ Arquitetura backend | 62 | Boa base, anti-padrões sistêmicos |
| 🧠 Agente IA & integrações | 62 | HITL sólido, mas limites "decorativos" |
| 📱 Módulos legados | 58 | Banking bom, scrapers quebrados |
| 🎨 Arquitetura frontend | 66 | Acima da média, componentes-monstro |

---

## 🚨 Achados críticos

1. **Três segredos de produção vazados no histórico git** (repo tornou-se público): chave mTLS do Banco Inter (`backend/certs/inter.key`), API key do Dolibarr (`.env`, também embutida no bundle por ser `VITE_`), clientSecret OAuth do Inter (`Dados Inter/Infos.txt`), e dump `dolibarr_local.db` (9,9 MB, PII real de ~941 clientes → LGPD). Estavam no `.gitignore` mas foram commitados **antes** do ignore.
2. **Gate de typecheck do auto-merge morto** (`taskRunnerService.ts`): `if (!verifyOk)` sobre objeto `{ok,output}` sempre-truthy → typecheck/build pós-rebase nunca bloqueava o merge na `main`.
3. **CI não bloqueava merge**: repo privado free (sem branch protection) + job frontend não rodava vitest (~1.054 testes fora do CI).
4. **`/api/ai/debug/execute-tool` sem autenticação**: executava ferramentas arbitrárias antes do `requireDolibarrLogin` global.

## 🟠 Altos
- Agente de chat mergeava na `main` sem piso de score (`mergeTask` incondicional) — explorável por prompt injection.
- Prompt injection no TaskRunner (corpo/comentários de issue entram crus no prompt do coder e do Judge).
- PAT do GitHub quase-admin (`delete_repo`/`admin:org`/`workflow`) herdado pelo processo do opencode sem sandbox.
- Caminho do bot WhatsApp bypassa permissões (`generateReply` sem `runWithToolContext`).
- Limites do agente decorativos (`maxInvoiceAmount`, `isCustomerRestricted`, `maxToolCallsPerConversation` definidos mas nunca aplicados).
- Race no worktree compartilhado (`tryAutoMerge`/`startPreview` fora da fila serial, sem mutex).
- 24 vulns npm (front) / 48 (back) — cluster axios atingindo código bancário/Dolibarr.
- Erro vaza mensagem crua (222 `res.status(500).json({error: error.message})`, 0 `next(error)`).
- God-objects (`taskRunnerService` 2101 linhas, `agentTools` switch de 70 cases).
- 9 testes desatualizados (7 backend do fallback #347, 2 frontend).

> **Rebaixados pela verificação cética:** recursão do Judge (teto de 3 é à prova de falha), Rules of Hooks no frontend (guard é código morto), HMAC opcional de webhook (handlers só logam/emitem socket), módulo de email (`ENCRYPTION_KEY` já presente no `.env`).

## 🟡 Médios (resumo)
Listas viram "vazio" silencioso em erro de fetch (`ErrorState` nunca usado) · 662 `: any` sem augmentation de `Request` · validação Zod em 1/20 rotas · duplicação entre providers no `aiService` · stores JSON reescrevem arquivo inteiro a cada mutação (2 sem escrita atômica) · sync Dolibarr sem transação · CORS `*.trycloudflare.com` + CSP `unsafe-inline` · scrapers CentroVibe quebrados sem flag (#196) · `whatsapp-web.js` em commit alpha · webhooks bancários só stub (pagamentos Itaú não gravados) · `context/` vs `contexts/` duplicados · `src__tests__/` fantasma · sem backup do `backend/data/`.

---

## Triagem de issues (snapshot 2026-06-13)

**Já feitas (fechar):** #282 (`5f00795`), #329 (`eab0af8`), #319 (`pollSync`), #321 (`recordEvent`), #239 (`66e504a`), #310 (coberta por #282/#110), #270-Fase1 (`e8e78a7`); #26/#27/#32/#33/#34/#35 (auditoria abr/2026 majoritariamente implementada).
**Válidas:** #30 (rotação — alta), #29 (SQLite), #155 (ponte tulipa-v4), #299, #293, #45, #335, #54/#31/#280/#59/#58.
**Tracking:** #362, #352, #291, #60.
**Branches:** 14 `worktree-agent-*` = lixo (0 commits únicos); ~9 `feat/*-fase2`/`fix-NNN` já squash-merged → deletar (nunca `git merge` na main).

---

## Remediação aplicada (2026-06-13)

### Histórico git purgado
`.env`, `dolibarr_local.db`, `backend/certs/inter.*`, `Dados Inter/`, `Certificado_Webhook.zip` removidos de **todas as 57 branches** (local + remoto via `git filter-repo` + force-push). Backup completo em `C:\tmp\sistemav2-backup\` (bundle de todas as refs + arquivos sensíveis + diff de stash antigo).

### Correções de código (PR #365, ref #364)
- Gate de auto-merge corrigido (`!verify.ok`).
- Piso de `judgeScore >= minMergeScore` em `mergeTask()` salvo `force` (override humano); tool do agente nunca força.
- `/debug/execute-tool` e `/debug/extract-tool` exigem login (+ admin na execute).
- CI frontend roda `npm run test:unit`.
- `npm audit fix`: axios → 1.17.0 (front 24→4, back 48→5 vulns).
- 9 testes atualizados. Backend 1837 ✓, frontend 1054 ✓, typecheck/build ✓.

### Pendente (ação manual do dono)
- **Rotacionar** as 4 credenciais expostas (Inter mTLS key+cert, Inter OAuth secret, Dolibarr API key) — purga não desfaz exposição em repo público. Ver #364.
- Hardening: fine-grained PAT p/ TaskRunner, branch protection, HMAC fail-closed, CORS/CSP, ativar limites do agente.
