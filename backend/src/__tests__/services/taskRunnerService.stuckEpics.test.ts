// #stuck-epics (red-team Fable): destrava épicas presas no beco-sem-saída (kind:'epic' sem subTasks).
// Cobre o sweep decomposeStuckEpics (orquestração + 5 guardas de pausa + reentrância + anti-spin
// crash-safe + cota-não-consome-tentativa), o strict-dedup do listIssues/approveDecomposition
// (fix error-as-empty #1347) e a notificação do 2º modo de travamento (subs todas terminais).
import { describe, it, expect, vi, beforeEach } from 'vitest';

// execFile mockado p/ testar listIssues strict: o callback dispara erro → promisify(execFile) rejeita.
vi.mock('child_process', () => ({
    execFile: vi.fn((_cmd: string, _args: string[], opts: any, cb: any) => {
        const callback = typeof opts === 'function' ? opts : cb;
        callback(new Error('gh boom')); // toda chamada gh falha (só listIssues real é exercitado aqui)
    }),
    exec: vi.fn(), spawn: vi.fn(),
}));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/aiService', () => ({ aiService: { generateReply: vi.fn() } }));
vi.mock('../../services/aiJobService', () => ({ aiJobService: { runAndWait: vi.fn() } }));
vi.mock('../../services/screenshotService', () => ({ screenshotService: { captureForTask: vi.fn() } }));
vi.mock('../../services/taskUsageTracker', () => ({ recordUsage: vi.fn(), getUsageForTask: vi.fn(() => null) }));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
// vi.mock do planner NÃO alcança o require() lazy do decomposeEpic — por isso os testes semeiam
// svc.decomposeEpic/approveDecomposition direto no singleton (padrão provado no red-team).
vi.mock('../../services/taskPlannerService', () => ({ taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) } }));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn(() => ({})) } }));
// notificationService: stub best-effort. O código usa require('./notificationService') lazy dentro do
// método e vi.mock/spyOn não alcança require lazy (memória do projeto: caches import≠require no vitest).
// Por isso os testes NÃO assertam sobre a notificação (cosmética, envolta em try/catch) — assertam os
// efeitos DURÁVEIS observáveis que provam que o ramo rodou (flag epicStalledNotified, attempts, eventos).
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));
const quotaState = vi.hoisted(() => ({ exhausted: false }));
vi.mock('../../services/llmQuotaState', () => ({
    isQuotaError: vi.fn((m: any) => typeof m === 'string' && m.includes('QUOTA')),
    isQuotaExhausted: vi.fn(() => quotaState.exhausted),
    markQuotaExhausted: vi.fn(), clearQuotaExhausted: vi.fn(),
    quotaStatus: vi.fn(() => ({ exhausted: quotaState.exhausted })),
}));
vi.mock('../../services/claudeCliService', () => ({ claudeCliService: { available: vi.fn(async () => true), runCode: vi.fn(), runText: vi.fn() } }));

import { taskRunnerService } from '../../services/taskRunnerService';
const svc = taskRunnerService as any;
const lastEvent = (t: any) => t.events[t.events.length - 1];

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
    quotaState.exhausted = false;
    svc.store = { tasks: {} };
    svc.save = vi.fn();
    svc.pendingExecs = 0;
    svc.epicSweepInFlight = false;
    svc.epicOpsInFlight = new Set();
    svc.execInFlight = new Map();
    svc.getAutomationConfig = vi.fn(() => ({ autoPlay: true, autoDecompose: true, dailyRoundBudget: 200 }));
    svc.isPeakHold = vi.fn(() => false);
    svc.dailyRoundsToday = vi.fn(() => 0);
    svc.autoPlayNext = vi.fn();
    // Semeados no singleton (require lazy do decomposeEpic não é mockável via vi.mock).
    svc.decomposeEpic = vi.fn(async (n: number) => { svc.store.tasks[n].decompositionPlan = { subTasks: [{}, {}] }; return svc.store.tasks[n]; });
    svc.approveDecomposition = vi.fn(async (n: number) => { svc.store.tasks[n].subTasks = [901, 902]; return svc.store.tasks[n]; });
});

