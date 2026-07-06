# Mapeamento: redo, execChain, taskPlannerService e ingestão (issue #1117)

> Spike de investigação. Parent Epic: #1113. Complexidade: low.
> Objetivo: mapear onde `redo`/ingestão chamam `taskPlannerService.analyzeTask`
> de forma síncrona, e onde está o `execChain`/worker que pode receber a chamada
> assíncrona. Saída esperada: este documento (critérios de aceite da issue).

Base de referência: commit/working-tree em 06/07/2026. Todas as `arquivo:linha`
abaixo apontam para o código de produção em `backend/src/`.

---

## 1. Handler HTTP do `redo` e da ingestão

### 1.1 `redo`
- **Rota:** `POST /:issueNumber/redo` em `backend/src/routes/taskRoutes.ts:179`
  → `taskRunnerService.redoTask(issueNumber, instruction)` (`taskRoutes.ts:182`).
- **Service:** `redoTask()` em `backend/src/services/taskRunnerService.ts:2837`.
- **Caminho até o Planner:** `redoTask` NÃO chama `analyzeTask` diretamente. Ele
  zera estado da task, seta `status='running'` (`taskRunnerService.ts:2863`) e
  enfileira via `this.scheduleExec(task, branch, 'running')` (`taskRunnerService.ts:2869`).
  O `scheduleExec` é quem encadeia no `execChain` e, dentro do callback da cadeia,
  chama `analyzeTask` (`taskRunnerService.ts:893`) — ver §3. Ou seja, **o redo
  alcansa o Planner pelo worker (893), não por um call-site próprio.**

### 1.2 Ingestão
- A ingestão de issues é feita por **polling**, não por webhook push.
- `pollSync()` em `backend/src/services/taskRunnerService.ts:442` chama
  `syncTasks()` (`taskRunnerService.ts:475` → definido em `:645`), que cria tasks
  `status:'pending'` a partir das issues com label `opencode-task` (`:654-668`).
- `syncTasks()` dispara `scheduleAutoPlan()` (`taskRunnerService.ts:674`) →
  `planWithLLM()` (`taskRunnerService.ts:3222`). **Atenção:** `planWithLLM` é uma
  chamada de LLM **diferente** do Planner (apenas sugere ORDEM da fila); ela **não**
  chama `analyzeTask`.
- O início automático de execução pós-ingestão ocorre em
  `pollSync` (`taskRunnerService.ts:512-517`): `startTask(num, {mode:'cumulative'})`
  → `scheduleExec` → `execChain` → `analyzeTask` (893).
- O `GET /api/tasks` (`taskRoutes.ts:13`) também chama `syncTasks()` (ingestão) e,
  em background, `syncWithGitHub()` (`taskRoutes.ts:20`). Nenhum dos dois chama
  `analyzeTask` diretamente.
- **Conclusão:** a ingestão em si **não** chama `analyzeTask` síncronamente. O
  Planner só é acionado quando a task é efetivamente despachada para execução
  (worker 893) ou por ação manual (`POST /planner/analyze`, §5.1).

---

## 2. `taskPlannerService.analyzeTask`

- **Definição:** `backend/src/services/taskPlannerService.ts:124`
- **Assinatura:**
  ```ts
  async analyzeTask(task: Task, opts?: { noCache?: boolean }): Promise<PlannerDecision>
  ```
- `Task` é importado de `./taskRunnerService` (`taskPlannerService.ts:7`).
- `PlannerDecision` definido em `taskPlannerService.ts:20-30`
  (`action | reason | priority | blockedBy | overlappingFiles | alreadyResolved
  | filesEstimate | isEpic | epicReason`).
- Custo da chamada: `gh` (lista PRs + diffs, `taskPlannerService.ts:152`) **+ 1
  chamada de LLM** via `aiJobService.runAndWait` (`taskPlannerService.ts:268`,
  dentro de `queryLLM`). Há cache in-memory (§6).

---

## 3. `execChain` / worker

Não existe `backend/src/services/execChain.ts`. O worker **é um campo privado**
da classe `TaskRunnerService`:

