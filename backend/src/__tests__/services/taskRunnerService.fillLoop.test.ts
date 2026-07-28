import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocks (hoisted) — mesmo harness de claimAtomic.test.ts ===
vi.mock('child_process', () => ({ execFile: vi.fn(), exec: vi.fn(), spawn: vi.fn() }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/aiService', () => ({ aiService: { generateReply: vi.fn() } }));
vi.mock('../../services/aiJobService', () => ({ aiJobService: { runAndWait: vi.fn() } }));
vi.mock('../../utils/previewPorts', () => ({ previewPortsFor: vi.fn(() => ({ frontendPort: 5999, backendPort: 6000 })) }));
vi.mock('../../services/screenshotService', () => ({ screenshotService: { captureForTask: vi.fn() } }));
vi.mock('../../services/taskUsageTracker', () => ({ recordUsage: vi.fn(), getUsageForTask: vi.fn(() => null) }));
vi.mock('../../utils/processTree', () => ({
    killTree: vi.fn(async () => ({ ok: true })), isAlive: vi.fn(() => false),
    killOpencodeOrphans: vi.fn(async () => ({ killed: [], errors: [], confirmedGone: true })),
}));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
vi.mock('../../services/taskPlannerService', () => ({
    taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) },
}));
vi.mock('../../services/claudeCliService', () => ({
    claudeCliService: { available: vi.fn(async () => false), runText: vi.fn(), runCode: vi.fn() },
}));
vi.mock('../../services/llmQuotaState', () => ({
    isQuotaError: vi.fn(() => false), isQuotaExhausted: vi.fn(() => false),
    markQuotaExhausted: vi.fn(), clearQuotaExhausted: vi.fn(),
    quotaStatus: vi.fn(() => ({ exhausted: false, since: null, reason: '' })),
}));

import { slotManager, Slot } from '../../services/slotManager';
import { taskRunnerService } from '../../services/taskRunnerService';

const svc = taskRunnerService as any;

// Slot-2 fake registrado no slotManager real (par do slot-1). afterEach faz unregister.
const FAKE_SLOT2: Slot = { id: 2, root: '/tmp/slot2', dataDir: '/tmp/slot2-xdg', kind: 'clone' };

// Simula o CLAIM SÍNCRONO REAL do startTask→scheduleExec: pendingExecs++, execInFlight.set e
// slotQueueDepth.set(slot.id, +1) — tudo síncrono ANTES de qualquer await (é o que a I5 exige).
function fakeSyncClaim() {
    return vi.fn((n: number, opts: { slot: Slot }) => {
        svc.pendingExecs++;
        svc.execInFlight.set(n, 1);
        svc.slotQueueDepth.set(opts.slot.id, (svc.slotQueueDepth.get(opts.slot.id) ?? 0) + 1);
        return Promise.resolve();
    });
}

