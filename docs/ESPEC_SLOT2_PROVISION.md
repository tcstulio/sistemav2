# ESPEC — Provisão do slot-2 do TaskRunner (item 2 do #1661)

> Red-teamada pelo Fable contra o código real (2026-07-21). Fundação #1668 já mergeada.
> Divisão: 3 PRs byte-seguros (todos inertes sem env flag) + passos de ops.

## Fatos verificados (código + máquina, não memória)

| Fato | Evidência |
|---|---|
| `Slot = { id, root, dataDir }`, slot1.root = `C:\Projetos\sistemav2-taskrunner-wt`, `dataDir: null` | `slotManager.ts:16-35` |
| `maxParallelExec()` retorna `1` hard-coded | `slotManager.ts:47-49` |
| `runOpencode` spawna `git-bash -lc <cmd>` herdando `process.env` sem override — sem plumbing de XDG hoje | `runOpencode.ts:78-83` |
| `slot.dataDir` existe no shape mas nunca é lido | grep `dataDir` |
| Provisão git do ensureWorktree: `fetch origin main` + `worktree prune`/`add --force` (cwd=REPO_ROOT) | `taskRunnerService.ts:2159,2178-2179` |
| Push do coder: `git push origin <branch> --force` com `cwd: slot.root` | `taskRunnerService.ts:3163,4289` |
| Todo `gh` passa `--repo REPO` explícito → API independe do remote/cwd | `taskRunnerService.ts:1120,3185,...` |
| Deps: usa **`npm install`** de propósito (npm ci quebrou c/ lockfile drift — lição #1379) + marker `.tr-installed` | `taskRunnerService.ts:2207-2229` |
| `cleanSnapshotLockFor` hardcoda `os.homedir()/.local/share/opencode/snapshot` | `taskRunnerService.ts:1848` |
| Data dir do opencode: `auth.json`(400B)+`account.json`+**`opencode.db`=5.2GB**+WAL+snapshot/+storage/ | `ls ~/.local/share/opencode` |
| `XDG_DATA_HOME` não setado no ambiente | `env` |
| `.git` de prod = **41 MB**; origin = `https://github.com/tcstulio/sistemav2.git` | `du`, `git remote get-url` |
| **Disco C: 96% cheio — 11 GB livres** (guard do robô exige 3 GB) | `df -h /c` |
| gh usa `gh auth git-credential` global → clone/push de qualquer dir autentica | git config global |
| GC de worktrees varre só `.claude/worktrees`; `protectedPaths=[REPO_ROOT,WT_ROOT]` | `gc-worktrees.ts:70-73,319` |
| Call-sites de scheduleExec ainda hardcodam `slotManager.slot1` (fix/redo/feedback) | `taskRunnerService.ts:1206,3460,3492,4063,4428,4475` |
| Judge Visual roda opencode em REPO_ROOT sob lock do slot-1, XDG default | `taskRunnerService.ts:3742-3753` |

## Decisões do red-team

- **R1. Clone de GitHub direto (nem worktree, nem `--local`).** Worktree quebra por namespace único de branch (`fix-N` reusada nos fluxos de fix/redo → "already checked out") + locks compartilhados do `.git` de prod. `--local` traz push-em-prod + hardlink/GC. Clone de `https://github.com/tcstulio/sistemav2.git`: origin correto por construção, sem hardlink. Custo: ~41MB one-time. Fallback (rede fora): `git clone --no-hardlinks C:\Projetos\sistemav2 <slot2>` + set-url + O2 obrigatório.
- **R2. Origin resolvido por construção + oráculo O2 na provisão E em todo boot** (defesa contra "conserto" manual futuro do remote).
- **R3. XDG por slot + SEED de auth.** Copiar `auth.json`+`account.json` p/ `<XDG2>/opencode/` (NUNCA o db de 5.2GB). `cleanSnapshotLockFor` vira dataDir-aware. `runOpencode` ganha `opts.env` mesclado no spawn; slot-1 (`dataDir=null`) passa `undefined` → spawn byte-idêntico. Valor com forward slashes.
- **R4. `npm install` real por slot (nem ci, nem junction).** Junction rejeitado (hazard já materializado). Disco: gate ≥10GB livre senão aborta.
- **R5. Smoke = 2× `tsc --noEmit` (backend + root), exit 0 obrigatório.**
- **R6. GC dissolvido** (sem hardlink no clone-de-GitHub). +1 linha defensiva: `SLOT2_ROOT` em `protectedPaths`.
- **R7. Autoridade do "pronto" = verificação de boot (O-boot), não flag.** Receipt `backend/data/slot2-provision.json` é só telemetria. Teardown junction-safe + re-provisiona.
- **R8. Windows**: paths sem espaço, git via execFile (array de args), env pelo spawn, teardown lstat+unlink reparse points primeiro.

## Onde mora o código

| Peça | Arquivo | Mudança |
|---|---|---|
| Shape + registro + clamp | `slotManager.ts` | `Slot.kind:'worktree'\|'clone'`; `slot2` privado; `registerSlot2/unregisterSlot2`; `slots()=[slot1,...slot2?]`; `maxParallelExec()=max(1,min(TASKRUNNER_MAX_PARALLEL\|\|1, slots().length))`; consts `SLOT2_ROOT`/`SLOT2_XDG` |
| Provisionador | **novo** `slotProvisioner.ts` | plano puro + executor com exec injetável; `ensureSlot2()` no boot |
| Boot hook | `taskRunnerService.ts` (~496) | `if(TASKRUNNER_SLOT2==='1') setImmediate(()=>slotProvisioner.ensureSlot2().catch(log.warn))` |
| Env do opencode | `runOpencode.ts` | `opts.env` mesclado no spawn |
| Call-site do env | `runOpencodeIsolated` (2062,2081) | `slot.dataDir ? {XDG_DATA_HOME:slot.dataDir} : undefined` |
| Snapshot lock slot-aware | `taskRunnerService.ts:1846-1866` | raiz do snapshot derivada de `slot.dataDir` (slot-1 null → idêntico) |
| ensureWorktree clone-mode | `taskRunnerService.ts:2147-2230` | ramo `kind==='clone'` |
| GC protectedPaths | `gc-worktrees.ts:319` | `+ SLOT2_ROOT` |

## Sequência da provisão (`ensureSlot2`)

Consts: `PROD=C:\Projetos\sistemav2`, `ROOT2=C:\Projetos\sistemav2-taskrunner-slot2`, `XDG2=C:/Projetos/sistemav2-taskrunner-slot2-xdg`, `HOME_OC=%USERPROFILE%\.local\share\opencode`.

```
P0 Gate:  TASKRUNNER_SLOT2 !== '1' → return (no-op)
P1 Gate:  disco livre em ROOT2 >= 10 GB → senão log.error + return
P2 Verify: ROOT2 existe → O-boot. Passou → P6. Falhou → teardown junction-safe → P3
P3 originUrl = git -C PROD remote get-url origin; ASSERT ^https://github\.com/|^git@github\.com: senão ABORT
P4 git clone <originUrl> <ROOT2>  (timeout 600s)
P5 O1+O2 → falhou → teardown + ABORT (próximo boot re-tenta)
P6 XDG: mkdir <XDG2>/opencode; copy auth.json (ausente→ABORT) + account.json (ausente→warn); NUNCA o db
P7 Deps: ensureDepsAt(ROOT2) + ensureDepsAt(ROOT2\backend) (npm install --no-audit --no-fund + marker)
P8 Smoke: npx tsc --noEmit -p backend/tsconfig.json + -p tsconfig.json (cwd ROOT2, 240s cada) → exit 0
P9 Receipt: backend/data/slot2-provision.json {provisionedAt,originUrl,smokePassedAt,sizes,oracles}
P10 Registro: slotManager.registerSlot2({id:2,root:ROOT2,dataDir:XDG2,kind:'clone'})
```
Qualquer ABORT deixa o sistema como hoje (slot-2 fora de `slots()`, clamp efetivo 1).

## ensureWorktree clone-mode (runtime, pós-provisão)

Ramificar por `slot.kind`:
- `'worktree'` (slot-1): **byte-idêntico ao atual**.
- `'clone'` (slot-2): fetch com `cwd:slot.root`; validade = `.git` dir + `rev-parse --is-inside-work-tree` + O2. Inválido → `unregisterSlot2()` + `ensureSlot2()` async + `throw`. reset/clean/checkout/deps idênticos (já usam cwd:slot.root). **NUNCA** `worktree prune`/`add` no clone.

## maxParallelExec()→2 está FORA deste item

Devolve 2 só quando (a) slot-2 provisionado+registrado E (b) `TASKRUNNER_MAX_PARALLEL=2`. Pré-requisitos do FLIP (outro item): (1) call-sites hardcoded `slotManager.slot1` em fix/redo → eleição/afinidade; (2) lock central p/ Judge Visual/auto-merge que tocam REPO_ROOT; (3) canário verde; (4) colisão de portas de preview (`issueNumber % 10`).

## Oráculos

| # | Prova | Comando | Pass |
|---|---|---|---|
| O1 | Clone íntegro | `git -C <ROOT2> fsck --no-dangling` + `rev-parse origin/main` | exit 0 |
| O2 | Push jamais atinge prod | `remote get-url origin`==prod E casa `^https://github\.com/`; `remote -v` sem `C:`/`/c/` | provisão E boot |
| O2b | Auth de push sem efeito | `git -C <ROOT2> push --dry-run origin HEAD:refs/heads/tr-slot2-smoke` | exit 0 |
| O3 | XDG atravessa `bash -lc` | spawn `bash -lc 'echo "$XDG_DATA_HOME"'` com env | stdout==XDG2 |
| O4 | Auth seedada | `test -s <XDG2>/opencode/auth.json` | exit 0 |
| O5 | Sem junction em node_modules | PS `(Get-Item ...node_modules).LinkType` vazio | não ReparsePoint |
| O6 | Coder compila | os 2 tsc do P8 | exit 0 |
| O7 | Isolamento do db | canário | db novo no XDG2; db default intocado |
| O8 | GC não toca slot-2 | `npx tsx scripts/gc-worktrees.ts` | ROOT2 fora de removidos |
| O-boot | Re-verificação rápida (autoridade) | `.git` dir + is-inside-work-tree + O2 + O4 + `.tr-installed` (root+backend) | verde→registra |

## Canário dirigido (operador, janela ociosa, ANTES do flip)

```bash
export XDG_DATA_HOME='C:/Projetos/sistemav2-taskrunner-slot2-xdg'
cd /c/Projetos/sistemav2-taskrunner-slot2
opencode run "responda apenas OK"
ls -la "$XDG_DATA_HOME/opencode/opencode.db"      # existe e pequeno (novo)
stat -c %Y ~/.local/share/opencode/opencode.db    # mtime do db default NÃO avançou
# depois: 1 task normal no slot-1 → confirma que ainda autentica (seed não invalidou token)
```

## Divisão em PRs (todos mergeáveis, clamp efetivo = 1)

- **PR-1 — shape + plumbing (byte-idêntico)**: `Slot.kind`; `registerSlot2/slots()/maxParallelExec` env-gated (default 1); `runOpencode` `opts.env` (slot-1→undefined); `cleanSnapshotLockFor` dataDir-aware (slot-1 null→idêntico). Testes: fórmula do clamp, merge de env no spawn, snapshot path por dataDir.
- **PR-2 — provisionador (inerte sem env)**: `slotProvisioner.ts` (plano puro + executor injetável), boot hook gated por `TASKRUNNER_SLOT2` (default OFF), receipt, O-boot, teardown junction-safe, GC protectedPaths. Testes: plano puro, idempotência, O2 rejeitando path local.
- **PR-3 — runtime clone-mode (caminho morto até slot-2 eleito)**: ramo `kind==='clone'` no ensureWorktree, extração de `ensureDepsAt`. Testes: mock de git provando que clone-mode nunca roda `worktree add` + fetch com cwd=slot.root.
- **Ops (sem PR)**: `TASKRUNNER_SLOT2=1` → observar provisão → canário + O7/O8 → **parar**. `TASKRUNNER_MAX_PARALLEL=2` pertence ao item do flip.

Sequência: PR-1 → PR-2 → PR-3 (PR-3 depende do `kind` de PR-1; PR-2⊥PR-3).

## Riscos aceitos/vigiados

1. **Disco (nº 1 real)**: 11GB livres / gate ≥10GB → ops PRECISA liberar disco antes (o `opencode.db` de 5.2GB é o alvo). Gate falha ruidosamente.
2. Rotação de token no `auth.json` compartilhado entre 2 data dirs — canário cobre; correção seria auth por provider-key estática.
3. Cold-start do opencode no slot-2 (db novo → re-index no 1º run) — sem ação.
4. CPU: 2× tsc/vitest simultâneos pós-flip podem estourar timeouts de 240s — item do flip.
