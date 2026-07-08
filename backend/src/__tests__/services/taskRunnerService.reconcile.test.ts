import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (hoisted) — mesmas dependências externas do taskRunnerService. ===
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
    killByImageName: vi.fn(async () => undefined), listPidsByName: vi.fn(async () => []),
}));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
vi.mock('../../services/taskPlannerService', () => ({
    taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) },
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn() } }));
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));

import { execFile } from 'child_process';
import { taskRunnerService } from '../../services/taskRunnerService';
import type { Task } from '../../services/taskRunnerService';

// Mapa de respostas do `gh pr view --json state,merged` por número de PR.
// undefined = PR NÃO mergeado (estado OPEN/CLOSED); {merged:true} = mergeado.
let mergedPrs = new Map<number, boolean>();

function makeTask(n: number, over: Partial<Task> = {}): Task {
    return {
        issueNumber: n, title: `#${n}`, body: 'b', labels: ['opencode-task'],
        status: 'reviewing', feedbackHistory: [], events: [], attempts: [],
        updatedAt: new Date().toISOString(), phase: 'done', kind: 'task',
        branch: `fix-${n}`, prNumber: 9000 + n,
        ...over,
    } as Task;
}

describe('#1191 — reconcileManualMerges: reconcilia failed com PR mergeado; ignora rejected/cancelled', () => {
    let svc: any;

    beforeEach(() => {
        svc = taskRunnerService as any;
        svc.pendingExecs = 0;
        svc.execChain = Promise.resolve();
        svc.worktreeLock = Promise.resolve();
        svc.store = { tasks: {} };
        svc.mergeInFlight = new Set<number>();
        // Isola efeitos colaterais (não queremos métricas reais nem fechar épicas aqui).
        svc.finalizeTaskMetrics = vi.fn();
        svc.checkEpicCompletion = vi.fn();

        mergedPrs = new Map();

        vi.mocked(execFile).mockImplementation((file: string, args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            const a = args || [];
            let stdout = '';
            if (file === 'gh') {
                if (a[0] === 'pr' && a[1] === 'view') {
                    const prNum = Number(a[2]);
                    const merged = mergedPrs.get(prNum) === true;
                    stdout = JSON.stringify({ state: merged ? 'MERGED' : 'OPEN', merged });
                } else if (a.includes('list')) {
                    stdout = '[]';
                } else {
                    stdout = '{}';
                }
            }
            setImmediate(() => cb(null, { stdout, stderr: '' }));
            return undefined as any;
        });
    });

    it('failed com PR mergeado → reconciliada para merged + checkEpicCompletion', async () => {
        const t = makeTask(983, { status: 'failed', prNumber: 42, error: 'rodada vazia (#1190)' });
        svc.store.tasks[983] = t;
        mergedPrs.set(42, true);

        await svc.reconcileManualMerges();

        expect(t.status).toBe('merged');
        expect(t.completedAt).toBeTruthy();
        expect(svc.finalizeTaskMetrics).toHaveBeenCalledWith(t);
        expect(svc.checkEpicCompletion).toHaveBeenCalledWith(t);
        const evt = t.events.find((e: any) => e.type === 'pr_merged');
        expect(evt).toBeTruthy();
        expect(evt.message).toMatch(/PR #42 mergeado — task reconciliada de failed→merged/);
        expect(evt.meta.previousStatus).toBe('failed');
    });

    it('approved e reviewing com PR mergeado continuam reconciliando (regressão do caminho feliz)', async () => {
        const tA = makeTask(1, { status: 'approved', prNumber: 101 });
        const tR = makeTask(2, { status: 'reviewing', prNumber: 102 });
        svc.store.tasks = { 1: tA, 2: tR };
        mergedPrs.set(101, true);
        mergedPrs.set(102, true);

        await svc.reconcileManualMerges();

        expect(tA.status).toBe('merged');
        expect(tR.status).toBe('merged');
        expect(svc.checkEpicCompletion).toHaveBeenCalledTimes(2);
        const evtA = tA.events.find((e: any) => e.type === 'pr_merged');
        expect(evtA.message).toMatch(/reconciliada de approved→merged/);
        const evtR = tR.events.find((e: any) => e.type === 'pr_merged');
        expect(evtR.message).toMatch(/reconciliada de reviewing→merged/);
    });

    it('rejected NÃO é reconciliada mesmo com PR mergeado (decisão explícita)', async () => {
        const t = makeTask(3, { status: 'rejected', prNumber: 103 });
        svc.store.tasks = { 3: t };
        mergedPrs.set(103, true);

        await svc.reconcileManualMerges();

        expect(t.status).toBe('rejected');
        expect(t.events.some((e: any) => e.type === 'pr_merged')).toBe(false);
        expect(svc.checkEpicCompletion).not.toHaveBeenCalled();
    });

    it('cancelled NÃO é reconciliada mesmo com PR mergeado', async () => {
        const t = makeTask(4, { status: 'cancelled', prNumber: 104 });
        svc.store.tasks = { 4: t };
        mergedPrs.set(104, true);

        await svc.reconcileManualMerges();

        expect(t.status).toBe('cancelled');
        expect(t.events.some((e: any) => e.type === 'pr_merged')).toBe(false);
        expect(svc.checkEpicCompletion).not.toHaveBeenCalled();
    });

    it('failed com PR NÃO mergeado permanece failed', async () => {
        const t = makeTask(5, { status: 'failed', prNumber: 105 });
        svc.store.tasks = { 5: t };
        mergedPrs.set(105, false);

        await svc.reconcileManualMerges();

        expect(t.status).toBe('failed');
        expect(svc.checkEpicCompletion).not.toHaveBeenCalled();
    });

    it('failed sem prNumber não é candidata (não há PR para checar)', async () => {
        const t = makeTask(6, { status: 'failed', prNumber: undefined });
        svc.store.tasks = { 6: t };

        await svc.reconcileManualMerges();

        expect(t.status).toBe('failed');
        expect(svc.checkEpicCompletion).not.toHaveBeenCalled();
    });

    it('task em mergeInFlight não é reconciliada (evita corrida com auto-merge)', async () => {
        const t = makeTask(7, { status: 'failed', prNumber: 106 });
        svc.store.tasks = { 7: t };
        svc.mergeInFlight = new Set([7]);
        mergedPrs.set(106, true);

        await svc.reconcileManualMerges();

        expect(t.status).toBe('failed');
        expect(svc.checkEpicCompletion).not.toHaveBeenCalled();
    });
});
