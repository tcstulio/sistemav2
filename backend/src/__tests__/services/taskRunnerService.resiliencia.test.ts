// #resiliencia — 3 correções contra falhas TRANSITÓRIAS/de-AMBIENTE (análise de 197 tasks failed:
// ~97% eram ambiente — restart do backend, git fetch flaky, npm — não trabalho difícil):
//  FIX1: recoverStuckTasksOnBoot RE-ENFILEIRA (com teto 3) em vez de marcar 'failed' no restart.
//  FIX2: gitFetchWithRetry sobe de 3 p/ 5 tentativas, backoff limitado a 8s.
//  FIX3: notifyStalledDecomposedEpics re-enfileira sub-tasks que falharam por TRANSITÓRIO (teto 2)
//        antes de travar a épica; só trava se sobrar falha REAL. isTransientError ampliado.
// Harness espelha claimAtomic.test.ts / gitRetry.test.ts (mocks hoisted + singleton semeado).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn(() => ({})) } }));
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));
vi.mock('../../services/claudeCliService', () => ({ claudeCliService: { available: vi.fn(async () => false), runText: vi.fn(), runCode: vi.fn() } }));
vi.mock('../../services/llmQuotaState', () => ({
    isQuotaError: vi.fn(() => false), isQuotaExhausted: vi.fn(() => false),
    markQuotaExhausted: vi.fn(), clearQuotaExhausted: vi.fn(),
    quotaStatus: vi.fn(() => ({ exhausted: false, since: null, reason: '' })),
}));

import { execFile } from 'child_process';
import { taskRunnerService, gitFetchWithRetry } from '../../services/taskRunnerService';

const svc = taskRunnerService as any;
const lastEvent = (t: any) => t.events[t.events.length - 1];

const task = (issueNumber: number, over: any = {}) => ({
    issueNumber, title: `Task #${issueNumber}`, body: '', labels: ['opencode-task'],
    status: 'running', kind: 'task', feedbackHistory: [], events: [], attempts: [],
    updatedAt: new Date().toISOString(), phase: 'done', ...over,
});
const epic = (issueNumber: number, over: any = {}) => ({
    issueNumber, title: `Épica #${issueNumber}`, body: '', labels: ['opencode-task'],
    status: 'pending', kind: 'epic', feedbackHistory: [], events: [], attempts: [],
    updatedAt: new Date().toISOString(), phase: 'done', ...over,
});
const sub = (issueNumber: number, status: string, over: any = {}) => ({
    issueNumber, title: `Sub #${issueNumber}`, body: '', labels: ['opencode-task'],
    status, kind: 'task', feedbackHistory: [], events: [], attempts: [],
    updatedAt: new Date().toISOString(), phase: 'done', ...over,
});

beforeEach(() => {
    svc.stopPolling?.();
    vi.clearAllMocks();
    svc.store = { tasks: {} };
    svc.save = vi.fn();
    svc.emitStatus = vi.fn();        // isola do socket/notification (asserta os efeitos DURÁVEIS no store)
    svc.pendingExecs = 5;            // p/ provar que FIX1 zera no fim
});
afterEach(() => vi.useRealTimers());

