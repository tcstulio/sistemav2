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

// #1330 — mock do rateLimit middleware: nos testes de bankingRoutes o limiter
// `bankingPost` (10/15min) é ruído — ele só é exercitado nos testes integrados
// de regressão. Aqui a função é ser no-op pra não gerar 429 falso nas várias
// requisições de uma mesma suite.
vi.mock('../../middleware/rateLimit', () => ({
    rateLimiters: {
        login: (req: any, res: any, next: any) => next(),
        ai: (req: any, res: any, next: any) => next(),
        banking: (req: any, res: any, next: any) => next(),
        bankingPost: (req: any, res: any, next: any) => next(),
        scheduler: (req: any, res: any, next: any) => next(),
        strict: (req: any, res: any, next: any) => next(),
        default: (req: any, res: any, next: any) => next(),
        sync: (req: any, res: any, next: any) => next(),
    },
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
// #1330 — sem o errorHandler global, as rotas que propagam erro via
// `next(new AppError(...))` respondem só com status (sem envelope),
// quebrando as asserções em `res.body.error.code/...`. Adicionado aqui
// porque `/export` agora usa `next(AppError)` em vez de `apiResponse.fail(...)`.
import { errorHandler } from '../../middleware/errorHandler';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/banking', bankingRoutes);
    app.use(errorHandler);
    return app;
}

// #1330 — chave de API válida para o `requireUserApiKey` (CNPJ 14 dígitos).
const VALID_CNPJ_KEY = '12345678901234';
// Variante UUID — também aceita pela nova regex.
const VALID_UUID_KEY = 'a1b2c3d4-1234-5678-9abc-def012345678';
// Chave alfanumérica legacy (32 chars) — válida para o `validateUserApiKey`
// opcional mas rejeitada pelo `requireUserApiKey` (CNPJ/UUID).
const LEGACY_ALPHANUMERIC_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

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
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ transactions: [{ date: '2024-01-01', amount: 100, description: 'Test' }] });

            expect(res.status).toBe(200);
        });

        it('returns 400 when transactions missing', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({});

            expect(res.status).toBe(400);
        });

        it('returns 400 when transactions not array', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ transactions: 'not-array' });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/banking/analyze/anomalies', () => {
        it('returns 200 with valid transactions', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/anomalies')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ transactions: [{ date: '2024-01-01', amount: 100 }] });

            expect(res.status).toBe(200);
        });

        it('returns 400 when transactions missing', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/anomalies')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/banking/insights/cash-flow', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/banking/insights/cash-flow')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ accounts: [], transactions: [] });

            expect(res.status).toBe(200);
        });

        it('returns 400 when accounts or transactions missing', async () => {
            const res = await request(app)
                .post('/api/banking/insights/cash-flow')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ accounts: [] });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/banking/reconcile/suggest', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/suggest')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ bankLines: [], invoices: [] });

            expect(res.status).toBe(200);
        });

        it('returns 400 when missing fields', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/suggest')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ bankLines: [] });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/banking/balance/calculate', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(200);
        });

        it('returns 400 when missing fields', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ initialBalance: 1000 });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/banking/reconcile/toggle — #630 persistence', () => {
        it('returns 200 and success:true when reconcileBankLine succeeds', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(true);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockDolibarrService.reconcileBankLine).toHaveBeenCalledWith(
                'acc1', 'line1', true, VALID_CNPJ_KEY
            );
        });

        it('returns 200 and success:false when reconcileBankLine returns false', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(false);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: false });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
        });

        it('returns 400 when accountId is missing', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ lineId: 'line1', reconciled: true });

            expect(res.status).toBe(400);
        });

        it('returns 400 when lineId is missing', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ accountId: 'acc1', reconciled: true });

            expect(res.status).toBe(400);
        });

        it('returns 400 when reconciled is not a boolean', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: 'yes' });

            expect(res.status).toBe(400);
        });

        it('returns 500 when reconcileBankLine throws', async () => {
            mockDolibarrService.reconcileBankLine.mockRejectedValue(new Error('Dolibarr down'));
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(500);
        });
    });

    // =====================================================
    // #1330 — userApiKey header validation (CNPJ 14 dígitos ou UUID)
    // O middleware `requireUserApiKey` é OBRIGATÓRIO nas rotas POST do
    // `bankingRoutes.ts`. Ausente ou inválido → 401 INVALID_USER_API_KEY.
    // O middleware legacy `validateUserApiKey` (opcional, alfanumérico 32-128)
    // continua aplicado no router.use, mas coexistindo com o novo por-rota.
    // =====================================================
    describe('requireUserApiKey header validation (#1330 — CNPJ/UUID)', () => {
        it('returns 401 with INVALID_USER_API_KEY when userApiKey is absent', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_USER_API_KEY');
        });

        it('returns 401 with INVALID_USER_API_KEY when userApiKey is malformed (short alphanumeric)', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('userApiKey', 'short-key!')
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('INVALID_USER_API_KEY');
        });

        it('returns 401 when DOLAPIKEY is alphanumeric legacy (32 chars) — incompatível com CNPJ/UUID', async () => {
            // A regex antiga (alfanumérico 32-128) NÃO bate com a nova (CNPJ/UUID).
            // Esse é o comportamento desejado — a #1330 endurece o formato.
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('DOLAPIKEY', LEGACY_ALPHANUMERIC_KEY)
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('INVALID_USER_API_KEY');
        });

        it('accepts a well-formed CNPJ (14 digits) userApiKey', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(200);
        });

        it('accepts a well-formed UUID userApiKey', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('userApiKey', VALID_UUID_KEY)
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(200);
        });

        it('also accepts dolapikey header as alias (CNPJ)', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('DOLAPIKEY', VALID_CNPJ_KEY)
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(200);
        });
    });

    describe('Zod validation rejects malformed payloads (#1542)', () => {
        it('rejects non-number initialBalance with 400', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ initialBalance: 'muito', transactions: [] });

            expect(res.status).toBe(400);
        });

        it('rejects non-array transactions on insights/cash-flow with 400', async () => {
            const res = await request(app)
                .post('/api/banking/insights/cash-flow')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ accounts: [], transactions: 'nope' });

            expect(res.status).toBe(400);
        });

        it('rejects non-boolean reconciled on reconcile/toggle with 400', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: 'yes' });

            expect(res.status).toBe(400);
        });
    });

    // =====================================================
    // #1330 — POST /api/banking/export
    // Body: { format: string (JSON-serializável), bankCode: string, accountId: string }
    // - `format` é parseado com try/catch → 400 INVALID_JSON em erro
    // - Zod valida a presença de `format`/`bankCode`/`accountId`
    // =====================================================
    describe('POST /api/banking/export (#1330)', () => {
        it('returns 200 with valid format/bankCode/accountId', async () => {
            const format = JSON.stringify({ type: 'csv', encoding: 'utf-8' });
            const res = await request(app)
                .post('/api/banking/export')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ format, bankCode: '001', accountId: 'acc-1' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.bankCode).toBe('001');
            expect(res.body.data.accountId).toBe('acc-1');
        });

        it('returns 400 INVALID_JSON when format is malformed (NOT 500 crash)', async () => {
            const res = await request(app)
                .post('/api/banking/export')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ format: '{invalid json', bankCode: '001', accountId: 'acc-1' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_JSON');
        });

        it('returns 400 when format is missing', async () => {
            const res = await request(app)
                .post('/api/banking/export')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ bankCode: '001', accountId: 'acc-1' });

            expect(res.status).toBe(400);
        });

        it('returns 400 when bankCode is missing', async () => {
            const res = await request(app)
                .post('/api/banking/export')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ format: '{}', accountId: 'acc-1' });

            expect(res.status).toBe(400);
        });

        it('returns 400 when accountId is missing', async () => {
            const res = await request(app)
                .post('/api/banking/export')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ format: '{}', bankCode: '001' });

            expect(res.status).toBe(400);
        });

        it('returns 401 when userApiKey is missing', async () => {
            const res = await request(app)
                .post('/api/banking/export')
                .send({ format: '{}', bankCode: '001', accountId: 'acc-1' });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('INVALID_USER_API_KEY');
        });
    });
});
