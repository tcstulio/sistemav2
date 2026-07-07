import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (espelham as deps externas do taskRunnerService — mesmo conjunto do p0.test). ===
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

// Task mínima que satisfaz os builders (que leem só estes campos).
function mkTask(over: any = {}) {
    return { issueNumber: 7, title: 'Teste', feedbackHistory: [], durableFeedback: [], attempts: [], events: [], ...over };
}
const ISSUE = { title: 'Teste', body: 'corpo da issue' };
const MARK = 'CORRIGIR_ISTO_MARCADOR_UNICO';

describe('#1154 P1 item 3 — feedback durável sobrevive ao wipe de feedbackHistory e chega ao coder', () => {
    it('durableFeedbackBlock rende as correções; vazio quando não há', () => {
        expect(svc.durableFeedbackBlock(mkTask({ durableFeedback: [] }))).toBe('');
        expect(svc.durableFeedbackBlock(mkTask({ durableFeedback: undefined }))).toBe('');
        const block = svc.durableFeedbackBlock(mkTask({ durableFeedback: [MARK] }));
        expect(block).toContain(MARK);
        expect(block).toContain('persistem entre tentativas');
    });

    it('poda para as últimas 5 (não estoura o prompt)', () => {
        const many = Array.from({ length: 8 }, (_, i) => `fb-${i}`);
        const block = svc.durableFeedbackBlock(mkTask({ durableFeedback: many }));
        expect(block).toContain('fb-7');
        expect(block).toContain('fb-3'); // 3..7 = últimas 5
        expect(block).not.toContain('fb-2'); // podada
    });

    it('os TRÊS builders injetam o feedback durável mesmo com feedbackHistory VAZIO (o wipe já rodou)', () => {
        const task = mkTask({ feedbackHistory: [], durableFeedback: [MARK] });
        expect(svc.buildPrompt(task, ISSUE)).toContain(MARK);
        expect(svc.buildSynthesisPrompt(task, ISSUE)).toContain(MARK);
        expect(svc.buildCumulativePrompt(task, ISSUE, [])).toContain(MARK);
    });
});

describe('#1154 P1 item 7 — feedback humano vai ao campo durável E reabre o ciclo de auto-fix', () => {
    beforeEach(() => {
        svc.stopPolling?.();
        svc.scheduleExec = vi.fn();
        svc.save = vi.fn();
        svc.recordEvent = vi.fn();
    });

    it('addFeedback persiste no durableFeedback e zera judgeAttempts', async () => {
        svc.store = { tasks: { 8: mkTask({ issueNumber: 8, judgeAttempts: 3, status: 'reviewing' }) } };
        await svc.addFeedback(8, 'humano: faça Z');
        const t = svc.store.tasks[8];
        expect(t.durableFeedback).toContain('humano: faça Z');
        expect(t.judgeAttempts).toBe(0);       // ciclo reaberto
        expect(t.status).toBe('fixing');
        expect(svc.scheduleExec).toHaveBeenCalled();
    });
});
