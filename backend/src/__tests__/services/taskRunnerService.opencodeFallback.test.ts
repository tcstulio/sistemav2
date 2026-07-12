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

import { runOpencode } from '../../utils/runOpencode';
import { taskRunnerService, shouldFallbackOpencode } from '../../services/taskRunnerService';

const svc = taskRunnerService as any;

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

describe('opencode fallback GLM→MiniMax (diretriz 2026-07-11)', () => {
    it('falha por 429/cota → re-roda com --model minimax/MiniMax-M3', async () => {
        const task = makeTask(800);
        vi.mocked(runOpencode)
            .mockRejectedValueOnce(new Error('opencode exited code=1: HTTP 429 too many requests'))
            .mockResolvedValueOnce('ok do fallback');

        const out = await svc.runOpencodeIsolated(task);

        expect(out).toBe('ok do fallback');
        expect(runOpencode).toHaveBeenCalledTimes(2);
        const secondCmd = vi.mocked(runOpencode).mock.calls[1][0] as string;
        expect(secondCmd).toContain('--model minimax/MiniMax-M3');
        // evento audível na timeline
        expect(task.events.some((e: any) => /fallback/i.test(e.message || ''))).toBe(true);
    });

    it('TIMEOUT/hang do primário (GLM pendurado sem 429) → re-roda com fallback', async () => {
        const task = makeTask(805);
        // Sob limite semanal o GLM pendura até o timeout de 1800s em vez de 429 — era o que matava as tasks.
        vi.mocked(runOpencode)
            .mockRejectedValueOnce(new Error('opencode timeout (1800s) — últimas linhas do output:\n...'))
            .mockResolvedValueOnce('ok do fallback pós-timeout');

        const out = await svc.runOpencodeIsolated(task);

        expect(out).toBe('ok do fallback pós-timeout');
        expect(runOpencode).toHaveBeenCalledTimes(2);
        expect(vi.mocked(runOpencode).mock.calls[1][0] as string).toContain('--model minimax/MiniMax-M3');
        // evento deve deixar claro que foi timeout/hang, não cota
        expect(task.events.some((e: any) => /timeout|hang/i.test(e.message || ''))).toBe(true);
    });

    it('falha que NÃO é cota (erro de código/exit) NÃO re-roda — propaga', async () => {
        const task = makeTask(801);
        vi.mocked(runOpencode).mockRejectedValueOnce(new Error('opencode exited code=1: SyntaxError em foo.ts'));

        await expect(svc.runOpencodeIsolated(task)).rejects.toThrow(/SyntaxError/);
        expect(runOpencode).toHaveBeenCalledTimes(1);
    });

    it('kill solicitado durante o run NÃO dispara fallback', async () => {
        const task = makeTask(802);
        task.killRequested = true;
        vi.mocked(runOpencode).mockRejectedValueOnce(new Error('HTTP 429 too many requests'));

        await expect(svc.runOpencodeIsolated(task)).rejects.toThrow(/429/);
        expect(runOpencode).toHaveBeenCalledTimes(1);
    });

    it('sucesso no primário nunca chama o fallback', async () => {
        const task = makeTask(803);
        vi.mocked(runOpencode).mockResolvedValueOnce('ok primário');

        const out = await svc.runOpencodeIsolated(task);
        expect(out).toBe('ok primário');
        expect(runOpencode).toHaveBeenCalledTimes(1);
    });

    it('fallback também falhando → propaga o erro do fallback', async () => {
        const task = makeTask(804);
        vi.mocked(runOpencode)
            .mockRejectedValueOnce(new Error('rate limit'))
            .mockRejectedValueOnce(new Error('insufficient balance (1008)'));

        await expect(svc.runOpencodeIsolated(task)).rejects.toThrow(/1008/);
        expect(runOpencode).toHaveBeenCalledTimes(2);
    });
});

describe('shouldFallbackOpencode (decisão pura)', () => {
    const ok = { hasFallbackModel: true, killRequested: false, primaryIsFallback: false };

    it('timeout do opencode (hang) → true', () => {
        expect(shouldFallbackOpencode('opencode timeout (1800s) — últimas linhas...', ok)).toBe(true);
    });
    it('429/cota → true', () => {
        expect(shouldFallbackOpencode('opencode exited: HTTP 429 too many requests', ok)).toBe(true);
        expect(shouldFallbackOpencode('insufficient balance (1008)', ok)).toBe(true);
    });
    it('erro de código (não-cota, não-timeout) → false', () => {
        expect(shouldFallbackOpencode('SyntaxError em foo.ts', ok)).toBe(false);
    });
    it('sem modelo de fallback → false mesmo em timeout', () => {
        expect(shouldFallbackOpencode('opencode timeout (1800s)', { ...ok, hasFallbackModel: false })).toBe(false);
    });
    it('kill solicitado → false', () => {
        expect(shouldFallbackOpencode('HTTP 429', { ...ok, killRequested: true })).toBe(false);
    });
    it('primário JÁ é o fallback → false (não re-roda o mesmo modelo)', () => {
        expect(shouldFallbackOpencode('opencode timeout (1800s)', { ...ok, primaryIsFallback: true })).toBe(false);
    });
});
