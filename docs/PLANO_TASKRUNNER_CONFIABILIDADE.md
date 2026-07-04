# Plano de Confiabilidade do TaskRunner — Análise Adversarial (2026-07-04)

> Síntese de 4 análises adversariais independentes (worktree/ambiente, gate/verificação, coder/escalação, fila/durabilidade/aprendizado), todas verificadas contra o código e o worktree reais.

## 🎯 Achado central (os 4 convergiram)

**~84% das falhas do robô são de AMBIENTE, não do coder.** O GLM/MiniMax quase nunca é o problema (16-23% das falhas). O que quebra é o **pipeline em volta** dele.

Classificação das 31 falhas reais (300 tasks, 211 merged = 71%):
| Causa | Qtd | Culpado |
|---|---|---|
| Timeout no worktree lock | 14 | AMBIENTE (já corrigido hoje) |
| CI não ficou verde a tempo (judge 8-9, MERGEABLE) | 5 | AMBIENTE/gate |
| Backend reiniciou (nodemon) | 3 | AMBIENTE |
| Humano fechou PR aprovado | 4 | HUMANO |
| Coder veio vazio | 5 | CODER |
| Coder score baixo | 0 | CODER |

**Regra de ouro (Agente 3):** *"escalar Claude antes de consertar o gate seria pagar caro pra alimentar um gate quebrado."* → **Ambiente primeiro, modelo depois.**

---

## Os bugs, consolidados e priorizados

### 🔴 CRÍTICO — reprova TODA task (falso-negativo sistêmico)

