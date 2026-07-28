import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    killByImageName: vi.fn(async () => undefined), listPidsByName: vi.fn(async () => []),
}));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
vi.mock('../../services/taskPlannerService', () => ({
    taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) },
}));
vi.mock('../../services/claudeCliService', () => ({
    claudeCliService: { available: vi.fn(async () => false), runText: vi.fn(), runCode: vi.fn() },
}));

import { execFile } from 'child_process';
import { taskRunnerService } from '../../services/taskRunnerService';
import type { Task } from '../../services/taskRunnerService';

function makeTask(n: number, over: Partial<Task> = {}): Task {
    return {
        issueNumber: n, title: `T${n}`, body: '', labels: ['opencode-task'],
        status: 'reviewing', feedbackHistory: [], events: [], attempts: [],
        updatedAt: new Date().toISOString(), phase: 'done', kind: 'task',
        branch: `fix-${n}`, roundsUsed: 23, judgeErrorRequeues: 3,
        ...over,
    } as Task;
}

describe('redoTask — resetBudget (#1567: redo MANUAL zera o teto de rodadas)', () => {
    let svc: any;

    beforeEach(() => {
        svc = taskRunnerService as any;
        svc.store = { tasks: {} };
        svc.scheduleExec = vi.fn();
        svc.save = vi.fn();
        // gh (via execFile) devolve vazio — sem PR, nem é chamado.
        vi.mocked(execFile).mockImplementation((file: string, args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            setImmediate(() => cb(null, { stdout: '{}', stderr: '' }));
            return undefined as any;
        });
    });

    afterEach(() => vi.restoreAllMocks());

    it('resetBudget=true zera roundsUsed e judgeErrorRequeues (task volta a poder rodar)', async () => {
        const t = makeTask(1, { prNumber: undefined }); // sem PR → não chama gh pr close
        svc.store.tasks[1] = t;

        await svc.redoTask(1, 'retry manual', { resetBudget: true });

        expect(t.roundsUsed).toBe(0);
        expect(t.judgeErrorRequeues).toBe(0);
        expect(t.status).toBe('running');
        expect(svc.scheduleExec).toHaveBeenCalled();
    });

    it('SEM resetBudget (redo automático do quebra-deadlock) PRESERVA o teto de rodadas', async () => {
        const t = makeTask(2, { prNumber: undefined, roundsUsed: 15, judgeErrorRequeues: 2 });
        svc.store.tasks[2] = t;

        await svc.redoTask(2, 'Deadlock: re-despacho automático'); // sem opts → não reseta

        expect(t.roundsUsed).toBe(15); // preservado (anti-loop do re-despacho)
        expect(t.judgeErrorRequeues).toBe(2);
        expect(t.status).toBe('running');
    });
});
