import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockBankingService = vi.hoisted(() => ({
    parseOFX: vi.fn(() => ({ transactions: [], accountNumber: '123', balance: 0 })),
    parseCSV: vi.fn(() => ({ transactions: [], metadata: {} })),
    parseStatement: vi.fn(() => ({ transactions: [], accountNumber: '123', balance: 0 })),
    categorizeTransactions: vi.fn(() => []),
    detectAnomalies: vi.fn(() => []),
    generateCashFlowInsights: vi.fn(() => ({})),
    getCashFlowChartData: vi.fn(() => ({})),
    suggestReconciliation: vi.fn(() => []),
    saveReconciliation: vi.fn(() => true),
    calculateDynamicBalance: vi.fn(() => ({})),
}));

const mockDolibarrService = vi.hoisted(() => ({
    reconcileBankLine: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/bankingService', () => ({
    bankingService: mockBankingService,
}));

vi.mock('../../services/dolibarr', () => ({
    dolibarrService: mockDolibarrService,
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

vi.mock('multer', () => {
    // multer é chamado como função (multer({...})) e tem .memoryStorage/.diskStorage estáticos.
    // #1330: single() injeta um arquivo fake — necessário para exercitar o caminho de
    // parse do `format` em /import/csv (o handler valida o format e depois o arquivo).
    const fakeFile = () => ({
        fieldname: 'file',
        originalname: 'extrato.csv',
        mimetype: 'text/csv',
        size: 44,
        buffer: Buffer.from('date,amount,description\n2024-01-01,100,Teste\n'),
    });
    const multerMock: any = (_options?: any) => ({
        array: () => (_req: any, _res: any, next: any) => next(),
        single: () => (req: any, _res: any, next: any) => { req.file = fakeFile(); next(); },
        fields: () => (_req: any, _res: any, next: any) => next(),
        none: () => (_req: any, _res: any, next: any) => next(),
    });
    multerMock.memoryStorage = () => ({});
    multerMock.diskStorage = () => ({});
    return { default: multerMock };
});

import bankingRoutes, { bankingLimiter } from '../../routes/bankingRoutes';
// #1330: errorHandler global para renderizar os `next(error)` (Zod/AppError/429)
// no envelope padronizado `{ success: false, error: { code, message } }`.
import { errorHandler } from '../../middleware/errorHandler';

// Chaves válidas para o header `dolapikey` (#1330: CNPJ 14 dígitos ou UUID)
const VALID_UUID_KEY = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const VALID_CNPJ_KEY = '12345678000199';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/banking', bankingRoutes);
    app.use(errorHandler);
    return app;
}

/**
 * Reseta o bucket do bankingLimiter para o IP de loopback (supertest usa
 * `::ffff:127.0.0.1` por padrão). Sem isso, após 10 POSTs os testes seguintes
 * começariam a receber 429 (o limiter é 10/15min por IP — #1330). Mesmo padrão
 * do resetSchedulerLimiter (#1567).
 */
function resetBankingLimiter() {
    const limiter: any = bankingLimiter as any;
    if (typeof limiter?.resetKey !== 'function') return;
    for (const ip of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
        try { limiter.resetKey(ip); } catch { /* ignore */ }
    }
}

describe('bankingRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        resetBankingLimiter();
        app = createApp();
    });

    describe('POST /api/banking/analyze/categorize', () => {
        it('returns 200 with valid transactions', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .send({ transactions: [{ date: '2024-01-01', amount: 100, description: 'Test' }] });

            expect(res.status).toBe(200);
        });

        it('returns 400 when transactions missing', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .send({});

            expect(res.status).toBe(400);
        });

        it('returns 400 when transactions not array', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .send({ transactions: 'not-array' });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/banking/analyze/anomalies', () => {
        it('returns 200 with valid transactions', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/anomalies')
                .send({ transactions: [{ date: '2024-01-01', amount: 100 }] });

            expect(res.status).toBe(200);
        });

        it('returns 400 when transactions missing', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/anomalies')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/banking/insights/cash-flow', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/banking/insights/cash-flow')
                .send({ accounts: [], transactions: [] });

            expect(res.status).toBe(200);
        });

        it('returns 400 when accounts or transactions missing', async () => {
            const res = await request(app)
                .post('/api/banking/insights/cash-flow')
                .send({ accounts: [] });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/banking/reconcile/suggest', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/suggest')
                .send({ bankLines: [], invoices: [] });

            expect(res.status).toBe(200);
        });

        it('returns 400 when missing fields', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/suggest')
                .send({ bankLines: [] });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/banking/balance/calculate', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(200);
        });

        it('returns 400 when missing fields', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .send({ initialBalance: 1000 });

            expect(res.status).toBe(400);
        });
    });

    // #1330: todos os testes de toggle enviam DOLAPIKEY válida — o header agora é
    // obrigatório (401 sem ele; casos de 401 no describe do userApiKey abaixo).
    describe('POST /api/banking/reconcile/toggle — #630 persistence', () => {
        it('returns 200 and success:true when reconcileBankLine succeeds', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(true);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', VALID_UUID_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockDolibarrService.reconcileBankLine).toHaveBeenCalledWith(
                'acc1', 'line1', true, VALID_UUID_KEY
            );
        });

        it('returns 200 and success:false when reconcileBankLine returns false', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(false);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', VALID_UUID_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: false });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
        });

        it('returns 400 when accountId is missing', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', VALID_UUID_KEY)
                .send({ lineId: 'line1', reconciled: true });

            expect(res.status).toBe(400);
        });

        it('returns 400 when lineId is missing', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', VALID_UUID_KEY)
                .send({ accountId: 'acc1', reconciled: true });

            expect(res.status).toBe(400);
        });

        it('returns 400 when reconciled is not a boolean', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', VALID_UUID_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: 'yes' });

            expect(res.status).toBe(400);
        });

        it('returns 500 when reconcileBankLine throws', async () => {
            mockDolibarrService.reconcileBankLine.mockRejectedValue(new Error('Dolibarr down'));
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', VALID_UUID_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(500);
        });
    });

    // =====================================================
    // #1330 — AC: JSON inválido em `format` retorna 400 (não crash 500)
    // =====================================================
    describe('#1330: POST /api/banking/import/csv — validação de format', () => {
        it('format com JSON inválido retorna 400 com envelope VALIDATION_ERROR (não 500)', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({ format: '{invalid json' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.message).toBe('Formato inválido');
        });

        it('format: null retorna 400 (regressão — não crash)', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({ format: null });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('format que parseia para não-objeto (ex.: "123") retorna 400', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({ format: '123' });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toBe('Formato inválido');
        });

        it('format JSON válido retorna 200 e repassa o format ao parseCSV', async () => {
            const format = { dateColumn: 'data', amountColumn: 'valor', descriptionColumn: 'desc', delimiter: ';', hasHeader: true };
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({ format: JSON.stringify(format) });

            expect(res.status).toBe(200);
            expect(mockBankingService.parseCSV).toHaveBeenCalledWith(expect.any(String), format);
        });

        it('sem format usa auto-detecção (defaults) e retorna 200', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({});

            expect(res.status).toBe(200);
            expect(mockBankingService.parseCSV).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ dateColumn: 'date', amountColumn: 'amount' })
            );
        });
    });

    // =====================================================
    // #1330 — AC: Zod aplicado nas demais rotas POST
    // =====================================================
    describe('#1330: Zod schema nas rotas POST', () => {
        it('insights/chart-data sem transactions retorna 400 com VALIDATION_ERROR', async () => {
            const res = await request(app)
                .post('/api/banking/insights/chart-data')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('import/auto com bankCode não-string retorna 400', async () => {
            const res = await request(app)
                .post('/api/banking/import/auto')
                .send({ bankCode: 123 });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('balance/calculate com initialBalance não-numérico retorna 400', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .send({ initialBalance: 'mil', transactions: [] });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });

    // =====================================================
    // #1330 — AC: header userApiKey (dolapikey) validado por regex CNPJ/UUID
    // =====================================================
    describe('#1330: header userApiKey (dolapikey) — CNPJ/UUID', () => {
        it('reconcile/toggle sem header retorna 401', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
        });

        it('reconcile/toggle com header fora do padrão retorna 401', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', 'test-key')
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
        });

        it('reconcile/toggle com CNPJ válido (14 dígitos) passa (200)', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(true);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', VALID_CNPJ_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(200);
            expect(mockDolibarrService.reconcileBankLine).toHaveBeenCalledWith(
                'acc1', 'line1', true, VALID_CNPJ_KEY
            );
        });

        it('reconcile/save sem header retorna 401', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/save')
                .send({ lineId: 'line1', invoiceId: 'inv1' });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
        });

        it('reconcile/save com UUID válido passa (200)', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/save')
                .set('DOLAPIKEY', VALID_UUID_KEY)
                .send({ lineId: 'line1', invoiceId: 'inv1' });

            expect(res.status).toBe(200);
            expect(mockBankingService.saveReconciliation).toHaveBeenCalledWith(
                'line1', 'inv1', VALID_UUID_KEY
            );
        });
    });

    // =====================================================
    // #1330 — AC: 11ª requisição POST em 15min retorna 429
    // O limiter (factory createBankingLimiter, 10/15min, bucket por IP) é aplicado
    // em router.use() dentro de bankingRoutes.ts e cobre todas as rotas POST.
    // O 429 vem no envelope padronizado via next(error) → errorHandler.
    // =====================================================
    describe('#1330: bankingLimiter — 11ª POST em 15min → 429', () => {
        it('10 POSTs OK; a 11ª retorna 429 com envelope RATE_LIMIT', async () => {
            for (let i = 0; i < 10; i++) {
                const res = await request(app)
                    .post('/api/banking/analyze/categorize')
                    .send({ transactions: [] });
                expect(res.status).toBe(200);
            }

            const blocked = await request(app)
                .post('/api/banking/analyze/categorize')
                .send({ transactions: [] });

            expect(blocked.status).toBe(429);
            expect(blocked.body.success).toBe(false);
            expect(blocked.body.error.code).toBe('RATE_LIMIT');
            expect(typeof blocked.body.error.message).toBe('string');
            expect(blocked.body.error.message.length).toBeGreaterThan(0);
        });
    });
});
