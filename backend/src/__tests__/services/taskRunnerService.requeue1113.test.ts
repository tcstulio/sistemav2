import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (mesmo conjunto dos demais testes de taskRunner — espelham as deps externas). ===
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
import { execFile } from 'child_process';
const svc = taskRunnerService as any;
// Captura o scheduleExec REAL antes de qualquer suite sobrescrevê-lo no singleton.
const realScheduleExec = svc.scheduleExec.bind(svc);

// Configura o mock de execFile para chamar o callback (gh pr close fire-and-forget resolve).
function mockExecFileOk() {
    vi.mocked(execFile as any).mockImplementation((_cmd: string, _args: string[], opts: any, cb: any) => {
        if (typeof opts === 'function') { cb = opts; }
        cb(null, { stdout: '', stderr: '' });
    });
}

beforeEach(() => { svc.stopPolling?.(); vi.clearAllMocks(); });

describe('#1113 — requeueTask: re-enfileirar SEM re-planejar (reusa o plano)', () => {
    beforeEach(() => {
        svc.scheduleExec = vi.fn();
        svc.save = vi.fn();
        svc.recordEvent = vi.fn();
        svc.store = {
            tasks: {
                6001: {
                    issueNumber: 6001, title: 'Bug X', body: 'corpo', status: 'failed',
                    queuePriority: 5, planReason: 'plano antigo', branch: 'fix-6001',
                    feedbackHistory: [], durableFeedback: [], attempts: [], events: [], kind: 'task', phase: 'done',
                },
            },
        };
    });

    it('reseta para pending, PRESERVA queuePriority/planReason e agenda com skipPlanner=true', async () => {
        const task = await svc.requeueTask(6001);
        expect(task.status).toBe('pending');
        expect(task.queuePriority).toBe(5);            // plano reutilizado
        expect(task.planReason).toBe('plano antigo');  // plano reutilizado
        expect(task.error).toBeUndefined();
        expect(task.completedAt).toBeUndefined();
        expect(task.judgeAttempts).toBe(0);
        expect(svc.scheduleExec).toHaveBeenCalledTimes(1);
        // 4º argumento = opts com skipPlanner true (caminho "sem re-planejar").
        expect(svc.scheduleExec).toHaveBeenCalledWith(task, 'fix-6001', 'running', { skipPlanner: true });
    });

    it('com replan:true agenda SEM skipPlanner (força re-análise do Planner)', async () => {
        await svc.requeueTask(6001, { replan: true });
        expect(svc.scheduleExec).toHaveBeenCalledWith(expect.any(Object), 'fix-6001', 'running', { skipPlanner: false });
    });

    it('fecha PR em BACKGROUND (não aguarda gh) — limpa prNumber/prHistory na hora', async () => {
        mockExecFileOk();
        svc.store.tasks[6001].prNumber = 4242;
        svc.store.tasks[6001].prHistory = [];
        const task = await svc.requeueTask(6001);
        // Estado resetado imediatamente (o handler não espera o gh pr close).
        expect(task.prNumber).toBeUndefined();
        expect(task.prHistory).toContain(4242);
        expect(task.status).toBe('pending');
        expect(svc.scheduleExec).toHaveBeenCalledTimes(1);
        expect(execFile).toHaveBeenCalled(); // gh pr close disparado (fire-and-forget)
    });

    it('lança erro quando a task não existe', async () => {
        await expect(svc.requeueTask(9999)).rejects.toThrow(/não encontrada|not found/i);
        expect(svc.scheduleExec).not.toHaveBeenCalled();
    });
});

describe('#1113 — requeueBatch: recuperação em LOTE (reusa plano, sem LLM)', () => {
    beforeEach(() => {
        svc.scheduleExec = vi.fn();
        svc.save = vi.fn();
        svc.recordEvent = vi.fn();
        svc.store = {
            tasks: {
                6101: { issueNumber: 6101, status: 'failed', queuePriority: 1, planReason: 'p1', branch: 'fix-6101', kind: 'task', events: [], attempts: [] },
                6102: { issueNumber: 6102, status: 'approved', queuePriority: 2, planReason: 'p2', branch: 'fix-6102', kind: 'task', events: [], attempts: [] },
                // 6103 propositalmente ausente (não encontrada)
                6104: { issueNumber: 6104, status: 'pending', kind: 'epic', events: [], attempts: [] },
                6105: { issueNumber: 6105, status: 'running', kind: 'task', events: [], attempts: [] },
            },
        };
    });

    it('re-enfileira as tasks válidas e reporta skipped (ausente/épica/em execução)', async () => {
        const result = await svc.requeueBatch([6101, 6102, 6103, 6104, 6105]);
        expect(result.requeued).toEqual([6101, 6102]);
        // 1 chamada de scheduleExec por task re-enfileirada (NENHUMA chamada LLM síncrona).
        expect(svc.scheduleExec).toHaveBeenCalledTimes(2);
        expect(svc.scheduleExec).toHaveBeenNthCalledWith(1, expect.objectContaining({ issueNumber: 6101 }), 'fix-6101', 'running', { skipPlanner: true });
        expect(result.skipped.map((s: any) => s.issueNumber)).toEqual([6103, 6104, 6105]);
        const reasons = Object.fromEntries(result.skipped.map((s: any) => [s.issueNumber, s.reason]));
        expect(reasons[6103]).toMatch(/não encontrada/i);
        expect(reasons[6104]).toMatch(/épica/i);
        expect(reasons[6105]).toMatch(/em execução/i);
    });

    it('com replan:true propaga skipPlanner=false para todo o lote', async () => {
        const result = await svc.requeueBatch([6101], { replan: true });
        expect(result.requeued).toEqual([6101]);
        expect(svc.scheduleExec).toHaveBeenCalledWith(expect.any(Object), 'fix-6101', 'running', { skipPlanner: false });
    });
});

