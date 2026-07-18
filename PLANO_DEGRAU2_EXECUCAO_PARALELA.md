# Degrau 2 — Execução de código em PARALELO (N coders simultâneos)

## Objetivo
Hoje o TaskRunner roda **1 coder por vez** (serial). Queremos N coders ao mesmo tempo, cada um numa
sub-task de área diferente (a decomposição já corta por área p/ não colidir), reduzindo o tempo de
esvaziar o backlog e de completar uma épica. Escopo: SÓ trabalho de **código** (issue→coder→PR). Não
mexe no agente de negócio (cotação etc.), que é outro pipeline.

## A restrição CENTRAL (mapeada no código)
O serial de hoje é sustentado por 4 recursos single-instance (`taskRunnerService.ts`):
1. **1 worktree compartilhado** `WT_ROOT = ../sistemav2-taskrunner-wt` (:34) — todo `git checkout -B` (:2084) toca estado global.
2. **worktreeLock único** (:1235) — serializa executeTask + tryAutoMerge + startPreview + runVisualJudge.
3. **execChain Promise serial** (:1365) + `autoPlayNext` com `pendingExecs>0 → return` (:1656).
4. **opencode projectID GLOBAL por-REPO** (:1682-1683) — **o mais duro**: o opencode agrupa TODOS os
   worktrees do mesmo repositório sob 1 projectID (snapshot + `index.lock` em `~/.local/share/opencode/
   snapshot/<projectID>`). **Dois opencode no mesmo repo colidem** (deadlock de index.lock = causa do #335).
   ⇒ **N git-worktrees do MESMO repo NÃO isolam o opencode.** É o ponto que mata a solução ingênua.

Outros recursos por-task que já são/ficam isolados: branch `fix-<n>` (:1165), PROMPT_FILE (:35, por-WT),
portas de preview `previewPortsFor(issueNumber)` (:3554, já dinâmico por issue). Compartilhados a resolver:
node_modules (junction por-WT), contador `dailyRounds` in-memory (:1791), store `tasks.json` (save atômico).

## Opções de isolamento (o Fable escolhe/refuta)

### (A) Pool de N CLONES isolados (recomendada a priori)
Cada "slot" de execução = um **clone git separado** do repo (`.git` próprio) em pasta própria
(`taskrunner-slot-1..N`), com seu **próprio node_modules** e sua **própria porta de preview**.
- Por quê resolve o projectID: o projectID do opencode deriva do caminho-raiz do repo → clones em
  caminhos diferentes = **projectIDs diferentes** = snapshots/index.lock separados = SEM colisão #335.
- Slot manager: `Map<slotId, {path, busy}>`; ao despachar, pega slot livre, roda, libera no finally.
- Concorrência = nº de slots (config `maxParallelExec`, default conservador ex.: 2).
- Custo: disco (N× node_modules) + provisão inicial (clone + npm ci por slot, 1× na criação; reusa depois).
- Locks: `worktreeLock` vira `Map<slotId, Promise>` (1 lock por slot). Cuidado: o **Judge Visual roda em
  REPO_ROOT** (:3602-3607) compartilhado → precisa de lock CENTRAL do REPO_ROOT, separado dos locks por-slot.

### (B) N worktrees + isolar o data-dir do opencode por env
Manter git-worktrees (baratos), mas lançar cada opencode com `HOME`/`XDG_DATA_HOME` (ou flag equivalente)
apontando p/ um data-dir próprio → projectID/snapshot isolados sem clonar.
- Mais barato em disco. Risco: DEPENDE de o opencode respeitar esse override (a exploração NÃO confirmou
  que existe `--project-id`/data-dir por invocação). Se não respeitar, não isola → volta ao #335.
- **Pré-requisito de validação: um oráculo executável provando 2 opencode simultâneos no mesmo repo com
  data-dirs distintos NÃO colidem.** Sem essa prova, (B) é inviável.

### (C) Híbrido: serial no git-crítico, paralelo no coder
Rodar os N coders em paralelo (cada um no seu clone/worktree) MAS serializar as fases que tocam o
REPO_ROOT/git-central (Judge Visual, auto-merge) sob um lock central. Na prática é a (A) com os locks
bem separados (por-slot p/ o coder, central p/ merge/visual). Provavelmente é a forma final da (A).

## Guardas e invariantes a preservar (não regredir)
- **Não sobrepor sub-tasks que tocam o MESMO arquivo** (conflito de merge). A decomposição corta por área,
  mas não garante disjunção → precisa de um guard: ou (i) despachar em paralelo só sub-tasks com
  `filesEstimate` disjuntos, ou (ii) aceitar o conflito e resolver no merge (rebase/retry). Definir.
- **Ordem de merge determinística** quando N PRs ficam prontos juntos (o auto-merge já existe; garantir que
  N merges concorrentes na main não se atropelem — provavelmente serializar SÓ o merge).
- **Teto de custo/cota**: N coders = N× burn de LLM. O `dailyRoundBudget` e o peak-hold têm que contar
  o paralelo (hoje `dailyRoundsToday` é global — ok, mas o gate do autoPlay precisa considerar os N em voo).
- **Cleanup robusto**: cada slot precisa de teardown junction-safe (a memória: `.Delete()` na junction ANTES
  de remover; nunca `rm -rf` que segue junction e apaga node_modules real). Órfãos do opencode por-slot.
- **Watchdog/kill por-slot** (hoje o sweep de órfão discrimina por PROMPT_FILE; com N precisa discriminar
  por slot/cwd).
- **Recuperação**: o `checkQueueHealth` reseta a cadeia presa; com N slots, detectar/recuperar por-slot.

## Rollout seguro (proposta)
- Fase 0: `maxParallelExec` config (default **1** = comportamento atual, kill-switch). Nada muda até ligar.
- Fase 1: infra de slot pool (provisão/reuso/teardown) + testes, com maxParallelExec=1 (prova que não regride).
- Fase 2: ligar 2 slots atrás da flag; validar em prod com 2 sub-tasks de áreas disjuntas; medir colisão.
- Fase 3: guard de disjunção de arquivos + serialização do merge/visual; subir o teto gradual.

## ⚠️ VEREDITO FABLE (2026-07-18) — plano CORRIGIDO

**A premissa central estava ERRADA (provada por Fable com o opencode.db real):**
- O projectID do opencode = **identidade do REPO (root-commit)**, NÃO o caminho. Um clone em outro
  caminho/drive cai no **MESMO** projectID (provado: `D:/TulipaProd` sob o mesmo projectID de `C:/Projetos/tulipa-v4`).
- **MAS** a colisão do #335 é por-**CAMINHO**: o snapshot é `snapshot/<projectID>/<sha1(caminho-do-worktree)>/`
  — um bare-git separado por caminho, cada um com seu `index.lock`. Logo **N worktrees do mesmo repo em
  caminhos diferentes JÁ isolam o opencode** (o `cleanSnapshotLockFor` :1750 já discrimina por caminho).
- Evidência natural: sessões concorrentes (dirs diferentes, mesmo projectID) coexistiram e completaram; o
  `opencode.db` global (SQLite WAL) aguentou. Risco residual do DB compartilhado = baixo, mas falta um
  **oráculo dirigido** (2 opencode simultâneos numa janela ociosa — não rodado porque há opencode de PROD vivo).

**Decisão de design:** manter **(A/C) pool de CLONES + lock central**, MAS pelo motivo certo = **isolamento de
GIT** (namespace de branch: worktrees do mesmo repo não podem ter a mesma branch em checkout; contenção de
refs/fetch no .git; slot corrompido = descartável). Custo desprezível (.git do sistemav2 = 32MB; node_modules
N× é igual nas duas opções). (B) worktrees+`XDG_DATA_HOME` por env EXISTE e é trivial, mas desnecessário p/ o
index.lock — guardar como defesa se o oráculo do DB falhar.

**BLOQUEADORES P0 (o plano não listou — e o pior já é bug HOJE):**
1. **`killByImageName('opencode.exe')` = `taskkill /F /T /IM` mata TODO opencode da máquina** (runOpencode.ts:108/167,
   em CADA run). Com N slots, um timeout num slot NUKA os outros (+ Judge Visual + opencode manual/tulipa). **Já é
   bug hoje** — a serialização era a única proteção.
2. **Sweep de órfãos é slot-cego** (needle = PROMPT_FILE, mesmo nome p/ todos os slots; processTree.ts:122-176):
   pre/post-run de um slot mata o coder VIVO do vizinho.
3. **Sampler de CPU/RAM soma TODOS os opencode.exe** e atribui à task corrente (runOpencode.ts:133) → heartbeat/
   telemetria mentem (getRunnerHealth usa cpuMemSamples como heartbeat).

**Outros globais a tratar:** portas de preview mod-10 (colidem); preview PINA o worktree após soltar o lock
(slot não recicla); `git()` cwd=REPO_ROOT + fetch/worktree-add global; namespace de branch compartilhado;
`checkQueueHealth` reseta estado global (vira recovery por-slot); ~/.config/opencode node_modules + autoupdate
concorrentes (setar OPENCODE_DISABLE_AUTOUPDATE); contenção de CPU real (timeouts calibrados SERIAL → medir).

**Correções factuais:** `dailyRounds` in-memory NÃO é problema novo; "node_modules junction por-WT" DESATUALIZADO
(WT do robô tem dirs reais); peak-hold já está certo.

**GUARDAS que faltavam:** claim atômico task+slot no dispatch (senão a mesma issue vai p/ 2 slots = force-push
cruzado); kill/sweep por-slot é PRÉ-REQUISITO; merge-train (2º PR fica BEHIND quando o 1º mergeia → re-rebase
loop sob lock central); disjunção de arquivos = otimização Fase 3 (NÃO bloquear Fase 2 — merge serial+rebase+CI
absorvem); estados do slot (busy/pinned-by-preview/quarantined) + teardown junction-safe por-slot.

**ROLLOUT RECOMENDADO (Fable):**
- **Fase 0:** `maxParallelExec` default 1 (kill-switch).
- **Fase 1a (FAZER PRIMEIRO):** kill-machinery + sweep + sampler POR-SLOT, com maxParallel=1. Refactor testável,
  zero mudança de comportamento, **conserta o bug ATUAL de matar opencode manual/tulipa**, e destrava o resto.
- **Fase 1b:** pool de 2 clones fixos (`taskrunner-slot-1/2`) + rodar o oráculo dirigido (2 opencode simultâneos)
  numa janela ociosa.
- **Fase 2:** ligar 2 slots com merge/visual/preview sob lock central; medir taxa de timeout + SQLITE_BUSY por ~1
  semana antes de 3+.
- **Fase 3:** merge-train + guard de disjunção + teto dinâmico.

## Perguntas ao red-team (Fable) — RESPONDIDAS acima
1. A restrição do projectID do opencode está correta e é REALMENTE por-caminho-de-repo? Clones separados
   garantem projectIDs distintos? (exigir oráculo ou evidência no código/opencode.)
2. (A) vs (B) vs (C): qual tem menos superfície de risco? (B) é viável (opencode isola por env)?
3. O que mais é global e eu NÃO listei? (procurar recursos escondidos: caches, locks, tmp fixos, o Judge
   Visual em REPO_ROOT, o orphan sweep que mata por nome e poderia matar coders de outros slots.)
4. O guard de disjunção de arquivos é necessário na Fase 2 ou dá p/ confiar no corte por área + merge-retry?
5. Menor incremento seguro que já entrega valor (ex.: 2 slots fixos) vs a solução completa (pool dinâmico)?
6. Riscos de custo/cota e de corrupção de git que eu subestimei.
