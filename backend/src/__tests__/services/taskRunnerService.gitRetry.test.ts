import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks mínimos p/ carregar o taskRunnerService sem tocar serviços reais.
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
import { git, gitFetchWithRetry } from '../../services/taskRunnerService';

/** Faz o execFile mockado (usado via promisify) resolver/rejeitar via callback conforme uma fila. */
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

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('#1357 — git() enriquece o erro com stderr/exitcode', () => {
    it('anexa stderr e exit code à message genérica "Command failed"', async () => {
        const err: any = new Error('Command failed: git fetch origin main');
        err.stderr = 'fatal: unable to access: Could not resolve host';
        err.code = 128;
        queueExecFile([{ err }]);

        await expect(git(['fetch', 'origin', 'main'])).rejects.toThrow(/Could not resolve host/);
        try { await git(['fetch', 'origin', 'main']); } catch (e: any) {
            expect(e.message).toContain('exit=128');
            expect(e.message).toContain('stderr:');
        }
    });

    it('sucesso passa direto (sem tocar a message)', async () => {
        queueExecFile([{ stdout: 'ok' }]);
        const r = await git(['status']);
        expect(r.stdout).toBe('ok');
    });
});

describe('#1357 — gitFetchWithRetry: retry com backoff', () => {
    it('falha 1x depois OK → resolve (task NÃO morre)', async () => {
        vi.useFakeTimers();
        const err: any = new Error('Command failed: git fetch'); err.stderr = 'lock'; err.code = 128;
        queueExecFile([{ err }, { stdout: 'fetched' }]);

        const p = gitFetchWithRetry(['fetch', 'origin', 'main']);
        await vi.runAllTimersAsync(); // avança o backoff
        await expect(p).resolves.toMatchObject({ stdout: 'fetched' });
        expect(vi.mocked(execFile).mock.calls.length).toBe(2);
    });

    it('falha SEMPRE → rejeita após N tentativas, com stderr capturado', async () => {
        vi.useFakeTimers();
        const err: any = new Error('Command failed: git fetch'); err.stderr = 'timeout'; err.code = 128;
        queueExecFile([{ err }]);

        const p = gitFetchWithRetry(['fetch', 'origin', 'main'], undefined, 3);
        const assertion = expect(p).rejects.toThrow(/timeout/);
        await vi.runAllTimersAsync();
        await assertion;
        expect(vi.mocked(execFile).mock.calls.length).toBe(3);
    });

    it('sucesso na 1ª → sem retry (não desperdiça tentativa)', async () => {
        queueExecFile([{ stdout: 'ok' }]);
        await expect(gitFetchWithRetry(['fetch', 'origin', 'main'])).resolves.toMatchObject({ stdout: 'ok' });
        expect(vi.mocked(execFile).mock.calls.length).toBe(1);
    });

    // Revisão adversarial: não re-tentar erro PERMANENTE (desperdício + retry sob lock atrasa watchdog).
    it('erro permanente (index.lock) NÃO re-tenta — falha na 1ª', async () => {
        const err: any = new Error('Command failed'); err.stderr = 'fatal: Unable to create index.lock: File exists'; err.code = 128;
        queueExecFile([{ err }]);
        await expect(gitFetchWithRetry(['fetch', 'origin', 'main'], undefined, 3)).rejects.toThrow(/index\.lock/);
        expect(vi.mocked(execFile).mock.calls.length).toBe(1);
    });

    it('erro permanente (auth) NÃO re-tenta', async () => {
        const err: any = new Error('Command failed'); err.stderr = 'fatal: Authentication failed'; err.code = 128;
        queueExecFile([{ err }]);
        await expect(gitFetchWithRetry(['fetch', 'origin', 'main'], undefined, 3)).rejects.toThrow(/Authentication/);
        expect(vi.mocked(execFile).mock.calls.length).toBe(1);
    });

    it('shouldAbort=true antes da 1ª → aborta sem chamar git (task cancelada)', async () => {
        queueExecFile([{ stdout: 'nunca' }]);
        await expect(gitFetchWithRetry(['fetch', 'origin', 'main'], undefined, 3, () => true)).rejects.toThrow(/abortado/);
        expect(vi.mocked(execFile).mock.calls.length).toBe(0);
    });

    it('shouldAbort vira true entre tentativas → para o retry (não segue sob lock após kill)', async () => {
        vi.useFakeTimers();
        const err: any = new Error('Command failed'); err.stderr = 'timeout'; err.code = 128;
        queueExecFile([{ err }]);
        let killed = false;
        const p = gitFetchWithRetry(['fetch', 'origin', 'main'], undefined, 3, () => killed);
        killed = true; // watchdog cancela a task após a 1ª falha
        const assertion = expect(p).rejects.toBeTruthy();
        await vi.runAllTimersAsync();
        await assertion;
        expect(vi.mocked(execFile).mock.calls.length).toBe(1); // não seguiu p/ a 2ª
    });
});