// ─────────────────────────────────────────────────────────────────────────────
// FIX1: recoverStuckTasksOnBoot RE-ENFILEIRA (teto 3) em vez de failed permanente.
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX1 — recoverStuckTasksOnBoot re-enfileira restart transitório (teto 3)', () => {
    it('stuck running restartRequeues=0 → vira pending (não failed), restartRequeues=1, slotId undefined', () => {
        svc.store.tasks[10] = task(10, { status: 'running', slotId: 2, childPid: 12345, killRequested: true, error: 'x' });
        svc.recoverStuckTasksOnBoot();
        const t = svc.store.tasks[10];
        expect(t.status).toBe('pending');
        expect(t.restartRequeues).toBe(1);
        expect(t.slotId).toBeUndefined();
        expect(t.childPid).toBeUndefined();
        expect(t.killRequested).toBe(false);
        expect(t.error).toBeUndefined();
        expect(lastEvent(t).type).toBe('task_started');
        expect(lastEvent(t).meta?.restartRequeue).toBe(true);
        expect(svc.emitStatus).toHaveBeenCalledWith(t);
    });

    it('fixing e cancelling também re-enfileiram (não só running)', () => {
        svc.store.tasks[11] = task(11, { status: 'fixing' });
        svc.store.tasks[12] = task(12, { status: 'cancelling' });
        svc.recoverStuckTasksOnBoot();
        expect(svc.store.tasks[11].status).toBe('pending');
        expect(svc.store.tasks[12].status).toBe('pending');
        expect(svc.store.tasks[11].restartRequeues).toBe(1);
        expect(svc.store.tasks[12].restartRequeues).toBe(1);
    });

    it('restartRequeues=3 (teto estourado) → vira failed de verdade', () => {
        svc.store.tasks[20] = task(20, { status: 'running', restartRequeues: 3 });
        svc.recoverStuckTasksOnBoot();
        const t = svc.store.tasks[20];
        expect(t.status).toBe('failed');
        expect(t.restartRequeues).toBe(3); // não incrementa após estourar
        expect(t.error).toMatch(/3 re-enfileiramentos/i);
        expect(lastEvent(t).type).toBe('task_failed');
        expect(lastEvent(t).meta?.restartRequeueExhausted).toBe(true);
    });

    it('sempre zera pendingExecs e persiste no fim', () => {
        svc.store.tasks[10] = task(10, { status: 'running' });
        svc.recoverStuckTasksOnBoot();
        expect(svc.pendingExecs).toBe(0);
        expect(svc.save).toHaveBeenCalled();
    });

    it('sem stuck tasks → no-op (não toca pendingExecs)', () => {
        svc.store.tasks[10] = task(10, { status: 'merged' });
        svc.recoverStuckTasksOnBoot();
        expect(svc.pendingExecs).toBe(5); // early return antes do reset
        expect(svc.emitStatus).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX2: gitFetchWithRetry sobe p/ 5 tentativas (backoff limitado a 8s).
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX2 — gitFetchWithRetry: 5 tentativas por default (janela maior p/ Azure-BR)', () => {
    function queueExecFile(outcomes: Array<{ err?: any; stdout?: string }>) {
        let i = 0;
        vi.mocked(execFile).mockImplementation(((_file: string, _args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            const o = outcomes[Math.min(i, outcomes.length - 1)];
            i++;
            setImmediate(() => o.err ? cb(o.err) : cb(null, { stdout: o.stdout ?? '', stderr: '' }));
            return undefined as any;
        }) as any);
    }

    it('falha transitória SEMPRE → 5 tentativas (era 3), depois rejeita', async () => {
        vi.useFakeTimers();
        const err: any = new Error('Command failed: git fetch'); err.stderr = 'timeout'; err.code = 128;
        queueExecFile([{ err }]);
        const p = gitFetchWithRetry(['fetch', 'origin', 'main']); // sem tries → usa o DEFAULT (agora 5)
        const assertion = expect(p).rejects.toThrow(/timeout/);
        await vi.runAllTimersAsync();
        await assertion;
        expect(vi.mocked(execFile).mock.calls.length).toBe(5);
    });

    it('sucesso na 4ª tentativa → resolve (antes com tries=3 teria falhado)', async () => {
        vi.useFakeTimers();
        const err: any = new Error('Command failed: git fetch'); err.stderr = 'network'; err.code = 128;
        queueExecFile([{ err }, { err }, { err }, { stdout: 'fetched' }]);
        const p = gitFetchWithRetry(['fetch', 'origin', 'main']);
        await vi.runAllTimersAsync();
        await expect(p).resolves.toMatchObject({ stdout: 'fetched' });
        expect(vi.mocked(execFile).mock.calls.length).toBe(4);
    });

    it('backoff limitado a 8s (não explode exponencialmente na 5ª)', async () => {
        vi.useFakeTimers();
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        const err: any = new Error('Command failed: git fetch'); err.stderr = 'timeout'; err.code = 128;
        queueExecFile([{ err }]);
        const p = gitFetchWithRetry(['fetch', 'origin', 'main']);
        const assertion = expect(p).rejects.toThrow();
        await vi.runAllTimersAsync();
        await assertion;
        // 4 backoffs entre 5 tentativas: 1s, 2s, 4s, 8s (o 5º NÃO tem backoff — é a última). 8000, não 16000.
        const delays = setTimeoutSpy.mock.calls.map((c) => c[1]).filter((d) => typeof d === 'number' && (d as number) >= 1000);
        expect(delays).toContain(8000);
        expect(delays.every((d) => (d as number) <= 8000)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX3: notifyStalledDecomposedEpics re-enfileira sub-tasks TRANSITÓRIAS (teto 2)
// antes de travar; só trava em falha REAL. isTransientError ampliado.
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX3 — isTransientError ampliado', () => {
    const cases: Array<[string, boolean]> = [
        ['Backend reiniciou durante execução', true],
        ['git fetch origin main falhou', true],
        ['npm ci exited with code 1', true],
        ['ECONNRESET while fetch origin', true],
        ['aguardando a task 5 na fila', true],
        ['ETIMEDOUT', true],
        ['typecheck TS2322: Type not assignable', false],
        ['conflito de merge não resolvido', false],
        ['', false],
    ];
    for (const [msg, expected] of cases) {
        it(`"${msg || '(vazio)'}" → ${expected}`, () => {
            expect(svc.isTransientError(msg)).toBe(expected);
        });
    }
});

describe('FIX3 — épica re-enfileira sub-task TRANSITÓRIA; trava só em falha REAL', () => {
    it('sub failed com error "Backend reiniciou" → volta a pending (subtaskRetries=1), épica NÃO trava', () => {
        svc.store.tasks[100] = epic(100, { subTasks: [101, 102] });
        svc.store.tasks[101] = sub(101, 'merged');
        svc.store.tasks[102] = sub(102, 'failed', { error: 'Backend reiniciou durante execução (status era: running)' });
        svc.notifyStalledDecomposedEpics();
        const s = svc.store.tasks[102];
        expect(s.status).toBe('pending');
        expect(s.subtaskRetries).toBe(1);
        expect(s.slotId).toBeUndefined();
        expect(s.error).toBeUndefined();
        expect(lastEvent(s).meta?.epicRetry).toBe(true);
        expect(svc.store.tasks[100].epicStalledNotified).toBeUndefined(); // NÃO travou
    });

    it('sub failed com error REAL "typecheck TS2322" → épica TRAVA (epicStalledNotified), sub segue failed', () => {
        svc.store.tasks[100] = epic(100, { subTasks: [101, 102] });
        svc.store.tasks[101] = sub(101, 'merged');
        svc.store.tasks[102] = sub(102, 'failed', { error: 'typecheck TS2322: Type string not assignable to number' });
        svc.notifyStalledDecomposedEpics();
        expect(svc.store.tasks[102].status).toBe('failed'); // não re-enfileirada
        expect(svc.store.tasks[100].epicStalledNotified).toBe(true);
        expect(lastEvent(svc.store.tasks[100]).meta?.stalledEpic).toBe(true);
    });

    it('transitório mas teto estourado (subtaskRetries=2) → conta como REAL, épica trava', () => {
        svc.store.tasks[100] = epic(100, { subTasks: [102] });
        svc.store.tasks[102] = sub(102, 'failed', { error: 'git fetch falhou', subtaskRetries: 2 });
        svc.notifyStalledDecomposedEpics();
        expect(svc.store.tasks[102].status).toBe('failed'); // teto → não re-tenta
        expect(svc.store.tasks[100].epicStalledNotified).toBe(true);
    });

    it('classifica pela mensagem do EVENTO task_failed quando s.error está vazio', () => {
        svc.store.tasks[100] = epic(100, { subTasks: [102] });
        const s = sub(102, 'failed');
        s.events = [{ ts: new Date().toISOString(), type: 'task_failed', message: 'npm install falhou no worktree' }];
        svc.store.tasks[102] = s;
        svc.notifyStalledDecomposedEpics();
        expect(svc.store.tasks[102].status).toBe('pending'); // transitório detectado via evento
        expect(svc.store.tasks[102].subtaskRetries).toBe(1);
        expect(svc.store.tasks[100].epicStalledNotified).toBeUndefined();
    });

    it('mistura: 1 transitória + 1 real → re-enfileira a transitória e NÃO trava (re-avalia no próximo poll)', () => {
        svc.store.tasks[100] = epic(100, { subTasks: [101, 102] });
        svc.store.tasks[101] = sub(101, 'failed', { error: 'Backend reiniciou' });
        svc.store.tasks[102] = sub(102, 'failed', { error: 'conflito de merge' });
        svc.notifyStalledDecomposedEpics();
        expect(svc.store.tasks[101].status).toBe('pending');  // transitória re-enfileirada
        expect(svc.store.tasks[102].status).toBe('failed');   // real permanece
        expect(svc.store.tasks[100].epicStalledNotified).toBeUndefined(); // não trava enquanto há re-tentativa viva
    });

    it('regressão: subs merged+failed(sem error nem evento) → falha REAL (msg vazia) → trava (comportamento antigo)', () => {
        svc.store.tasks[100] = epic(100, { subTasks: [101, 102] });
        svc.store.tasks[101] = sub(101, 'merged');
        svc.store.tasks[102] = sub(102, 'failed'); // sem error → '' → não-transitório
        svc.notifyStalledDecomposedEpics();
        expect(svc.store.tasks[100].epicStalledNotified).toBe(true);
    });
});
