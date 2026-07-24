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
    const multerMock: any = (_options?: any) => ({
        array: () => (_req: any, _res: any, next: any) => next(),
        single: () => (req: any, _res: any, next: any) => {
            if (req.headers['x-test-file'] === 'true') {
                req.file = {
                    buffer: Buffer.from('date,amount,description\n2024-01-01,100,Test'),
                    originalname: 'statement.csv',
                    mimetype: 'text/csv'
                };
            }
            next();
        },
        fields: () => (_req: any, _res: any, next: any) => next(),
        none: () => (_req: any, _res: any, next: any) => next(),
    });
    multerMock.memoryStorage = () => ({});
    multerMock.diskStorage = () => ({});
    return { default: multerMock };
});

import bankingRoutes from '../../routes/bankingRoutes';
import { errorHandler } from '../../middleware/errorHandler';
import { rateLimiters } from '../../middleware/rateLimit';

const validUserApiKey = '12345678901234';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (!req.headers['x-test-no-api-key'] && !req.headers['userapikey'] && !req.headers['dolapikey']) {
            req.headers['userapikey'] = validUserApiKey;
        }
        next();
    });
    app.use('/api/banking', bankingRoutes);
    app.use(errorHandler);
    return app;
}

function resetBankingLimiter() {
    const limiter: any = rateLimiters.banking;
    if (typeof limiter?.resetKey !== 'function') return;
    for (const ip of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
        try { limiter.resetKey(ip); } catch { continue; }
    }
}

describe('bankingRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        resetBankingLimiter();
        mockDolibarrService.reconcileBankLine.mockResolvedValue(true);
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

    describe('POST /api/banking/reconcile/toggle — #630 persistence', () => {
        it('returns 200 and success:true when reconcileBankLine succeeds', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(true);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', validUserApiKey)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockDolibarrService.reconcileBankLine).toHaveBeenCalledWith(
                'acc1', 'line1', true, validUserApiKey
            );
        });

        it('returns 200 and success:false when reconcileBankLine returns false', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(false);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: false });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
        });

        it('returns 400 when accountId is missing', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ lineId: 'line1', reconciled: true });

            expect(res.status).toBe(400);
        });

        it('returns 400 when lineId is missing', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ accountId: 'acc1', reconciled: true });

            expect(res.status).toBe(400);
        });

        it('returns 400 when reconciled is not a boolean', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: 'yes' });

            expect(res.status).toBe(400);
        });

        it('returns 500 when reconcileBankLine throws', async () => {
            mockDolibarrService.reconcileBankLine.mockRejectedValue(new Error('Dolibarr down'));
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/banking/export — #1330 validation', () => {
        it('returns 400 for malformed JSON format', async () => {
            const res = await request(app)
                .post('/api/banking/export')
                .send({ format: '{invalid json', bankCode: '001', accountId: 'acc1' });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toBe('Formato inválido');
        });

        it.each([null, undefined])('returns 400 when format is %s', async (format) => {
            const body: Record<string, unknown> = { bankCode: '001', accountId: 'acc1' };
            if (format !== undefined) body.format = format;

            const res = await request(app)
                .post('/api/banking/export')
                .send(body);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('accepts a UUID userApiKey', async () => {
            const res = await request(app)
                .post('/api/banking/export')
                .set('userApiKey', '123e4567-e89b-12d3-a456-426614174000')
                .send({ format: '{"type":"csv"}', bankCode: '001', accountId: 'acc1' });

            expect(res.status).toBe(200);
        });
    });

    describe('userApiKey validation — #1330', () => {
        it('returns 401 when the header is absent', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .set('x-test-no-api-key', 'true')
                .send({ transactions: [] });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
        });

        it('returns 401 when the header is invalid', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .set('userApiKey', 'invalid-key')
                .send({ transactions: [] });

            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/banking/import/csv — #1330 regression', () => {
        it('delegates malformed JSON to the error handler as HTTP 400', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .set('x-test-file', 'true')
                .send({ format: '{invalid json' });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toBe('Formato inválido');
        });

        it.each([null, undefined])('returns 400 when format is %s', async (format) => {
            const body: Record<string, unknown> = {};
            if (format !== undefined) body.format = format;

            const res = await request(app)
                .post('/api/banking/import/csv')
                .set('x-test-file', 'true')
                .send(body);

            expect(res.status).toBe(400);
            expect(mockBankingService.parseCSV).not.toHaveBeenCalled();
        });
    });

    describe('bankingLimiter — #1330', () => {
        it('returns 429 on the 11th POST within 15 minutes', async () => {
            for (let requestNumber = 1; requestNumber <= 10; requestNumber += 1) {
                const res = await request(app)
                    .post('/api/banking/analyze/categorize')
                    .send({ transactions: [] });
                expect(res.status).toBe(200);
            }

            const limited = await request(app)
                .post('/api/banking/reconcile/suggest')
                .send({ bankLines: [], invoices: [] });

            expect(limited.status).toBe(429);
            expect(limited.body.error.code).toBe('RATE_LIMIT');
        });
    });
});
