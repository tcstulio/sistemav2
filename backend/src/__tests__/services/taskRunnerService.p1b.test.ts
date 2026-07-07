import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (mesmo conjunto do p0/p1 test). ===
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
import { notificationService } from '../../services/notificationService';
const svc = taskRunnerService as any;

beforeEach(() => { svc.stopPolling?.(); vi.clearAllMocks(); });

describe('#1154 P1 item 4 — failedChecksFromRollup distingue CI VERMELHA de CI lenta', () => {
    it('extrai só os checks CONCLUÍDOS em falha (CheckRun.conclusion e StatusContext.state)', () => {
        const rollup = [
            { __typename: 'CheckRun', name: 'test', conclusion: 'FAILURE' },
            { __typename: 'CheckRun', name: 'build', conclusion: 'SUCCESS' },        // verde → fora
            { __typename: 'CheckRun', name: 'rodando', status: 'IN_PROGRESS', conclusion: null }, // pendente → fora
            { __typename: 'StatusContext', context: 'ci/lint', state: 'FAILURE' },
            { __typename: 'StatusContext', context: 'ci/ok', state: 'SUCCESS' },      // verde → fora
        ];
        expect(svc.failedChecksFromRollup(rollup)).toEqual(['test', 'ci/lint']);
    });
    it('vazio/não-array → []', () => {
        expect(svc.failedChecksFromRollup(undefined)).toEqual([]);
        expect(svc.failedChecksFromRollup([])).toEqual([]);
        expect(svc.failedChecksFromRollup([{ conclusion: 'NEUTRAL' }])).toEqual([]);
    });
});

describe('#1154 P1 item 10 — holdApproved é audível e idempotente', () => {
    beforeEach(() => { svc.save = vi.fn(); svc.emitStatus = vi.fn(); svc.recordEvent = vi.fn(); });

    it('registra o motivo 1x; mesmo motivo não re-registra; motivo novo re-registra', () => {
        const task: any = { issueNumber: 5, status: 'approved', events: [] };
        svc.holdApproved(task, 'motivo A');
        expect(task.mergeHoldReason).toBe('motivo A');
        expect(svc.recordEvent).toHaveBeenCalledTimes(1);
        svc.holdApproved(task, 'motivo A');                 // idempotente
        expect(svc.recordEvent).toHaveBeenCalledTimes(1);
        svc.holdApproved(task, 'motivo B');                 // motivo mudou → re-registra
        expect(task.mergeHoldReason).toBe('motivo B');
        expect(svc.recordEvent).toHaveBeenCalledTimes(2);
    });
});

describe('#1154 P1 item 10 — score < piso de merge estaciona AUDÍVEL (não mais return mudo)', () => {
    beforeEach(() => { svc.save = vi.fn(); svc.emitStatus = vi.fn(); svc.recordEvent = vi.fn(); svc.getAutomationConfig = vi.fn(() => ({ autoMerge: true, minMergeScore: 9 })); });

    it('tryAutoMergeInner com score 7 seta mergeHoldReason e mantém approved', async () => {
        const task: any = { issueNumber: 50, status: 'approved', judgeScore: 7, prNumber: 123, events: [] };
        await svc.tryAutoMergeInner(task);
        expect(task.status).toBe('approved');
        expect(task.mergeHoldReason).toMatch(/piso de merge/i);
        expect(svc.recordEvent).toHaveBeenCalled(); // audível
    });
});

describe('#1154 P1 item 10 — resumePendingMerges NÃO re-tenta tasks retidas (fim do spam + loop eterno)', () => {
    beforeEach(() => {
        svc.recordEvent = vi.fn();
        svc.tryAutoMerge = vi.fn(async () => {});
        svc.mergeInFlight = new Set();
        svc.getAutomationConfig = vi.fn(() => ({ autoMerge: true, minMergeScore: 9 }));
    });

    it('pula a task RETIDA (mergeHoldReason) e retoma só a PENDENTE (sem motivo)', async () => {
        svc.store = { tasks: {
            1: { issueNumber: 1, status: 'approved', prNumber: 11, mergeHoldReason: 'score baixo' }, // retida
            2: { issueNumber: 2, status: 'approved', prNumber: 22 },                                  // CI pendente
        } };
        await svc.resumePendingMerges();
        expect(svc.tryAutoMerge).toHaveBeenCalledTimes(1);
        expect(svc.tryAutoMerge).toHaveBeenCalledWith(svc.store.tasks[2]);
        // Não logou "Retomando" para a retida (anti-spam):
        const retomouRetida = svc.recordEvent.mock.calls.some((c: any[]) => c[0]?.issueNumber === 1);
        expect(retomouRetida).toBe(false);
    });
});
