import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockDolibarrService = vi.hoisted(() => ({
    createThirdParty: vi.fn(() => ({ id: '1', name: 'Test' })),
    createInvoice: vi.fn(() => ({ id: '1' })),
    addPayment: vi.fn(() => ({})),
    validateSupplierOrder: vi.fn(() => ({})),
    closeProposal: vi.fn(() => ({})),
    addTimeSpent: vi.fn(() => ({})),
    proxyCustomSync: vi.fn(() => ({ status: 200, data: {} })),
    proxyRequest: vi.fn(() => ({ status: 200, data: {} })),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/dolibarrService', () => ({
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

vi.mock('express-rate-limit', () => {
    const fn = vi.fn(() => (req: any, res: any, next: any) => next());
    return { default: fn };
});

import dolibarrRoutes from '../../routes/dolibarrRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/dolibarr', dolibarrRoutes);
    return app;
}

describe('dolibarrRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('POST /api/dolibarr/thirdparties', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/dolibarr/thirdparties')
                .send({ name: 'Test Company', email: 'test@example.com' });

            expect(res.status).toBe(200);
        });

        it('returns 400 when name missing', async () => {
            const res = await request(app)
                .post('/api/dolibarr/thirdparties')
                .send({ email: 'test@example.com' });

            expect(res.status).toBe(400);
        });

        it('returns 400 when email invalid', async () => {
            const res = await request(app)
                .post('/api/dolibarr/thirdparties')
                .send({ name: 'Test', email: 'invalid-email' });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/dolibarr/invoices', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/dolibarr/invoices')
                .send({
                    socid: '1',
                    date: Date.now(),
                    lines: [{ desc: 'Test', subprice: 100, qty: 1 }]
                });

            expect(res.status).toBe(200);
        });

        it('returns 400 when socid missing', async () => {
            const res = await request(app)
                .post('/api/dolibarr/invoices')
                .send({ date: Date.now(), lines: [{ desc: 'Test', subprice: 100, qty: 1 }] });

            expect(res.status).toBe(400);
        });

        it('returns 400 when lines empty', async () => {
            const res = await request(app)
                .post('/api/dolibarr/invoices')
                .send({ socid: '1', date: Date.now(), lines: [] });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/dolibarr/invoices/:id/payments', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .post('/api/dolibarr/invoices/1/payments')
                .send({ amount: 100 });

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/dolibarr/supplierorders/:id/validate', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .post('/api/dolibarr/supplierorders/1/validate')
                .send({});

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/dolibarr/proposals/:id/close', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .post('/api/dolibarr/proposals/1/close')
                .send({});

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/dolibarr/tasks/:id/addtimespent', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .post('/api/dolibarr/tasks/1/addtimespent')
                .send({ hours: 2 });

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/dolibarr/custom_sync.php', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .get('/api/dolibarr/custom_sync.php')
                .query({ action: 'test' });

            expect(res.status).toBe(200);
        });
    });
});
