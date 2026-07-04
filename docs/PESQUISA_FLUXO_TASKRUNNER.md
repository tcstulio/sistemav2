# Pesquisa: Fluxo Atual do Task Runner (issue #1014)

> Parent Epic: #972 — análise prévia de tasks antes do run do opencode.
> Complexidade: low. **Sem mudança de código** — apenas mapeamento da estrutura atual.
> Commits de referência: `b3164cb` (resgate Claude), `68f5fb6` (gate de teste), `957bd08` (CI retomável), `9a4f11f` (gate por delta).

---

## 1. Arquivos relevantes (caminhos exatos)

| Arquivo | Papel |
|---|---|
| `backend/src/services/taskRunnerService.ts` | **Núcleo** do pipeline (~3338 linhas): ingestão, fila serial, execução, judge, gate, merge. |
| `backend/src/services/taskPlannerService.ts` | Pré-validação (triagem LLM) que decide go/skip/wait/reorder antes de executar. |
| `backend/src/services/agentTools.ts` | Ferramentas do agente de **chat**: `create_opencode_task`, `start_opencode_task`, `git_recent`, `read_logs`, `list_github_issues`. |
| `backend/src/routes/taskRoutes.ts` | API REST exposta à UI (start/fix/redo/merge/kill/planner/preview). |
| `backend/src/services/taskUsageTracker.ts` | Métricas de tokens/custo USD do Judge por task. |
| `backend/src/services/claudeCliService.ts` | Tier "resgate" (Claude Code assume worktree vazio). |
| `backend/src/services/gateDelta.ts` | Parse de erros de tsc + filtro delta (erros novos em arquivos tocados). |
| `backend/src/__tests__/services/taskRunnerService.queue.test.ts` | Testes da fila serial. |
| `backend/src/__tests__/services/taskRunnerService.gate.test.ts` | Testes do gate (delta/testes/auto-merge). |
| `backend/src/__tests__/services/taskPlannerService.test.ts` | Testes do planner. |
| `backend/data/tasks.json` | Store persistente (single source of truth do estado de cada task). |

---

## 2. Função de entrada da task (recebimento + enfileiramento)

Há **3 caminhos** que chegam ao mesmo enfileirador:

### A. Agente de chat (`agentTools.ts`)
- `create_opencode_task` — `agentTools.ts:1332`: cria issue no GitHub com label `opencode-task` (com anti-duplicata).
- `start_opencode_task` — `agentTools.ts:1383`: chama `taskRunnerService.startTask(issueNum)`.

### B. API REST (`taskRoutes.ts`)
- `POST /api/tasks` — `taskRoutes.ts:140` → `createTask()`.
- `POST /api/tasks/:issueNumber/start` — `taskRoutes.ts:152` → `startTask(issueNumber, {mode})`.

### C. Polling / auto-start (`taskRunnerService.ts`)
- `pollSync()` — `taskRunnerService.ts:412`: a cada 5 min chama `syncTasks()` (`:615`), que sincroniza issues com label `opencode-task` para o `store.tasks`. Quando detecta task nova e `autoPlay` está ligado (`:482`), dispara `startTask()` automaticamente.

### Enfileirador comum
Todas as vias convergem para:
- **`startTask()` — `taskRunnerService.ts:785`**: valida status, define branch (`fix-<n>`), e chama `scheduleExec()`.
- **`scheduleExec()` — `taskRunnerService.ts:848`**: fila **serial** (1 task por vez — o worktree `WT_ROOT` é compartilhado). Usa `execChain: Promise<void>` (`:803`) + contador `pendingExecs` (`:802`) + `worktreeLock` mutex (`:818`).

```
[issue opencode-task] ─┐
[POST /start]          ├──► startTask(:785) ──► scheduleExec(:848) ──► [fila serial] ──► executeTask(:1705)
[agente start_opencode]┘                                  │
                                                          └─► taskPlannerService.analyzeTask(:863)  ← PRÉ-VALIDAÇÃO
```

---

## 3. Ciclo de vida completo

`TaskStatus` (`:85`) — valores exatos do tipo:
`pending → running → fixing → reviewing → approved → merged`
(transitório de cancelamento: `cancelling`; terminais: `cancelled | rejected | failed`).