describe('#1113 — redoTask: apenas enfileira (pending) e retorna rápido', () => {
    beforeEach(() => {
        svc.scheduleExec = vi.fn();
        svc.save = vi.fn();
        svc.recordEvent = vi.fn();
        svc.store = {
            tasks: {
                6201: { issueNumber: 6201, title: 'Bug Y', status: 'failed', branch: 'fix-6201', kind: 'task', phase: 'done', events: [], attempts: [] },
            },
        };
    });

    it('seta status=pending (NÃO running) e agenda a execução', async () => {
        const task = await svc.redoTask(6201, 'corrija isso');
        expect(task.status).toBe('pending');            // enfileira, não executa síncrono
        expect(task.durableFeedback).toContain('Redo: corrija isso');
        expect(task.startedAt).toBeUndefined();
        expect(svc.scheduleExec).toHaveBeenCalledTimes(1);
        expect(svc.scheduleExec).toHaveBeenCalledWith(task, 'fix-6201', 'running');
    });

    it('com PR aberto NÃO bloqueia o handler (fecha em background)', async () => {
        mockExecFileOk();
        svc.store.tasks[6201].prNumber = 7777;
        svc.store.tasks[6201].prHistory = [];
        const start = Date.now();
        const task = await svc.redoTask(6201);
        const elapsed = Date.now() - start;
        // Retorna rápido (o gh pr close é fire-and-forget, não awaited).
        expect(elapsed).toBeLessThan(1000);
        expect(task.prNumber).toBeUndefined();
        expect(task.prHistory).toContain(7777);
        expect(task.status).toBe('pending');
        expect(svc.scheduleExec).toHaveBeenCalledTimes(1);
    });
});

describe('#1113 — scheduleExec real: skipPlanner pula o Planner na chain serial', () => {
    beforeEach(() => {
        // Estado da chain real (NÃO mocka scheduleExec — exercita o método de verdade).
        svc.scheduleExec = realScheduleExec; // restaura o método real (suítes anteriores mockam)
        svc.pendingExecs = 0;
        svc.execChain = Promise.resolve();
        svc.deletedIssueNumbers = new Map();
        // gh (execFile) responde vazio — se o Planner real rodar (require na chain), não lança.
        mockExecFileOk();
        // Isola os efeitos colaterais pesados da chain (executeTask/lock/watchdog).
        svc.executeTask = vi.fn(async () => {});
        svc.withWorktreeLock = async (_label: string, fn: () => any) => fn();
        svc.finalizeTaskMetrics = vi.fn();
        svc.save = vi.fn();
        svc.recordEvent = vi.fn();
        svc.emitStatus = vi.fn();
        svc.emitLog = vi.fn();
        svc.autoPlayNext = vi.fn();
        svc.getAutomationConfig = () => ({ autoPlay: false, autoMerge: false, autoDecompose: false, minMergeScore: 8, minApproveScore: 9, maxJudgeRounds: 3, maxGateFixRounds: 3, maxRoundsPerTask: 20, dailyRoundBudget: 200 });
        svc.store = {
            tasks: {
                6301: { issueNumber: 6301, title: 'Bug Z', status: 'pending', branch: 'fix-6301', kind: 'task', phase: 'exploring', events: [], attempts: [], queuePriority: 9, planReason: 'ja planejado' },
            },
        };
    });

    it('com skipPlanner=true: NÃO entra no Planner e vai direto à execução (reusa o plano)', async () => {
        const task = svc.store.tasks[6301];
        svc.scheduleExec(task, 'fix-6301', 'running', { skipPlanner: true });
        await svc.execChain;
        expect(taskPlannerService.analyzeTask).not.toHaveBeenCalled();
        // Não emitiu o evento de "iniciando planner" — o Planner foi pulado.
        const plannerStarted = svc.recordEvent.mock.calls.filter((c: any[]) => c[1] === 'planner_started');
        expect(plannerStarted).toHaveLength(0);
        // Em vez disso, registrou que o plano foi reutilizado.
        const reused = svc.recordEvent.mock.calls.filter((c: any[]) => c[1] === 'planner_decision' && c[3]?.reusedPlan);
        expect(reused.length).toBeGreaterThanOrEqual(1);
        expect(svc.executeTask).toHaveBeenCalledTimes(1);   // foi direto executar (reusando o plano)
    });

    it('sem skipPlanner: entra no Planner (contraprova do caminho normal) e prossegue à execução', async () => {
        const task = svc.store.tasks[6301];
        svc.scheduleExec(task, 'fix-6301', 'running');
        await svc.execChain;
        // O Planner normal EMITE o evento "planner_started" (skipPlanner pula exatamente isto).
        const plannerStarted = svc.recordEvent.mock.calls.filter((c: any[]) => c[1] === 'planner_started');
        expect(plannerStarted).toHaveLength(1);
        expect(svc.executeTask).toHaveBeenCalledTimes(1);
    });
});
