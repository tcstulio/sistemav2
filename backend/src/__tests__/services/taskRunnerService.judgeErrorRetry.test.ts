import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocks (hoisted) — espelha o gate test. ===
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
// #1407: força o classificador de cota a NÃO reconhecer o erro (o 400 do Judge NÃO é cota) — o teste
// exercita justamente o ramo NÃO-COTA (o de cota já re-enfileira por outro caminho, coberto à parte).
vi.mock('../../services/llmQuotaState', () => ({
    isQuotaError: vi.fn(() => false), isQuotaExhausted: vi.fn(() => false),
    markQuotaExhausted: vi.fn(), clearQuotaExhausted: vi.fn(),
    quotaStatus: vi.fn(() => ({ exhausted: false, since: null, reason: '' })),
}));
// Judge CLAUDE-FIRST desligado (available=false) → o Judge cai direto na cadeia do chat (aiJobService),
// que é onde simulamos o erro/saída-ruim.
vi.mock('../../services/claudeCliService', () => ({
    claudeCliService: { available: vi.fn(async () => false), runText: vi.fn(), runCode: vi.fn() },
}));

import { execFile } from 'child_process';
import { aiJobService } from '../../services/aiJobService';
import { taskRunnerService } from '../../services/taskRunnerService';
import type { Task } from '../../services/taskRunnerService';

function makeTask(n: number, over: Partial<Task> = {}): Task {
    return {
        issueNumber: n, title: `#${n}`, body: 'b', labels: ['opencode-task'],
        status: 'reviewing', feedbackHistory: [], events: [], attempts: [],
        updatedAt: new Date().toISOString(), phase: 'done', kind: 'task',
        branch: `fix-${n}`, prNumber: 9000 + n,
        ...over,
    } as Task;
}
const okJudge = { text: '{"score": 9, "approved": true, "review": "ok"}', usage: {}, model: 'test' };

