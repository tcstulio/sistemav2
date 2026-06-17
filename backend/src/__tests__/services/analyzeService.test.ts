import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListInvoices = vi.hoisted(() => vi.fn());
const mockGenerateSalesForecast = vi.hoisted(() => vi.fn());
const mockSaveAnalysis = vi.hoisted(() => vi.fn());

vi.mock('../../services/dolibarr', () => ({
    dolibarrService: { listInvoices: mockListInvoices },
}));

vi.mock('../../services/aiService', () => ({
    aiService: { generateSalesForecast: mockGenerateSalesForecast },
}));

vi.mock('../../services/financialAnalysisStore', () => ({
    financialAnalysisStore: { saveAnalysis: mockSaveAnalysis },
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

describe('analyzeService.runSalesForecastAnalysis', () => {
    let runSalesForecastAnalysis: () => Promise<any>;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();

        mockListInvoices.mockResolvedValue([{ id: 1, total_ttc: '100' }]);
        mockGenerateSalesForecast.mockResolvedValue(JSON.stringify({ forecast: [], summary: 'ok', trend: 'up' }));
        mockSaveAnalysis.mockImplementation((input: any) => ({
            data: input.data,
            status: input.status,
            lastRunAt: input.lastRunAt ?? '2025-06-17T18:00:00.000Z',
        }));

        const mod = await import('../../services/analyzeService');
        runSalesForecastAnalysis = mod.runSalesForecastAnalysis;
    });

    it('fetches invoices, calls generateSalesForecast (same fn the route uses), and persists the snapshot', async () => {
        const { result, snapshot } = await runSalesForecastAnalysis();

        expect(mockListInvoices).toHaveBeenCalledWith({ limit: 200 });
        expect(mockGenerateSalesForecast).toHaveBeenCalledWith(
            [{ id: 1, total_ttc: '100' }],
            { referenceDate: expect.any(String) },
        );
        expect(mockSaveAnalysis).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
        expect(snapshot.status).toBe('success');
        expect(result).toBe(JSON.stringify({ forecast: [], summary: 'ok', trend: 'up' }));
    });

    it('stores the forecast parsed as a structured object', async () => {
        await runSalesForecastAnalysis();
        const saved = mockSaveAnalysis.mock.calls[0][0];
        expect(saved.data).toEqual({ forecast: [], summary: 'ok', trend: 'up' });
    });

    it('falls back to raw string when the forecast is not valid JSON', async () => {
        mockGenerateSalesForecast.mockResolvedValue('not-json');
        await runSalesForecastAnalysis();
        const saved = mockSaveAnalysis.mock.calls[0][0];
        expect(saved.data).toBe('not-json');
    });

    it('propagates errors from the AI provider', async () => {
        mockGenerateSalesForecast.mockRejectedValue(new Error('ai down'));
        await expect(runSalesForecastAnalysis()).rejects.toThrow('ai down');
    });

    it('passes a valid ISO referenceDate to the forecast context', async () => {
        await runSalesForecastAnalysis();
        const ctx = mockGenerateSalesForecast.mock.calls[0][1];
        expect(new Date(ctx.referenceDate).getTime()).not.toBeNaN();
    });
});
