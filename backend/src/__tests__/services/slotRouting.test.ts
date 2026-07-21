import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (hoisted) — espelham o header de taskRunnerService.judgeErrorRetry.test.ts ===
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

import { runOpencode } from '../../utils/runOpencode';
import { taskRunnerService } from '../../services/taskRunnerService';

const svc = taskRunnerService as any;

// runOpencode(command, cwd, task, timeoutMs, onSample?, opts?) — o cwd é o 2º arg posicional (índice 1).
// Esta suíte PROVA o roteamento por slot: runOpencodeIsolated deve passar `slot.root` como cwd, tanto
// na chamada PRIMÁRIA quanto no FALLBACK (era a antiga const global WT_ROOT). Com um slot fake apontando
// p/ um root distinto, um threading incorreto (uso residual de WT_ROOT) apareceria como cwd errado.
const CWD_ARG = 1;
const fakeSlot = { id: 1, root: '/tmp/fake-slot', dataDir: null };

function makeTask(num: number) {
    svc.store.tasks[num] = {
        issueNumber: num, title: `Task ${num}`, body: '', labels: ['opencode-task'],
        status: 'running', feedbackHistory: [], events: [],
        updatedAt: new Date().toISOString(), phase: 'exploring', attempts: [], kind: 'task',
    };
    return svc.store.tasks[num];
}

beforeEach(() => {
    svc.stopPolling?.();
    vi.clearAllMocks();
    svc.store = { tasks: {} };
});

describe('roteamento por slot (Degrau-2 PR-2) — runOpencodeIsolated usa slot.root como cwd', () => {
    it('chamada PRIMÁRIA roda no cwd == slot.root', async () => {
        const task = makeTask(900);
        vi.mocked(runOpencode).mockResolvedValueOnce('ok primário');

        const out = await svc.runOpencodeIsolated(task, fakeSlot);

        expect(out).toBe('ok primário');
        expect(runOpencode).toHaveBeenCalledTimes(1);
        expect(vi.mocked(runOpencode).mock.calls[0][CWD_ARG]).toBe('/tmp/fake-slot');
    });

    it('FALLBACK (após 429 no primário) TAMBÉM roda no cwd == slot.root', async () => {
        const task = makeTask(901);
        vi.mocked(runOpencode)
            .mockRejectedValueOnce(new Error('opencode exited code=1: HTTP 429 too many requests'))
            .mockResolvedValueOnce('ok fallback');

        const out = await svc.runOpencodeIsolated(task, fakeSlot);

        expect(out).toBe('ok fallback');
        expect(runOpencode).toHaveBeenCalledTimes(2);
        // primário E fallback: os DOIS spawnam no workspace do slot.
        expect(vi.mocked(runOpencode).mock.calls[0][CWD_ARG]).toBe('/tmp/fake-slot');
        expect(vi.mocked(runOpencode).mock.calls[1][CWD_ARG]).toBe('/tmp/fake-slot');
    });

    it('slot DIFERENTE → o cwd acompanha o slot (não fixo num WT_ROOT global)', async () => {
        const task = makeTask(902);
        const otherSlot = { id: 2, root: '/tmp/outro-slot', dataDir: null };
        vi.mocked(runOpencode).mockResolvedValueOnce('ok');

        await svc.runOpencodeIsolated(task, otherSlot);

        expect(vi.mocked(runOpencode).mock.calls[0][CWD_ARG]).toBe('/tmp/outro-slot');
    });
});
