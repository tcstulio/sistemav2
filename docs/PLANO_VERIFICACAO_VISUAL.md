# Plano de Verificação Visual & Loop Visual — Análise Adversarial (2026-07-04)

> Síntese de 3 análises adversariais independentes (gaps da verificação visual · relatório de prova · loop de feedback + imagem como input), todas verificadas contra o código real.

## 🎯 Achado central (os 3 convergiram)

**O robô tem um stack de visão COMPLETO — e está DESLIGADO em todos os pontos.** As três evoluções pedidas são o mesmo cabo desconectado em três pontas:

| Ponto | Peça que JÁ existe | Estado |
|---|---|---|
| **Visão no INPUT** (usuário mostra o alvo numa imagem) | `aiService.describeImage()` → GLM-4.6V (validado 03/jul) | existe, **não ligada** ao coder |
| **Visão no OUTPUT** (o resultado ficou bom?) | `runVisualJudge()` (zai-vision + minimax, prompt completo) | **código morto** — 0 call sites vivos |
| **Visão como PROVA** (mostrar ao usuário) | captura + rotas `/screenshots` + `getScreenshots()` + `visualScore`/`visualReview` | tudo pronto, **ninguém chama** |

Conectar isso é majoritariamente **plumbing** (não pesquisa) — alto ROI.

---

## PARTE 1 — A verificação visual atual dá FALSA CONFIANÇA

O que roda no caminho de merge como "verificação visual":

| Camada | Roda quando | O que checa DE VERDADE | Bloqueia merge? |
|---|---|---|---|
| CI `visual` (`visual.yml`) | PR→main | pixel-diff de **1 tela** (login) | Sim — só login |
| CI `test` (`playwright.yml`) | PR→main | `smoke.spec.ts`: 200 + `#root` não-vazio + `<script>` | Sim, trivial |
| CI frontend (`ci.yml`) | PR→main | `tsc` + 192 Vitest (**jsdom**) + `vite build` | Sim |
| Judge Visual LLM | **NUNCA** | — | Não (morto) |
| `verify()` auto-merge | pós-rebase | `tsc` + `vite build` (+ testes tocados no delta) | Sim |

**O único gate que olha pixel é o CI `visual` — e fotografa 1 de 132 rotas (`App.tsx`). Cobertura real ≈ 0,8%.**

### Gaps (severidade)

- **[CRÍTICA] Baseline cobre 1 tela; 132 rotas atrás de login.** Regressão em `/invoices`, `/customers` etc. passa tsc+build+jsdom+pixel-diff-de-login. **Merge automático de tela quebrada com CI verde.** Único spec: `tests/visual/login.visual.spec.ts` (1 baseline PNG). O spec DECLARA a exclusão das telas internas.
- **[CRÍTICA] Judge Visual LLM = código morto.** `grep runVisualJudge` = 0 call sites vivos (só def :2213 + comentários). O fluxo de aprovação (:2163) chama `tryAutoMerge` direto. "Advisory futuro" = nunca. Pior que advisory: nem é computado — não há score pra humano consultar.
- **[CRÍTICA] Vitest em jsdom → cego a layout.** `vitest.config.ts:25` `environment:'jsdom'`. Sem `getBoundingClientRect`, media query, flex/grid, sticky/fixed. Bug de responsividade / z-index / overflow passa nos 192 testes. O comentário do merge ("gate de frontend = tsc+Vitest+build") é a fonte da falsa confiança — nenhum vê pixel.
- **[ALTA] Smoke raso.** "React montou" (200 + `#root` + `<script>`). O teste de erro de console faz `skip` sem backend — e a CI não tem backend → sempre pula. Tela quebrada / botão que erra / `NaN` financeiro passam.
- **[ALTA] E2E real (nav/auth/CRUD) é só local e majoritariamente `skip`.** `ui-crawler.spec.ts` visita 35 rotas coletando `console.error`+`pageerror`+HTTP≥400 — o detector de tela-quebrada mais barato — mas está `test.skip` (sem creds) e FORA da CI (só `smoke.spec.ts` roda). `navigation.spec.ts`/`auth.spec.ts` idem.
- **[ALTA] Screenshots do robô frágeis + enganosos.** `runVisualJudge` compara `localhost:3003` vs preview — **nenhum autentica** → compara login vs login p/ mudança em `/invoices` (10/10 cego). Falha de preview → judge PULADO → segue pra merge (**fail-open**). `colorScheme:'light'` fixo apesar do prompt perguntar de dark mode.
- **[MÉDIA] Baseline nasce sem revisão humana** (auto-bootstrap na 1ª run) — oráculo pode nascer errado. E mudança visual intencional exige `workflow_dispatch` humano (fricção num robô "autônomo").