describe('decomposeStuckEpics — caminho feliz', () => {
    it('épica SEM plano → decomposeEpic + approveDecomposition(strictDedup) + zera anti-spin + autoPlayNext', async () => {
        svc.store.tasks[10] = epic(10);
        await svc.decomposeStuckEpics();
        expect(svc.decomposeEpic).toHaveBeenCalledWith(10);
        expect(svc.approveDecomposition).toHaveBeenCalledWith(10, { strictDedup: true });
        expect(svc.store.tasks[10].epicDecomposeAttempts).toBe(0);
        expect(svc.store.tasks[10].epicDecomposeNextAttemptAt).toBeUndefined();
        expect(svc.store.tasks[10].subTasks).toEqual([901, 902]);
        expect(svc.autoPlayNext).toHaveBeenCalled();
    });

    it('épica COM plano → NÃO chama decomposeEpic, só approveDecomposition (evita 2ª chamada LLM)', async () => {
        svc.store.tasks[10] = epic(10, { decompositionPlan: { subTasks: [{}, {}] } });
        await svc.decomposeStuckEpics();
        expect(svc.decomposeEpic).not.toHaveBeenCalled();
        expect(svc.approveDecomposition).toHaveBeenCalledWith(10, { strictDedup: true });
    });

    it('serial: 1 épica por tick, ordenada por issueNumber asc', async () => {
        svc.store.tasks[20] = epic(20);
        svc.store.tasks[10] = epic(10);
        await svc.decomposeStuckEpics();
        expect(svc.decomposeEpic).toHaveBeenCalledTimes(1);
        expect(svc.decomposeEpic).toHaveBeenCalledWith(10);
    });
});

describe('decomposeStuckEpics — elegibilidade', () => {
    const runsFor = async (t: any) => {
        svc.store.tasks[t.issueNumber] = t;
        await svc.decomposeStuckEpics();
        return svc.decomposeEpic.mock.calls.length > 0;
    };
    it('pula épica COM subTasks (já decomposta)', async () => {
        expect(await runsFor(epic(10, { subTasks: [1, 2] }))).toBe(false);
    });
    it('pula kind:task', async () => {
        expect(await runsFor({ ...epic(10), kind: 'task' })).toBe(false);
    });
    it('pula com parentEpic (é sub de outra)', async () => {
        expect(await runsFor(epic(10, { parentEpic: 5 }))).toBe(false);
    });
    it('pula status terminal (failed)', async () => {
        expect(await runsFor(epic(10, { status: 'failed' }))).toBe(false);
    });
    it('pula em backoff futuro', async () => {
        expect(await runsFor(epic(10, { epicDecomposeNextAttemptAt: Date.now() + 3600_000 }))).toBe(false);
    });
    it('pula após 3 tentativas (cap)', async () => {
        expect(await runsFor(epic(10, { epicDecomposeAttempts: 3 }))).toBe(false);
    });
    it('backoff VENCIDO volta a ser elegível', async () => {
        expect(await runsFor(epic(10, { epicDecomposeAttempts: 1, epicDecomposeNextAttemptAt: Date.now() - 1000 }))).toBe(true);
    });
});

describe('decomposeStuckEpics — guardas de pausa', () => {
    beforeEach(() => { svc.store.tasks[10] = epic(10); });
    const swept = async () => { await svc.decomposeStuckEpics(); return svc.decomposeEpic.mock.calls.length > 0; };
    it('autoDecompose OFF → no-op', async () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: true, autoDecompose: false, dailyRoundBudget: 200 }));
        expect(await swept()).toBe(false);
    });
    it('autoPlay OFF → no-op', async () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: false, autoDecompose: true, dailyRoundBudget: 200 }));
        expect(await swept()).toBe(false);
    });
    it('#accelerate-sweep: pendingExecs>0 mas a issue NÃO está em dispatch → sweep RODA (nova capacidade)', async () => {
        svc.pendingExecs = 1;                 // outra task rodando
        svc.execInFlight = new Map([[999, 1]]); // uma OUTRA issue em voo, não a #10
        expect(await swept()).toBe(true);      // antes era no-op; agora destrava mesmo com a fila ocupada
    });
    it('#accelerate-sweep: a épica que está em dispatch (execInFlight) é PULADA (O2)', async () => {
        svc.store.tasks[11] = epic(11);       // outra elegível
        svc.execInFlight = new Map([[10, 1]]); // #10 em dispatch → pula ela, elege a #11
        await svc.decomposeStuckEpics();
        expect(svc.decomposeEpic).toHaveBeenCalledTimes(1);
        expect(svc.decomposeEpic).toHaveBeenCalledWith(11);
    });
    it('cota esgotada → no-op', async () => {
        quotaState.exhausted = true;
        expect(await swept()).toBe(false);
    });
    it('pico → no-op', async () => {
        svc.isPeakHold = vi.fn(() => true);
        expect(await swept()).toBe(false);
    });
    it('teto diário atingido → no-op', async () => {
        svc.dailyRoundsToday = vi.fn(() => 200);
        expect(await swept()).toBe(false);
    });
});

