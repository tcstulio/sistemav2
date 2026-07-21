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
}

class SlotManager {
    /** Slot-1 = o worktree compartilhado de sempre. Path idêntico à antiga const WT_ROOT. */
    readonly slot1: Slot;

    constructor(repoRoot: string) {
        this.slot1 = {
            id: 1,
            root: path.resolve(repoRoot, '..', 'sistemav2-taskrunner-wt'),
            dataDir: null, // slot-1 herda o XDG default do opencode (comportamento atual)
        };
    }

    /** Slots disponíveis. Com o clamp em 1, é sempre só o slot-1. */
    slots(): Slot[] {
        return [this.slot1];
    }

    /**
     * Máximo de coders em paralelo. HARD-CLAMPADO em 1 até a Fase 2.1.e provisionar o slot-2
     * (clone + XDG + npm ci + guard do GC). Enquanto for 1, todo o TaskRunner roda serial e
     * byte-idêntico ao de hoje. NÃO desclampe sem a provisão do slot-2 (corrompe git).
     */
    maxParallelExec(): number {
        return 1;
    }
}

// REPO_ROOT calculado igual ao de taskRunnerService.ts (mesmo diretório: backend/src/services →
// ../../../ = raiz do repo), garantindo que slot1.root == a antiga const WT_ROOT byte a byte.
const REPO_ROOT = path.resolve(__dirname, '../../../');

export const slotManager = new SlotManager(REPO_ROOT);