### Estágios
1. **Descoberta/ingestão** — `syncTasks()` (`:615`) popula `store.tasks` a partir de issues GitHub; `pollSync()` (`:412`) detecta novidades e (se `autoPlay`) auto-inicia.
2. **Enfileiramento** — `startTask()` → `scheduleExec()` (`:785`/`:848`). Fila serial por causa do worktree compartilhado.
3. **Pré-validação (Planner)** — `taskPlannerService.analyzeTask()` em `:863`, **antes** de `executeTask`. Decide go/skip/wait/reorder; detecta conflito de arquivos com PRs abertos, issue já resolvida, e épicas (→ decomposição).
4. **Execução** — `executeTask()` (`:1705`):
   - `ensureWorktree()` (`:1172`): worktree git isolado a partir de `origin/main`, deps sincronizadas.
   - `captureBaseline()` (`:1290`): snapshot de erros de tsc do main (cache por SHA) p/ o gate delta.
   - Leitura da issue (`:1727`) + `describeIssueImages()` (`:1730`): descreve anexos de imagem via visão.
   - **Loop de implementação** — dois modos:
     - `runCumulativeImplementation()` (`:1555`): loop incremental gated (até 8 rounds, não reseta).
     - *synthesis* (`:1746`–`:1925`): 3 explorações independentes + 3 sínteses.
   - Cada iteração roda `runOpencodeIsolated()` (`:1152`) = `opencode run` no worktree lendo `.taskrunner-prompt.md`.
   - `verify()` (`:1319`): gate = tsc delta + vite build (se tocou `src/`) + `runTouchedTests()` (`:1360`, vitest related).
   - `tryClaudeRescue()` (`:2449`): se o coder barato vem vazio, Claude Code assume o worktree.
5. **Commit + push** — `:1927`–`:1948` (remove o prompt file antes de commitar).
6. **PR** — `gh pr create` em `:1958` (`pr_created`).
7. **Judge (LLM-as-judge)** — `runJudge()` (`:1993`): rubrica 0–10 sobre o diff. Score `<8` → auto-fix (re-roda `executeTask` com feedback, até 3x); `≥6` após esgotar tentativas → `approved`; `<6` → `reviewing`.
8. **Auto-merge** — `tryAutoMerge()` (`:2513`) → `tryAutoMergeInner()` (`:2520`):
   - gates: `judgeScore ≥ minMergeScore` (`:2523`), `judgeApproved !== false` (`:2526`), `checkTestRegression()` (`:2388`, gate determinístico de contagem de testes), rebase na main (`:2566-2569` fetch+rebase sob `withWorktreeLock`), `verify()`, `waitForPrMergeable()` (`:2253`, espera CI), `mergeTask()` (chamada em `:2629`; def. pública em `:2842`).
   - `selfHealFromGate()` (`:2471`): realimenta o coder 1x com a crítica do gate (regressão de testes / veto do juiz) antes de escalar p/ humano.
9. **Pós-merge** — `reevaluateAfterMerge()` (`:2652`): re-analisa tasks bloqueadas (planner) e dispara a próxima (`autoPlayNext()`).

---

## 4. Hook de pré-validação existente (pergunta da issue)

> "git_recent, list_github_issues, read_logs já são chamados em algum momento?"

**Não no pipeline do task runner.** `git_recent`, `read_logs` e `list_github_issues` são ferramentas do **agente de chat conversacional** (`agentTools.ts:1237`, `:1868`, `:1883`), invocadas quando um usuário conversa com o assistente. Elas **não** são chamadas pelo `taskRunnerService`/`executeTask`/Planner.

**O único hook pré-execução que existe hoje** é o **TaskPlanner** (`taskPlannerService.analyzeTask`), chamado em `taskRunnerService.ts:863` dentro de `scheduleExec`, antes de `executeTask`. Ele:
- `listOpenPRs()` + `fileOverlap()` — detecção de conflito de arquivos com PRs abertos;
- `getFileContextFromMain()` — busca conteúdo de arquivos citados na issue via `gh api`;
- `queryLLM()` — decisão go/skip/wait/reorder, `alreadyResolved`, detecção de épica;
- cache por hash do corpo da issue (TTL 1h, `taskPlannerService.ts:97`).