- **Campo (a "cadeia"):** `private execChain: Promise<void> = Promise.resolve();`
  em `backend/src/services/taskRunnerService.ts:833`.
- **Contador de pendentes:** `private pendingExecs = 0;` em
  `taskRunnerService.ts:832`.
- **Mutex do worktree:** `withWorktreeLock(label, fn)` em
  `taskRunnerService.ts:849` (serializa `executeTask`/`tryAutoMerge`/`startPreview`
  entre si; NÃO cobre `analyzeTask`).
- **Entrypoint (enfileiramento):** `private scheduleExec(task, branch,
  activeStatus: TaskStatus = 'running'): void` em `taskRunnerService.ts:878`.
  - Se `pendingExecs > 0`, marca `task.status='pending'` (`:882`) e emite evento
    "Na fila" (`:884`).
  - Encadeia: `this.execChain = this.execChain.catch(()=>{}).then(async () => { …
    analyzeTask (893) … executeTask (980) … })` (`taskRunnerService.ts:888`).
- **Quem chama `scheduleExec`** (4 call-sites, grep-confirmado — `rg
  'scheduleExec\('` retorna 825, 2646, 2832, 2869 além da própria definição
  `:878`): `startTask` (`:825`, status `'running'`),
  `selfHealFromGate` (`:2646`, status `'fixing'` — realimentação pós-bloqueio de
  gate determinístico: regressão de teste ou veto do Juiz, método privado em
  `:2625`), `addFeedback` (`:2832`, status `'fixing'`) e `redoTask` (`:2869`,
  status `'running'`). **Todos os 4** anexam à cadeia e, portanto, disparam
  `analyzeTask` (`:893`) dentro do callback — nenhuma via chama o Planner
  diretamente.
- **Como o worker recebe tasks pendentes:** o worker **não drena** uma fila
  externa; cada `scheduleExec` **anexa seu próprio `.then`** à cadeia compartilhada.
  A serialização é, portanto, FIFO por ordem de append, **1 task por vez**.
- **Driver de despacho (auto-play):** `autoPlayNext()` em
  `taskRunnerService.ts:1053` lê `getQueuedTasks()[0]` e chama `startTask`.
- **Fila consultável:** `getQueuedTasks(): Task[]` em
  `taskRunnerService.ts:3215` — filtra `status==='pending' && kind!=='epic'` e
  ordena por `queuePriority` asc.
- **Auto-recuperação de cadeia presa:** `checkQueueHealth()` em
  `taskRunnerService.ts:402` reseta `execChain`/`pendingExecs` (`:433-434`) quando
  há slot fantasma há mais de `QUEUE_RECOVERY_MIN_MS`.

> Implicação para o throttle: o call-site `893` já roda **serializado** pela
> cadeia (1 analyzeTask por vez). O ponto que pode virar assíncrono é o handler
> HTTP manual (`POST /planner/analyze`, §5.1), que roda fora da cadeia.

---

## 4. Modelo/estado de tasks e persistência do "plan"

Não existe `backend/src/models/task.ts`. O modelo vive em
`backend/src/services/taskRunnerService.ts`.

### 4.1 Status
- **Tipo:** `export type TaskStatus` em `taskRunnerService.ts:86`:
  ```
  'pending' | 'running' | 'reviewing' | 'approved' | 'fixing' |
  'cancelling' | 'cancelled' | 'merged' | 'rejected' | 'rejected_precheck' | 'failed'
  ```
- **Terminais** (`isTerminalStatus`, `taskRunnerService.ts:678`):
  `approved | merged | rejected | failed | cancelled`.
- **`pending`** = na fila aguardando slot; **`running`/`fixing`** = em execução
  (fixing = realimentação pós-feedback); **`cancelling`/`cancelled`** = kill.

