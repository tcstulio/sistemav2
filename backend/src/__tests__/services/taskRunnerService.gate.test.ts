import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocks (hoisted) — mesmas dependências externas do taskRunnerService (espelha o queue test). ===
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
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn() } }));
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));

import { execFile } from 'child_process';
import { taskRunnerService } from '../../services/taskRunnerService';
import type { Task } from '../../services/taskRunnerService';

// Saída controlável do `gh pr diff` (e flag p/ simular falha de infra ao buscar o diff).
let prDiff = '';
let prDiffThrows = false;

function makeTask(n: number, over: Partial<Task> = {}): Task {
    return {
        issueNumber: n, title: `#${n}`, body: 'b', labels: ['opencode-task'],
        status: 'reviewing', feedbackHistory: [], events: [], attempts: [],
        updatedAt: new Date().toISOString(), phase: 'done', kind: 'task',
        branch: `fix-${n}`, prNumber: 9000 + n, judgeScore: 8, judgeApproved: true,
        ...over,
    } as Task;
}

// Diff sintético: um arquivo de teste com `removed` casos a menos que `added` (net = added-removed).
function diffWithTestDelta(added: number, removed: number, deletedFile = false): string {
    let d = `diff --git a/src/__tests__/foo.test.tsx b/src/__tests__/foo.test.tsx\n`;
    if (deletedFile) d += `deleted file mode 100644\n`;
    d += `index 111..222 100644\n--- a/src/__tests__/foo.test.tsx\n+++ b/src/__tests__/foo.test.tsx\n`;
    for (let i = 0; i < added; i++) d += `+    it('novo ${i}', () => {});\n`;
    for (let i = 0; i < removed; i++) d += `-    it('antigo ${i}', () => {});\n`;
    return d;
}

