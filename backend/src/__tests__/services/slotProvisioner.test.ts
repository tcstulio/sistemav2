import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// === Harness: TODO I/O é mockado via ProvisionDeps injetável. Os testes NUNCA tocam disco/rede ===
// (senão disparam o hazard de junction em node_modules). Espelha o estilo de mocks de
// slot2SnapshotPath.test.ts / claimAtomic.test.ts.
vi.mock('child_process', () => ({ execFile: vi.fn(), exec: vi.fn(), spawn: vi.fn() }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../utils/diskSpace', () => ({
    getFreeDiskBytes: vi.fn(async () => null),
    formatGB: (b: number) => (b / 1024 ** 3).toFixed(2),
}));
// slotManager NÃO é mockado: usamos as consts reais (SLOT2_ROOT/SLOT2_XDG) e espiamos register/unregister.

import { slotManager, SLOT2_ROOT, SLOT2_XDG } from '../../services/slotManager';
import {
    SlotProvisioner,
    ProvisionDeps,
    isAcceptableOrigin,
    remoteVerboseHasLocalPath,
    diskGateBlocks,
} from '../../services/slotProvisioner';

const GITHUB_ORIGIN = 'https://github.com/tcstulio/sistemav2.git';

/** Deps totalmente mockadas — default = "tudo verde para um clone GitHub saudável". */
function makeDeps(overrides: Partial<ProvisionDeps> = {}): {
    deps: ProvisionDeps;
    gitCalls: string[][];
    shCalls: Array<[string, string, number]>;
} {
    const gitCalls: string[][] = [];
    const shCalls: Array<[string, string, number]> = [];
    const deps: ProvisionDeps = {
        git: vi.fn(async (args: string[]) => {
            gitCalls.push(args);
            const joined = args.join(' ');
            if (joined.includes('remote get-url origin')) return { stdout: GITHUB_ORIGIN + '\n', stderr: '' };
            if (joined.includes('remote -v')) {
                return { stdout: `origin\t${GITHUB_ORIGIN} (fetch)\norigin\t${GITHUB_ORIGIN} (push)\n`, stderr: '' };
            }
            return { stdout: '', stderr: '' };
        }),
        sh: vi.fn(async (command: string, cwd: string, timeout: number) => {
            shCalls.push([command, cwd, timeout]);
            return { stdout: '', stderr: '' };
        }),
        freeDiskBytes: vi.fn(async () => null), // null = não mediu → prossegue
        existsSync: vi.fn((p: string) => {
            // por padrão o slot NÃO existe ainda (fluxo de clone do zero); mas os markers/auth existem
            // quando checados após P4/P6/P7 — controlado por overrides nos testes de idempotência.
            if (p === SLOT2_ROOT) return false;
            return true;
        }),
        lstatIsSymlink: vi.fn(() => false),
        lstatIsDirectory: vi.fn(() => false),
        isDirectory: vi.fn(() => true),
        isFileNonEmpty: vi.fn(() => true),
        mkdirp: vi.fn(),
        copyFile: vi.fn(),
        readdir: vi.fn(() => []),
        rmdirSync: vi.fn(),
        rmRecursive: vi.fn(),
        writeReceipt: vi.fn(),
        registerSlot2: vi.fn(),
        unregisterSlot2: vi.fn(),
        ...overrides,
    };
    return { deps, gitCalls, shCalls };
}

function provisioner(deps: ProvisionDeps): any {
    return new SlotProvisioner(deps);
}

const OLD_ENV = process.env.TASKRUNNER_SLOT2;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.TASKRUNNER_SLOT2;
    else process.env.TASKRUNNER_SLOT2 = OLD_ENV;
    vi.restoreAllMocks();
});

// ==== Funções puras (O2 / disco) ==========================================================

describe('isAcceptableOrigin (O2)', () => {
    it('aceita GitHub https e ssh', () => {
        expect(isAcceptableOrigin('https://github.com/tcstulio/sistemav2.git')).toBe(true);
        expect(isAcceptableOrigin('git@github.com:tcstulio/sistemav2.git')).toBe(true);
    });
    it('REJEITA path local (C:\\... e /c/...) — nunca clonar de path local', () => {
        expect(isAcceptableOrigin('C:\\Projetos\\sistemav2')).toBe(false);
        expect(isAcceptableOrigin('/c/Projetos/sistemav2')).toBe(false);
        expect(isAcceptableOrigin('file:///c/Projetos/sistemav2')).toBe(false);
    });
    it('REJEITA outros hosts', () => {
        expect(isAcceptableOrigin('https://gitlab.com/x/y.git')).toBe(false);
        expect(isAcceptableOrigin('')).toBe(false);
    });
});

