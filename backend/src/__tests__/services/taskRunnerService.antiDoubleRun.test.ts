import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #flip PR-B — GUARDS anti-double-run. Oráculo executável do risco G6: a MESMA issue NUNCA roda em 2
// slots ao mesmo tempo. `execInFlight` (Map por issueNumber, setado no prólogo do scheduleExec) é o único
// predicado SÍNCRONO que cobre a janela 'pending'-eleita (dispatch agendado, status ainda pending). Os
// entry-points (startTask/escalateTask/redoTask) rejeitam se a issue está em voo; addFeedback NÃO joga fora
// o feedback humano — persiste em durableFeedback e NÃO agenda 2ª exec.
//
// Header de mocks espelhado de slotAffinity.test.ts / claimAtomic.test.ts (mesmo bloco hoisted).
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

import * as childProcess from 'child_process';
import { taskRunnerService } from '../../services/taskRunnerService';
import { slotManager } from '../../services/slotManager';

const svc = taskRunnerService as any;
const execFileMock = childProcess.execFile as unknown as ReturnType<typeof vi.fn>;

const SLOT2 = { id: 2, root: '/tmp/s2', dataDir: '/tmp/s2-xdg', kind: 'clone' as const };

function makeTask(num: number, over: Record<string, any> = {}) {
    svc.store.tasks[num] = {
        issueNumber: num, title: `Task ${num}`, body: '', labels: ['opencode-task'],
        status: 'reviewing', feedbackHistory: [], events: [],
        updatedAt: new Date().toISOString(), phase: 'exploring', attempts: [], kind: 'task',
        branch: `fix-${num}`, ...over,
    };
    return svc.store.tasks[num];
}

beforeEach(() => {
    svc.stopPolling?.();
    vi.clearAllMocks();
    svc.store = { tasks: {} };
    svc.execInFlight = new Map();
    // neutraliza a fila real: os testes só checam se scheduleExec FOI ou NÃO chamado.
    vi.spyOn(svc, 'scheduleExec').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── 1. startTask duplicado ──────────────────────────────────────────────────
describe('#flip PR-B — startTask com exec em voo REJEITA', () => {
    it('issue 9 em execInFlight → startTask(9) rejeita', async () => {
        makeTask(9, { status: 'reviewing' });
        svc.execInFlight = new Map([[9, 1]]);
        await expect(svc.startTask(9)).rejects.toThrow(/execução em voo/i);
        // não mutou/agendou
        expect(svc.scheduleExec).not.toHaveBeenCalled();
    });

    it('issue 9 NÃO em voo → startTask agenda (comportamento preservado)', async () => {
        makeTask(9, { status: 'reviewing' });
        await svc.startTask(9);
        expect(svc.scheduleExec).toHaveBeenCalledTimes(1);
    });
});

// ── 2. escalate/redo duplicado ──────────────────────────────────────────────
describe('#flip PR-B — escalateTask/redoTask com exec em voo REJEITAM', () => {
    it('escalateTask(9) em voo → rejeita, sem agendar', async () => {
        makeTask(9, { status: 'reviewing' });
        svc.execInFlight = new Map([[9, 1]]);
        await expect(svc.escalateTask(9, 'opus')).rejects.toThrow(/execução em voo/i);
        expect(svc.scheduleExec).not.toHaveBeenCalled();
    });

    it('redoTask(9) em voo → rejeita ANTES do `gh pr close` (nenhuma chamada pr/close)', async () => {
        makeTask(9, { status: 'reviewing', prNumber: 555 });
        svc.execInFlight = new Map([[9, 1]]);
        await expect(svc.redoTask(9)).rejects.toThrow(/redo ignorado/i);
        expect(svc.scheduleExec).not.toHaveBeenCalled();
        // PROVA: o guard vem ANTES do `gh pr close` — execFile NUNCA foi invocado com 'pr','close'.
        const closeCalls = execFileMock.mock.calls.filter(
            (c: any) => Array.isArray(c[1]) && c[1].includes('pr') && c[1].includes('close'),
        );
        expect(closeCalls).toHaveLength(0);
    });
});

// ── 3. addFeedback em voo: persiste, NÃO agenda ─────────────────────────────
describe('#flip PR-B — addFeedback com exec em voo persiste sem re-agendar', () => {
    it('issue 9 em voo: durableFeedback cresce, scheduleExec NÃO é chamado, retorna task com feedback_received', async () => {
        const task = makeTask(9, { status: 'reviewing', durableFeedback: [] });
        svc.execInFlight = new Map([[9, 1]]);

        const before = task.durableFeedback.length;
        const out = await svc.addFeedback(9, 'corrija o botão azul');

        expect(out.durableFeedback.length).toBe(before + 1);
        expect(out.durableFeedback).toContain('corrija o botão azul');
        expect(svc.scheduleExec).not.toHaveBeenCalled();
        // não transiciona p/ 'fixing' (a rodada em andamento consome o durableFeedback)
        expect(out.status).toBe('reviewing');
        const ev = out.events[out.events.length - 1];
        expect(ev.type).toBe('feedback_received');
        expect(ev.meta?.inFlight).toBe(true);
    });
});

// ── 4. addFeedback SEM voo: agenda (comportamento atual preservado) ──────────
describe('#flip PR-B — addFeedback SEM exec em voo preserva o caminho atual', () => {
    it('issue NÃO em voo → agenda (scheduleExec chamado) + status fixing', async () => {
        const task = makeTask(9, { status: 'reviewing', durableFeedback: [] });
        // execInFlight vazio (default do beforeEach)
        const out = await svc.addFeedback(9, 'ajuste o layout');

        expect(out.durableFeedback).toContain('ajuste o layout');
        expect(svc.scheduleExec).toHaveBeenCalledTimes(1);
        expect(out.status).toBe('fixing');
    });
});

// ── 5. isExecInFlight reflete o Map ─────────────────────────────────────────
describe('#flip PR-B — isExecInFlight (read-only)', () => {
    it('reflete o estado do Map execInFlight', () => {
        svc.execInFlight = new Map([[42, 1]]);
        expect(svc.isExecInFlight(42)).toBe(true);
        expect(svc.isExecInFlight(43)).toBe(false);
        svc.execInFlight.delete(42);
        expect(svc.isExecInFlight(42)).toBe(false);
    });
});

// ── 6. I1 mestre: com slot-2 registrado, redoTask de issue em voo REJEITA ────
describe('#flip PR-B — I1 mestre: NUNCA 2 execs da mesma issue (slot-2 ativo)', () => {
    beforeEach(() => {
        slotManager.registerSlot2(SLOT2);
    });
    afterEach(() => {
        slotManager.unregisterSlot2();
    });

    it('slot-2 ativo + dispatch de #200 (execInFlight.set) → redoTask(200) rejeita (prova: nunca 2 execs)', async () => {
        makeTask(200, { status: 'reviewing', slotId: 2, prNumber: 777 });
        // simula o dispatch já em voo (o que o scheduleExec faz no prólogo real)
        svc.execInFlight.set(200, 1);

        await expect(svc.redoTask(200)).rejects.toThrow(/redo ignorado/i);
        // nunca agendou uma 2ª exec, nem fechou o PR da exec viva
        expect(svc.scheduleExec).not.toHaveBeenCalled();
        const closeCalls = execFileMock.mock.calls.filter(
            (c: any) => Array.isArray(c[1]) && c[1].includes('pr') && c[1].includes('close'),
        );
        expect(closeCalls).toHaveLength(0);
    });
});
