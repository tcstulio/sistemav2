// getRunnerHealth: liveness observável do robô (o monitor externo saber se está TRABALHANDO).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execFile: vi.fn(), exec: vi.fn(), spawn: vi.fn() }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/aiService', () => ({ aiService: { generateReply: vi.fn() } }));
vi.mock('../../services/aiJobService', () => ({ aiJobService: { runAndWait: vi.fn() } }));
vi.mock('../../services/screenshotService', () => ({ screenshotService: { captureForTask: vi.fn() } }));
vi.mock('../../services/taskUsageTracker', () => ({ recordUsage: vi.fn(), getUsageForTask: vi.fn(() => null) }));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
vi.mock('../../services/taskPlannerService', () => ({ taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) } }));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn() } }));
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));
const quotaState = vi.hoisted(() => ({ exhausted: false }));
vi.mock('../../services/llmQuotaState', () => ({
    isQuotaError: vi.fn(() => false), isQuotaExhausted: vi.fn(() => quotaState.exhausted),
    markQuotaExhausted: vi.fn(), clearQuotaExhausted: vi.fn(), quotaStatus: vi.fn(() => ({ exhausted: quotaState.exhausted })),
}));
vi.mock('../../services/claudeCliService', () => ({ claudeCliService: { available: vi.fn(async () => true), runCode: vi.fn(), runText: vi.fn() } }));

import { taskRunnerService } from '../../services/taskRunnerService';
const svc = taskRunnerService as any;
const minsAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

beforeEach(() => {
    svc.stopPolling?.();
    vi.clearAllMocks();
    quotaState.exhausted = false;
    svc.store = { tasks: {} };
    svc.save = vi.fn();
    svc.stuckSince = null;
    svc.getAutomationConfig = vi.fn(() => ({ autoPlay: true, dailyRoundBudget: 200 }));
    svc.getQueuedTasks = vi.fn(() => []);
    svc.isPeakHold = vi.fn(() => false);
});

describe('getRunnerHealth — seemsStuck (o robô está trabalhando?)', () => {
    it('autoPlay on + fila pronta + NADA rodando + sem pausa → seemsStuck=TRUE (deveria trabalhar)', () => {
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        const h = svc.getRunnerHealth();
        expect(h.seemsStuck).toBe(true);
        expect(h.queued).toBe(1);
        expect(h.autoPlay).toBe(true);
    });

    it('fila VAZIA → seemsStuck=FALSE (ocioso legítimo, não travado)', () => {
        svc.getQueuedTasks = vi.fn(() => []);
        expect(svc.getRunnerHealth().seemsStuck).toBe(false);
    });

    it('task rodando COM heartbeat recente → seemsStuck=FALSE', () => {
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        svc.store.tasks[7] = { issueNumber: 7, status: 'running', startedAt: minsAgo(10), events: [{ ts: minsAgo(2) }] };
        const h = svc.getRunnerHealth();
        expect(h.seemsStuck).toBe(false);
        expect(h.running[0]).toMatchObject({ issueNumber: 7, status: 'running' });
        expect(h.running[0].sinceLastEventMin).toBeLessThan(20);
    });

    it('task rodando SEM heartbeat (>20min) → seemsStuck=TRUE (travada mid-task)', () => {
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        svc.store.tasks[7] = { issueNumber: 7, status: 'running', startedAt: minsAgo(60), events: [{ ts: minsAgo(35) }] };
        expect(svc.getRunnerHealth().seemsStuck).toBe(true);
    });

    it('cota esgotada → seemsStuck=FALSE (pausa legítima, não travamento)', () => {
        quotaState.exhausted = true;
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        const h = svc.getRunnerHealth();
        expect(h.quotaExhausted).toBe(true);
        expect(h.seemsStuck).toBe(false);
    });

    it('pico (peakHold) → seemsStuck=FALSE (pausa legítima)', () => {
        svc.isPeakHold = vi.fn(() => true);
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        expect(svc.getRunnerHealth().seemsStuck).toBe(false);
    });

    it('autoPlay OFF → seemsStuck=FALSE (parada por config, não travamento)', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: false, dailyRoundBudget: 200 }));
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        expect(svc.getRunnerHealth().seemsStuck).toBe(false);
    });

    it('stuckForMin reflete o watchdog interno (stuckSince)', () => {
        svc.stuckSince = Date.now() - 12 * 60000;
        expect(svc.getRunnerHealth().stuckForMin).toBe(12);
    });
});
