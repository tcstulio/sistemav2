import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (hoisted) — mesmas dependências externas do taskRunnerService. ===
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

// Mapa de respostas do `gh pr view --json state,merged` por número de PR.
// true = PR mergeado; false = não mergeado (OPEN/CLOSED).
let mergedPrs = new Map<number, boolean>();
// Issues que o `gh issue list` devolve (simula a "janela" do listIssues).
let issueWindow: { number: number; state: string }[] = [];

function makeTask(n: number, over: Partial<Task> = {}): Task {
    return {
        issueNumber: n, title: `#${n}`, body: 'b', labels: ['opencode-task'],
        status: 'reviewing', feedbackHistory: [], events: [], attempts: [],
        updatedAt: new Date().toISOString(), phase: 'done', kind: 'task',
        branch: `fix-${n}`, prNumber: 9000 + n,
        ...over,
    } as Task;
}

describe('#1304 — syncWithGitHub: fallback deterministico p/ issues fora da janela do listIssues', () => {
    let svc: any;

    beforeEach(() => {
        svc = taskRunnerService as any;
        svc.syncGitHubInFlight = false;
        svc.store = { tasks: {} };

        mergedPrs = new Map();
        issueWindow = [];

        vi.mocked(execFile).mockImplementation((file: string, args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            const a = args || [];
            let stdout = '';
            if (file === 'gh') {
                if (a[0] === 'issue' && a[1] === 'list') {
                    // Simula a janela do listIssues — só devolve as issues "dentro" da janela.
                    stdout = JSON.stringify(issueWindow);
                } else if (a[0] === 'pr' && a[1] === 'view') {
                    const prNum = Number(a[2]);
                    const merged = mergedPrs.get(prNum) === true;
                    stdout = JSON.stringify({ state: merged ? 'MERGED' : 'OPEN', merged });
                } else {
                    stdout = '{}';
                }
            }
            setImmediate(() => cb(null, { stdout, stderr: '' }));
            return undefined as any;
        });
    });

    it('task em reviewing com PR mergeado e issue FORA da janela → reconciliada para merged', async () => {
        const t = makeTask(1002, { status: 'reviewing', prNumber: 42 });
        svc.store.tasks[1002] = t;
        // A issue #1002 NÃO aparece na janela do listIssues (fora do limit).
        issueWindow = [{ number: 1300, state: 'OPEN' }];
        mergedPrs.set(42, true);

        const res = await svc.syncWithGitHub();

        expect(t.status).toBe('merged');
        expect(t.completedAt).toBeTruthy();
        expect(res.reconciled).toContain(1002);
        const evt = t.events.find((e: any) => e.type === 'pr_merged');
        expect(evt).toBeTruthy();
    });

    it('task em reviewing com PR NÃO mergeado e issue fora da janela → permanece reviewing', async () => {
        const t = makeTask(1005, { status: 'reviewing', prNumber: 55 });
        svc.store.tasks[1005] = t;
        issueWindow = [];
        mergedPrs.set(55, false);

        await svc.syncWithGitHub();

        expect(t.status).toBe('reviewing');
        expect(t.events.some((e: any) => e.type === 'pr_merged')).toBe(false);
    });

    it('task fora da janela SEM prNumber/prHistory → não é reconciliada (nada a checar)', async () => {
        const t = makeTask(1008, { status: 'reviewing', prNumber: undefined, prHistory: [] });
        svc.store.tasks[1008] = t;
        issueWindow = [];

        await svc.syncWithGitHub();

        expect(t.status).toBe('reviewing');
        expect(t.completedAt).toBeFalsy();
    });

    it('fallback via prHistory (sem prNumber atual, PR antigo mergeado) → merged', async () => {
        const t = makeTask(1042, { status: 'reviewing', prNumber: undefined, prHistory: [77, 78] });
        svc.store.tasks[1042] = t;
        issueWindow = [];
        mergedPrs.set(77, false);
        mergedPrs.set(78, true);

        await svc.syncWithGitHub();

        expect(t.status).toBe('merged');
    });

    it('regressão: task DENTRO da janela com issue CLOSED + PR merged continua reconciliando', async () => {
        const t = makeTask(1100, { status: 'reviewing', prNumber: 88 });
        svc.store.tasks[1100] = t;
        issueWindow = [{ number: 1100, state: 'CLOSED' }];
        mergedPrs.set(88, true);

        await svc.syncWithGitHub();

        expect(t.status).toBe('merged');
    });

    it('regressão: task DENTRO da janela com issue OPEN → permanece (não terminal)', async () => {
        const t = makeTask(1101, { status: 'reviewing', prNumber: 99 });
        svc.store.tasks[1101] = t;
        issueWindow = [{ number: 1101, state: 'OPEN' }];
        mergedPrs.set(99, false);

        await svc.syncWithGitHub();

        expect(t.status).toBe('reviewing');
    });
});