**Veredito:** a tela de login está bem protegida; **o resto do ERP não tem verificação visual real.** O robô pode aprovar+mergear tela interna quebrada com CI 100% verde.

---

## PARTE 2 — Relatório de PROVA visual ("acender a lâmpada que já existe")

~80% já está no código, morto. Reuso pronto: `screenshotService.captureForTask`, rotas `/api/tasks/:n/screenshots[/:type]`, `TaskService.getScreenshots()` (front, ninguém chama), `task.visualScore`/`visualReview` (persistidos+nos tipos), MCPs zai-vision+minimax, modal `DiffViewer` ("Revisão do PR"). Screenshots são **gitignored** (privacidade OK — PII nunca vaza).

### MVP (~1 dia): painel "Prova visual" no `DiffViewer`
Ao clicar "Revisar" numa task de frontend, o admin vê **before/after + score + resumo em pt** — e, se não houver prova, **por quê**.
1. **Backend (~0,5-1d):** chamar `runVisualJudge` **advisory/não-bloqueante** p/ tasks com `hasFrontendChanges`, após `pr_created`. **O judge sobe o próprio preview headless** (reusa `startPreview`/`previewPortsFor`) p/ capturar o "after" — hoje o preview só sobe no clique manual (o maior risco). Grava `visualScore`/`visualReview` (código existe).
2. **Frontend (~0,5d):** bloco "Prova visual" no `DiffViewer` (abaixo do Judge Review): 2 `<img>` before/after + badge do score + `visualReview` + **estado-vazio-com-motivo** (lê o último `judge_error` dos eventos).
3. **Auth do `<img>`:** a rota `/screenshots/:type` exige `requireDolibarrLogin` (Bearer); `<img src>` não manda header → token via query/cookie.

**É prova E diagnóstico:** expõe o modo-de-falha nº1 (preview que não sobe = ambiente, os 84%) na tela onde o humano decide.

**Corte se apertar:** só "after" + resumo (metade do valor, 1/3 do esforço — dispensa a URL `:3003`).
**Fora do MVP:** diff PNG do Playwright embutido, telas-tocadas automáticas, comentário no PR (screenshots são privados → não linká-los no PR público), GIF de fluxo (`gif_creator` NÃO existe no ambiente do robô — é tool do claude-in-chrome só desta sessão), dark mode (4 imagens).

### ⚠️ Refino de escopo (verificado no código — o MVP de "1 dia" é otimista)
Dois blocos de engenharia real, não "acender a lâmpada":
- **(a) Screenshots autenticam?** NÃO. `capturePage` (`screenshotService.ts:31`) faz `page.goto` cru — sem sessão. Pra qualquer tela interna, captura o **login**. Autenticar exige semear `localStorage['coolgroove_config']` = `{apiKey, url, currentUser:{login,admin,rights}}` (shape em `DolibarrContext.tsx:282-321`) + cookie `dolapikey` ANTES do goto (via Playwright `addInitScript`/`addCookies`), E um Dolibarr alcançável pelo browser (o app faz `fetchCurrentUser` + carrega dados). É a receita [[e2e-sessao-logada-recipe]] — funciona, mas tem pegadinhas.
- **(b) Preview usa o worktree COMPARTILHADO.** `startPreview` (`:3230`) dá `checkout` da branch no `WT_ROOT` sob o `worktreeLock` + sobe `nodemon+vite`. Logo **subir um preview SERIALIZA com/BLOQUEIA a execução de tasks** (o worktree só fica numa branch por vez). Pra prova autônoma confiável, o ideal é um preview em worktree ISOLADO (como o gate por task), não o compartilhado.

**Conclusão:** prova visual DE VERDADE = (a) + (b). Cada um é um passo próprio. O "corte" (só resumo do judge, sem before/after) é o único pedaço que dispensa (a)+(b) — mas aí não é "prova visual", é "resumo textual".

### Riscos
1. **Preview não sobe no fluxo autônomo** (o maior) — sem o judge subir o preview sozinho (e no worktree compartilhado, sem serializar), o "after" é 404 e a prova fica vazia.
2. **Auth do `<img>`** — detalhe pequeno mas bloqueia a imagem aparecer.
3. **Custo/latência** do judge (~120s, opencode+2 MCPs) sob `worktreeLock` — advisory+fire-and-forget + só `hasFrontendChanges`.
4. **Porta de preview** `5174+n%10` (10 slots) colide entre tasks com mesmo último dígito.
5. **MiniMax "insufficient balance"** — tratar como opcional; `zai-vision` sozinho dá score+resumo.
6. **Privacidade** — manter gitignored + atrás de login; nunca anexar ao PR público.