**B1. Worktree com `node_modules` STALE.** `ensureWorktree` (`taskRunnerService.ts:1192`) roda `npm ci` **só quando node_modules FALTA**. O `heic2any` (add em #949, 03/jul) nunca foi instalado no worktree (deps de 25/jun). Evidência de disco: `node_modules/.package-lock.json` (stamp) DIFERE main×worktree, embora o `package-lock.json` seja idêntico. `git clean -fd` preserva node_modules (gitignored) → esconde o drift. node_modules é dir REAL (não junction — memória desatualizada).
- Efeito: `verify()` (`:1219-1234`, roda `tsc backend` + `tsc frontend` + `vite build` no projeto INTEIRO) retorna `ok:false` no **baseline puro** — falha no tsc frontend (`heic2any` TS2307) E no vite build (Rollup não resolve heic2any). **Toda task que não toque heic2any é reprovada.**

**B2. Gate mede o REPO INTEIRO, não o DELTA da task.** Mesmo sem o drift, qualquer erro pré-existente de frontend reprova um PR só-de-backend. O gate funde "qualidade da task" com "saúde do repo".

### 🟠 ALTO

**B3. Rejeições por CI-timing.** #821-824/#830: judge 8-9/10, MERGEABLE, mas `task_failed: CI não ficou verde a tempo` (`:2378-2382`, `CHECKS_TIMEOUT` 15min) → viram `rejected`. Código excelente perdido por timing.

**B4. Coder sem contexto de arquivo.** O Planner já busca `getFileContextFromMain` (`taskPlannerService.ts:65-82`) mas **descarta**. Tasks de segurança/multi-arquivo (as que mais "vazam") precisam achar as rotas sem contexto.

**B5. Mensagem stale do lock.** O timeout foi elevado p/ 185min hoje, mas a string do erro (`:809`) e `task.error` ainda dizem ">10min". Além disso o handler carimba `failed` em QUALQUER task `running` que achar (vítimas colaterais #977/#981).

### 🟡 MÉDIO

**B6. Contaminação exploração→síntese.** A síntese (`:1626`) não reseta → herda o diff não-commitado da 3ª exploração. Clean escopado a `src/ backend/src/` deixa vazar arquivos fora disso.
**B7. Store inchado.** ~24,5 MB (60%) dos 42 MB do `tasks.json` são telemetria (`events`+`cpuMemSamples`); `save()` reescreve tudo toda vez.
**B8. "Pending" nunca drenam.** `syncWithGitHub` (`:698-704`) re-toca 40 linhas todo poll sem tirá-las da fila; issue fechada fica `pending` p/ sempre.
**B9. Restart mata task rodando** (`running`→`failed`). Task não é resumível.
**B10. synthesis desperdiça runs.** Até 6 runs de opencode (cada `verify()` ~9-13min), joga trabalho fora entre explorações. Cumulative é superior (dados confirmam).

### 🟢 BAIXO (endurecimento)

**B11. Falso-positivos do gate:** `verify()` nunca roda testes; `checkTestRegression` é regex frágil (`it.skip` conta como ADIÇÃO — bug; asserção trivial burla); Judge enganável (diff truncado em 50KB, injection textual, auto-fix realimenta o próprio judge = gaming).
**B12. rescue/self-heal NUNCA rodaram** (0 track record em 300 tasks) — código novo desta sessão, precisa telemetria desde o 1º disparo.

---

## Plano de execução (ordem por ROI)

### FASE 0 — Ambiente (destrava ~84% das falhas, custo ~zero de Claude) ⬅️ COMEÇAR AQUI

1. ✅ **FEITO+VALIDADO** — **Consertar o drift de deps** (`ensureWorktree`): `ensureDeps` roda `npm ci` (raiz + backend) quando o `package-lock` é mais novo que o marker `.tr-installed`. Validado ao vivo (#986 passou typecheck em explorações, antes 0/3; criou PR #1001).
2. ✅ **COBERTO pelo item 3** — o gate por delta já roda `collectTscErrors` no worktree; baseline quebrado não é mais problema (filtro por arquivo-tocado).
3. ✅ **FEITO (v2, endurecido por 3 agentes adversariais)** — **Gate por DELTA**: `gateDelta.ts` (puro, testado 18/18) + `verify(task)`. **Só reprova por erro de tsc NOVO em arquivo que a task TOCOU** (`computeBlocking`) + global novo; `vite build` só quando toca `src/**`. Baseline best-effort cacheado por SHA (atômico, em `backend/data/baseline-cache/`). A análise adversarial pegou 3 bloqueantes que o design v1 tinha (baseline stale no auto-merge, self-heal→estrito, vite não-roda pós-rebase) — o filtro por arquivo-tocado neutraliza todos. `touchedFiles` via `git diff origin/main...HEAD` ∪ não-commitadas. Flag `TASKRUNNER_DELTA_GATE=0` volta ao estrito. **Reframe chave:** o delta NÃO é o portão final — a CI full-repo + branch protection é; logo falsos-negativos são contidos, e o alvo real é o falso-positivo (task boa reprovada).
   - ⏳ **Follow-up [ALTO, Fase 4/B11]**: rodar `vitest` dos arquivos tocados no `verify()` — o MAIOR falso-negativo do robô (pré-existente ao delta; o gate nunca rodou testes).
   - ⏳ **Follow-up**: medir custo real do `captureBaseline` (cache amortiza fraco sob auto-merge) antes de remover o flag; varrer caches de SHA velhos.
4. **Separar task-quality de repo-health**: baseline quebrado → alerta/issue própria, **não** reprova as outras tasks. (Parcial: o filtro por arquivo-tocado já isola; falta o alerta dedicado.)
5. **CI retomável** (`:2378`): "CI não ficou verde" vira estado que re-tenta o merge quando a CI fecha, não `rejected`. Subir `CHECKS_TIMEOUT`.
6. **Passar `getFileContextFromMain` ao prompt do coder** (ataca os "vazios" de segurança).
7. **Corrigir a msg stale do lock** (`:809`) + não carimbar `failed` em task que só passou pelo Planner.

### FASE 1 — Escada de escalação (só depois do gate justo)

- **Modo:** `cumulative` como DEFAULT (synthesis desperdiça; opt-in só p/ creative-small).
- **Roteamento por tipo:** `label:security` ou corpo casando `/rate.?limit|zod|auth|credential|token|financ|XSS|CSRF/` **OU** `complexity:high`/`filesEstimate>=3` → **Claude PRIMÁRIO** (`claudeCliService.runCode`), não rescue. Gating: `CLAUDE_PRIMARY_MAX_USD` por task + teto/dia.
- **Rescue (Degrau 3):** manter (bem posicionado, `:1498/1673`), mas **instrumentar** (custo/turns/changed no `TaskMetrics`) e **NÃO** disparar quando a causa é ambiente (quota/lock) → re-enfileira.
- **Self-heal (Degrau 4):** 1º strike coder barato, 2º strike → **Claude** (`gateFixInstruction`). Adicionar parada por sem-progresso (`diffHash` igual entre rodadas).
- **Humano (Degrau 5):** estacionar em `reviewing` (não `failed`) quando teto de custo/Claude estourou, gate `reason:infra`, ou judge+Claude reprovaram.

### FASE 2 — Durabilidade & operação

- **Task resumível** ao restart (não marcar `failed`; retomar do trabalho commitado).
- **Trim de telemetria** em tasks terminais (mover `events`/`cpuMemSamples` p/ arquivo separado; `tasks.json` fica leve).
- **Drenar pending**: reconciliar issue fechada/velha → `cancelled`/`parked`.
- **Rejuvenescer o worktree** a cada N tasks (recriar do zero + `npm ci`).

### FASE 3 — Loop de aprendizado

- Capturar por task: causa da falha → tier que resolveu (barato/Claude/humano) em `data/task_learning.jsonl` + `routing_policy.json`.
- **Post-mortem automático** (1×/dia, Claude barato): lê os `failed`, sugere ajuste de rota/prompt.
- **Roteamento adaptativo:** "tipo X falha sempre no barato → Claude direto".
- Nota: não usar `prNumber` como sinal de merge (111 merged sem prNumber); usar `status==='merged'`.

### FASE 4 — Endurecimento do gate (B11)

- ✅ **FEITO** — **Rodar os testes afetados no `verify()`** (gate de teste local real): `runTouchedTests` roda `vitest related --run --passWithNoTests --retry=2` dos arquivos tocados, em cada projeto (backend/frontend). Pega regressão de lógica que passa no tsc — o MAIOR falso-negativo do robô (a análise adversarial destacou). Como o main é verde (CI), falha = regressão da task. Timeout = advisory; flag `TASKRUNNER_TEST_GATE=0` desliga. `splitTouchedByProject` puro+testado. De-riscado ao vivo (related acha testes por grafo de módulos, incl. test-files tocados; --passWithNoTests p/ arquivo sem teste).
- ⏳ `it.skip`/`test.skip` add = **regressão** no `checkTestRegression`; estender regex (`describe`, `it.each`, `.only`). (o gate de teste acima já cobre o caso do teste ESVAZIADO — o teste real roda e falha; falta o caso do `it.skip` que "some" silenciosamente.)
- ⏳ Sinalizar quando o diff do Judge trunca em 50KB.

---

## Próximo passo imediato

**Fase 0, itens 1-2** (drift de deps + pré-check de baseline). São pequenos, de altíssimo ROI, e destravam praticamente todas as tasks. Fazer com o robô parado (autoPlay off), aplicar, e re-rodar a #986 pra validar que o gate agora passa.

**Arquivo central:** `backend/src/services/taskRunnerService.ts` (worktree `:1145-1198`; verify `:1219-1234`; synthesis/cumulative `:1365/1557/1633`; judge `:1788`; rescue `:2244`; self-heal `:2266`; auto-merge `:2291`).