### 4.2 Interface `Task`
`backend/src/services/taskRunnerService.ts:225-287`. Campos relevantes ao Planner:
- `status: TaskStatus` (`:230`)
- `queuePriority?: number` (`:266`) — prioridade de fila (menor = mais urgente)
- `planReason?: string` (`:267`) — motivo da decisão do Planner
- `kind: 'task' | 'epic'` (`:272`), `parentEpic?: number` (`:275`),
  `decompositionPlan?: DecompositionPlan` (`:274`)
- `prNumber?`/`prHistory?` (`:232-233`) — usados na detecção de conflito do Planner

### 4.3 Como o "plan" (resultado do LLM) é persistido
- **NÃO** há objeto `PlannerDecision` persistido. Apenas **dois campos derivados**
  são escritos na `Task` (e gravados em disco por `save()` → JSON):
  - `task.queuePriority = decision.priority` (`taskRunnerService.ts:895`)
  - `task.planReason = decision.reason` (`taskRunnerService.ts:896`)
- A `PlannerDecision` completa é memoizada **só em memória**, no cache
  module-level `plannerCache: Map<number, CacheEntry>`
  (`taskPlannerService.ts:103`), chave `issueNumber`, invalidada por mudança de
  hash do corpo ou TTL de 1h (`PLANNER_CACHE_TTL_MS`, `:97`).
- **Persistência:** store em memória `private store: TaskStore`
  (`taskRunnerService.ts:298`) + arquivo JSON via `atomicWriteSync`
  (`import` em `:7`). **Não há tabela/DB** para tasks.

---

## 5. TODOS os call-sites de `analyzeTask` (grep completo)

### 5.1 Produção
| # | arquivo:linha | contexto | síncrono? |
|---|---------------|----------|-----------|
| 1 | `backend/src/routes/taskRoutes.ts:281` | handler HTTP `POST /planner/analyze/:issueNumber` (handler em `:276`) — botão manual "analisar" | **SIM** — `await` prende a requisição HTTP até o LLM responder |
| 2 | `backend/src/services/taskRunnerService.ts:893` | callback do `execChain` dentro de `scheduleExec` (cadeia encadeada em `:888`) — **este é o worker** | SIM (`await`), porém já **serializado** pela cadeia (1 por vez) |
| 3 | `backend/src/services/taskPlannerService.ts:329` | auto-chamada recursiva dentro de `reevaluateWaiting()` (`:313`), com `{ noCache: true }` | SIM (`await` em loop `for…of`, até `PLANNER_REEVAL_MAX=20`) |

### 5.2 Testes (não são call-sites de produção — só para cobertura da refatoração)
- `backend/src/__tests__/services/taskPlannerService.test.ts:93, 121, 122, 130,
  131, 137, 138, 144, 146` (exercitam `analyzeTask` + cache).
- Mocks do serviço em `taskRunnerService.queue.test.ts:41` e
  `taskRunnerService.gate.test.ts:19` (`taskPlannerService: { analyzeTask: vi.fn(), … }`).

> **Observação importante:** `planWithLLM()` (`taskRunnerService.ts:3222`) é uma
> chamada de LLM **distinta** (ordenação da fila) e **não** passa por
> `analyzeTask`. Ela chama `aiService.generateReply` **diretamente**
> (`taskRunnerService.ts:3256`), **bypassando** `aiJobService.runAndWait` — ver §6.

---

## 6. Infraestrutura de fila/concorrência existente (NÃO reinventar)

- **Nenhuma** lib externa de fila (Bull, BullMQ, agenda, p-queue, redis, ioredis,
  kue, fastq) em `package.json`/`backend/package.json` — confirmado por leitura.
