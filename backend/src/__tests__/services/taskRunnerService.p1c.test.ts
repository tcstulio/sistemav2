import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Mocks (mesmo conjunto do p0/p1/p1b test). ===
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
const svc = taskRunnerService as any;

beforeEach(() => { svc.stopPolling?.(); vi.clearAllMocks(); });

describe('#1154 P1 item 6 — isTransientError distingue infra transitória de falha real', () => {
    it('casa rede/gh/timeout/5xx/rate-limit', () => {
        for (const m of ['connect ETIMEDOUT 1.2.3.4:443', 'read ECONNRESET', 'HTTP 503 Service Unavailable',
                         'API rate limit exceeded', 'socket hang up', 'getaddrinfo ENOTFOUND api.github.com']) {
            expect(svc.isTransientError(m)).toBe(true);
        }
    });
    it('NÃO casa conflito real / typecheck / erro genérico (esses vão p/ revisão)', () => {
        for (const m of ['PR com conflitos (mergeable=CONFLICTING)', 'typecheck falhou: TS2322', 'algo deu errado']) {
            expect(svc.isTransientError(m)).toBe(false);
        }
    });
});

describe('#1154 P1 item 6 — self-heal de typecheck pós-rebase (kind novo)', () => {
    beforeEach(() => {
        svc.scheduleExec = vi.fn();
        svc.save = vi.fn();
        svc.emitStatus = vi.fn();
        svc.recordEvent = vi.fn();
        svc.emitLog = vi.fn();
        svc.getAutomationConfig = vi.fn(() => ({ maxGateFixRounds: 3 }));
    });

    it('typecheckAfterRebase gera instrução de rebase, marca fixing e agenda exec fresco', () => {
        const task: any = { issueNumber: 1, branch: 'fix-1', gateFixAttempts: 0, events: [] };
        const ok = svc.selfHealFromGate(task, 'typecheckAfterRebase', 'TS2345: tipo incompatível');
        expect(ok).toBe(true);
        expect(task.gateFixInstruction).toMatch(/rebase/i);
        expect(task.status).toBe('fixing');
        expect(task.gateFixAttempts).toBe(1);
        expect(svc.scheduleExec).toHaveBeenCalledWith(task, 'fix-1', 'fixing', expect.objectContaining({ id: 1 })); // exec fresco + #slot-chain 4º arg
    });

    it('respeita o teto (maxGateFixRounds) — esgotado, retorna false p/ o chamador estacionar', () => {
        const task: any = { issueNumber: 2, branch: 'fix-2', gateFixAttempts: 3, events: [] };
        expect(svc.selfHealFromGate(task, 'typecheckAfterRebase', 'x')).toBe(false);
    });
});
