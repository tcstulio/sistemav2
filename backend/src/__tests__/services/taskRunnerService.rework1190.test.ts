import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (hoisted) — cobrem as dependências externas do taskRunnerService ===
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
import { taskRunnerService } from '../../services/taskRunnerService';

const svc = taskRunnerService as any;

// Degrau-2 PR-2: branchIsAheadOfMain/hasExistingCommittedWork recebem o `slot` por parâmetro
// (era a const global WT_ROOT). Slot fake — o git/gh estão mockados via execFile, o path não pesa.
const fakeSlot = { id: 1, root: '/tmp/fake-slot', dataDir: null };

// Estado controlável das "fontes" lidas do git/gh. Cada teste os ajusta e depois
// monta o mock do execFile para responder de acordo com o comando/subcomando.
let gitRevListCount = '0';        // `git rev-list --count origin/main..HEAD`
let gitStatusPorcelain = '';      // `git status --porcelain`
let ghPrDiffFiles = '';           // `gh pr diff <n> --name-only`

function buildExecFileMock() {
    return vi.fn((file: string, args: any[], opts: any, cb: any) => {
        if (typeof opts === 'function') { cb = opts; }
        const a = (args || []) as string[];
        let stdout = '';
        if (file === 'git') {
            if (a[0] === 'rev-list') stdout = gitRevListCount;
            else if (a[0] === 'status') stdout = gitStatusPorcelain;
        } else if (file === 'gh') {
            if (a[0] === 'pr' && a[1] === 'diff') stdout = ghPrDiffFiles;
        }
        setImmediate(() => cb(null, { stdout, stderr: '' }));
        return undefined as any;
    });
}

beforeEach(() => {
    svc.stopPolling?.();
    vi.clearAllMocks();
    gitRevListCount = '0';
    gitStatusPorcelain = '';
    ghPrDiffFiles = '';
    vi.mocked(execFile).mockImplementation(buildExecFileMock() as any);
});

describe('#1190 — hasCommittedWork (helper PURO)', () => {
    it('retorna TRUE quando a branch está à frente da main (trabalho já commitado)', () => {
        expect(svc.hasCommittedWork(true, false, [])).toBe(true);
    });

    it('retorna TRUE quando há PR existente com diff', () => {
        expect(svc.hasCommittedWork(false, true, [])).toBe(true);
    });

    it('retorna TRUE quando há mudanças não-commitadas no worktree', () => {
        expect(svc.hasCommittedWork(false, false, ['src/foo.ts', 'backend/src/bar.ts'])).toBe(true);
    });

    it('retorna TRUE quando vários sinais combinam', () => {
        expect(svc.hasCommittedWork(true, true, ['x.ts'])).toBe(true);
    });

    it('retorna FALSE apenas quando NÃO há trabalho algum (task genuinamente vazia)', () => {
        // branch == main, sem PR, worktree limpo → deve FALHAR como antes.
        expect(svc.hasCommittedWork(false, false, [])).toBe(false);
    });
});

describe('#1190 — branchIsAheadOfMain (lê git rev-list --count origin/main..HEAD)', () => {
    it('retorna TRUE quando há commits além da main (count > 0)', async () => {
        gitRevListCount = '3';
        expect(await svc.branchIsAheadOfMain(fakeSlot)).toBe(true);
        // evidencia: o comando certo foi chamado
        const calls = vi.mocked(execFile).mock.calls.filter((c: any) => c[0] === 'git');
        expect(calls.some((c: any) => (c[1] as string[]).slice(0, 3).join(' ') === 'rev-list --count origin/main..HEAD')).toBe(true);
    });

    it('retorna FALSE quando count == 0 (branch == main)', async () => {
        gitRevListCount = '0';
        expect(await svc.branchIsAheadOfMain(fakeSlot)).toBe(false);
    });

    it('retorna FALSE (best-effort) quando o git lança erro', async () => {
        vi.mocked(execFile).mockImplementation(((file: string, args: any[], opts: any, cb: any) => {
            if (typeof opts === 'function') { cb = opts; }
            setImmediate(() => cb(new Error('no origin/main'), { stdout: '', stderr: '' }));
            return undefined as any;
        }) as any);
        expect(await svc.branchIsAheadOfMain(fakeSlot)).toBe(false);
    });
});

describe('#1190 — existingPrHasDiff (lê gh pr diff --name-only)', () => {
    it('retorna FALSE quando a task NÃO tem prNumber', async () => {
        expect(await svc.existingPrHasDiff({ prNumber: undefined } as any)).toBe(false);
    });

    it('retorna TRUE quando o PR tem arquivos no diff', async () => {
        ghPrDiffFiles = 'src/a.ts\nbackend/src/b.ts\n';
        expect(await svc.existingPrHasDiff({ prNumber: 42 } as any)).toBe(true);
    });

    it('retorna FALSE quando o PR não tem diff (vazio)', async () => {
        ghPrDiffFiles = '';
        expect(await svc.existingPrHasDiff({ prNumber: 42 } as any)).toBe(false);
    });
});

describe('#1190 — hasExistingCommittedWork (combina as 3 fontes via helper puro)', () => {
    it('CAMINHO 1 (re-work): branch à frente da main → TRUE (não deve falhar)', async () => {
        // worktree LIMPO, sem PR — mas a branch tem trabalho commitado sobre a main.
        gitRevListCount = '2';
        gitStatusPorcelain = '';
        ghPrDiffFiles = '';
        const task = { prNumber: undefined } as any;
        expect(await svc.hasExistingCommittedWork(task, fakeSlot, [])).toBe(true);
    });

    it('CAMINHO 1b (re-work): PR existente com diff → TRUE (não deve falhar)', async () => {
        gitRevListCount = '0';
        gitStatusPorcelain = '';
        ghPrDiffFiles = 'src/changed.ts\n';
        const task = { prNumber: 7 } as any;
        expect(await svc.hasExistingCommittedWork(task, fakeSlot, [])).toBe(true);
    });

    it('CAMINHO 2 (genuinamente vazia): branch == main, sem PR, worktree limpo → FALSE (deve falhar)', async () => {
        gitRevListCount = '0';
        gitStatusPorcelain = '';
        ghPrDiffFiles = '';
        const task = { prNumber: undefined } as any;
        expect(await svc.hasExistingCommittedWork(task, fakeSlot, [])).toBe(false);
    });

    it('worktree com mudanças não-commitadas também conta como trabalho (TRUE)', async () => {
        gitRevListCount = '0';
        gitStatusPorcelain = '';
        ghPrDiffFiles = '';
        const task = { prNumber: undefined } as any;
        expect(await svc.hasExistingCommittedWork(task, fakeSlot, ['src/wip.ts'])).toBe(true);
    });
});
