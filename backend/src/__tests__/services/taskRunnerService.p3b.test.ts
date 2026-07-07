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
    killTree: vi.fn(async () => ({ ok: true })), isAlive: vi.fn(() => false),
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
const today = () => new Date().toISOString().slice(0, 10);

beforeEach(() => { svc.stopPolling?.(); vi.clearAllMocks(); });

describe('#1154 item 23 — accountRound contabiliza por task e por dia', () => {
    it('incrementa roundsUsed da task e o contador do dia', () => {
        const task: any = { issueNumber: 1, roundsUsed: 0 };
        svc.dailyRounds = { date: '', count: 0 };
        svc.accountRound(task);
        svc.accountRound(task);
        expect(task.roundsUsed).toBe(2);
        expect(svc.dailyRoundsToday()).toBe(2);
    });
});

describe('#1154 item 23 — autoPlayNext segura ao atingir o teto DIÁRIO', () => {
    beforeEach(() => { svc.isPeakHold = vi.fn(() => false); });

    it('NÃO despacha quando o teto diário foi atingido', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: true, dailyRoundBudget: 5 }));
        svc.dailyRounds = { date: today(), count: 5 };
        svc.startTask = vi.fn(async () => {});
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 9 }]);
        svc.autoPlayNext();
        expect(svc.startTask).not.toHaveBeenCalled();
    });

    it('despacha normalmente abaixo do teto', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: true, dailyRoundBudget: 200 }));
        svc.dailyRounds = { date: today(), count: 1 };
        svc.startTask = vi.fn(async () => {});
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 9 }]);
        svc.autoPlayNext();
        expect(svc.startTask).toHaveBeenCalledWith(9);
    });
});