describe('taskRunnerService — resiliência do Judge a falha NÃO-COTA (#1407)', () => {
    let svc: any;

    beforeEach(() => {
        process.env.TASKRUNNER_JUDGE_RETRY_BACKOFF_MS = '0'; // sem espera real nas re-tentativas inline
        svc = taskRunnerService as any;
        svc.store = { tasks: {} };
        svc.getAutomationConfig = () => ({ autoPlay: false, autoMerge: false, autoDecompose: false, minMergeScore: 8, minApproveScore: 9, maxJudgeRounds: 3, judgeModel: '' });
        svc.finalizeTaskMetrics = vi.fn();
        svc.scheduleExec = vi.fn();
        svc.tryAutoMerge = vi.fn(async () => {});
        svc.postJudgeComment = vi.fn(async () => {});

        // `gh pr diff` devolve um diff sintético; demais chamadas gh devolvem vazio.
        vi.mocked(execFile).mockImplementation((file: string, args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            const a = args || [];
            let stdout = '';
            if (file === 'gh' && a[0] === 'pr' && a[1] === 'diff') {
                stdout = 'diff --git a/src/foo.ts b/src/foo.ts\n+const x = 1;\n';
            } else if (file === 'gh' && a.includes('list')) stdout = '[]';
            else if (file === 'gh') stdout = '{}';
            setImmediate(() => cb(null, { stdout, stderr: '' }));
            return undefined as any;
        });
    });

    afterEach(() => {
        delete process.env.TASKRUNNER_JUDGE_ERROR_MAX_REQUEUES;
        delete process.env.TASKRUNNER_JUDGE_RETRY_BACKOFF_MS;
        vi.restoreAllMocks();
    });

    it('chamada do juiz lança 400 nas 3 tentativas inline → re-enfileira (pending); após o teto → reviewing', async () => {
        process.env.TASKRUNNER_JUDGE_ERROR_MAX_REQUEUES = '2';
        const t = makeTask(1);
        svc.store.tasks[t.issueNumber] = t;
        vi.mocked(aiJobService.runAndWait).mockRejectedValue(new Error('Request failed with status code 400'));

        await svc.runJudge(t);
        expect(t.status).toBe('pending');
        expect(t.judgeErrorRequeues).toBe(1);
        expect(t.startedAt).toBeUndefined();
        expect(svc.scheduleExec).not.toHaveBeenCalled();
        // 3 re-tentativas INLINE por invocação (mesmo diff, sem re-codar)
        expect(vi.mocked(aiJobService.runAndWait)).toHaveBeenCalledTimes(3);

        await svc.runJudge(t);
        expect(t.status).toBe('pending');
        expect(t.judgeErrorRequeues).toBe(2);

        await svc.runJudge(t); // 2 não < 2 → esgotou → escala p/ humano
        expect(t.status).toBe('reviewing');
        expect(t.judgeReview).toMatch(/erro na chamada.*após 2 re-tentativas/i);
    });

    it('PONTO 4: juiz RESPONDE sem JSON parseável (não-cota, 200 corpo-de-erro) → também re-enfileira, NÃO beco-sem-saída', async () => {
        process.env.TASKRUNNER_JUDGE_ERROR_MAX_REQUEUES = '2';
        const t = makeTask(2);
        svc.store.tasks[t.issueNumber] = t;
        // Sem throw: resolve com texto sem score (o que ANTES caía direto em 'reviewing').
        vi.mocked(aiJobService.runAndWait).mockResolvedValue({ text: '<html>Bad Gateway</html> sem json', usage: {}, model: 'x' } as any);

        await svc.runJudge(t);
        expect(t.status).toBe('pending');       // re-enfileira (antes: reviewing direto)
        expect(t.judgeErrorRequeues).toBe(1);
        expect(t.judgeReview).toBeUndefined();  // na re-fila NÃO grava review (não houve veredito ainda)

        await svc.runJudge(t);
        expect(t.judgeErrorRequeues).toBe(2);

        await svc.runJudge(t); // esgotou
        expect(t.status).toBe('reviewing');
        expect(t.judgeReview).toMatch(/não produziu score após 2 re-tentativas/i);
    });

    it('hiccup BREVE: lança na 1ª tentativa mas responde na 2ª → recupera INLINE, SEM re-enfileirar nem re-codar', async () => {
        const t = makeTask(3);
        svc.store.tasks[t.issueNumber] = t;
        vi.mocked(aiJobService.runAndWait)
            .mockRejectedValueOnce(new Error('Request failed with status code 400'))
            .mockResolvedValue(okJudge as any);

        await svc.runJudge(t);
        expect(t.judgeScore).toBe(9);
        expect(t.status).not.toBe('pending');    // NÃO re-enfileirou
        expect(t.judgeErrorRequeues ?? 0).toBe(0);
        expect(svc.scheduleExec).not.toHaveBeenCalled(); // NÃO re-codou
    });

    it('julgamento com sucesso após re-enfileiramento → ZERA o contador de erros', async () => {
        const t = makeTask(4);
        svc.store.tasks[t.issueNumber] = t;

        vi.mocked(aiJobService.runAndWait).mockRejectedValue(new Error('Request failed with status code 400'));
        await svc.runJudge(t);
        expect(t.judgeErrorRequeues).toBe(1);
        expect(t.status).toBe('pending');

        vi.mocked(aiJobService.runAndWait).mockReset();
        vi.mocked(aiJobService.runAndWait).mockResolvedValue(okJudge as any);
        await svc.runJudge(t);
        expect(t.judgeScore).toBe(9);
        expect(t.judgeErrorRequeues).toBe(0);
    });

    it('teto padrão (env ausente) = 3 re-tentativas antes de escalar', async () => {
        const t = makeTask(5);
        svc.store.tasks[t.issueNumber] = t;
        vi.mocked(aiJobService.runAndWait).mockRejectedValue(new Error('Request failed with status code 400'));

        await svc.runJudge(t); expect(t.judgeErrorRequeues).toBe(1); expect(t.status).toBe('pending');
        await svc.runJudge(t); expect(t.judgeErrorRequeues).toBe(2); expect(t.status).toBe('pending');
        await svc.runJudge(t); expect(t.judgeErrorRequeues).toBe(3); expect(t.status).toBe('pending');
        await svc.runJudge(t); expect(t.status).toBe('reviewing'); // 3 não < 3 → escala
    });
});