describe('decomposeStuckEpics — reentrância + crash-safety + anti-spin', () => {
    it('reentrância: 2ª chamada concorrente é no-op (epicSweepInFlight)', async () => {
        svc.store.tasks[10] = epic(10);
        let release!: () => void;
        svc.decomposeEpic = vi.fn(() => new Promise<any>(r => { release = () => r(svc.store.tasks[10]); }));
        const p1 = svc.decomposeStuckEpics();
        const p2 = svc.decomposeStuckEpics(); // deve sair no-op (sweep em voo)
        await p2;
        expect(svc.decomposeEpic).toHaveBeenCalledTimes(1);
        release();
        await p1;
    });

    it('crash-safety: attempts é incrementado e persistido ANTES da chamada LLM', async () => {
        svc.store.tasks[10] = epic(10);
        let attemptsAtCall: number | undefined;
        svc.decomposeEpic = vi.fn(async (n: number) => {
            attemptsAtCall = svc.store.tasks[n].epicDecomposeAttempts;
            svc.store.tasks[n].decompositionPlan = { subTasks: [{}] };
            return svc.store.tasks[n];
        });
        await svc.decomposeStuckEpics();
        expect(attemptsAtCall).toBe(1); // já incrementado quando o LLM roda
        expect(svc.save).toHaveBeenCalled();
    });

    it('falha genérica → attempts=1 + backoff futuro', async () => {
        svc.store.tasks[10] = epic(10);
        svc.decomposeEpic = vi.fn(async () => { throw new Error('boom'); });
        await svc.decomposeStuckEpics();
        expect(svc.store.tasks[10].epicDecomposeAttempts).toBe(1);
        expect(svc.store.tasks[10].epicDecomposeNextAttemptAt).toBeGreaterThan(Date.now());
        expect(svc.decomposeEpic).toHaveBeenCalledTimes(1);
    });

    it('3ª falha (cap) → attempts=3 e no tick seguinte o cap BARRA (não re-processa)', async () => {
        svc.store.tasks[10] = epic(10, { epicDecomposeAttempts: 2 });
        svc.decomposeEpic = vi.fn(async () => { throw new Error('boom'); });
        await svc.decomposeStuckEpics();
        expect(svc.store.tasks[10].epicDecomposeAttempts).toBe(3);
        // próximo tick: cap (>=3) barra a elegibilidade → não re-processa (nem re-notifica)
        await svc.decomposeStuckEpics();
        expect(svc.decomposeEpic).toHaveBeenCalledTimes(1);
    });

    it('falha por COTA → NÃO consome tentativa (attempts inalterado) + retry curto (~10min)', async () => {
        svc.store.tasks[10] = epic(10, { epicDecomposeAttempts: 1 });
        svc.decomposeEpic = vi.fn(async () => { throw new Error('QUOTA weekly limit'); });
        const before = Date.now();
        await svc.decomposeStuckEpics();
        expect(svc.store.tasks[10].epicDecomposeAttempts).toBe(1); // devolvida
        const backoff = svc.store.tasks[10].epicDecomposeNextAttemptAt - before;
        expect(backoff).toBeGreaterThan(9 * 60_000);
        expect(backoff).toBeLessThan(12 * 60_000);
    });
});

describe('listIssues — strict (fix error-as-empty #1347)', () => {
    it('sem strict: erro do gh → devolve [] (best-effort)', async () => {
        await expect(svc.listIssues('open')).resolves.toEqual([]);
    });
    it('com strict: erro do gh → PROPAGA (dedup precisa saber que a listagem falhou)', async () => {
        await expect(svc.listIssues('open', { strict: true })).rejects.toThrow();
    });
});

