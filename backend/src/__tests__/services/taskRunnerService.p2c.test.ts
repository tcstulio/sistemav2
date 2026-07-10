import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execFile: vi.fn(), exec: vi.fn(), spawn: vi.fn() }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/aiService', () => ({ aiService: { generateReply: vi.fn() } }));
vi.mock('../../services/aiJobService', () => ({ aiJobService: { runAndWait: vi.fn() } }));
vi.mock('../../utils/previewPorts', () => ({ previewPortsFor: vi.fn(() => ({ frontendPort: 5999, backendPort: 6000 })) }));
vi.mock('../../services/screenshotService', () => ({ screenshotService: { captureForTask: vi.fn() } }));
vi.mock('../../services/taskUsageTracker', () => ({ recordUsage: vi.fn(), getUsageForTask: vi.fn(() => null) }));
vi.mock('../../utils/processTree', () => ({
    killTree: vi.fn(async () => ({ ok: true })), isAlive: vi.fn(() => true), // PID "vivo" p/ não marcar ghost por PID
    killOpencodeOrphans: vi.fn(async () => ({ killed: [], errors: [], confirmedGone: true, discriminated: true })),
    killByImageName: vi.fn(async () => undefined), listPidsByName: vi.fn(async () => []),
}));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
vi.mock('../../services/taskPlannerService', () => ({
    taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) },
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn() } }));
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));

import { taskRunnerService } from '../../services/taskRunnerService';
const svc = taskRunnerService as any;

beforeEach(() => { svc.stopPolling?.(); vi.clearAllMocks(); });

describe('#1154 P2 item 15 — getQueuedTasks exclui tasks em cooldown de wait (anti spin-loop)', () => {
    it('exclui planWaitUntil no futuro; inclui o vencido e o sem cooldown', () => {
        const now = Date.now();
        svc.store = { tasks: {
            1: { issueNumber: 1, status: 'pending', queuePriority: 1 },                       // elegível
            2: { issueNumber: 2, status: 'pending', queuePriority: 2, planWaitUntil: now + 60_000 }, // cooldown → fora
            3: { issueNumber: 3, status: 'pending', queuePriority: 3, planWaitUntil: now - 60_000 }, // vencido → elegível
            4: { issueNumber: 4, status: 'running' },                                          // não pending → fora
        } };
        const nums = svc.getQueuedTasks().map((t: any) => t.issueNumber);
        expect(nums).toEqual([1, 3]);
    });
});

describe('#1154 P2 item 14 — checkQueueHealth usa HEARTBEAT (não marca ghost uma task que gravou evento há pouco)', () => {
    it('task rodando sem childPid há 20min MAS com evento recente NÃO é ghost → não fica stuck', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: true }));
        svc.stuckSince = null;
        svc.pendingExecs = 1;
        const oldStart = new Date(Date.now() - 20 * 60_000).toISOString();
        const recent = new Date(Date.now() - 1_000).toISOString();
        svc.store = { tasks: {
            5: { issueNumber: 5, status: 'running', startedAt: oldStart, events: [{ ts: recent, type: 'opencode_output', message: 'vivo' }] },
            6: { issueNumber: 6, status: 'pending' }, // fila não-vazia (passa do early-return)
        } };
        svc.checkQueueHealth();
        expect(svc.stuckSince).toBeNull(); // heartbeat recente → não ghost → não stuck (antes: 20min > 15min = ghost falso)
    });
});