describe('remoteVerboseHasLocalPath (O2 defesa-em-profundidade)', () => {
    it('detecta C:\\ e /c/ na saída de remote -v', () => {
        expect(remoteVerboseHasLocalPath('origin\tC:\\Projetos\\sistemav2 (fetch)')).toBe(true);
        expect(remoteVerboseHasLocalPath('origin\t/c/Projetos/sistemav2 (push)')).toBe(true);
    });
    it('não dispara p/ remote GitHub puro', () => {
        expect(remoteVerboseHasLocalPath(`origin\t${GITHUB_ORIGIN} (fetch)\norigin\t${GITHUB_ORIGIN} (push)`)).toBe(false);
    });
});

describe('diskGateBlocks (P1)', () => {
    it('null (não mediu) → PROSSEGUE (não bloqueia)', () => expect(diskGateBlocks(null)).toBe(false));
    it('< 10 GB → bloqueia', () => expect(diskGateBlocks(5 * 1024 ** 3)).toBe(true));
    it('>= 10 GB → prossegue', () => expect(diskGateBlocks(12 * 1024 ** 3)).toBe(false));
});

// ==== P0: gate de env ======================================================================

describe('ensureSlot2 — P0 gate de env (byte-safety)', () => {
    it('TASKRUNNER_SLOT2 != "1" → NO-OP total (sem clone, sem registro, sem tocar disco)', async () => {
        delete process.env.TASKRUNNER_SLOT2;
        const { deps, gitCalls, shCalls } = makeDeps();
        await provisioner(deps).ensureSlot2();
        expect(gitCalls.length).toBe(0);
        expect(shCalls.length).toBe(0);
        expect(deps.registerSlot2).not.toHaveBeenCalled();
        expect(deps.freeDiskBytes).not.toHaveBeenCalled();
    });
});

// ==== P1: gate de disco ====================================================================

describe('ensureSlot2 — P1 gate de disco', () => {
    beforeEach(() => { process.env.TASKRUNNER_SLOT2 = '1'; });

    it('disco < 10 GB → NÃO provisiona (sem clone, sem registro) e NÃO lança', async () => {
        const { deps, gitCalls } = makeDeps({ freeDiskBytes: vi.fn(async () => 5 * 1024 ** 3) });
        await expect(provisioner(deps).ensureSlot2()).resolves.toBeUndefined();
        expect(gitCalls.some((a) => a.includes('clone'))).toBe(false);
        expect(deps.registerSlot2).not.toHaveBeenCalled();
    });

    it('disco null (não mediu) → PROSSEGUE (chega a clonar)', async () => {
        const { deps, gitCalls } = makeDeps({ freeDiskBytes: vi.fn(async () => null) });
        await provisioner(deps).ensureSlot2();
        expect(gitCalls.some((a) => a.includes('clone'))).toBe(true);
    });
});

// ==== P3 / O2: origin ======================================================================

describe('ensureSlot2 — P3/O2 origin', () => {
    beforeEach(() => { process.env.TASKRUNNER_SLOT2 = '1'; });

    it('origin do PROD = path local (C:\\...) → ABORT (NUNCA clona)', async () => {
        const { deps, gitCalls } = makeDeps({
            git: vi.fn(async (args: string[]) => {
                if (args.join(' ').includes('remote get-url origin')) return { stdout: 'C:\\Projetos\\sistemav2\n', stderr: '' };
                return { stdout: '', stderr: '' };
            }),
        });
        await provisioner(deps).ensureSlot2();
        expect(gitCalls.some((a) => a.includes('clone'))).toBe(false);
        expect(deps.registerSlot2).not.toHaveBeenCalled();
    });

    it('origin GitHub → segue (chega a clonar e registra ao fim)', async () => {
        const { deps, gitCalls } = makeDeps();
        await provisioner(deps).ensureSlot2();
        expect(gitCalls.some((a) => a.includes('clone'))).toBe(true);
        expect(deps.registerSlot2).toHaveBeenCalledWith(
            expect.objectContaining({ id: 2, root: SLOT2_ROOT, dataDir: SLOT2_XDG, kind: 'clone' }),
        );
    });

    it('O2: clone com remote -v contendo path local → ABORT + teardown (não registra)', async () => {
        const { deps } = makeDeps({
            git: vi.fn(async (args: string[]) => {
                const joined = args.join(' ');
                if (joined.includes('remote get-url origin')) return { stdout: GITHUB_ORIGIN + '\n', stderr: '' };
                // o clone "conserta" o remote p/ path local → O2 deve pegar no remote -v
                if (joined.includes('remote -v')) return { stdout: `origin\tC:\\Projetos\\sistemav2 (push)\n`, stderr: '' };
                return { stdout: '', stderr: '' };
            }),
            // após o clone, SLOT2_ROOT passa a existir p/ o teardown
            existsSync: vi.fn(() => true),
        });
        await provisioner(deps).ensureSlot2();
        expect(deps.registerSlot2).not.toHaveBeenCalled();
        expect(deps.rmRecursive).toHaveBeenCalled(); // teardown rodou
    });
});

