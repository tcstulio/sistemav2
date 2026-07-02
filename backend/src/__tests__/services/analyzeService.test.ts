import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListInvoices = vi.hoisted(() => vi.fn());
const mockGenerateSalesForecast = vi.hoisted(() => vi.fn());
const mockSaveAnalysis = vi.hoisted(() => vi.fn());
const mockSetSalesForecast = vi.hoisted(() => vi.fn());

vi.mock('../../services/dolibarr', () => ({
    dolibarrService: { listInvoices: mockListInvoices },
}));

vi.mock('../../services/aiService', () => ({
    aiService: { generateSalesForecast: mockGenerateSalesForecast },
}));

vi.mock('../../services/financialAnalysisStore', () => ({
    financialAnalysisStore: { saveAnalysis: mockSaveAnalysis },
}));

vi.mock('../../services/dashboardArtifactsService', () => ({
    dashboardArtifactsService: { setSalesForecast: mockSetSalesForecast },
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
            'banking',
        );
        expect(mockSaveAnalysis).not.toHaveBeenCalled(); // #931: não grava no store da Análise Financeira
        expect(snapshot.status).toBe('success');
        expect(result).toBe(JSON.stringify({ forecast: [], summary: 'ok', trend: 'up' }));
    });

    it('retorna o forecast parseado como objeto estruturado no snapshot', async () => {
        const { snapshot } = await runSalesForecastAnalysis();
        expect(snapshot.data).toEqual({ forecast: [], summary: 'ok', trend: 'up' });
    });

    it('mantém string crua no snapshot quando o forecast não é JSON válido', async () => {
        mockGenerateSalesForecast.mockResolvedValue('not-json');
        const { snapshot } = await runSalesForecastAnalysis();
        expect(snapshot.data).toBe('not-json');
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

    it('#931: alimenta o widget (dashboardArtifacts) quando o forecast é válido', async () => {
        const fc = { forecast: [{ month: 'Jul 2026', predicted_revenue: 1000, confidence: 'medium' }], summary: 'ok', trend: 'up' };
        mockGenerateSalesForecast.mockResolvedValue(JSON.stringify(fc));

        await runSalesForecastAnalysis();

        expect(mockSetSalesForecast).toHaveBeenCalledWith(fc, 'Automação');
    });

    it('#931: NÃO sobrescreve o widget quando o forecast vem vazio', async () => {
        // default do beforeEach: forecast: [] → não deve gravar no store do widget
        await runSalesForecastAnalysis();
        expect(mockSetSalesForecast).not.toHaveBeenCalled();
    });
});
