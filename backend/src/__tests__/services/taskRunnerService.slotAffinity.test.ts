import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #flip PR-A — AFINIDADE de slot. Oráculo executável: a task carrega seu slot pelo ciclo de vida
// inteiro (auto-fix/selfHeal/redo/feedback/escalate/preview/diff/kill). Com o clamp da fundação em 1
// (slots()=[slot1]), slotForTask devolve sempre slot-1 → byte-idêntico. Aqui REGISTRAMOS um slot-2
// fake p/ PROVAR a afinidade com N=2 (o que o flip real habilitará), sem ligar o clamp de verdade.
//
// Header de mocks espelhado de slotRouting.test.ts / killPerSlot.test.ts (mesmo bloco hoisted).
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
import { slotManager } from '../../services/slotManager';

const svc = taskRunnerService as any;

// scheduleExec(task, branch, activeStatus, slot) — o SLOT é o 4º arg posicional (índice 3). Espionamos
// para inspecionar QUAL slot cada caminho do ciclo de vida escolhe, sem disparar a fila de verdade.
const SLOT_ARG = 3;

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
    slotManager.registerSlot2(SLOT2);
});

afterEach(() => {
    slotManager.unregisterSlot2();
});

describe('#flip PR-A — resolver slotForTask (afinidade)', () => {
    it('task com slotId=2 → slotForTask devolve o slot-2 registrado', () => {
        const task = makeTask(700, { slotId: 2 });
        expect(svc.slotForTask(task).id).toBe(2);
    });

    it('fallback: slotId=2 mas slot-2 DESREGISTRADO → devolve slot-1 (id=1)', () => {
        const task = makeTask(701, { slotId: 2 });
        slotManager.unregisterSlot2(); // slot-2 some (oBoot/clone inválido)
        expect(svc.slotForTask(task).id).toBe(1);
        expect(svc.slotForTask(task)).toBe(slotManager.slot1);
    });

    it('byte-idêntico: task VIRGEM (slotId undefined) → slot-1', () => {
        const task = makeTask(702); // sem slotId
        expect(task.slotId).toBeUndefined();
        expect(svc.slotForTask(task).id).toBe(1);
        expect(svc.slotForTask(task)).toBe(slotManager.slot1);
    });
});

describe('#flip PR-A — afinidade nos caminhos do ciclo de vida (task slotId=2 agenda no slot-2)', () => {
    let scheduleSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        // neutraliza a fila real: só inspecionamos o 4º arg (slot).
        scheduleSpy = vi.spyOn(svc, 'scheduleExec').mockImplementation(() => {});
    });
    afterEach(() => { scheduleSpy.mockRestore(); });

    const lastSlot = () => scheduleSpy.mock.calls[scheduleSpy.mock.calls.length - 1]?.[SLOT_ARG] as any;

    it('selfHealFromGate (auto-fix por gate) agenda no slot-2', () => {
        const task = makeTask(710, { slotId: 2, status: 'approved', gateFixAttempts: 0 });
        const ok = svc.selfHealFromGate(task, 'testRegression', 'regrediu 2 testes');
        expect(ok).toBe(true);
        expect(lastSlot().id).toBe(2);
    });

    it('redoTask agenda no slot-2', async () => {
        const task = makeTask(711, { slotId: 2 });
        await svc.redoTask(711);
        expect(lastSlot().id).toBe(2);
    });

    it('addFeedback agenda no slot-2', async () => {
        const task = makeTask(712, { slotId: 2 });
        await svc.addFeedback(712, 'ajuste isto');
        expect(lastSlot().id).toBe(2);
    });

    it('escalateTask agenda no slot-2', async () => {
        const task = makeTask(713, { slotId: 2, status: 'reviewing' });
        await svc.escalateTask(713, 'opus');
        expect(lastSlot().id).toBe(2);
    });

    it('startTask (sem opts.slot) usa a afinidade → slot-2', async () => {
        const task = makeTask(714, { slotId: 2, status: 'reviewing' });
        await svc.startTask(714);
        expect(lastSlot().id).toBe(2);
    });

    it('fallback vivo: slotId=2 mas slot-2 DESREGISTRADO → agenda no slot-1', async () => {
        const task = makeTask(715, { slotId: 2 });
        slotManager.unregisterSlot2();
        await svc.redoTask(715);
        expect(lastSlot().id).toBe(1);
    });

    it('byte-idêntico: task virgem → agenda no slot-1', async () => {
        const task = makeTask(716); // sem slotId
        await svc.redoTask(716);
        expect(lastSlot().id).toBe(1);
    });
});

describe('#flip PR-A — carimbo do slotId (scheduleExec é o ÚNICO escritor)', () => {
    it('scheduleExec grava task.slotId com o id do slot passado', () => {
        const task = makeTask(720); // virgem
        // preflight resolve early → a fila aborta logo após o carimbo SÍNCRONO (sem tocar o Planner/opencode).
        vi.spyOn(svc, 'preflightAlreadyDone').mockResolvedValue({ done: true, hint: '' });
        expect(task.slotId).toBeUndefined();
        svc.scheduleExec(task, 'fix-720', 'running', SLOT2);
        // o carimbo é síncrono (antes de qualquer await) → já vale imediatamente.
        expect(task.slotId).toBe(2);
    });

    it('startTask com opts.slot carimba o slotId do slot eleito', async () => {
        const task = makeTask(721, { status: 'reviewing' }); // virgem
        vi.spyOn(svc, 'preflightAlreadyDone').mockResolvedValue({ done: true, hint: '' });
        await svc.startTask(721, { slot: SLOT2 });
        expect(task.slotId).toBe(2);
    });
});

describe('#flip PR-A — lock-timeout NÃO mata vizinho (seleção do stuckTask por-slot)', () => {
    it('a seleção do stuckTask do slot-2 só encontra a task DO slot-2 (poupa o coder do slot-1)', () => {
        const t1 = makeTask(730, { slotId: 1, status: 'running' });
        const t2 = makeTask(731, { slotId: 2, status: 'running' });
        // Réplica EXATA do predicado do handler do lock do slot-2 (slot.id === 2):
        const stuck = Object.values(svc.store.tasks).find(
            (t: any) => (t.status === 'running' || t.status === 'fixing') && svc.slotForTask(t).id === 2,
        ) as any;
        expect(stuck.issueNumber).toBe(731);
        // o vizinho do slot-1 NÃO foi selecionado → não seria marcado failed pelo handler do slot-2.
        expect(t1.status).toBe('running');
        expect(t2.status).toBe('running');
    });

    it('o handler do lock do slot-1 só encontra a task do slot-1', () => {
        makeTask(732, { slotId: 1, status: 'fixing' });
        makeTask(733, { slotId: 2, status: 'running' });
        const stuck = Object.values(svc.store.tasks).find(
            (t: any) => (t.status === 'running' || t.status === 'fixing') && svc.slotForTask(t).id === 1,
        ) as any;
        expect(stuck.issueNumber).toBe(732);
    });
});
