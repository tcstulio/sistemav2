// getRunnerHealth: liveness observável do robô (o monitor externo saber se está TRABALHANDO).
// Reescrito após red-team — cobre os furos provados (FP-2a opencode longo, FN-2 fila vazia, FN-1b
// approved travada, FP-teto, FP-2b mid-dispatch).
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
const health = () => svc.getRunnerHealth();

beforeEach(() => {
    svc.stopPolling?.();
    vi.clearAllMocks();
    quotaState.exhausted = false;
    svc.store = { tasks: {} };
    svc.save = vi.fn();
    svc.stuckSince = null;
    svc.pendingExecs = 0;
    svc.getAutomationConfig = vi.fn(() => ({ autoPlay: true, autoMerge: false, dailyRoundBudget: 200 }));
    svc.getQueuedTasks = vi.fn(() => []);
    svc.isPeakHold = vi.fn(() => false);
    svc.dailyRoundsToday = vi.fn(() => 0);
});

describe('getRunnerHealth — seemsStuck (o robô está trabalhando?)', () => {
    it('autoPlay on + fila pronta + NADA rodando + pendingExecs 0 → seemsStuck=TRUE', () => {
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        const h = health();
        expect(h.seemsStuck).toBe(true);
        expect(h.queued).toBe(1);
    });

    it('fila VAZIA → seemsStuck=FALSE (ocioso legítimo)', () => {
        expect(health().seemsStuck).toBe(false);
    });

    it('FP-2b: mid-dispatch (pending com pendingExecs=1, nada ACTIVE) → seemsStuck=FALSE', () => {
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        svc.pendingExecs = 1; // despacho em voo
        expect(health().seemsStuck).toBe(false);
    });

    it('FP-2a: opencode LONGO saudável (evento antigo mas cpuMemSample fresco) → seemsStuck=FALSE', () => {
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        svc.store.tasks[7] = { issueNumber: 7, status: 'running', startedAt: minsAgo(28),
            events: [{ ts: minsAgo(27) }], cpuMemSamples: [{ ts: minsAgo(0), cpuPercent: 80, rssMb: 500 }] };
        const h = health();
        expect(h.seemsStuck).toBe(false);
        expect(h.running[0].sinceHeartbeatMin).toBeLessThan(5); // heartbeat vem do sample fresco
    });

    it('travado mid-task: running SEM heartbeat > timeout+5 (sem sample) → seemsStuck=TRUE', () => {
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        svc.store.tasks[7] = { issueNumber: 7, status: 'running', startedAt: minsAgo(50), events: [{ ts: minsAgo(45) }] };
        expect(health().seemsStuck).toBe(true);
    });

    it('FN-2: running pendurado > timeout+5 com FILA VAZIA → seemsStuck=TRUE (não é mais gateado por queued)', () => {
        svc.getQueuedTasks = vi.fn(() => []); // fila vazia
        svc.store.tasks[7] = { issueNumber: 7, status: 'running', startedAt: minsAgo(50), events: [{ ts: minsAgo(45) }] };
        expect(health().seemsStuck).toBe(true);
    });

    it('FN-3: um zumbi (-1) NÃO mascara outra task pendurada (some, não every)', () => {
        svc.store.tasks[7] = { issueNumber: 7, status: 'cancelling' }; // zumbi sem startedAt/events → -1
        svc.store.tasks[8] = { issueNumber: 8, status: 'running', startedAt: minsAgo(50), events: [{ ts: minsAgo(45) }] };
        expect(health().seemsStuck).toBe(true);
    });

    it('FN-1b: approved com autoMerge LIGADO travada há >30min → seemsStuck=TRUE (auto-merge morreu)', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: true, autoMerge: true, dailyRoundBudget: 200 }));
        svc.store.tasks[9] = { issueNumber: 9, status: 'approved', startedAt: minsAgo(200), events: [{ ts: minsAgo(40) }] };
        const h = health();
        expect(h.stalled).toContain(9);
        expect(h.seemsStuck).toBe(true);
    });

    it('approved com mergeHoldReason (espera humana) → NÃO é stalled', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: true, autoMerge: true, dailyRoundBudget: 200 }));
        svc.store.tasks[9] = { issueNumber: 9, status: 'approved', startedAt: minsAgo(200), events: [{ ts: minsAgo(40) }], mergeHoldReason: 'score < piso' };
        expect(health().stalled).not.toContain(9);
        expect(health().seemsStuck).toBe(false);
    });

    it('FP-teto: teto diário atingido → seemsStuck=FALSE (pausa legítima)', () => {
        svc.dailyRoundsToday = vi.fn(() => 200);
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        const h = health();
        expect(h.budgetHit).toBe(true);
        expect(h.seemsStuck).toBe(false);
    });

    it('cota esgotada / pico → seemsStuck=FALSE', () => {
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        quotaState.exhausted = true;
        expect(health().seemsStuck).toBe(false);
        quotaState.exhausted = false;
        svc.isPeakHold = vi.fn(() => true);
        expect(health().seemsStuck).toBe(false);
    });

    it('autoPlay OFF → seemsStuck=FALSE', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: false, autoMerge: false, dailyRoundBudget: 200 }));
        svc.getQueuedTasks = vi.fn(() => [{ issueNumber: 5 }]);
        expect(health().seemsStuck).toBe(false);
    });

    it('expõe waiting (pending com planWaitUntil futuro) — backlog preso ≠ vazio', () => {
        svc.store.tasks[11] = { issueNumber: 11, status: 'pending', planWaitUntil: Date.now() + 3600_000 };
        expect(health().waiting).toBe(1);
    });

    it('stuckForMin reflete o watchdog interno (stuckSince)', () => {
        svc.stuckSince = Date.now() - 12 * 60000;
        expect(health().stuckForMin).toBe(12);
    });
});
