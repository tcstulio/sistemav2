import { describe, it, expect } from 'vitest';
import path from 'path';
import {
    buildJunctionSafeRemovalPlan,
    classifyWorktreeDir,
    computeFreedBytes,
    DEFAULT_DISK_THRESHOLD_BYTES,
    formatBytes,
    isJunctionEntry,
    isNodeModulesEntry,
    isOrphanOpencode,
    isTaskrunnerPreviewPort,
    isTaskrunnerVitePreview,
    isUnderClaudeWorktrees,
    isWorktreeInUse,
    junctionPreUnlinkSteps,
    normalizePath,
    parseWorktreePorcelain,
    shouldAlertLowDisk,
    summarizeReport,
    type DiskInfo,
    type GcReport,
} from '../../utils/gcWorktrees';

describe('formatBytes', () => {
    it('formata bytes/KiB/MiB/GiB/TiB', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1024)).toBe('1.0 KiB');
        expect(formatBytes(1536)).toBe('1.5 KiB');
        expect(formatBytes(1048576)).toBe('1.0 MiB');
        expect(formatBytes(1073741824)).toBe('1.0 GiB');
        expect(formatBytes(1099511627776)).toBe('1.0 TiB');
    });

    it('formata valores negativos (ex.: freed negativo se algo cresceu)', () => {
        expect(formatBytes(-1024)).toBe('-1.0 KiB');
        expect(formatBytes(-512)).toBe('-512 B');
    });

    it('retorna "N/A" para null/undefined/NaN', () => {
        expect(formatBytes(null)).toBe('N/A');
        expect(formatBytes(undefined)).toBe('N/A');
        expect(formatBytes(NaN)).toBe('N/A');
        expect(formatBytes(Infinity)).toBe('N/A');
    });
});

describe('normalizePath', () => {
    it('lowercase + forward slash + resolve', () => {
        expect(normalizePath('C:\\Projetos\\Repo\\Sub')).toBe('c:/projetos/repo/sub');
        expect(normalizePath('/a/b/../c')).toBe(path.resolve('/a/b/../c').toLowerCase().replace(/\\/g, '/'));
    });

    it('é comparável independente de barras', () => {
        expect(normalizePath('C:\\X\\Y')).toBe(normalizePath('c:/x/y'));
    });
});

describe('isNodeModulesEntry', () => {
    it('reconhece node_modules case-insensitive', () => {
        expect(isNodeModulesEntry('node_modules')).toBe(true);
        expect(isNodeModulesEntry('Node_Modules')).toBe(true);
        expect(isNodeModulesEntry('NODE_MODULES')).toBe(true);
    });
    it('rejeita outros nomes', () => {
        expect(isNodeModulesEntry('src')).toBe(false);
        expect(isNodeModulesEntry('modules')).toBe(false);
        expect(isNodeModulesEntry('')).toBe(false);
    });
});

describe('isJunctionEntry', () => {
    it('true quando lstat diz symbolicLink (junction/reparse point)', () => {
        expect(isJunctionEntry({ isSymbolicLink: true, isDirectory: false })).toBe(true);
        expect(isJunctionEntry({ isSymbolicLink: true, isDirectory: true })).toBe(true);
    });
    it('false para diretório real (sem junction)', () => {
        expect(isJunctionEntry({ isSymbolicLink: false, isDirectory: true })).toBe(false);
        expect(isJunctionEntry({ isSymbolicLink: false, isDirectory: false })).toBe(false);
    });
});

