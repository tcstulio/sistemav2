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

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/bankingService', () => ({
    bankingService: mockBankingService,
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
    return {
        default: {
            memoryStorage: () => ({}),
            diskStorage: () => ({}),
        },
    };
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
});
