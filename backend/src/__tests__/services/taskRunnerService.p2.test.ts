import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (mesmo conjunto dos demais testes de taskRunner). ===
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
    killOpencodeOrphans: vi.fn(async () => ({ killed: [], errors: [], confirmedGone: true, discriminated: true })),
    killByImageName: vi.fn(async () => undefined), listPidsByName: vi.fn(async () => []),
}));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
vi.mock('../../services/taskPlannerService', () => ({
    taskPlannerService: { analyzeTask: vi.fn(async () => ({ action: 'go', priority: 1, reason: 'ok' })), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) },
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn() } }));
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));

import { taskRunnerService } from '../../services/taskRunnerService';
import { taskPlannerService } from '../../services/taskPlannerService';
const svc = taskRunnerService as any;

beforeEach(() => { svc.stopPolling?.(); vi.clearAllMocks(); });

describe('#1154 P2 item 11 — task deletada/cancelada na fila NÃO ressuscita', () => {
    beforeEach(() => {
        svc.pendingExecs = 0;
        svc.execChains = new Map(); // #slot-chain: cadeia por-slot
        svc.recordEvent = vi.fn();
        svc.save = vi.fn();
        svc.emitStatus = vi.fn();
        svc.autoPlayNext = vi.fn();
    });

    it('task deletada (fora do store) aborta ANTES do planner', async () => {
        svc.store = { tasks: {} };                       // #77 já removida do store
        svc.deletedIssueNumbers = new Map([[77, 1]]);
        const task: any = { issueNumber: 77, branch: 'fix-77', status: 'pending', events: [] };
        svc.scheduleExec(task, 'fix-77', 'running', { id: 1, root: '/tmp/wt', dataDir: null });
        await svc.chainFor(1);
        expect(taskPlannerService.analyzeTask).not.toHaveBeenCalled(); // não ressuscitou
    });

    it('task cancelada (killRequested) aborta ANTES do planner', async () => {
        svc.store = { tasks: { 78: { issueNumber: 78 } } };
        svc.deletedIssueNumbers = new Map();
        const task: any = { issueNumber: 78, branch: 'fix-78', status: 'cancelling', killRequested: true, events: [] };
        svc.store.tasks[78] = task;
        svc.scheduleExec(task, 'fix-78', 'running', { id: 1, root: '/tmp/wt', dataDir: null });
        await svc.chainFor(1);
        expect(taskPlannerService.analyzeTask).not.toHaveBeenCalled();
    });
});

describe('#1154 P2 item 12 — rejectTask mata o exec em andamento (rejeição não evapora)', () => {
    beforeEach(() => {
        svc.save = vi.fn(); svc.emitStatus = vi.fn(); svc.recordEvent = vi.fn(); svc.finalizeTaskMetrics = vi.fn();
    });

    it('seta killRequested e marca rejected (terminal)', async () => {
        svc.store = { tasks: { 50: { issueNumber: 50, status: 'running', events: [] } } }; // sem prNumber → pula gh
        const t = await svc.rejectTask(50);
        expect(t.killRequested).toBe(true);   // exec vivo vai PARAR (isCancelSignal)
        expect(t.status).toBe('rejected');     // terminal → o .catch do exec preserva
    });
});
