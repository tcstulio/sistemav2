import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocks (hoisted) — mesmas dependências externas do taskRunnerService (espelha o gate test). ===
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

function makeTask(n: number, over: Partial<Task> = {}): Task {
    return {
        issueNumber: n, title: `#${n}`, body: 'b', labels: ['opencode-task'],
        status: 'reviewing', feedbackHistory: [], events: [], attempts: [],
        updatedAt: new Date().toISOString(), phase: 'done', kind: 'task',
        branch: `fix-${n}`, prNumber: 4242, judgeAttempts: 1,
        ...over,
    } as Task;
}

// Captura os args do `gh pr comment` p/ asserção.
let commentCalls: any[] = [];
let commentFails = false;

describe('postJudgeComment (#1203 / Fase D2) — comentário do Judge no PR', () => {
    let svc: any;

    beforeEach(() => {
        svc = taskRunnerService as any;
        svc.store = { tasks: {} };
        commentCalls = [];
        commentFails = false;
        vi.mocked(execFile).mockImplementation((file: string, args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            const a = args || [];
            if (file === 'gh' && a[0] === 'pr' && a[1] === 'comment') {
                commentCalls.push(a);
                if (commentFails) { setImmediate(() => cb(new Error('gh comment failed'), null)); return undefined as any; }
            }
            setImmediate(() => cb(null, { stdout: '', stderr: '' }));
            return undefined as any;
        });
    });

    afterEach(() => { vi.restoreAllMocks(); });

    it('posta comentário com score/resumo/attempt no PR via gh pr comment', async () => {
        const t = makeTask(1, { prNumber: 99, judgeAttempts: 3 });
        await svc.postJudgeComment(t, { score: 9, approved: true, review: 'Excelente.', missing_coverage: ['x.ts'] });

        expect(commentCalls.length).toBe(1);
        const args = commentCalls[0];
        expect(args[0]).toBe('pr');
        expect(args[1]).toBe('comment');
        expect(args[2]).toBe('99');
        expect(args).toContain('--repo');
        expect(args).toContain('tcstulio/sistemav2');
        const body = args[args.indexOf('--body') + 1];
        expect(body).toContain('Score: 9/10');
        expect(body).toContain('tentativa 3');
        expect(body).toContain('Excelente.');
        expect(body).toContain('x.ts');
        // marca anti-spam
        expect(t._judgeCommentedAttempt).toBe(3);
    });

    it('BEST-EFFORT: falha do gh comment NÃO rejeita e não afeta o pipeline', async () => {
        commentFails = true;
        const t = makeTask(2, { prNumber: 100, judgeAttempts: 1 });
        // Deve resolver sem lançar — apenas logar.
        await expect(svc.postJudgeComment(t, { score: 7, approved: false, review: 'ok' })).resolves.toBeUndefined();
        // A task permanece íntegra.
        expect(t.status).toBe('reviewing');
        // A tentativa foi marcada (não re-posta em resume), mesmo com a falha.
        expect(t._judgeCommentedAttempt).toBe(1);
    });

    it('ANTI-SPAM: no máx. 1 comentário por rodada (judgeAttempts); resume não re-posta', async () => {
        const t = makeTask(3, { prNumber: 101, judgeAttempts: 2 });
        await svc.postJudgeComment(t, { score: 8, approved: true, review: 'r1' });
        // Resume / re-run do MESMO attempt → não re-posta.
        await svc.postJudgeComment(t, { score: 8, approved: true, review: 'r1' });
        await svc.postJudgeComment(t, { score: 8, approved: true, review: 'r1' });
        expect(commentCalls.length).toBe(1);
        expect(t._judgeCommentedAttempt).toBe(2);
    });

    it('uma NOVA rodada (judgeAttempts diferente) gera um novo comentário', async () => {
        const t = makeTask(4, { prNumber: 102, judgeAttempts: 1 });
        await svc.postJudgeComment(t, { score: 6, approved: false, review: 'rodada 1' });
        t.judgeAttempts = 2; // novo julgamento
        await svc.postJudgeComment(t, { score: 9, approved: true, review: 'rodada 2' });
        expect(commentCalls.length).toBe(2);
        expect(t._judgeCommentedAttempt).toBe(2);
    });

    it('sem prNumber → não tenta comentar', async () => {
        const t = makeTask(5, { prNumber: undefined, judgeAttempts: 1 });
        await svc.postJudgeComment(t, { score: 9, approved: true, review: 'r' });
        expect(commentCalls.length).toBe(0);
    });
});