describe('taskRunnerService — gate determinístico + self-heal', () => {
    let svc: any;

    beforeEach(() => {
        process.env.TASKRUNNER_GATE_FIX_MAX = '1'; // #963: testa o MECANISMO do teto num valor fixo (default real = 3)
        svc = taskRunnerService as any;
        svc.pendingExecs = 0;
        svc.execChain = Promise.resolve();
        svc.worktreeLock = Promise.resolve();
        svc.store = { tasks: {} };
        svc.getAutomationConfig = () => ({ autoPlay: false, autoMerge: true, autoDecompose: false, minMergeScore: 8 });
        // Isola efeitos colaterais não relacionados ao gate.
        svc.scheduleExec = vi.fn();
        svc.refreshOriginMain = vi.fn();
        svc.hasFrontendChanges = vi.fn(async () => false);

        prDiff = '';
        prDiffThrows = false;
        vi.mocked(execFile).mockImplementation((file: string, args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            const a = args || [];
            let stdout = '';
            if (file === 'gh') {
                if (a[0] === 'pr' && a[1] === 'diff') {
                    if (prDiffThrows) { setImmediate(() => cb(new Error('gh diff falhou (infra)'), null)); return undefined as any; }
                    stdout = prDiff;
                } else if (a.includes('list')) stdout = '[]';
                else if (a[0] === 'pr' || a[0] === 'issue') stdout = '{}';
            }
            setImmediate(() => cb(null, { stdout, stderr: '' }));
            return undefined as any;
        });
    });

    afterEach(() => { delete process.env.TASKRUNNER_GATE_FIX_MAX; vi.restoreAllMocks(); });

    // --- checkTestRegression: classifica reason corretamente ---
    it('checkTestRegression: net negativo → blocked reason=regression', async () => {
        const t = makeTask(1);
        prDiff = diffWithTestDelta(1, 5); // +1/-5 → net -4
        const r = await svc.checkTestRegression(t);
        expect(r.blocked).toBe(true);
        expect(r.reason).toBe('regression');
    });

    it('checkTestRegression: arquivo de teste apagado → blocked reason=regression', async () => {
        const t = makeTask(2);
        prDiff = diffWithTestDelta(0, 0, /* deletedFile */ true);
        const r = await svc.checkTestRegression(t);
        expect(r.blocked).toBe(true);
        expect(r.reason).toBe('regression');
    });

    it('checkTestRegression: só adições → não bloqueia reason=ok', async () => {
        const t = makeTask(3);
        prDiff = diffWithTestDelta(5, 0);
        const r = await svc.checkTestRegression(t);
        expect(r.blocked).toBe(false);
        expect(r.reason).toBe('ok');
    });

    it('checkTestRegression: falha ao buscar diff → blocked reason=infra (não-reversível)', async () => {
        const t = makeTask(4);
        prDiffThrows = true;
        const r = await svc.checkTestRegression(t);
        expect(r.blocked).toBe(true);
        expect(r.reason).toBe('infra');
    });

    // --- selfHealFromGate: teto, campos, re-entry ---
    it('selfHealFromGate: 1ª chamada dispara (true) e seta campos; 2ª respeita o teto (false)', () => {
        const t = makeTask(5, { gateFixAttempts: 0 });
        const first = svc.selfHealFromGate(t, 'testRegression', 'net -3');
        expect(first).toBe(true);
        expect(t.gateFixAttempts).toBe(1);
        expect(t.status).toBe('fixing');
        expect(t.gateFixInstruction).toMatch(/RESTAURE/i);
        expect(svc.scheduleExec).toHaveBeenCalledTimes(1);
        expect(t.judgeAttempts).toBeUndefined(); // NÃO reseta/reabre a faixa do Juiz

        const second = svc.selfHealFromGate(t, 'testRegression', 'net -3');
        expect(second).toBe(false);              // teto (GATE_MAX=1) esgotado
        expect(svc.scheduleExec).toHaveBeenCalledTimes(1);
    });

    it('selfHealFromGate: sem branch → false (nada a re-submeter)', () => {
        const t = makeTask(6, { branch: undefined });
        expect(svc.selfHealFromGate(t, 'testRegression', 'x')).toBe(false);
    });

    // --- tryAutoMerge: regressão dispara self-heal; esgotado/infra estaciona ---
    it('tryAutoMerge: regressão real → self-heal (fixing), NÃO estaciona nem mergeia', async () => {
        const t = makeTask(7, { gateFixAttempts: 0 });
        svc.store.tasks[t.issueNumber] = t;
        prDiff = diffWithTestDelta(0, 4);
        await svc.tryAutoMerge(t);
        expect(t.status).toBe('fixing');
        expect(t.gateFixAttempts).toBe(1);
        expect(svc.scheduleExec).toHaveBeenCalledTimes(1);
    });

    it('tryAutoMerge: regressão com teto esgotado → estaciona em reviewing', async () => {
        const t = makeTask(8, { gateFixAttempts: 1 });
        svc.store.tasks[t.issueNumber] = t;
        prDiff = diffWithTestDelta(0, 4);
        await svc.tryAutoMerge(t);
        expect(t.status).toBe('reviewing');
        expect(svc.scheduleExec).not.toHaveBeenCalled();
    });

    it('tryAutoMerge: falha de infra no diff → reviewing (sem self-heal)', async () => {
        const t = makeTask(9, { gateFixAttempts: 0 });
        svc.store.tasks[t.issueNumber] = t;
        prDiffThrows = true;
        await svc.tryAutoMerge(t);
        expect(t.status).toBe('reviewing');
        expect(svc.scheduleExec).not.toHaveBeenCalled();
    });

    it('tryAutoMerge: veto do Juiz com review acionável → self-heal; review vazia → reviewing', async () => {
        const t1 = makeTask(10, { judgeApproved: false, judgeReview: 'Faltou tratar o caso de lista vazia e adicionar o teste correspondente.', gateFixAttempts: 0 });
        svc.store.tasks[t1.issueNumber] = t1;
        await svc.tryAutoMerge(t1);
        expect(t1.status).toBe('fixing');
        expect(t1.gateFixAttempts).toBe(1);

        const t2 = makeTask(11, { judgeApproved: false, judgeReview: 'ruim', gateFixAttempts: 0 });
        svc.store.tasks[t2.issueNumber] = t2;
        await svc.tryAutoMerge(t2);
        expect(t2.status).toBe('reviewing'); // review curta/não-acionável → não tenta self-heal
    });

    // --- mergeTask: gate determinístico INDEPENDENTE de quem chama (fecha o buraco do merge_opencode_task) ---
    it('mergeTask (sem force): veto approved=false → lança', async () => {
        const t = makeTask(12, { judgeApproved: false });
        svc.store.tasks[t.issueNumber] = t;
        await expect(svc.mergeTask(t.issueNumber)).rejects.toThrow(/Juiz reprovou|approved=false/i);
    });

    it('mergeTask (sem force): regressão de testes → lança (mesmo com score alto)', async () => {
        const t = makeTask(13, { judgeApproved: true, judgeScore: 9 });
        svc.store.tasks[t.issueNumber] = t;
        prDiff = diffWithTestDelta(0, 6);
        await expect(svc.mergeTask(t.issueNumber)).rejects.toThrow(/regressão de testes/i);
    });

    it('mergeTask (force=true): humano sobrepõe o gate → não lança no gate', async () => {
        const t = makeTask(14, { judgeApproved: false });
        svc.store.tasks[t.issueNumber] = t;
        svc.checkEpicCompletion = vi.fn();
        svc.finalizeTaskMetrics = vi.fn();
        prDiff = diffWithTestDelta(0, 6);
        await svc.mergeTask(t.issueNumber, { force: true });
        expect(t.status).toBe('merged');
    });

    it('mergeTask (sem force): PR limpo (só adições) → mergeia', async () => {
        const t = makeTask(15, { judgeApproved: true, judgeScore: 9 });
        svc.store.tasks[t.issueNumber] = t;
        svc.checkEpicCompletion = vi.fn();
        svc.finalizeTaskMetrics = vi.fn();
        prDiff = diffWithTestDelta(3, 0);
        await svc.mergeTask(t.issueNumber);
        expect(t.status).toBe('merged');
    });
});