- **Primitivas existentes (já usadas pelo Planner):**
  - **`execChain` + `pendingExecs`** (`taskRunnerService.ts:832-833`): serializa
    execuções 1-por-vez — é a "fila" efetiva do TaskRunner.
  - **`withWorktreeLock`** (`taskRunnerService.ts:849`): mutex para toda operação
    que toca o worktree/opencode compartilhado.
  - **`aiJobService`** (`backend/src/services/aiJobService.ts`): fila genérica de
    jobs LLM, `MAX_CONCURRENT = 3` (`:28`), com `enqueue()` (fire-and-forget,
    retorna `jobId`) e **`runAndWait(fn, label)`** (`:78`). **O Planner já roteia
    sua chamada de LLM por aqui** (`taskPlannerService.ts:268`, dentro de
    `queryLLM`). **Não reinventar** — é o throttle natural do LLM.
    - **Porém (nuance crítica p/ o throttle do Planner):** o `aiJobService` cobre
      **APENAS a chamada LLM**. O `analyzeTask` dispara, **antes** do LLM, **dezenas
      de subprocessos `gh`** que **não** passam pelo `aiJobService`:
      `listOpenPRs()` (`taskPlannerService.ts:152`: 1 `gh pr list` + 1 `gh pr diff`
      por PR aberto, até 30) e `getFileContextFromMain()` (`:183`: 1 `gh api` por
      arquivo citado na issue, até 10). Esses batem direto na API do GitHub
      (rate-limit) e somam dezenas de spawns. Logo, limitar só o LLM **não**
      satura a proteção desejada — é preciso limitar o **fluxo inteiro**
      (gh + LLM). Esse gap motivou o semáforo module-level de §7.
  - **`llmQuotaState`** (import em `taskRunnerService.ts:12`):
    `isQuotaExhausted`/`markQuotaExhausted`/`clearQuotaExhausted`/`isQuotaError`/
    `quotaStatus` — segura a fila durante 429/indisponibilidade da API.
  - **`plannerCache`** (`taskPlannerService.ts:103`): memoização de decisões
    (reduz chamadas de LLM; TTL 1h, invalidada por hash do corpo).
  - **Hold de pico:** `isPeakHold()` (`taskRunnerService.ts:1046`) +
    `TASKRUNNER_PEAK_*` — atrasa despacho na janela de billing 3x.
- **Gap remanescente (não coberto por este PR):** `planWithLLM()`
  (`taskRunnerService.ts:3256`) chama `aiService.generateReply` **diretamente**,
  sem passar pelo `aiJobService` nem pelo throttle do §7 — é outra chamada de LLM
  (ordenação da fila). Se o epic #1113 precisar cobri-la, normalizar envolvendo-a
  em `aiJobService.runAndWait`.

---

## 7. Solução implementada neste PR (síntese do spike)

Diante do mapeamento, a refatoração de throttle foi implementada como um
**semáforo module-level dentro de `analyzeTask`** (ponto único de estrangulamento)
— em vez de mexer em cada call-site ou introduzir Bull/redis.

### 7.1 Mecanismo
- Arquivo: `backend/src/services/taskPlannerService.ts` (após `invalidatePlannerCache`).
- Variáveis module-level: `plannerMaxConcurrent` (default
  `process.env.PLANNER_MAX_CONCURRENT || 1`), `plannerActive`, `plannerWaiters[]`.
- Helpers `acquirePlannerSlot()`/`releasePlannerSlot()` com **transferência de
  slot** (o release despacha o próximo waiter sem re-incrementar `plannerActive`,
  respeitando o limite N).
- Exports p/ teste/config: `setPlannerMaxConcurrent(n)` e `resetPlannerThrottle()`.
- `analyzeTask` chama `await acquirePlannerSlot()` **após** o cache-check e
  `releasePlannerSlot()` num **`finally`** (libera mesmo se `gh`/LLM lançarem).

### 7.2 Por que cobre TODOS os call-sites por construção
`analyzeTask` é o gargalo comum aos 3 call-sites de produção (§5). Limitá-lo
limita todo o fluxo caro (gh + LLM) independentemente do caller — inclusive o
handler HTTP (`taskRoutes.ts:281`) que roda **fora** do `execChain`. Não foi
necessário tocar `taskRunnerService.ts` nem `taskRoutes.ts`.

### 7.3 Cache hit **não** adquire slot
O cache-check retorna **antes** do `acquirePlannerSlot()`. Decisões baratas e
determinísticas continuam imediatas, mesmo com todos os slots ocupados
(confirmado por teste: 2 calls de LLM + `maxActive===1` quando a 3ª é cache hit).

