import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocks (hoisted) — espelham as dependências externas do taskRunnerService (padrão do queue/gate test). ===
vi.mock('child_process', () => ({ execFile: vi.fn(), exec: vi.fn(), spawn: vi.fn() }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/aiService', () => ({ aiService: { generateReply: vi.fn() } }));
vi.mock('../../services/aiJobService', () => ({ aiJobService: { runAndWait: vi.fn() } }));
vi.mock('../../utils/previewPorts', () => ({
    previewPortsFor: vi.fn(() => ({ frontendPort: 5999, backendPort: 6000 })),
}));
vi.mock('../../services/screenshotService', () => ({ screenshotService: { captureForTask: vi.fn() } }));
vi.mock('../../services/taskUsageTracker', () => ({
    recordUsage: vi.fn(),
    getUsageForTask: vi.fn(() => null),
}));
vi.mock('../../utils/processTree', () => ({
    killTree: vi.fn(async () => ({ ok: true })),
    isAlive: vi.fn(() => false),
    killOpencodeOrphans: vi.fn(async () => ({ killed: [], errors: [], confirmedGone: true, discriminated: true })),
    killByImageName: vi.fn(async () => undefined),
    listPidsByName: vi.fn(async () => []),
}));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
vi.mock('../../services/taskPlannerService', () => ({
    taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) },
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn() } }));
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));

import { taskRunnerService } from '../../services/taskRunnerService';

// withWorktreeLock é private; acessamos via cast para exercitar a unidade de lock diretamente.
const svc = taskRunnerService as any;

describe('taskRunnerService — withWorktreeLock: cadeia não-envenenável (#1114)', () => {
    beforeEach(() => {
        // Derruba TODOS os timers reais do singleton (recoveryTimer/pollTimer agendados no boot)
        // ANTES de virar o relógio falso, p/ que o avanço dispare APENAS o watchdog do lock.
        svc.stopPolling?.();

        // Reseta o elo do mutex p/ um estado limpo entre testes.
        svc.worktreeLock = Promise.resolve();
        svc.store = { tasks: {} };

        // Isola os side-effects do handler de watchdog (foco no comportamento do mutex, não neles).
        svc.sweepOrphanedOpencode = vi.fn(async () => false);
        svc.cleanStaleLocks = vi.fn();
        svc.save = vi.fn();

        // Relógio falso: reproduz o estouro do watchdog sem esperar 3h reais.
        vi.useFakeTimers();
        vi.clearAllTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('holder pendurado → 1ª aquisição FALHA (timeout) MAS a 2ª se RECUPERA (cadeia não trava)', async () => {
        // Cenário do incidente 2026-07-06: semeia um elo PENDURADO — promise que NUNCA settle
        // (holder que travou/restart e não chamou release()). Sem o fix (#1114), este elo
        // envenenaria a cadeia p/ sempre: TODA aquisição seguinte também daria timeout.
        svc.worktreeLock = new Promise<void>(() => { /* holder que nunca libera */ });

        // 1) A 1ª aquisição após o elo pendurado estoura o watchdog e REJEITA (lock abortado).
        const first = svc.withWorktreeLock('acq#1', async () => 'r1');
        // Anexa o handler de reject SINCRONAMENTMENTE (antes do avanço do relógio) p/ evitar
        // "Unhandled rejection" — o reject é disparado pelo timer falso, antes do vitest anexar.
        const firstErr = first.catch((e: Error) => e);
        // Avança além do watchdog total do lock (MAX_TASK_WALL_MS=180min + 5min de margem).
        // É o único timer pendente após o stopPolling/clearAllTimers, então dispara só este.
        await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000); // 12h > 3h05 de watchdog
        expect(String(await firstErr)).toMatch(/worktreeLock timeout/i);

        // 2) Evidência da correção: o release() no catch curou o elo — this.worktreeLock voltou
        //    a ser uma promise RESOLVIDA (não pendurada). Sem o fix, estaria pendurada p/ sempre.
        await expect(svc.worktreeLock).resolves.toBeUndefined();

        // 3) A 2ª aquisição se RECUPERA: sem o fix, esta também daria timeout (cascata).
        const second = svc.withWorktreeLock('acq#2', async () => 'r2');
        await expect(second).resolves.toBe('r2');
    }, 15000);

    it('caminho feliz: aquisições concorrentes SERIALIZAM e cada uma libera o elo p/ a próxima', async () => {
        // Sem holder pendurado: cada aquisição resolve e libera o lock p/ a seguinte (regressão
        // garante que o fix do #1114 não quebrou o fluxo normal de aquisição/liberação).
        const r1 = await svc.withWorktreeLock('happy#1', async () => 'a');
        expect(r1).toBe('a');

        const r2 = await svc.withWorktreeLock('happy#2', async () => 'b');
        expect(r2).toBe('b');

        // Ao fim, o elo está liberado (promise resolvida) — pronto p/ a próxima aquisição.
        await expect(svc.worktreeLock).resolves.toBeUndefined();
    });
});