describe('autoPlayNext — fill-loop síncrono (Degrau 2 FLIP PR-E)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        slotManager.registerSlot2(FAKE_SLOT2); // slots() = [slot1, slot2]
        svc.getAutomationConfig = () => ({ autoPlay: true, dailyRoundBudget: 200 });
        svc.isPeakHold = () => false;
        svc.dailyRoundsToday = () => 0;
        svc.pendingExecs = 0;
        svc.execInFlight = new Map();
        svc.slotQueueDepth = new Map(); // freeSlot() lê isto
        svc.startTask = fakeSyncClaim();
    });
    afterEach(() => {
        slotManager.unregisterSlot2();
        vi.restoreAllMocks();
    });

    it('1) fill N=2: UMA chamada despacha EXATAMENTE 2 — issues e slots DISTINTOS', () => {
        vi.spyOn(slotManager, 'maxParallelExec').mockReturnValue(2);
        // 3 tasks na fila, 2 slots livres.
        svc.getQueuedTasks = () => [{ issueNumber: 100 }, { issueNumber: 101 }, { issueNumber: 102 }];

        svc.autoPlayNext(); // UMA só chamada

        expect(svc.startTask).toHaveBeenCalledTimes(2);
        const issues = svc.startTask.mock.calls.map((c: any) => c[0]);
        const slots = svc.startTask.mock.calls.map((c: any) => c[1].slot.id);
        expect(issues).toEqual([100, 101]);       // issues DISTINTAS (não re-elege a em voo)
        expect(new Set(issues).size).toBe(2);
        expect(slots.sort()).toEqual([1, 2]);      // slots DISTINTOS (slot.id 1 e 2)
        expect(new Set(slots).size).toBe(2);
    });

    it('2) serial-sentinela (byte-idêntico): maxParallelExec=1 → despacha EXATAMENTE 1 e para', () => {
        vi.spyOn(slotManager, 'maxParallelExec').mockReturnValue(1);
        svc.getQueuedTasks = () => [{ issueNumber: 100 }, { issueNumber: 101 }, { issueNumber: 102 }];

        svc.autoPlayNext();

        expect(svc.startTask).toHaveBeenCalledTimes(1);
        expect(svc.startTask).toHaveBeenCalledWith(100, expect.objectContaining({ slot: expect.objectContaining({ id: 1 }) }));
    });

    it('3) não re-elege slot ocupado: slot-1 já com depth>0 → despacha no slot-2', () => {
        vi.spyOn(slotManager, 'maxParallelExec').mockReturnValue(2);
        svc.slotQueueDepth = new Map([[1, 1]]); // slot-1 ocupado (depth>0)
        svc.pendingExecs = 1;                    // reflete a exec já em voo no slot-1
        svc.getQueuedTasks = () => [{ issueNumber: 200 }];

        svc.autoPlayNext();

        expect(svc.startTask).toHaveBeenCalledTimes(1);
        expect(svc.startTask).toHaveBeenCalledWith(200, expect.objectContaining({ slot: expect.objectContaining({ id: 2 }) }));
    });

    it('4) não re-elege issue em voo: issue já em execInFlight não é redespachada', () => {
        vi.spyOn(slotManager, 'maxParallelExec').mockReturnValue(2);
        svc.execInFlight = new Map([[100, 1]]); // 100 já em voo
        svc.pendingExecs = 1;
        svc.slotQueueDepth = new Map([[1, 1]]); // ocupa o slot-1 (onde 100 roda)
        // getQueuedTasks ainda devolve 100 (janela de corrida) + a nova 101.
        svc.getQueuedTasks = () => [{ issueNumber: 100 }, { issueNumber: 101 }];

        svc.autoPlayNext();

        expect(svc.startTask).toHaveBeenCalledTimes(1);
        const issues = svc.startTask.mock.calls.map((c: any) => c[0]);
        expect(issues).toEqual([101]); // 100 pulada (em voo)
    });

    it('5) respeita teto: peak-hold NÃO despacha (guarda de topo preservada)', () => {
        vi.spyOn(slotManager, 'maxParallelExec').mockReturnValue(2);
        svc.isPeakHold = () => true; // guarda de topo
        svc.getQueuedTasks = () => [{ issueNumber: 100 }, { issueNumber: 101 }];

        svc.autoPlayNext();

        expect(svc.startTask).not.toHaveBeenCalled();
    });

    it('5b) respeita teto: dailyRoundBudget estourado NÃO despacha (guarda de topo preservada)', () => {
        vi.spyOn(slotManager, 'maxParallelExec').mockReturnValue(2);
        svc.getAutomationConfig = () => ({ autoPlay: true, dailyRoundBudget: 5 });
        svc.dailyRoundsToday = () => 5; // teto atingido
        svc.getQueuedTasks = () => [{ issueNumber: 100 }, { issueNumber: 101 }];

        svc.autoPlayNext();

        expect(svc.startTask).not.toHaveBeenCalled();
    });
});

describe('withRepoRootLock — usa a chave do slot-1 (Degrau 2 FLIP PR-D)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('withRepoRootLock chama withWorktreeLock com slotManager.slot1 — mesmo no contexto de uma task slotId=2', async () => {
        // Espia withWorktreeLock e prova que o 2º arg (o slot) é o slot-1 (a chave é slot.root),
        // NUNCA o slot da task — mesmo que o chamador esteja tratando uma task com slotId=2.
        const spy = vi.spyOn(svc, 'withWorktreeLock').mockImplementation(
            (_label: any, _slot: any, fn: any) => fn(),
        );

        const result = await svc.withRepoRootLock('visual-judge #999', async () => 'ok');

        expect(result).toBe('ok');
        expect(spy).toHaveBeenCalledTimes(1);
        const passedSlot = spy.mock.calls[0][1];
        expect(passedSlot).toBe(slotManager.slot1);
        expect(passedSlot.id).toBe(1);
        expect(passedSlot.root).toBe(slotManager.slot1.root); // a chave do lock é slot1.root = REPO_ROOT
    });
});
