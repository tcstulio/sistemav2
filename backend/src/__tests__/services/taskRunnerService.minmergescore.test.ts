import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mesmo conjunto de mocks do p0/p1 test (taskRunnerService importa pesado no topo). ===
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

beforeEach(() => { svc.stopPolling?.(); vi.clearAllMocks(); });

// #1168 — baixar o minMergeScore na config destrava tasks 'approved' retidas por score (limpa o
// mergeHoldReason p/ o resumePendingMerges re-avaliar), SEM tocar holds por outros motivos.
describe('#1168 — onMinMergeScoreLowered destrava tasks retidas por score', () => {
    beforeEach(() => {
        svc.save = vi.fn();
        svc.emitStatus = vi.fn();
        svc.recordEvent = vi.fn();
        svc.resumePendingMerges = vi.fn(async () => {});
        svc.getAutomationConfig = vi.fn(() => ({ autoMerge: true, minMergeScore: 8 }));
    });

    it('baixar o piso (9→8) limpa mergeHoldReason/Kind das tasks retidas por SCORE e dispara re-avaliação', () => {
        svc.store = { tasks: {
            1: { issueNumber: 1, status: 'approved', prNumber: 11, judgeScore: 8, mergeHoldReason: 'Score 8/10 abaixo do piso de merge (9).', mergeHoldKind: 'score' },
            2: { issueNumber: 2, status: 'approved', prNumber: 22, judgeScore: 7, mergeHoldReason: 'Score 7/10 abaixo do piso de merge (9).', mergeHoldKind: 'score' },
        } };
        svc.onMinMergeScoreLowered(9, 8);

        expect(svc.store.tasks[1].mergeHoldReason).toBeUndefined();
        expect(svc.store.tasks[1].mergeHoldKind).toBeUndefined();
        expect(svc.store.tasks[2].mergeHoldReason).toBeUndefined();
        expect(svc.store.tasks[2].mergeHoldKind).toBeUndefined();
        // 1 evento de timeline por task destravada:
        expect(svc.recordEvent).toHaveBeenCalledTimes(2);
        expect(svc.recordEvent.mock.calls.every((c: any[]) => c[1] === 'merge_hold')).toBe(true);
        // emit status p/ a UI refletir o hold limpo:
        expect(svc.emitStatus).toHaveBeenCalledTimes(2);
        // re-avaliação disparada 1x (resumePendingMerges re-dispara o auto-merge das que agora passam):
        expect(svc.resumePendingMerges).toHaveBeenCalledTimes(1);
    });

    it('NÃO afeta holds por auto-merge off (outro motivo) — preserva motivo + kind', () => {
        svc.store = { tasks: {
            3: { issueNumber: 3, status: 'approved', prNumber: 33, judgeScore: 9, mergeHoldReason: 'Auto-merge desligado — PR #33 aprovado (score 9/10), aguarda seu merge manual.', mergeHoldKind: 'autoMergeOff' },
        } };
        svc.onMinMergeScoreLowered(9, 8);

        expect(svc.store.tasks[3].mergeHoldReason).toBe('Auto-merge desligado — PR #33 aprovado (score 9/10), aguarda seu merge manual.');
        expect(svc.store.tasks[3].mergeHoldKind).toBe('autoMergeOff');
        expect(svc.recordEvent).not.toHaveBeenCalled();
        expect(svc.emitStatus).not.toHaveBeenCalled();
        expect(svc.resumePendingMerges).not.toHaveBeenCalled();
    });

    it('NÃO faz nada quando o piso SOBE ou fica IGUAL (no-op)', () => {
        svc.store = { tasks: {
            1: { issueNumber: 1, status: 'approved', prNumber: 11, mergeHoldReason: 'Score 8/10 abaixo do piso de merge (8).', mergeHoldKind: 'score' },
        } };
        svc.onMinMergeScoreLowered(8, 9); // subiu
        expect(svc.store.tasks[1].mergeHoldReason).toBe('Score 8/10 abaixo do piso de merge (8).');
        svc.onMinMergeScoreLowered(8, 8); // igual
        expect(svc.store.tasks[1].mergeHoldReason).toBe('Score 8/10 abaixo do piso de merge (8).');
        expect(svc.recordEvent).not.toHaveBeenCalled();
        expect(svc.resumePendingMerges).not.toHaveBeenCalled();
    });

    it('ignora tasks não-approved, sem hold, ou com hold sem kind (legado)', () => {
        svc.store = { tasks: {
            4: { issueNumber: 4, status: 'reviewing', prNumber: 44, mergeHoldReason: 'Score...', mergeHoldKind: 'score' }, // não-approved
            5: { issueNumber: 5, status: 'approved', prNumber: 55, mergeHoldReason: undefined },                         // sem hold
            6: { issueNumber: 6, status: 'approved', prNumber: 66, mergeHoldReason: 'Score antigo sem kind' },          // legado (sem kind)
        } };
        svc.onMinMergeScoreLowered(9, 8);

        expect(svc.store.tasks[4].mergeHoldReason).toBe('Score...'); // não tocada
        expect(svc.store.tasks[6].mergeHoldReason).toBe('Score antigo sem kind'); // legado preservado (sem kind='score' não destrava)
        expect(svc.recordEvent).not.toHaveBeenCalled();
        expect(svc.resumePendingMerges).not.toHaveBeenCalled();
    });

    it('NÃO destrava quando auto-merge está desligado (sem o que retomar)', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoMerge: false, minMergeScore: 8 }));
        svc.store = { tasks: {
            7: { issueNumber: 7, status: 'approved', prNumber: 77, judgeScore: 8, mergeHoldReason: 'Score 8/10 abaixo do piso de merge (9).', mergeHoldKind: 'score' },
        } };
        svc.onMinMergeScoreLowered(9, 8);

        expect(svc.store.tasks[7].mergeHoldReason).toBe('Score 8/10 abaixo do piso de merge (9).');
        expect(svc.recordEvent).not.toHaveBeenCalled();
        expect(svc.resumePendingMerges).not.toHaveBeenCalled();
    });
});

// Integração ponta-a-ponta do classificação: holdApproved marca o kind certo, e tryAutoMergeInner
// (score < piso) classifica como 'score' — base p/ o destrave seletivo do onMinMergeScoreLowered.
describe('#1168 — holdApproved classifica o kind do hold (score vs autoMergeOff)', () => {
    beforeEach(() => { svc.save = vi.fn(); svc.emitStatus = vi.fn(); svc.recordEvent = vi.fn(); });

    it('hold de score recebe kind="score"', () => {
        const task: any = { issueNumber: 10, status: 'approved', events: [] };
        svc.holdApproved(task, 'Score 7/10 abaixo do piso de merge (9).', 'score');
        expect(task.mergeHoldKind).toBe('score');
        expect(task.mergeHoldReason).toMatch(/piso de merge/i);
    });

    it('hold de auto-merge off recebe kind="autoMergeOff"', () => {
        const task: any = { issueNumber: 11, status: 'approved', events: [] };
        svc.holdApproved(task, 'Auto-merge desligado — aguarda seu merge manual.', 'autoMergeOff');
        expect(task.mergeHoldKind).toBe('autoMergeOff');
    });
});