// ==== P6: seed de auth =====================================================================

describe('ensureSlot2 — P6 seed de auth', () => {
    beforeEach(() => { process.env.TASKRUNNER_SLOT2 = '1'; });

    it('auth.json AUSENTE → ABORT + teardown (não registra)', async () => {
        const { deps } = makeDeps({
            isFileNonEmpty: vi.fn((p: string) => !p.includes('auth.json')), // auth vazio/ausente
            existsSync: vi.fn(() => true), // clone criou o dir → teardown pode rodar
        });
        await provisioner(deps).ensureSlot2();
        expect(deps.registerSlot2).not.toHaveBeenCalled();
        expect(deps.rmRecursive).toHaveBeenCalled();
    });
});

// ==== oBoot ================================================================================

describe('oBoot — autoridade do "pronto"', () => {
    it('tudo verde → true', async () => {
        const { deps } = makeDeps({ existsSync: vi.fn(() => true) });
        expect(await provisioner(deps).oBoot()).toBe(true);
    });

    it('auth.json ausente → false', async () => {
        const { deps } = makeDeps({
            existsSync: vi.fn(() => true),
            isFileNonEmpty: vi.fn((p: string) => !p.includes('auth.json')),
        });
        expect(await provisioner(deps).oBoot()).toBe(false);
    });

    it('.tr-installed (root) ausente → false', async () => {
        const { deps } = makeDeps({
            existsSync: vi.fn((p: string) => !p.includes(path.join('node_modules', '.tr-installed')) || p.includes('backend')),
        });
        expect(await provisioner(deps).oBoot()).toBe(false);
    });

    it('.git não é dir → false', async () => {
        const { deps } = makeDeps({ isDirectory: vi.fn(() => false) });
        expect(await provisioner(deps).oBoot()).toBe(false);
    });

    it('origin não-GitHub → false', async () => {
        const { deps } = makeDeps({
            existsSync: vi.fn(() => true),
            git: vi.fn(async (args: string[]) => {
                if (args.join(' ').includes('remote get-url origin')) return { stdout: 'C:\\Projetos\\sistemav2\n', stderr: '' };
                return { stdout: '', stderr: '' };
            }),
        });
        expect(await provisioner(deps).oBoot()).toBe(false);
    });
});

// ==== Idempotência =========================================================================

describe('ensureSlot2 — idempotência', () => {
    beforeEach(() => { process.env.TASKRUNNER_SLOT2 = '1'; });

    it('SLOT2_ROOT existe + oBoot true → registra SEM clonar', async () => {
        const { deps, gitCalls } = makeDeps({ existsSync: vi.fn(() => true) });
        await provisioner(deps).ensureSlot2();
        expect(gitCalls.some((a) => a.includes('clone'))).toBe(false);
        expect(deps.registerSlot2).toHaveBeenCalledWith(
            expect.objectContaining({ id: 2, root: SLOT2_ROOT, kind: 'clone' }),
        );
    });

    it('SLOT2_ROOT existe + oBoot FALHOU → teardown + re-clona', async () => {
        // oBoot falha porque auth ausente; mas o dir existe → teardown deve rodar antes do re-clone
        let authQueried = false;
        const { deps, gitCalls } = makeDeps({
            existsSync: vi.fn(() => true),
            isFileNonEmpty: vi.fn((p: string) => {
                if (p.includes('auth.json')) {
                    // 1ª consulta (dentro do oBoot) = falha; consultas depois (seedXdg) = ok
                    const r = authQueried;
                    authQueried = true;
                    return r;
                }
                return true;
            }),
        });
        await provisioner(deps).ensureSlot2();
        expect(deps.unregisterSlot2).toHaveBeenCalled();
        expect(deps.rmRecursive).toHaveBeenCalled(); // teardown
        expect(gitCalls.some((a) => a.includes('clone'))).toBe(true); // re-clonou
    });
});

// ==== singleton real registra no slotManager real (smoke de integração leve) ================

describe('registro no slotManager real', () => {
    beforeEach(() => { process.env.TASKRUNNER_SLOT2 = '1'; });
    afterEach(() => slotManager.unregisterSlot2());

    it('provisão bem-sucedida deixa slot-2 em slots() do slotManager real', async () => {
        const { deps } = makeDeps({
            existsSync: vi.fn(() => true),
            registerSlot2: (slot) => slotManager.registerSlot2(slot),
            unregisterSlot2: () => slotManager.unregisterSlot2(),
        });
        await provisioner(deps).ensureSlot2();
        expect(slotManager.slots().some((s) => s.id === 2 && s.kind === 'clone')).toBe(true);
    });
});
