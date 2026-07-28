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
        single: () => (_req: any, _res: any, next: any) => next(),
        fields: () => (_req: any, _res: any, next: any) => next(),
        none: () => (_req: any, _res: any, next: any) => next(),
    });
    multerMock.memoryStorage = () => ({});
    multerMock.diskStorage = () => ({});
    return { default: multerMock };
});

import bankingRoutes from '../../routes/bankingRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/banking', bankingRoutes);
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

    // Chave de API bem-formada (alfanumérica, 32 chars) — exigida pelo guard
    // validateUserApiKey (#1542) quando o header DOLAPIKEY está presente.
    const VALID_API_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

    describe('POST /api/banking/reconcile/toggle — #630 persistence', () => {
        it('returns 200 and success:true when reconcileBankLine succeeds', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(true);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', VALID_API_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockDolibarrService.reconcileBankLine).toHaveBeenCalledWith(
                'acc1', 'line1', true, VALID_API_KEY
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

    describe('userApiKey header validation (#1542)', () => {
        it('returns 401 with INVALID_API_KEY when DOLAPIKEY is malformed', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('DOLAPIKEY', 'short-key!')
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_API_KEY');
        });

        it('returns 401 when DOLAPIKEY has a valid length but unsafe charset', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('DOLAPIKEY', 'a'.repeat(20) + ' spaces here 12')
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('INVALID_API_KEY');
        });

        it('accepts a well-formed 32-char alphanumeric DOLAPIKEY', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('DOLAPIKEY', VALID_API_KEY)
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(200);
        });

        it('allows requests without the header (falls back to session auth)', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(200);
        });
    });

    describe('Zod validation rejects malformed payloads (#1542)', () => {
        it('rejects non-number initialBalance with 400', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .send({ initialBalance: 'muito', transactions: [] });

            expect(res.status).toBe(400);
        });

        it('rejects non-array transactions on insights/cash-flow with 400', async () => {
            const res = await request(app)
                .post('/api/banking/insights/cash-flow')
                .send({ accounts: [], transactions: 'nope' });

            expect(res.status).toBe(400);
        });

        it('rejects non-boolean reconciled on reconcile/toggle with 400', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: 'yes' });

            expect(res.status).toBe(400);
        });
    });
});