---

## PARTE 3 — Imagem como INPUT (usuário aponta o alvo) — ✅ FEITO (2026-07-04)

**IMPLEMENTADO:** `describeIssueImages(issueData)` + `downloadImageBase64(url)` no taskRunnerService — extrai imagens do markdown/HTML da issue (regex), baixa (token gh, fallback público), descreve via `aiService.describeImage` (GLM-4.6V, exposto no facade), e injeta no `spec` dos 3 builders (dentro dos marcadores de dado não-confiável) como "## Alvo indicado por imagem". Best-effort (nunca lança). Validado: regex extrai 2/2 + ignora não-imagem, download OK, tsc 0, 114/114. E2e real roda quando o robô pega issue com imagem. Detalhes abaixo ↓

Capacidade já existe: `describeImage()`→GLM-4.6V, e o runner já invoca visão no `runVisualJudge`. **Gap = plumbing**: hoje `gh issue view --json body` traz `![](url)` como TEXTO; a URL entra no prompt e a imagem é **ignorada** (o robô *finge* que leu). Anotação ("muda ISSO", seta vermelha) se perde.

**Caminho (~100 linhas):** `describeIssueImages(issueData)` — regex `!\[.*?\]\((.+?)\)` → download autenticado (`gh api <url>`) → `describeImage(base64, "o usuário anotou o que quer mudar; descreva o alvo")` → injetar nos builders (`buildPrompt`/`buildSynthesisPrompt`/`buildCumulativePrompt`), bloco "## Alvo indicado por imagem". **Classificação: PERTO.**

---

## PARTE 4 — Loop "aprovada mas não ficou como eu queria" (B)

Hoje: memória boa DENTRO da issue (`feedbackHistory`, `/fix`, `redoTask`, `prHistory`, self-heal). **Cross-issue: nada.** Uma issue nova é 100% independente — sem `supersedes`/`relatedIssue` (só `parentEpic` p/ épico→subtask). Planner não olha tasks mergeadas. **Fase 3 (aprendizado) = 0 linhas** (`task_learning.jsonl`/`routing_policy.json` não existem).

**Caminho:** (perto) detectar `#123` no corpo → linkar ao PR anterior → injetar "corrige o rumo do PR #X; NÃO repita a abordagem"; (maior) loop de aprendizado (Fase 3 do plano de confiabilidade).

---

## Ordem de execução (por ROI)

1. **[MVP ~1d] Relatório de prova visual + ligar o judge** (Parte 2) — máximo "me prova que funciona", des-morta o stack de visão, e de brinde expõe o modo-de-falha nº1. **COMEÇAR AQUI.**
2. **Rodar `ui-crawler.spec.ts` na CI** (Parte 1, gap E2E) — já escrito, só `skip`; detecção de erro em 35 telas. Precisa backend/fixtures de teste.
3. **Baselines autenticadas das ~10-15 telas reais** (Parte 1, gap crítico #1) — 0,8%→real; usa a receita [[e2e-sessao-logada-recipe]] + Dolibarr de fixtures. Maior.
4. ✅ **FEITO (2026-07-04)** — **Imagem como input (Parte 3)** — o robô agora LÊ as imagens anexadas na issue (antes ignorava).
5. **Loop de aprendizado (Parte 4 / Fase 3)** — o item grande, depois.

## Arquivos-chave
- `.github/workflows/visual.yml` (pixel-diff 1 tela), `playwright.yml` (só smoke), `ci.yml`
- `tests/visual/login.visual.spec.ts` (único spec), `tests/smoke.spec.ts`, `tests/ui-crawler.spec.ts` (útil, skip+fora da CI)
- `backend/src/services/taskRunnerService.ts`: `runVisualJudge` (:2213, sem call sites), caminho de merge (:2163), `hasFrontendChanges` (:2183)
- `backend/src/services/screenshotService.ts` (URLs cruas sem auth, `light` fixo), `backend/src/services/aiService.ts` (`describeImage` :1265)
- `backend/src/routes/taskRoutes.ts` (rotas `/screenshots`), `src/services/taskService.ts:139` (`getScreenshots`), `src/components/TasksBoard/DiffViewer.tsx`, `src/components/Issues/IssuesPage.tsx:1025`
- `vitest.config.ts:25` (`jsdom`)
