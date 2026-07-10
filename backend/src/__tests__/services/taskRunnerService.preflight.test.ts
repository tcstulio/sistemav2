import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (hoisted) — mesmos das outras suítes do taskRunnerService ===
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

import { execFile } from 'child_process';
import { taskRunnerService } from '../../services/taskRunnerService';

const svc = taskRunnerService as any;

// Respostas controláveis do gh por subcomando.
let mergedSearchJson = '[]';   // gh pr list --state merged --search "#N in:body"
let mergedRecentJson = '[]';   // gh pr list --state merged (recentes, p/ hint)
let prBodyByNumber: Record<string, string> = {};  // gh pr view <n> --json body
let issueCloseCalls: string[][] = [];

function mockExecFile() {
    return vi.fn((file: string, args: any[], opts: any, cb: any) => {
        if (typeof opts === 'function') { cb = opts; }
        const a = (args || []) as string[];
        let stdout = '';
        if (file === 'gh') {
            if (a[0] === 'pr' && a[1] === 'list' && a.includes('--search')) stdout = mergedSearchJson;
            else if (a[0] === 'pr' && a[1] === 'list') stdout = mergedRecentJson;
            else if (a[0] === 'pr' && a[1] === 'view') stdout = JSON.stringify({ body: prBodyByNumber[a[2]] || '' });
            else if (a[0] === 'issue' && a[1] === 'close') { issueCloseCalls.push([...a]); stdout = ''; }
        }
        setImmediate(() => cb(null, { stdout, stderr: '' }));
        return undefined as any;
    });
}

function makeTask(num: number, title = `Task ${num}`) {
    svc.store.tasks[num] = {
        issueNumber: num, title, body: 'corpo', labels: ['opencode-task'],
        status: 'pending', feedbackHistory: [], events: [],
        updatedAt: new Date().toISOString(), phase: 'done', attempts: [], kind: 'task',
    };
    return svc.store.tasks[num];
}

beforeEach(() => {
    svc.stopPolling?.();
    vi.clearAllMocks();
    mergedSearchJson = '[]';
    mergedRecentJson = '[]';
    prBodyByNumber = {};
    issueCloseCalls = [];
    svc.store = { tasks: {} };
    vi.mocked(execFile).mockImplementation(mockExecFile() as any);
});

describe('#1279 — preflightAlreadyDone', () => {
    it('(a) PR mergeado com "Closes #N" no corpo → done, task vira merged e fecha a issue', async () => {
        const task = makeTask(500, 'Backend: expor coisa X');
        mergedSearchJson = JSON.stringify([{ number: 900, title: 'feat(#500): expor coisa X', mergedAt: '2026-07-01T00:00:00Z' }]);
        prBodyByNumber['900'] = 'Closes #500\n\nImplementado pelo TaskRunner.';

        const r = await svc.preflightAlreadyDone(task);

        expect(r.done).toBe(true);
        expect(task.status).toBe('merged');
        expect(task.prNumber).toBe(900);
        // fechou a issue com comentário de pre-flight
        expect(issueCloseCalls.length).toBe(1);
        expect(issueCloseCalls[0]).toContain('500');
    });

    it('(a-negativo) PR mergeado apenas MENCIONANDO "#N" (sem keyword) NÃO conta', async () => {
        const task = makeTask(501);
        mergedSearchJson = JSON.stringify([{ number: 901, title: 'outra coisa', mergedAt: '2026-07-01T00:00:00Z' }]);
        prBodyByNumber['901'] = 'Relacionado ao #501 mas resolve outra coisa.';

        const r = await svc.preflightAlreadyDone(task);

        expect(r.done).toBe(false);
        expect(task.status).toBe('pending');
        expect(issueCloseCalls.length).toBe(0);
    });

    it('(b) PR mergeado RECENTE com título similar vira hint (não veredito)', async () => {
        const task = makeTask(502, 'Backend: expor dailyRoundsToday() via rota admin');
        const recentIso = new Date(Date.now() - 2 * 86400_000).toISOString();
        mergedRecentJson = JSON.stringify([
            { number: 902, title: 'feat: expor dailyRoundsToday via rota admin', mergedAt: recentIso },
        ]);

        const r = await svc.preflightAlreadyDone(task);

        expect(r.done).toBe(false);
        expect(r.hint).toContain('#902');
        expect(task.status).toBe('pending');
    });

    it('(b-negativo) PR similar mas ANTIGO (>14 dias) não gera hint', async () => {
        const task = makeTask(503, 'Backend: expor dailyRoundsToday() via rota admin');
        const oldIso = new Date(Date.now() - 30 * 86400_000).toISOString();
        mergedRecentJson = JSON.stringify([
            { number: 903, title: 'feat: expor dailyRoundsToday via rota admin', mergedAt: oldIso },
        ]);

        const r = await svc.preflightAlreadyDone(task);

        expect(r.done).toBe(false);
        expect(r.hint).toBe('');
    });

    it('sem PR mergeado relevante → segue normal (done=false, hint vazio)', async () => {
        const task = makeTask(504);
        const r = await svc.preflightAlreadyDone(task);
        expect(r).toEqual({ done: false, hint: '' });
    });
});

describe('#1279 — approveDecomposition com dedup', () => {
    it('sub-task com título similar a issue aberta NÃO é criada; a existente é adotada', async () => {
        const epic = makeTask(600, 'Épica de teste');
        epic.kind = 'epic';
        epic.decompositionPlan = {
            subTasks: [
                { title: 'Backend: criar worktree.ts (computeWorktreeHash)', body: 'b', dependsOn: [], complexity: 'S', filesEstimate: [] },
                { title: 'Algo genuinamente novo e diferente', body: 'b', dependsOn: [], complexity: 'S', filesEstimate: [] },
            ],
        };
        // listIssues (gh issue list) devolve uma aberta com título similar à 1ª sub-task
        const openList = JSON.stringify([{ number: 700, title: 'feat: criar worktree.ts — computeWorktreeHash', state: 'OPEN', labels: [], createdAt: '', closedAt: null, body: '' }]);
        const created = JSON.stringify({});
        vi.mocked(execFile).mockImplementation(((file: string, args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') { cb = opts; }
            const a = (args || []) as string[];
            let stdout = '';
            if (file === 'gh') {
                if (a[0] === 'issue' && a[1] === 'list') stdout = openList;
                else if (a[0] === 'issue' && a[1] === 'create') stdout = 'https://github.com/tcstulio/sistemav2/issues/999';
                else stdout = created;
            }
            setImmediate(() => cb(null, { stdout, stderr: '' }));
            return undefined as any;
        }) as any);

        const result = await svc.approveDecomposition(600);

        // adotou a #700 (existente) e criou só a #999 (nova)
        expect(result.subTasks).toContain(700);
        expect(result.subTasks).toContain(999);
        expect(result.subTasks).toHaveLength(2);
    });
});
