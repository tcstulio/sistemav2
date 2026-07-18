# Fase 1a — kill / sweep / sampler POR-SLOT (pré-requisito do paralelo)

## Objetivo
Tornar a máquina de kill/recuperação **precisa por-execução** (por PID/needle), sem depender da
serialização. Rodar com `maxParallelExec=1` (ZERO mudança de comportamento observável), MAS já
per-slot-capable — e, de brinde, **consertar o bug atual** de o robô matar opencode manual/Tulipa.

## Os 3 pontos que hoje dependem da serialização (código lido)
1. **`killByImageName('opencode.exe')`** = `taskkill /F /T /IM` → mata TODO opencode da máquina.
   - `runOpencode.ts:108` (observador de kill) e `:167` (timeout).
   - `processTree.ts:137` (fallback do `killOpencodeOrphans` quando a enumeração falha E `excludePids` vazio).
2. **Sampler soma TODOS os opencode** (`runOpencode.ts:133`, `listPidsByName('opencode')`) e atribui à task corrente.
3. **Sweep com needle compartilhado** (`taskRunnerService.ts:1697`): needles = `[PROMPT_FILE, VISUAL_JUDGE_MARKER]`;
   `PROMPT_FILE='.taskrunner-prompt.md'` é o MESMO nome p/ todo slot → o CommandLine não distingue slots (o
   cwd não aparece no cmdline). Pre/post-run passam `excludePids=[]` → um sweep de um slot mataria o coder vivo do vizinho.

## Fatos que AJUDAM (já existem)
- `killTree(pid)` usa `taskkill /F /T /PID` → mata a ÁRVORE por PID (bash + opencode neto) SEM enumeração, PRECISO.
  Já é chamado em `:104` e `:164`. **O `killByImageName` é só BACKSTOP** p/ opencode ÓRFÃO (árvore quebrada) ou enum-fail.
- `killOpencodeOrphans('opencode', needles, excludePids)` já discrimina por CommandLine e aceita excludePids.

## Design proposto (a validar/refutar no red-team)

### D1. Registro de execuções vivas (module-level em runOpencode.ts)
`const liveRuns = new Map<number, { bashPid: number; needle: string; cohort: Set<number> }>()` keyed por runId.
- Cada `runOpencode` recebe um `runId` + `needle` único (marcador no comando, ver D4) e registra no início; remove no `finish`.
- `cohort` = PIDs de opencode desta run (para sampler e kill escopado). Calculada por DIFF: `antes=listPidsByName('opencode')`
  no spawn; após breve atraso, `depois − antes − (cohorts de outras runs)` = cohort desta run. (RACE a atacar: 2 runs
  começando juntas.)

### D2. Kill escopado (substitui o `killByImageName` nos 2 sites do runOpencode)
1. `killTree(child.pid)` — SEMPRE (já mata a árvore precisa; é o caminho normal).
2. Backstop (órfão/árvore quebrada):
   - Se `liveRuns.size <= 1`: **manter `killByImageName('opencode.exe')`** (serial, seguro — comportamento atual).
   - Se `>1`: `killOpencodeOrphans('opencode', [thisNeedle], excludePids = union(cohorts+bashPids das OUTRAS runs))`
     — mata só o opencode DESTA run (por needle), protegendo os vizinhos.

### D3. Sampler escopado
Amostrar a `cohort` desta run (não todos os opencode). Com 1 slot, cohort = todos os opencode = comportamento atual.
Se a cohort ainda não foi resolvida, pula a amostra (como hoje pula quando não há opencode).

### D4. Needle por-slot (discriminador único)
Injetar um marcador único no comando do opencode (padrão do `VISUAL_JUDGE_MARKER`): ex. `[[tr-run:<runId>]]` no
texto do prompt-command → o CommandLine passa a distinguir cada run. O sweep passa a usar os needles das runs
VIVAS + os marcadores GENÉRICOS (`.taskrunner-prompt`, `VISUAL_JUDGE_MARKER`) para pegar ÓRFÃOS de runs mortas.

### D5. excludePids nos sweeps do serviço
`sweepOrphanedOpencode` (pre-run/post-run/fallback/ensureWorktree/disk-low) passa a receber `excludePids =`
PIDs vivos de TODAS as runs (cohorts + bashPids do liveRuns). Hoje pre/post passam `[]` → com N slots matariam o vizinho.

## A DECISÃO DIFÍCIL (quero o veredito do Fable)
O `killByImageName` blanket é o que HOJE mata opencode manual/Tulipa (mesmo em serial). Para consertar isso de
verdade, o fallback de enum-fail (`processTree.ts:136-139`) NÃO poderia mais fazer `/IM` cego. Alternativas:
- **(i)** Nunca `/IM` cego: se a enumeração falhar, confiar no `killTree(child.pid)` (preciso) + forceKillTimer
  settle, e aceitar que um opencode ÓRFÃO (árvore quebrada) possa sobreviver até o PRÓXIMO sweep por-needle.
  Risco: órfão segurando index.lock do snapshot (a 2ª fase do #335) por uma janela.
- **(ii)** Manter `/IM` só quando `liveRuns.size<=1` (serial) — conserta o paralelo mas NÃO o bug do manual em serial.
- **(iii)** `/IM` cego só no BOOT (quando sabidamente não há run legítima nossa nem — idealmente — manual).
Qual o trade-off certo entre "matar opencode manual do usuário" e "deixar órfão segurando lock (#335)"?

## Riscos a atacar no red-team
1. Race da cohort (2 runs concorrentes atribuindo o mesmo opencode). Em serial não ocorre — mas o design precisa ser correto p/ Fase 2.
2. opencode gera netos (tsc/vitest/MCP) — a cohort de kill deve pegar a subárvore (killTree já pega); o sampler só conta opencode.exe (como hoje — aceitável?).
3. Enum-fail: o design degrada com segurança? (D2 backstop e a decisão difícil acima.)
4. Boot/recovery: com per-slot needle, o sweep de boot ainda pega órfãos de TODOS os slots de um restart? (needles genéricos + por-run.)
5. Há algum caller de `killByImageName`/sweep que eu não cobri? (grep completo.)
6. Menor mudança que já entrega "não matar opencode manual" + "sweep não mata vizinho", sem regressar o #335.

## Escopo do que MUDA (Fase 1a)
`runOpencode.ts` (registro/cohort/kill escopado/sampler escopado/runId+needle), `processTree.ts` (talvez ajustar o
fallback do killOpencodeOrphans), `taskRunnerService.ts` (passar excludePids vivos aos sweeps; needle por-run no comando;
manter PROMPT_FILE compat). `maxParallelExec` NÃO entra ainda (Fase 2). Testes: cohort/kill escopado/sweep-com-excludePids.