describe('buildJunctionSafeRemovalPlan', () => {
    it('coloca TODO junction ANTES do rmdir residual (ordem crítica)', () => {
        const nm = 'C:\\repo\\.claude\\worktrees\\wt1\\node_modules';
        const cache = 'C:\\repo\\.claude\\worktrees\\wt1\\.cache';
        const parent = 'C:\\repo\\.claude\\worktrees\\wt1';
        const plan = buildJunctionSafeRemovalPlan([nm, cache], parent);
        expect(plan.junctions).toEqual([nm, cache]);
        expect(plan.residualDir).toBe(parent);
        // Ordem invariável: unlink-junction, unlink-junction, rmdir.
        expect(plan.steps).toEqual([
            { kind: 'unlink-junction', path: nm },
            { kind: 'unlink-junction', path: cache },
            { kind: 'rmdir', path: parent },
        ]);
    });

    it('node_modules (junction perigoso) é o PRIMEIRO passo quando vem primeiro', () => {
        const nm = '/r/.claude/worktrees/x/node_modules';
        const parent = '/r/.claude/worktrees/x';
        const plan = buildJunctionSafeRemovalPlan([nm], parent);
        expect(plan.steps[0]).toEqual({ kind: 'unlink-junction', path: nm });
        expect(plan.steps[plan.steps.length - 1]).toEqual({ kind: 'rmdir', path: parent });
    });

    it('sem junctions → só um rmdir residual', () => {
        const parent = '/r/.claude/worktrees/x';
        const plan = buildJunctionSafeRemovalPlan([], parent);
        expect(plan.junctions).toEqual([]);
        expect(plan.steps).toEqual([{ kind: 'rmdir', path: parent }]);
    });

    it('NÃO mutate o array de entrada', () => {
        const input = ['/a/node_modules'];
        const plan = buildJunctionSafeRemovalPlan(input, '/a');
        expect(input).toEqual(['/a/node_modules']);
        plan.junctions.push('/mutado');
        expect(input).toEqual(['/a/node_modules']);
    });
});

describe('junctionPreUnlinkSteps — junction-safe no caminho `git worktree remove` (correção #3)', () => {
    it('retorna SOMENTE passos unlink-junction (sem rmdir residual — residual é do git)', () => {
        const nm = 'C:\\repo\\.claude\\worktrees\\wt1\\node_modules';
        const cache = 'C:\\repo\\.claude\\worktrees\\wt1\\.cache';
        const steps = junctionPreUnlinkSteps([nm, cache]);
        expect(steps).toEqual([
            { kind: 'unlink-junction', path: nm },
            { kind: 'unlink-junction', path: cache },
        ]);
        expect(steps.every((s) => s.kind === 'unlink-junction')).toBe(true);
    });

    it('node_modules (junction perigoso) é desligado ANTES do git worktree remove', () => {
        const nm = '/r/.claude/worktrees/x/node_modules';
        const steps = junctionPreUnlinkSteps([nm]);
        expect(steps).toEqual([{ kind: 'unlink-junction', path: nm }]);
    });

    it('sem junctions → [] (git worktree remove prossegue sem pré-unlink)', () => {
        expect(junctionPreUnlinkSteps([])).toEqual([]);
    });

    it('NÃO mutate o array de entrada', () => {
        const input = ['/a/node_modules'];
        junctionPreUnlinkSteps(input);
        expect(input).toEqual(['/a/node_modules']);
    });
});

describe('parseWorktreePorcelain', () => {
    it('extrai paths de blocos worktree', () => {
        const out = [
            'worktree C:/Projetos/sistemav2',
            'HEAD c636ebe',
            'branch refs/heads/main',
            '',
            'worktree C:/Projetos/sistemav2-taskrunner-wt',
            'HEAD ecd0355',
            'branch refs/heads/fix-1112',
            '',
        ].join('\n');
        expect(parseWorktreePorcelain(out)).toEqual([
            'C:/Projetos/sistemav2',
            'C:/Projetos/sistemav2-taskrunner-wt',
        ]);
    });

    it('ignora linhas locked/detached/etc', () => {
        const out = [
            'worktree /repo/.claude/worktrees/wt9',
            'HEAD abc',
            'detached',
            'locked reason',
        ].join('\n');
        expect(parseWorktreePorcelain(out)).toEqual(['/repo/.claude/worktrees/wt9']);
    });

    it('lida com CRLF e espaços no path', () => {
        const out = 'worktree C:/My Path/wt\r\nworktree D:/outro\r\n';
        expect(parseWorktreePorcelain(out)).toEqual(['C:/My Path/wt', 'D:/outro']);
    });

    it('vazio → []', () => {
        expect(parseWorktreePorcelain('')).toEqual([]);
    });
});