### 7.4 Complementar, não redundante, ao `aiJobService`
- `aiJobService` (MAX=3): protege o **provedor LLM** (max 3 LLM globais).
- Throttle do Planner (default 1): protege **gh/GitHub API** (dezenas de spawns
  por analyzeTask) **e** reduz contenção planner↔chat pelos slots do aiJobService.

### 7.5 Sem deadlock
`reevaluateWaiting` chama `analyzeTask` em `for…of` **sequencial** (await), nunca
concorrente; `analyzeTask` jamais re-entra em si mesmo. Logo o default N=1 não
produz self-deadlock.

### 7.6 Testes (`backend/src/__tests__/services/taskPlannerService.test.ts`)
Novo suite "throttle de concorrência (#1117 / Epic #1113)", preservando 100% dos
casos pré-existentes:
- serializa com `plannerMaxConcurrent=1` (`maxActive===1`);
- permite até N com `plannerMaxConcurrent=N` (`maxActive===2`);
- cache hit não adquire slot (retorna imediato, 0 LLM extra);
- **libera slot no `catch`** (analyzeTask que lança não vaza slot → sem deadlock);
- mantém contrato de `PlannerDecision` sob throttle.

---

## 8. Arquivos candidatos a modificar (próximos sub-tasks)

Consolidado (substitui as estimativas da issue — `models/task.ts` e
`execChain.ts` **não existem**; os reais são):

| Arquivo | Estado neste PR | Próximos passos (Epic #1113) |
|---------|-----------------|------------------------------|
| `backend/src/services/taskPlannerService.ts` | **MODIFICADO** (semáforo §7) | se default 1 for muito conservador, subir `PLANNER_MAX_CONCURRENT` |
| `backend/src/__tests__/services/taskPlannerService.test.ts` | **MODIFICADO** (novo suite) | manter ao mudar o contrato |
| `backend/src/routes/taskRoutes.ts` | inalterado (throttle cobre via analyzeTask) | opcional: tornar `POST /planner/analyze` assíncrono (job) p/ não prender a req HTTP |
| `backend/src/services/taskRunnerService.ts` | inalterado | normalizar `planWithLLM` (`:3222`) p/ entrar no `aiJobService` (gap §6) |
| `backend/src/services/aiJobService.ts` | inalterado (reutilizado) | — |

---

## 9. Resumo executivo

- `redo` (`redoTask` em `taskRunnerService.ts:2837`) e a ingestão (`syncTasks`/
  `pollSync`) **não chamam `analyzeTask` diretamente**; ambos alcancam o Planner
  pelo **worker do `execChain`** em `taskRunnerService.ts:893`.
- Há **3 call-sites de produção** de `analyzeTask`: o handler HTTP manual
  (`taskRoutes.ts:281`, o único fora da cadeia), o worker (`taskRunnerService.ts:893`)
  e o re-avaliador (`taskPlannerService.ts:329`).
- O `execChain` é um `Promise<void>` privado (`taskRunnerService.ts:833`)
  serializado por append de `.then` em `scheduleExec`; `getQueuedTasks()`
  (`:3215`) alimenta `autoPlayNext()` (`:1053`).
- O "plan" persiste só como `task.queuePriority` + `task.planReason`
  (`taskRunnerService.ts:266-267`); a decisão completa fica em cache in-memory.
- **Já existe** throttle de LLM (`aiJobService.runAndWait`, `MAX_CONCURRENT=3`),
  já usado pelo Planner (`taskPlannerService.ts:268`) — **reaproveitado**, sem
  Bull/redis. **Mas** ele cobre só o LLM; os subprocessos `gh` pré-LLM ficavam
  de fora.
- **Solução entregue:** semáforo module-level em `analyzeTask` (§7) que limita o
  fluxo caro INTEIRO (gh + LLM) a `PLANNER_MAX_CONCURRENT` (default 1), cobrindo
  os 3 call-sites por construção, com cache hit e `finally` garantindo
  immediatismo e ausência de deadlock.
