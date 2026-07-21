import path from 'path';

/**
 * Fase 2.1 (degrau-2) — fundação SLOT-AWARE do TaskRunner.
 *
 * Um "slot" é um workspace isolado onde um coder (opencode) roda. Hoje existe UM slot — o
 * worktree compartilhado de sempre (`WT_ROOT`). Esta camada existe para, no futuro (Fase 2.2),
 * ligar N slots (clones + XDG_DATA_HOME próprios) e rodar coders em paralelo SEM corromper git.
 *
 * NESTA fase o comportamento é IDÊNTICO ao de hoje: `maxParallelExec()` é HARD-CLAMPADO em 1,
 * então `slots()` sempre devolve só o slot-1 (= o WT_ROOT atual). A refatoração que troca a
 * const global `WT_ROOT` por `slot.root` (parâmetro threaded) é o que torna o resto do código
 * slot-aware; com 1 slot ela é byte-idêntica. Red-team do Fable: a auditoria dos call-sites é o
 * COMPILADOR (a const some; qualquer uso esquecido vira erro de tsc, não bug latente com N=2).
 */
export interface Slot {
    /** id estável do slot (1 = o WT_ROOT legado). */
    id: number;
    /** raiz do workspace (worktree/clone) onde o coder roda — substitui a const global WT_ROOT. */
    root: string;
    /** XDG_DATA_HOME do opencode p/ isolar o opencode.db entre slots. null = herda o default (slot-1). */
    dataDir: string | null;
    /**
     * Como o workspace é provido/atualizado. 'worktree' = o slot-1 legado (git worktree do .git de
     * prod). 'clone' = um clone independente do GitHub (slot-2+), que faz `fetch` no próprio origin e
     * NUNCA roda `worktree add/prune`. O `ensureWorktree` ramifica por este campo. slot-1 = 'worktree'
     * → caminho byte-idêntico ao de hoje.
     */
    kind: 'worktree' | 'clone';
}

class SlotManager {
    /** Slot-1 = o worktree compartilhado de sempre. Path idêntico à antiga const WT_ROOT. */
    readonly slot1: Slot;

    /**
     * Slot-2 = clone independente, provisionado sob demanda pelo slotProvisioner (Fase 2.1.e).
     * null = não provisionado (estado atual). Só é populado quando a provisão + oráculos passam;
     * qualquer falha o mantém null → `slots()` devolve só o slot-1 → clamp efetivo = 1.
     */
    private slot2: Slot | null = null;

    constructor(repoRoot: string) {
        this.slot1 = {
            id: 1,
            root: path.resolve(repoRoot, '..', 'sistemav2-taskrunner-wt'),
            dataDir: null, // slot-1 herda o XDG default do opencode (comportamento atual)
            kind: 'worktree',
        };
    }

    /**
     * Registra o slot-2 já provisionado e verificado. Chamado só pelo slotProvisioner após TODA a
     * provisão + oráculos (clone íntegro, origin ≠ path local, auth seedada, tsc verde). Idempotente:
     * re-registrar sobrescreve. Enquanto o env `TASKRUNNER_MAX_PARALLEL` for o default (1), registrar
     * é comportamentalmente inerte (maxParallelExec segue devolvendo 1).
     */
    registerSlot2(slot: Slot): void {
        this.slot2 = slot;
    }

    /** Remove o slot-2 de `slots()` (ex.: O-boot detectou o clone inválido → re-provisionar). */
    unregisterSlot2(): void {
        this.slot2 = null;
    }

    /** Slots disponíveis. Sem slot-2 provisionado, é só o slot-1 (comportamento atual). */
    slots(): Slot[] {
        return this.slot2 ? [this.slot1, this.slot2] : [this.slot1];
    }

    /**
     * Máximo de coders em paralelo. Devolve N>1 SOMENTE quando (a) há N slots provisionados E
     * (b) ops setou `TASKRUNNER_MAX_PARALLEL=N` explicitamente. Com o env default (1) OU com só o
     * slot-1 provisionado, devolve 1 → todo o TaskRunner roda serial e byte-idêntico ao de hoje.
     * O `Number(...) || 1` neutraliza env vazio/NaN/0. NÃO setar TASKRUNNER_MAX_PARALLEL=2 sem o
     * slot-2 provisionado E os pré-requisitos do flip (call-sites de slot, lock central) resolvidos.
     */
    maxParallelExec(): number {
        const envCap = Number(process.env.TASKRUNNER_MAX_PARALLEL) || 1;
        return Math.max(1, Math.min(envCap, this.slots().length));
    }
}

// REPO_ROOT calculado igual ao de taskRunnerService.ts (mesmo diretório: backend/src/services →
// ../../../ = raiz do repo), garantindo que slot1.root == a antiga const WT_ROOT byte a byte.
const REPO_ROOT = path.resolve(__dirname, '../../../');

/**
 * Paths do slot-2 (siblings de prod, sem espaço). SLOT2_XDG usa forward slashes de propósito:
 * o valor viaja como env var pelo `bash -lc` do runOpencode e forward-slash é válido na Win32 API
 * e imune ao path-mangling do MSYS2. No Unix (testes/CI) o replace é no-op.
 */
export const SLOT2_ROOT = path.resolve(REPO_ROOT, '..', 'sistemav2-taskrunner-slot2');
export const SLOT2_XDG = path.resolve(REPO_ROOT, '..', 'sistemav2-taskrunner-slot2-xdg').replace(/\\/g, '/');

export const slotManager = new SlotManager(REPO_ROOT);
