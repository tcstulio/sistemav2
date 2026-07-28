import { describe, it, expect, vi, beforeEach } from 'vitest';

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
const svc = taskRunnerService as any;

// emitStatus é método do SINGLETON; o teste do item 17 o substitui por um vi.fn() e não restaura.
// Capturamos o real e restauramos a cada teste p/ o item 19 (que exercita o emitStatus de verdade).
const realEmitStatus = svc.emitStatus;
beforeEach(() => { svc.stopPolling?.(); vi.clearAllMocks(); svc.emitStatus = realEmitStatus; });

describe('#1154 P2 item 20 — task.events tem cap (não cresce sem limite)', () => {
    it('mantém os últimos 500 eventos', () => {
        svc.save = vi.fn();
        const task: any = { issueNumber: 1, events: [] };
        for (let i = 0; i < 620; i++) svc.recordEvent(task, 'task_started', `evt ${i}`);
        expect(task.events.length).toBe(500);
        expect(task.events[task.events.length - 1].message).toBe('evt 619'); // mais recente preservado
        expect(task.events[0].message).toBe('evt 120');                     // 120..619 = 500
    });
});

describe('#1154 P2 item 17 — recovery de boot é AUDÍVEL (emitStatus dispara a notificação)', () => {
    // #resiliencia FIX1: o recovery de boot agora RE-ENFILEIRA (transitório) em vez de marcar 'failed'
    // permanente — restart do backend é ambiente, não falha do trabalho. A AUDIBILIDADE (emitStatus) que
    // este item garante segue valendo nos DOIS ramos (re-enfileira e teto).
    it('task running SEM restartRequeues → re-enfileira (pending) e emite status', () => {
        svc.store = { tasks: { 7: { issueNumber: 7, status: 'running', events: [] } } };
        svc.emitStatus = vi.fn(); svc.recordEvent = vi.fn(); svc.save = vi.fn();
        svc.recoverStuckTasksOnBoot();
        expect(svc.store.tasks[7].status).toBe('pending');
        expect(svc.store.tasks[7].restartRequeues).toBe(1);
        expect(svc.emitStatus).toHaveBeenCalledWith(svc.store.tasks[7]); // audível nos dois ramos
    });
    it('task running com restartRequeues=3 (teto) → vira failed e emite status', () => {
        svc.store = { tasks: { 7: { issueNumber: 7, status: 'running', events: [], restartRequeues: 3 } } };
        svc.emitStatus = vi.fn(); svc.recordEvent = vi.fn(); svc.save = vi.fn();
        svc.recoverStuckTasksOnBoot();
        expect(svc.store.tasks[7].status).toBe('failed');
        expect(svc.emitStatus).toHaveBeenCalledWith(svc.store.tasks[7]);
    });
});

describe('#1154 P2 item 19 — recomeçar trabalho reseta a idempotência de notificação', () => {
    it('emitStatus em status ativo (fixing) zera _lastNotifiedStatus → reviewing volta a notificar', () => {
        svc.save = vi.fn();
        const task: any = {
            issueNumber: 2, status: 'fixing', phase: 'synthesizing', _lastNotifiedStatus: 'reviewing',
            events: [], updatedAt: 'x', prNumber: 9,
        };
        svc.emitStatus(task);
        expect(task._lastNotifiedStatus).toBeUndefined();
    });
});