**Limitação relevante p/ a análise prévia do epic #972:** o Planner apenas decide *se* a task roda — ele **não** enriquece o prompt do coder com contexto coletado (commits recentes, logs, issues relacionadas). Não existe hoje um estágio de "context-gathering" que alimente o `buildPrompt()`.

---

## 5. Onde a análise prévia (#972) será plugada

**Ponto de inserção recomendado:** dentro de `scheduleExec()` (`taskRunnerService.ts:858`–`:953`), **após** o Planner confirmar `decision.action === 'go'` (`:875`) e **antes** de `executeTask()` ser despachado (`:950`). Janela concreta: entre a checagem de cota (`:920`) e a linha `task.status = activeStatus` (`:931`).

Justificativa:
- roda **uma vez por task**, depois da triagem barata (Planner) e antes do run caro (opencode);
- tem a `task` disponível (com `issueNumber`, `body`, `branch`), podendo chamar `git_recent`/logs/`list_github_issues` se desejado;
- o resultado pode ser injetado nos construtores de prompt — `buildPrompt()` (`:1444`), `buildSynthesisPrompt()` (`:1459`), `buildCumulativePrompt()` (`:1521`) — que já recebem `task` e `issueData`.

**Alternativa (também válida):** dentro de `executeTask()`, entre a leitura da issue (`:1727`) e a montagem do 1º prompt (`:1756`), quando o `issueData` completo já está disponível.

---

## 6. Onde guardar o resultado da análise prévia

**Local natural: a interface `Task`** (`taskRunnerService.ts:204`–`:257`), análoga aos campos de contexto já existentes:
- `feedbackHistory: string[]` (`:228`) — contexto injetado em todos os prompts;
- `gateFixInstruction?: string` (`:221`) — instrução persistente (sobrevive ao reset de feedback);
- `planReason?: string` (`:239`) — motivo do planner;
- `baselineErrors?: string[]` (`:254`) — dado de baseline do tsc.

**Proposta de campo** (a ser implementado em issue posterior, **não nesta pesquisa**):

```ts
// em Task (taskRunnerService.ts:204)
preAnalysis?: {
  context: string;          // sumário de contexto p/ o prompt (commits recentes, logs, issues relacionadas)
  relatedIssues: number[];  // issues correlatas detectadas
  touchedHints: string[];   // arquivos prováveis de serem tocados
  generatedAt: string;      // ISO timestamp
};
```

- **Persistência:** automática em `backend/data/tasks.json` via `save()` (`:590`, `atomicWriteSync`). Sobrevive a restarts.
- **Consumo:** pelos 3 builders de prompt (acima), anexado à seção de spec — **fora** do `wrapUntrusted()` (`:1395`) se o conteúdo for gerado por nós (próprio repo), ou **dentro** se incluir texto de terceiros (corpo de issue comentada).
- **Compat:** campo opcional `?` → tasks antigas em `data/tasks.json` seguem funcionando (mesmo padrão usado na adoção de `metrics`, `baselineErrors`, etc.).

---

## 7. Resumo para critérios de aceite

| Critério | Onde |
|---|---|
| Arquivos relevantes listados | §1 (11 arquivos, caminhos exatos) |
| Função de entrada da task | §2 — `startTask()` `:785` → `scheduleExec()` `:848` (3 vias de chegada) |
| Ciclo de vida completo | §3 — 9 estágios, do polling ao pós-merge |
| Hook de pré-validação existente | §4 — Planner (`:863`); `git_recent`/`read_logs`/`list_github_issues` **não** estão no pipeline |
| Onde plugar a análise prévia | §5 — `scheduleExec()` entre `:920` e `:931` (após "go", antes de `executeTask`) |
| Onde guardar o resultado | §6 — novo campo `preAnalysis?` na interface `Task` (`:204`), persistido em `tasks.json` |
| ≥3 commits/arquivos com caminho exato | `b3164cb`, `68f5fb6`, `957bd08`, `9a4f11f` + arquivos do §1 |

**Conclusão:** a análise prévia do epic #972 deve ser uma nova etapa em `scheduleExec()` (entre a triagem do Planner e o despacho de `executeTask`), armazenando o resultado num campo `preAnalysis?` da `Task`, consumido pelos builders de prompt. É uma adição **isolada** — não altera o ciclo de vida existente.
