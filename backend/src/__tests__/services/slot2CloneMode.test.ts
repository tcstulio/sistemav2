import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

// === Harness padrão (espelha taskRunnerService.disk.test.ts) ===
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
// disco sempre folgado (não interfere no ramo sob teste).
vi.mock('../../utils/diskSpace', () => ({ getFreeDiskBytes: vi.fn(async () => 50 * 1024 ** 3), formatGB: (b: number) => (b / 1024 ** 3).toFixed(2) }));

import { execFile, exec } from 'child_process';
import { taskRunnerService } from '../../services/taskRunnerService';
import { slotManager } from '../../services/slotManager';
import { slotProvisioner } from '../../services/slotProvisioner';

const svc = taskRunnerService as any;

const CLONE = { id: 2, root: '/tmp/fake-clone-slot2', dataDir: 'C:/tmp/xdg2', kind: 'clone' as const };
const WORKTREE = { id: 1, root: '/tmp/fake-wt-slot1', dataDir: null, kind: 'worktree' as const };

/** True se algum `git` foi chamado com `worktree <sub>` (add/prune). */
function calledWorktree(): boolean {
    return vi.mocked(execFile).mock.calls.some((c: any[]) => c[0] === 'git' && c[1]?.[0] === 'worktree');
}
/** cwd (opts.cwd) da 1ª chamada `git fetch origin main`. */
function fetchMainCwd(): string | undefined {
    const call = vi.mocked(execFile).mock.calls.find((c: any[]) => c[0] === 'git' && c[1]?.[0] === 'fetch' && c[1]?.[2] === 'main');
    return call ? (call[2] as any)?.cwd : undefined;
}

beforeEach(() => {
    svc.store = { tasks: {} };
    svc.sweepOrphanedOpencode = vi.fn(async () => false);
    svc.cleanStaleLocks = vi.fn();
    // git → sucesso vazio; grava args/opts p/ inspeção.
    vi.mocked(execFile).mockImplementation((_file: string, _args: any[], opts: any, cb: any) => {
        if (typeof opts === 'function') cb = opts;
        setImmediate(() => cb(null, { stdout: '', stderr: '' }));
        return undefined as any;
    });
    // exec (npm no ensureDeps) → resolve vazio.
    vi.mocked(exec).mockImplementation((_cmd: string, opts: any, cb: any) => {
        if (typeof opts === 'function') cb = opts;
        setImmediate(() => cb(null, { stdout: '', stderr: '' }));
        return undefined as any;
    });
});

afterEach(() => vi.restoreAllMocks());

describe('ensureWorktree — clone-mode (Degrau 2 PR-3)', () => {
    it('clone VÁLIDO → NUNCA `worktree add/prune`; fetch roda no cwd=slot.root (fetch-no-clone)', async () => {
        // clone válido: root + .git existem (+ node_modules p/ ensureDeps não pesar).
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        await svc.ensureWorktree('fix-500', CLONE);
        expect(calledWorktree()).toBe(false);          // clone NUNCA usa worktree add/prune
        expect(fetchMainCwd()).toBe(CLONE.root);        // fetch alimenta o origin do PRÓPRIO clone
    });

    it('clone INVÁLIDO (.git ausente) → unregisterSlot2 + re-provisão async + THROW (não recria inline)', async () => {
        // root existe, mas .git não → clone corrompido.
        vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => !String(p).endsWith('.git'));
        const unreg = vi.spyOn(slotManager, 'unregisterSlot2');
        const reprov = vi.spyOn(slotProvisioner, 'ensureSlot2').mockResolvedValue(undefined);

        await expect(svc.ensureWorktree('fix-501', CLONE)).rejects.toThrow(/slot-2 inválido/i);
        expect(unreg).toHaveBeenCalled();
        expect(reprov).toHaveBeenCalled();
        expect(calledWorktree()).toBe(false); // não tentou recriar via worktree
    });
});

describe('ensureWorktree — worktree-mode (slot-1) segue byte-idêntico', () => {
    it('dir AUSENTE → recria via `worktree add` (comportamento de sempre)', async () => {
        // slot.root não existe → needsCreate → worktree prune + add.
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        await svc.ensureWorktree('fix-1', WORKTREE);
        expect(calledWorktree()).toBe(true);        // worktree-mode USA worktree add
        expect(fetchMainCwd()).not.toBe(WORKTREE.root); // fetch NÃO roda no slot.root (é no REPO_ROOT/default)
    });
});
