import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (hoisted) — espelha judgeErrorRetry.test.ts ===
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

import { slotManager } from '../../services/slotManager';
import { taskRunnerService } from '../../services/taskRunnerService';

const svc = taskRunnerService as any;

describe('autoPlayNext — claim atômico (Degrau 2 PR-3)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        svc.getAutomationConfig = () => ({ autoPlay: true, dailyRoundBudget: 200 });
        svc.isPeakHold = () => false;
        svc.dailyRoundsToday = () => 0;
        svc.pendingExecs = 0;
        svc.execInFlight = new Map();
        // simula o claim SÍNCRONO real do startTask→scheduleExec (pendingExecs++ + execInFlight.set)
        svc.startTask = vi.fn((n: number) => { svc.pendingExecs++; svc.execInFlight.set(n, 1); return Promise.resolve(); });
    });

    it('SERIAL (maxParallelExec=1): 2 chamadas despacham 1 só — byte-idêntico', () => {
        vi.spyOn(slotManager, 'maxParallelExec').mockReturnValue(1);
        svc.getQueuedTasks = () => [{ issueNumber: 100 }, { issueNumber: 101 }];

        svc.autoPlayNext();
        svc.autoPlayNext(); // pendingExecs=1 >= 1 → guarda retorna

        expect(svc.startTask).toHaveBeenCalledTimes(1);
        expect(svc.startTask).toHaveBeenCalledWith(100);
    });

    it('N=2: 2 chamadas despacham 100 e 101 — NUNCA 100 duas vezes (double-claim provado)', () => {
        vi.spyOn(slotManager, 'maxParallelExec').mockReturnValue(2);
        // getQueuedTasks devolve 100 AINDA na fila após o dispatch (a janela de corrida: o status só
        // muda no async). O filtro execInFlight é a rede que impede re-elegê-la.
        svc.getQueuedTasks = () => [{ issueNumber: 100 }, { issueNumber: 101 }];

        svc.autoPlayNext(); // dispatch 100 → execInFlight={100}, pendingExecs=1
        svc.autoPlayNext(); // pendingExecs=1 < 2 → find pula 100 (em voo) → dispatch 101

        const dispatched = svc.startTask.mock.calls.map((c: any) => c[0]);
        expect(dispatched).toEqual([100, 101]); // sem [100, 100]
    });

    it('N=2 com 1 só na fila: não re-elege a que está em voo', () => {
        vi.spyOn(slotManager, 'maxParallelExec').mockReturnValue(2);
        svc.getQueuedTasks = () => [{ issueNumber: 100 }];

        svc.autoPlayNext(); // dispatch 100
        svc.autoPlayNext(); // pendingExecs=1 < 2, mas 100 em voo → find=undefined → return

        expect(svc.startTask).toHaveBeenCalledTimes(1);
        expect(svc.startTask).toHaveBeenCalledWith(100);
    });
});
