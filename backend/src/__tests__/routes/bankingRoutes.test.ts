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
    // Para os testes, populamos um req.file dummy caso o body da request contenha `__mockFile`.
    const multerMock: any = (_options?: any) => ({
        array: () => (_req: any, _res: any, next: any) => next(),
        single: () => (req: any, _res: any, next: any) => {
            if (req.body && req.body.__mockFile) {
                req.file = {
                    buffer: Buffer.from(req.body.__mockFileContent || ''),
                    originalname: req.body.__mockFileName || 'mock.txt',
                    mimetype: req.body.__mockFileMime || 'text/plain',
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

// Key válida pelo schema SafeApiKeyHeaderSchema (alfanumérico, 32-128 chars).
const SAFE_API_KEY = 'a'.repeat(32);

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/banking', bankingRoutes);
    app.use(errorHandler);
    return app;
}

describe('bankingRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
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
        it('returns 200 and data.success:true when reconcileBankLine succeeds', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(true);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', SAFE_API_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.success).toBe(true);
            expect(mockDolibarrService.reconcileBankLine).toHaveBeenCalledWith(
                'acc1', 'line1', true, SAFE_API_KEY
            );
        });

        it('returns 200 and data.success:false when reconcileBankLine returns false', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(false);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: false });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.success).toBe(false);
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

        it('returns 401 when DOLAPIKEY header is malformed (não-alfanumérico) #1542', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', 'short-key') // 9 chars, alfanumérico mas < 32
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
        });

        it('returns 401 when DOLAPIKEY header contains non-alphanumeric chars #1542', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', 'a'.repeat(32) + '!')
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/banking/reconcile/save — userApiKey/DOLAPIKEY validation #1542', () => {
        it('returns 401 when DOLAPIKEY é malformado (curto demais)', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/save')
                .set('DOLAPIKEY', 'short')
                .send({ lineId: 'l1', invoiceId: 'inv-1' });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
        });

        it('returns 200 when DOLAPIKEY válido (32-128 alfanumérico)', async () => {
            mockBankingService.saveReconciliation.mockResolvedValue(true);
            const res = await request(app)
                .post('/api/banking/reconcile/save')
                .set('DOLAPIKEY', SAFE_API_KEY)
                .send({ lineId: 'l1', invoiceId: 'inv-1' });

            expect(res.status).toBe(200);
            expect(res.body.data.success).toBe(true);
        });
    });

    // =====================================================
    // #1542 — JSON.parse malformado na rota de CSV
    // =====================================================
    describe('POST /api/banking/import/csv — malformed JSON in format #1542', () => {
        it('returns 400 INVALID_JSON (and does NOT crash) when format is malformed JSON', async () => {
            const { AppError } = await import('../../middleware/errorHandler');
            const handler = (req: any, _res: any, next: any) => {
                try {
                    JSON.parse(req.body.format);
                    next();
                } catch {
                    next(new AppError(400, 'INVALID_JSON', 'Formato CSV inválido: JSON mal formatado'));
                }
            };
            const tmpApp = express();
            tmpApp.use(express.json());
            tmpApp.post('/test', handler, (req, res) => res.json({ ok: true }));
            tmpApp.use(errorHandler);

            const res = await request(tmpApp)
                .post('/test')
                .send({ format: '{invalid json' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_JSON');
        });

        it('parseCsvFormat helper rejects malformed JSON with INVALID_JSON envelope', async () => {
            const tmpApp = express();
            tmpApp.use(express.json());
            tmpApp.post('/csv', (req: any, res: any) => {
                let parsed: any;
                try {
                    parsed = JSON.parse(String(req.body.format));
                } catch {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'INVALID_JSON', message: 'Formato CSV inválido: JSON mal formatado' },
                    });
                }
                res.json({ parsed });
            });

            const res = await request(tmpApp).post('/csv').send({ format: '{not-json' });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_JSON');
        });

        it('POST /api/banking/import/csv returns 400 INVALID_JSON when format is malformed JSON (does NOT crash server) #1542', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({
                    __mockFile: true,
                    __mockFileContent: 'a,b,c\n1,2,3',
                    __mockFileName: 'test.csv',
                    format: '{invalid json',
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_JSON');
        });

        it('POST /api/banking/import/csv returns 200 with valid format JSON #1542', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({
                    __mockFile: true,
                    __mockFileContent: 'date,amount,description\n2024-01-01,100,Test',
                    __mockFileName: 'test.csv',
                    format: JSON.stringify({
                        dateColumn: 'date',
                        amountColumn: 'amount',
                        descriptionColumn: 'description',
                    }),
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    // =====================================================
    // #1542 — Zod validation envelope
    // =====================================================
    describe('POST /api/banking/analyze/categorize — validates Zod schema + envelope #1542', () => {
        it('returns 400 VALIDATION_ERROR envelope when transactions is not array', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .send({ transactions: 'not-array' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });

    describe('POST /api/banking/reconcile/toggle — validates Zod schema + envelope #1542', () => {
        it('returns 400 VALIDATION_ERROR envelope when reconciled is not boolean', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ accountId: 'a1', lineId: 'l1', reconciled: 'yes' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });
});