describe('approveDecomposition — strictDedup propaga falha ANTES de criar sub-issues', () => {
    it('listagem falha + strictDedup → rejeita e NÃO cria sub-tasks', async () => {
        // usa o approveDecomposition REAL (remove o seed)
        delete svc.approveDecomposition;
        svc.store.tasks[10] = epic(10, { decompositionPlan: { subTasks: [{ title: 'A', body: '', dependsOn: [], complexity: 'M', filesEstimate: [] }] } });
        svc.listIssues = vi.fn(async () => { throw new Error('list fail'); });
        await expect(svc.approveDecomposition(10, { strictDedup: true })).rejects.toThrow('list fail');
        expect(svc.store.tasks[10].subTasks).toBeUndefined();
        expect(svc.epicOpsInFlight.has(10)).toBe(false); // finally limpou a guarda
    });
});

describe('notifyStalledDecomposedEpics — 2º modo (subs todas terminais c/ falha)', () => {
    it('épica decomposta com subs todas terminais e ≥1 falha → seta flag durável (idempotente)', () => {
        svc.store.tasks[100] = epic(100, { subTasks: [101, 102] });
        svc.store.tasks[101] = sub(101, 'merged');
        svc.store.tasks[102] = sub(102, 'failed');
        svc.notifyStalledDecomposedEpics();
        expect(svc.store.tasks[100].epicStalledNotified).toBe(true);
        expect(lastEvent(svc.store.tasks[100]).meta?.stalledEpic).toBe(true);
        const eventsAfterFirst = svc.store.tasks[100].events.length;
        svc.notifyStalledDecomposedEpics(); // flag durável → não re-processa (sem novo evento)
        expect(svc.store.tasks[100].events.length).toBe(eventsAfterFirst);
    });
    it('subs todas MERGED (sem falha) → NÃO marca', () => {
        svc.store.tasks[100] = epic(100, { subTasks: [101, 102] });
        svc.store.tasks[101] = sub(101, 'merged');
        svc.store.tasks[102] = sub(102, 'merged');
        svc.notifyStalledDecomposedEpics();
        expect(svc.store.tasks[100].epicStalledNotified).toBeUndefined();
    });
    it('alguma sub ainda RODANDO (não-terminal) → NÃO marca', () => {
        svc.store.tasks[100] = epic(100, { subTasks: [101, 102] });
        svc.store.tasks[101] = sub(101, 'running');
        svc.store.tasks[102] = sub(102, 'failed');
        svc.notifyStalledDecomposedEpics();
        expect(svc.store.tasks[100].epicStalledNotified).toBeUndefined();
    });
    it('épica SEM subTasks → ignora (é caso do sweep decomposeStuckEpics)', () => {
        svc.store.tasks[100] = epic(100);
        svc.notifyStalledDecomposedEpics();
        expect(svc.store.tasks[100].epicStalledNotified).toBeUndefined();
    });
});

describe('#accelerate-sweep (red-team Fable O2) — scheduleExec marca/limpa execInFlight', () => {
    it('seta execInFlight SÍNCRONO no dispatch e limpa após o settle da cadeia', async () => {
        svc.execInFlight = new Map();
        svc.pendingExecs = 0;
        svc.execChains = new Map(); // #slot-chain: cadeia por-slot
        svc.autoPlayNext = vi.fn();
        // killRequested → a cadeia retorna cedo (cancel-signal) sem tocar planner/opencode → settle rápido.
        const task = { ...epic(10), kind: 'task', killRequested: true };
        svc.store.tasks[10] = task;
        svc.scheduleExec(task, 'branch-x', 'running', { id: 1, root: '/tmp/wt', dataDir: null });
        expect(svc.execInFlight.has(10)).toBe(true);   // marcado ANTES de qualquer await
        expect(svc.pendingExecs).toBe(1);
        await svc.chainFor(1);                          // deixa o finally rodar (pipeline completo → pendingExecs=0)
        expect(svc.execInFlight.has(10)).toBe(false);   // limpo no finally
        expect(svc.pendingExecs).toBe(0);
    });

    it('uma issue em execInFlight bloqueia SÓ ela no sweep; épica em voo não é decomposta', async () => {
        svc.execInFlight = new Map([[10, 1]]);
        svc.store.tasks[10] = epic(10); // shape de presa, mas está em dispatch
        await svc.decomposeStuckEpics();
        expect(svc.decomposeEpic).not.toHaveBeenCalled();
    });
});