describe('classifyWorktreeDir', () => {
    const known = ['C:/Projetos/sistemav2', 'C:/Projetos/sistemav2-taskrunner-wt'];
    const prot = ['C:/Projetos/sistemav2', 'C:/Projetos/sistemav2-taskrunner-wt'];

    it('protected tem prioridade sobre known (nunca remove repo principal / WT_ROOT)', () => {
        expect(classifyWorktreeDir('C:/Projetos/sistemav2', known, prot)).toBe('protected');
        expect(classifyWorktreeDir('C:\\Projetos\\sistemav2-taskrunner-wt', known, prot)).toBe('protected');
    });

    it('known = worktree registrado vivo', () => {
        expect(classifyWorktreeDir('C:/Projetos/sistemav2-taskrunner-wt', known, [])).toBe('known');
    });

    it('orphan = não bate com protected nem known', () => {
        expect(classifyWorktreeDir('C:/Projetos/sistemav2/.claude/worktrees/wt9', known, prot)).toBe('orphan');
    });

    it('compara paths normalizados (barra/case)', () => {
        expect(classifyWorktreeDir('c:/projetos/sistemav2', known, prot)).toBe('protected');
        expect(classifyWorktreeDir('C:\\Projetos\\sistemav2\\.claude\\worktrees\\wt9', known, prot)).toBe('orphan');
    });
});

describe('isTaskrunnerPreviewPort', () => {
    it('frontend range 5174-5183', () => {
        expect(isTaskrunnerPreviewPort(5174)).toBe(true);
        expect(isTaskrunnerPreviewPort(5183)).toBe(true);
        expect(isTaskrunnerPreviewPort(5173)).toBe(false); // dev server principal
        expect(isTaskrunnerPreviewPort(5184)).toBe(false);
    });
    it('backend range 3014-3023', () => {
        expect(isTaskrunnerPreviewPort(3014)).toBe(true);
        expect(isTaskrunnerPreviewPort(3023)).toBe(true);
        expect(isTaskrunnerPreviewPort(3004)).toBe(false); // backend principal
        expect(isTaskrunnerPreviewPort(3024)).toBe(false);
    });
    it('invalido', () => {
        expect(isTaskrunnerPreviewPort(-1)).toBe(false);
        expect(isTaskrunnerPreviewPort(NaN)).toBe(false);
        expect(isTaskrunnerPreviewPort(0)).toBe(false);
    });
});

describe('isTaskrunnerVitePreview', () => {
    it('matcha vite preview na faixa do TaskRunner', () => {
        expect(isTaskrunnerVitePreview('node vite preview --port 5177')).toBe(true);
        expect(isTaskrunnerVitePreview('node node_modules/vite/bin/vite.js preview --port=5180 --strictPort')).toBe(true);
        expect(isTaskrunnerVitePreview('vite preview --port 3019')).toBe(true);
    });
    it('NÃO matcha dev server principal (5173) nem build nem fora da faixa', () => {
        expect(isTaskrunnerVitePreview('node vite --port 5173')).toBe(false); // sem "preview"
        expect(isTaskrunnerVitePreview('node vite preview --port 5173')).toBe(false); // fora da faixa
        expect(isTaskrunnerVitePreview('vite build')).toBe(false);
        expect(isTaskrunnerVitePreview('vite preview --port 9000')).toBe(false); // fora da faixa
    });
    it('não mata pm2/tulipa-v4/MCP (sem vite preview)', () => {
        expect(isTaskrunnerVitePreview('pm2 logs')).toBe(false);
        expect(isTaskrunnerVitePreview('node tulipa-v4/server.js')).toBe(false);
        expect(isTaskrunnerVitePreview('mcp-server run')).toBe(false);
    });
    it('vazio/sem porta', () => {
        expect(isTaskrunnerVitePreview('')).toBe(false);
        expect(isTaskrunnerVitePreview('vite preview')).toBe(false); // sem --port na faixa
    });
});

describe('isOrphanOpencode', () => {
    const needles = ['.taskrunner-prompt.md', 'taskrunner-visual-judge'];
    it('matcha command line com needle do TaskRunner', () => {
        expect(isOrphanOpencode('opencode run "Leia o arquivo .taskrunner-prompt.md"', needles)).toBe(true);
        expect(isOrphanOpencode('opencode taskrunner-visual-judge run', needles)).toBe(true);
    });
    it('command line vazia = órfão (mesma regra do killOpencodeOrphans)', () => {
        expect(isOrphanOpencode('', needles)).toBe(true);
        expect(isOrphanOpencode('   ', needles)).toBe(true);
    });
    it('NÃO mata opencode manual de outro projeto', () => {
        expect(isOrphanOpencode('opencode run "fix my bug in /other/project"', needles)).toBe(false);
        expect(isOrphanOpencode('opencode run --project /home/user/app', needles)).toBe(false);
    });
});

