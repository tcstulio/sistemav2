import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocks (espelham o gate/queue test + o novo diskSpace, controlável) ===
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

// diskSpace: getFreeDiskBytes controlável por fila; formatGB com a impl real (msgs previsíveis).
const GB = 1024 * 1024 * 1024;
const freeBytesQueue: (number | null)[] = [];
vi.mock('../../utils/diskSpace', () => ({
    getFreeDiskBytes: vi.fn(async () => (freeBytesQueue.length ? freeBytesQueue.shift()! : null)),
    formatGB: (b: number) => (b / GB).toFixed(2),
}));

import { execFile, exec } from 'child_process';
import { taskRunnerService } from '../../services/taskRunnerService';
import { getFreeDiskBytes } from '../../utils/diskSpace';
import type { Task } from '../../services/taskRunnerService';

function makeTask(n: number): Task {
    return {
        issueNumber: n, title: `#${n}`, body: 'b', labels: ['opencode-task'],
        status: 'running', feedbackHistory: [], events: [], attempts: [],
        updatedAt: new Date().toISOString(), phase: 'exploring', kind: 'task',
        branch: `fix-${n}`,
    } as Task;
}

describe('taskRunnerService — guard de disco (#1111)', () => {
    let svc: any;

    beforeEach(() => {
        svc = taskRunnerService as any;
        svc.pendingExecs = 0;
        svc.execChain = Promise.resolve();
        svc.worktreeLock = Promise.resolve();
        svc.currentExecTask = undefined;
        svc.store = { tasks: {} };
        svc.getAutomationConfig = () => ({ autoPlay: false, autoMerge: true, autoDecompose: false, minMergeScore: 8 });
        svc.scheduleExec = vi.fn();
        svc.refreshOriginMain = vi.fn();

        freeBytesQueue.length = 0;
        vi.mocked(getFreeDiskBytes).mockClear();

        // git → stdout vazio (tudo "succeed"); registra args p/ inspeção.
        vi.mocked(execFile).mockImplementation((file: string, args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            setImmediate(() => cb(null, { stdout: '', stderr: '' }));
            return undefined as any;
        });
        // exec (usado por `sh` no ensureDeps npm ci) — resolve vazio p/ não pendurar.
        vi.mocked(exec).mockImplementation((_cmd: string, opts: any, cb: any) => {
            if (typeof opts === 'function') cb = opts;
            setImmediate(() => cb(null, { stdout: '', stderr: '' }));
            return undefined as any;
        });
    });

    afterEach(() => { vi.restoreAllMocks(); });

    // --- ensureDiskSpace: fail-fast com mensagem clara quando o disco continua baixo ---
    it('disco BAIXO persistente → lança "disco insuficiente" com GB (não zumbi)', async () => {
        const t = makeTask(1);
        freeBytesQueue.push(1 * GB, 1 * GB); // antes e depois da limpeza = ainda baixo
        await expect(svc.ensureDiskSpace(t)).rejects.toThrow(/disco insuficiente: 1\.00 GB livres.*3\.00 GB/i);
    });

    it('disco BAIXO persistente → registra evento task_failed + meta diskFull', async () => {
        const t = makeTask(2);
        freeBytesQueue.push(0.5 * GB, 0.5 * GB);
        await expect(svc.ensureDiskSpace(t)).rejects.toThrow();
        const failEvt = t.events.find((e: any) => e.type === 'task_failed');
        expect(failEvt).toBeTruthy();
        expect(failEvt.meta?.diskFull).toBe(true);
    });

    it('disco BAIXO → tenta limpeza (chama worktree prune + reap) e re-mede', async () => {
        const t = makeTask(3);
        freeBytesQueue.push(0.2 * GB, 0.2 * GB);
        const sweepSpy = vi.spyOn(svc, 'sweepOrphanedOpencode' as any).mockResolvedValue(true);
        await expect(svc.ensureDiskSpace(t)).rejects.toThrow(/disco insuficiente/i);
        // worktree prune (git) e sweepOrphanedOpencode foram acionados durante a limpeza.
        expect(vi.mocked(execFile).mock.calls.some((c: any[]) => c[0] === 'git' && c[1]?.[0] === 'worktree' && c[1]?.[1] === 'prune')).toBe(true);
        expect(sweepSpy).toHaveBeenCalled();
    });

    // --- ensureDiskSpace: limpeza recupera espaço → prossegue ---
    it('disco BAIXO mas limpeza RECUPERA → não lança e registra recovery', async () => {
        const t = makeTask(4);
        freeBytesQueue.push(1 * GB, 5 * GB); // baixo antes, OK depois da limpeza
        await expect(svc.ensureDiskSpace(t)).resolves.toBeUndefined();
        const recEvt = t.events.find((e: any) => e.type === 'worktree_cleanup' && e.meta?.diskRecovered);
        expect(recEvt).toBeTruthy();
    });

    // --- ensureDiskSpace: medição indisponível → best-effort prossegue ---
    it('medição indisponível (null) → não bloqueia (best-effort)', async () => {
        const t = makeTask(5);
        freeBytesQueue.push(null);
        await expect(svc.ensureDiskSpace(t)).resolves.toBeUndefined();
    });

    it('disco OK → não bloqueia nem registra cleanup', async () => {
        const t = makeTask(6);
        freeBytesQueue.push(20 * GB);
        await expect(svc.ensureDiskSpace(t)).resolves.toBeUndefined();
        expect(t.events.some((e: any) => e.meta?.diskLow)).toBe(false);
    });

    // --- ensureWorktree: falha rápido ANTES do git work quando disco cheio (anti-zumbi) ---
    it('ensureWorktree com disco cheio → lança ANTES de fetch/worktree-add', async () => {
        svc.currentExecTask = makeTask(7);
        freeBytesQueue.push(1 * GB, 1 * GB); // baixo persistente
        await expect(svc.ensureWorktree('fix-7')).rejects.toThrow(/disco insuficiente/i);
        // Prova que o guard abortou ANTES de tocar o git do worktree: nenhum fetch foi emitido.
        const issuedFetch = vi.mocked(execFile).mock.calls.some(
            (c: any[]) => c[0] === 'git' && c[1]?.[0] === 'fetch',
        );
        expect(issuedFetch).toBe(false);
    });

    it('ensureWorktree com disco OK → prossegue para o setup normal (fetch emitido)', async () => {
        svc.currentExecTask = makeTask(8);
        freeBytesQueue.push(50 * GB);
        await svc.ensureWorktree('fix-8');
        const issuedFetch = vi.mocked(execFile).mock.calls.some(
            (c: any[]) => c[0] === 'git' && c[1]?.[0] === 'fetch',
        );
        expect(issuedFetch).toBe(true);
    });
});
