import { describe, it, expect, vi, beforeEach } from 'vitest';

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
const today = () => new Date().toISOString().slice(0, 10);

beforeEach(() => { svc.stopPolling?.(); vi.clearAllMocks(); });

describe('#1189 — getDailyRoundsStatus expõe consumo REAL do orçamento diário', () => {
    it('retorna used=0 e budget default quando nenhuma rodada ocorreu hoje', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: false, dailyRoundBudget: 200 }));
        svc.dailyRounds = { date: '', count: 0 };
        expect(svc.getDailyRoundsStatus()).toEqual({ dailyRoundsUsed: 0, dailyRoundBudget: 200 });
    });

    it('reflete o contador real do dia (sem mock do valor usado)', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: false, dailyRoundBudget: 50 }));
        svc.dailyRounds = { date: today(), count: 17 };
        const status = svc.getDailyRoundsStatus();
        expect(status.dailyRoundsUsed).toBe(17);
        expect(status.dailyRoundBudget).toBe(50);
    });

    it('zera o used quando o contador é de outro dia (virada do dia)', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: false, dailyRoundBudget: 200 }));
        svc.dailyRounds = { date: '1999-01-01', count: 99 };
        expect(svc.getDailyRoundsStatus().dailyRoundsUsed).toBe(0);
    });

    it('cai no fallback de budget (200) quando o teto configurado é inválido', () => {
        svc.getAutomationConfig = vi.fn(() => ({ autoPlay: false } as any));
        svc.dailyRounds = { date: today(), count: 3 };
        expect(svc.getDailyRoundsStatus()).toEqual({ dailyRoundsUsed: 3, dailyRoundBudget: 200 });
    });
});