describe('shouldAlertLowDisk', () => {
    const thr = 5 * 1024 ** 3;
    it('true quando livre < limiar', () => {
        expect(shouldAlertLowDisk(1 * 1024 ** 3, thr)).toBe(true);
        expect(shouldAlertLowDisk(0, thr)).toBe(true);
    });
    it('false quando livre >= limiar', () => {
        expect(shouldAlertLowDisk(10 * 1024 ** 3, thr)).toBe(false);
        expect(shouldAlertLowDisk(thr, thr)).toBe(false);
    });
    it('null quando impossível medir', () => {
        expect(shouldAlertLowDisk(null, thr)).toBe(null);
        expect(shouldAlertLowDisk(NaN, thr)).toBe(null);
        expect(shouldAlertLowDisk(10, NaN)).toBe(null);
        expect(shouldAlertLowDisk(10, -1)).toBe(null);
    });
    it('DEFAULT_DISK_THRESHOLD_BYTES = 5 GiB', () => {
        expect(DEFAULT_DISK_THRESHOLD_BYTES).toBe(5 * 1024 ** 3);
    });
});

describe('computeFreedBytes', () => {
    it('after - before quando ambos medidos', () => {
        const before: DiskInfo = { freeBytes: 1000, totalBytes: 10000 };
        const after: DiskInfo = { freeBytes: 3500, totalBytes: 10000 };
        expect(computeFreedBytes(before, after)).toBe(2500);
    });
    it('negativo se algo cresceu (after < before)', () => {
        expect(computeFreedBytes({ freeBytes: 5000, totalBytes: null }, { freeBytes: 4000, totalBytes: null })).toBe(-1000);
    });
    it('null se algum lado indisponível', () => {
        expect(computeFreedBytes({ freeBytes: null, totalBytes: null }, { freeBytes: 10, totalBytes: 10 })).toBe(null);
        expect(computeFreedBytes({ freeBytes: 10, totalBytes: 10 }, { freeBytes: null, totalBytes: null })).toBe(null);
    });
});

describe('isUnderClaudeWorktrees', () => {
    const dirs = ['C:/Projetos/sistemav2/.claude/worktrees'];
    it('true para subdir e o próprio dir', () => {
        expect(isUnderClaudeWorktrees('C:/Projetos/sistemav2/.claude/worktrees/wt1', dirs)).toBe(true);
        expect(isUnderClaudeWorktrees('C:/Projetos/sistemav2/.claude/worktrees', dirs)).toBe(true);
        expect(isUnderClaudeWorktrees('C:\\Projetos\\sistemav2\\.claude\\worktrees\\wt1', dirs)).toBe(true);
    });
    it('false para fora do dir', () => {
        expect(isUnderClaudeWorktrees('C:/Projetos/sistemav2', dirs)).toBe(false);
        expect(isUnderClaudeWorktrees('C:/Projetos/sistemav2-taskrunner-wt', dirs)).toBe(false);
        expect(isUnderClaudeWorktrees('C:/Projetos/sistemav2/.claude', dirs)).toBe(false); // pai, não filho
    });
});

describe('isWorktreeInUse — GC NUNCA toca worktree com processo vivo (correção #3)', () => {
    const wt = 'C:/Projetos/sistemav2/.claude/worktrees/wt1';

    it('true quando um processo vivo tem cwd == worktree (opencode rodando nele)', () => {
        expect(isWorktreeInUse(wt, [wt])).toBe(true);
        expect(isWorktreeInUse(wt, ['C:/outro/path', wt])).toBe(true);
    });

    it('true quando cwd é SUBDIR do worktree (opencode em subpasta)', () => {
        expect(isWorktreeInUse(wt, [`${wt}/backend/src`])).toBe(true);
        expect(isWorktreeInUse(wt, [`${wt}/.git`])).toBe(true);
    });

    it('false quando liveCwds vazio ou nenhum cwd dentro do worktree', () => {
        expect(isWorktreeInUse(wt, [])).toBe(false);
        expect(isWorktreeInUse(wt, ['C:/outro/path'])).toBe(false);
        expect(isWorktreeInUse(wt, ['C:/Projetos/sistemav2'])).toBe(false); // pai, não filho
    });

    it('NÃO falso-positiva entre wt1 e wt10 (prefix-match exige separador)', () => {
        expect(isWorktreeInUse('C:/r/.claude/worktrees/wt1', ['C:/r/.claude/worktrees/wt10'])).toBe(false);
        expect(isWorktreeInUse('C:/r/.claude/worktrees/wt10', ['C:/r/.claude/worktrees/wt1'])).toBe(false);
        // mas wt1/sub ainda casa wt1:
        expect(isWorktreeInUse('C:/r/.claude/worktrees/wt1', ['C:/r/.claude/worktrees/wt1/sub'])).toBe(true);
    });

    it('case/bara-insensitive (Windows)', () => {
        expect(isWorktreeInUse('C:\\Projetos\\Sistemav2\\.claude\\Worktrees\\Wt1',
            ['c:/projetos/sistemav2/.claude/worktrees/wt1'])).toBe(true);
        expect(isWorktreeInUse(wt, ['C:\\Projetos\\sistemav2\\.claude\\worktrees\\wt1\\backend'])).toBe(true);
    });

    it('ignora cwd vazio/nulo na lista', () => {
        expect(isWorktreeInUse(wt, ['', '  ', '/outro'])).toBe(false);
    });
});

