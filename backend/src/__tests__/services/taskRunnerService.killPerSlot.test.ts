import { describe, it, expect, vi, beforeEach } from 'vitest';

// #kill-per-slot (red-team Fable): sweepOrphanedOpencode passa protectNeedles = needles das runs
// VIVAS (liveRunNeedles) MENOS o excludeIssue. Em serial o registry tem ≤1 entrada e ela é o
// excludeIssue → protect vazio → comportamento idêntico ao de hoje. Habilita o paralelo (Fase 2)
// sem que o sweep de um slot mate o coder vizinho.
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
import { killOpencodeOrphans } from '../../utils/processTree';
import { OPENCODE_ORPHAN_NEEDLES } from '../../utils/gcWorktrees';
const svc = taskRunnerService as any;
const orphans = vi.mocked(killOpencodeOrphans);
const protectArg = () => orphans.mock.calls[orphans.mock.calls.length - 1]?.[3] as string[] | undefined;

beforeEach(() => {
    vi.clearAllMocks();
    svc.stopPolling?.();
    svc.liveRunNeedles = new Map<number, string>();
    orphans.mockResolvedValue({ killed: [], errors: [], confirmedGone: true, discriminated: true });
});

describe('sweepOrphanedOpencode — protectNeedles por-slot', () => {
    it('usa os needles genéricos como kill-list', async () => {
        await svc.sweepOrphanedOpencode('teste');
        expect(orphans).toHaveBeenCalledWith('opencode', OPENCODE_ORPHAN_NEEDLES, [], []);
    });

    it('serial (registry só com a própria run, excluída) → protect VAZIO (idêntico a hoje)', async () => {
        svc.liveRunNeedles.set(5, '[tr-run:5-111]');
        await svc.sweepOrphanedOpencode('pre-run #5', [], undefined, { excludeIssue: 5 });
        expect(protectArg()).toEqual([]);
    });

    it('paralelo: protege as OUTRAS runs vivas, exclui a própria', async () => {
        svc.liveRunNeedles.set(5, '[tr-run:5-111]');
        svc.liveRunNeedles.set(7, '[tr-run:7-222]');
        svc.liveRunNeedles.set(9, '[tr-run:9-333]');
        await svc.sweepOrphanedOpencode('pre-run #5', [], undefined, { excludeIssue: 5 });
        // protege 7 e 9 (vizinhos vivos), NÃO a própria #5.
        expect(protectArg()?.sort()).toEqual(['[tr-run:7-222]', '[tr-run:9-333]']);
    });

    it('lock-timeout: o holder travado é excluído do protect (é o alvo do kill)', async () => {
        svc.liveRunNeedles.set(5, '[tr-run:5-111]'); // holder travado
        svc.liveRunNeedles.set(7, '[tr-run:7-222]'); // vizinho saudável
        await svc.sweepOrphanedOpencode('lock-timeout', [], undefined, { excludeIssue: 5 });
        expect(protectArg()).toEqual(['[tr-run:7-222]']); // só o vizinho é protegido
    });

    it('sem excludeIssue → protege TODAS as runs vivas', async () => {
        svc.liveRunNeedles.set(5, '[tr-run:5-111]');
        svc.liveRunNeedles.set(7, '[tr-run:7-222]');
        await svc.sweepOrphanedOpencode('boot');
        expect(protectArg()?.sort()).toEqual(['[tr-run:5-111]', '[tr-run:7-222]']);
    });

    it('cancel mid-run (#5): NÃO protege o próprio órfão (mata o alvo), MAS protege o vizinho vivo (#7)', async () => {
        // Reproduz o bug do killTask: o needle da cancelada ainda no registry (finally só roda no settle).
        svc.liveRunNeedles.set(5, '[tr-run:5-111]'); // task sendo cancelada
        svc.liveRunNeedles.set(7, '[tr-run:7-222]'); // coder vizinho VIVO
        await svc.sweepOrphanedOpencode('cancel #5', [], undefined, { excludeIssue: 5 });
        // #5 fora do protect (é o alvo do cancel) → matável; #7 protegido.
        expect(protectArg()).toEqual(['[tr-run:7-222]']);
    });
});
