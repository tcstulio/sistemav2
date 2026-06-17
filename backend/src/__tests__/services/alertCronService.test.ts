import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loggerSpies = vi.hoisted(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
}));

const mockFinancialAnalysisStore = vi.hoisted(() => ({
    getAutomationConfig: vi.fn(),
    saveAutomationConfig: vi.fn(),
    saveAnalysis: vi.fn(),
}));

const mockRunSalesForecastAnalysis = vi.hoisted(() => vi.fn());

vi.mock('../../utils/logger', () => ({
    createLogger: () => loggerSpies,
}));

vi.mock('../../services/dolibarr', () => ({
    dolibarrService: {},
}));

vi.mock('../../services/notificationService', () => ({
    notificationService: { create: vi.fn() },
    NotificationEvent: {},
}));

vi.mock('../../services/notificationTemplates', () => ({
    renderTemplate: vi.fn(),
}));

vi.mock('../../services/delegationFollowUpService', () => ({
    delegationFollowUpService: { runTick: vi.fn() },
}));

vi.mock('../../services/financialAnalysisStore', () => ({
    financialAnalysisStore: mockFinancialAnalysisStore,
}));

vi.mock('../../services/analyzeService', () => ({
    runSalesForecastAnalysis: mockRunSalesForecastAnalysis,
}));

describe('alertCronService — financial analysis automation (issue #491)', () => {
    let alertCronService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        vi.useFakeTimers();
        vi.clearAllTimers();

        const mod = await import('../../services/alertCronService');
        alertCronService = mod.alertCronService;
    });

    afterEach(() => {
        try { alertCronService.stop(); } catch { /* noop */ }
        vi.useRealTimers();
    });

    describe('start()', () => {
        it('logs that the financial analysis automation was scheduled', () => {
            alertCronService.start();
            expect(loggerSpies.info).toHaveBeenCalledWith(
                '[alertCronService] Financial analysis automation scheduled',
            );
        });

        it('schedules a 1-minute interval for the financial analysis job', () => {
            const spy = vi.spyOn(global, 'setInterval');
            alertCronService.start();
            const calls = spy.mock.calls.map((c: any) => c[1]);
            expect(calls).toContain(60 * 1000);
            spy.mockRestore();
        });
    });

    describe('checkFinancialAnalysisAutomation()', () => {
        const due = new Date(2025, 5, 15, 18, 0, 0); // date real; schedule abaixo espelha dia/hora/min
        const dueSchedule = { dayOfWeek: due.getDay(), hour: 18, minute: 0 };

        it('does NOT run when automation is disabled', async () => {
            mockFinancialAnalysisStore.getAutomationConfig.mockReturnValue({
                enabled: false,
                schedule: dueSchedule,
            });

            const res = await alertCronService.checkFinancialAnalysisAutomation(due);

            expect(res).toEqual({ ran: false, reason: 'disabled' });
            expect(mockRunSalesForecastAnalysis).not.toHaveBeenCalled();
            expect(mockFinancialAnalysisStore.saveAutomationConfig).not.toHaveBeenCalled();
        });

        it('does NOT run when current time does not match the schedule', async () => {
            mockFinancialAnalysisStore.getAutomationConfig.mockReturnValue({
                enabled: true,
                schedule: { dayOfWeek: 3, hour: 9, minute: 30 }, // diferente do `due`
            });

            const res = await alertCronService.checkFinancialAnalysisAutomation(due);

            expect(res).toEqual({ ran: false, reason: 'not-due' });
            expect(mockRunSalesForecastAnalysis).not.toHaveBeenCalled();
        });

        it('runs the forecast, persists snapshot and updates config lastRunAt/lastRunStatus', async () => {
            const snapshot = { data: { forecast: [] }, lastRunAt: '2025-06-15T18:00:00.000Z', status: 'success' };
            mockFinancialAnalysisStore.getAutomationConfig.mockReturnValue({
                enabled: true,
                schedule: dueSchedule,
            });
            mockRunSalesForecastAnalysis.mockResolvedValue({ result: '{}', snapshot });
            mockFinancialAnalysisStore.saveAutomationConfig.mockReturnValue({ enabled: true, schedule: dueSchedule });

            const res = await alertCronService.checkFinancialAnalysisAutomation(due);

            expect(mockRunSalesForecastAnalysis).toHaveBeenCalledTimes(1);
            expect(mockFinancialAnalysisStore.saveAutomationConfig).toHaveBeenCalledWith({
                lastRunAt: snapshot.lastRunAt,
                lastRunStatus: 'success',
            });
            expect(res).toEqual({ ran: true, status: 'success' });
        });

        it('fires only once per target slot (dedup within the same minute)', async () => {
            const snapshot = { data: {}, lastRunAt: '2025-06-15T18:00:00.000Z', status: 'success' };
            mockFinancialAnalysisStore.getAutomationConfig.mockReturnValue({
                enabled: true,
                schedule: dueSchedule,
            });
            mockRunSalesForecastAnalysis.mockResolvedValue({ result: '{}', snapshot });

            const first = await alertCronService.checkFinancialAnalysisAutomation(due);
            const second = await alertCronService.checkFinancialAnalysisAutomation(due);

            expect(first).toEqual({ ran: true, status: 'success' });
            expect(second).toEqual({ ran: false, reason: 'already-ran' });
            expect(mockRunSalesForecastAnalysis).toHaveBeenCalledTimes(1);
        });

        it('respects a changed config (new day/time) on the next tick', async () => {
            const snapshot = { data: {}, lastRunAt: '2025-06-16T09:30:00.000Z', status: 'success' };
            const newDue = new Date(2025, 5, 16, 9, 30, 0);
            const newSchedule = { dayOfWeek: newDue.getDay(), hour: 9, minute: 30 }; // espelha dia/hora/min do `newDue`
            mockFinancialAnalysisStore.getAutomationConfig.mockReturnValue({
                enabled: true,
                schedule: newSchedule,
            });
            mockRunSalesForecastAnalysis.mockResolvedValue({ result: '{}', snapshot });

            const res = await alertCronService.checkFinancialAnalysisAutomation(newDue);

            expect(res).toEqual({ ran: true, status: 'success' });
            expect(mockRunSalesForecastAnalysis).toHaveBeenCalledTimes(1);
        });

        it('persists an error snapshot and sets lastRunStatus=error when the analysis throws', async () => {
            mockFinancialAnalysisStore.getAutomationConfig.mockReturnValue({
                enabled: true,
                schedule: dueSchedule,
            });
            mockRunSalesForecastAnalysis.mockRejectedValue(new Error('forecast failed'));
            const errSnap = { data: null, lastRunAt: '2025-06-15T18:00:00.000Z', status: 'error', error: 'forecast failed' };
            mockFinancialAnalysisStore.saveAnalysis.mockReturnValue(errSnap);

            const res = await alertCronService.checkFinancialAnalysisAutomation(due);

            expect(mockFinancialAnalysisStore.saveAnalysis).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'error', error: 'forecast failed' }),
            );
            expect(mockFinancialAnalysisStore.saveAutomationConfig).toHaveBeenCalledWith({
                lastRunAt: errSnap.lastRunAt,
                lastRunStatus: 'error',
            });
            expect(res).toEqual({ ran: true, status: 'error', reason: 'forecast failed' });
            expect(loggerSpies.error).toHaveBeenCalled();
        });
    });
});