describe('summarizeReport', () => {
    it('renderiza relatório completo com contagens e alerta', () => {
        const r: GcReport = {
            gitPruned: true,
            gitWorktreesRemoved: ['C:/r/.claude/worktrees/wtA'],
            gitWorktreesKept: ['C:/r/.claude/worktrees/wtLive'],
            orphanDirsRemoved: ['C:/r/.claude/worktrees/wtB'],
            orphanDirsKept: ['C:/r/.claude/worktrees/wtC'],
            junctionsUnlinked: ['C:/r/.claude/worktrees/wtB/node_modules'],
            processesReaped: [{ name: 'opencode', pids: [111, 222] }, { name: 'vite-preview', pids: [] }],
            diskBefore: { freeBytes: 1000, totalBytes: 10000 },
            diskAfter: { freeBytes: 6120, totalBytes: 10000 },
            freedBytes: 5120,
            lowDiskAlert: true,
            errors: ['algo falhou'],
        };
        const s = summarizeReport(r);
        expect(s).toContain('git worktree prune: OK');
        expect(s).toContain('worktrees git removidos: 1');
        expect(s).toContain('worktrees git preservados (processo vivo): 1');
        expect(s).toContain('dirs órfãos removidos: 1');
        expect(s).toContain('dirs órfãos preservados: 1');
        expect(s).toContain('junctions desligados (junction-safe): 1');
        expect(s).toContain('processos órfãos reapeados: 2');
        expect(s).toContain('espaço liberado: 5.0 KiB');
        expect(s).toContain('ALERTA: disco livre abaixo do limiar!');
        expect(s).toContain('erros (1)');
        expect(s).toContain('- algo falhou');
    });

    it('vazio sem alerta e sem erros', () => {
        const r: GcReport = {
            gitPruned: false,
            gitWorktreesRemoved: [],
            gitWorktreesKept: [],
            orphanDirsRemoved: [],
            orphanDirsKept: [],
            junctionsUnlinked: [],
            processesReaped: [],
            diskBefore: { freeBytes: null, totalBytes: null },
            diskAfter: { freeBytes: null, totalBytes: null },
            freedBytes: null,
            lowDiskAlert: null,
            errors: [],
        };
        const s = summarizeReport(r);
        expect(s).toContain('worktrees git removidos: 0');
        expect(s).not.toContain('preservados (processo vivo)');
        expect(s).toContain('espaço liberado: N/A');
        expect(s).toContain('medição indisponível');
        expect(s).toContain('erros: nenhum');
    });

    it('disk ok (acima do limiar) sem alerta', () => {
        const r: GcReport = {
            gitPruned: true,
            gitWorktreesRemoved: [],
            gitWorktreesKept: [],
            orphanDirsRemoved: [],
            orphanDirsKept: [],
            junctionsUnlinked: [],
            processesReaped: [],
            diskBefore: { freeBytes: 100 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3 },
            diskAfter: { freeBytes: 100 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3 },
            freedBytes: 0,
            lowDiskAlert: false,
            errors: [],
        };
        const s = summarizeReport(r);
        expect(s).toContain('acima do limiar (ok)');
        expect(s).not.toContain('ALERTA');
    });
});
