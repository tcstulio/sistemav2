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
    // Para os novos testes (#1542) que precisam exercitar o caminho de upload de CSV
    // com `format` malformado, populamos `req.file` no middleware `single()`.
    const FAKE_CSV_BUFFER = Buffer.from(
        'date,amount,description\n2024-01-01,100,Test transaction\n'
    );
    const multerMock: any = (_options?: any) => ({
        array: () => (_req: any, _res: any, next: any) => next(),
        single: () => (req: any, _res: any, next: any) => {
            req.file = {
                buffer: FAKE_CSV_BUFFER,
                originalname: 'test.csv',
                mimetype: 'text/csv',
                size: FAKE_CSV_BUFFER.length,
            };
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

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/banking', bankingRoutes);
    // errorHandler necessário porque validateBody propaga erros via next(error);
    // sem ele, Express cai no default handler (texto puro, sem envelope JSON).
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
        const VALID_KEY = 'abcdef1234567890abcdef1234567890'; // 32 chars, alfanumérico (#1542)

        it('returns 200 and success:true when reconcileBankLine succeeds', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(true);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', VALID_KEY)
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockDolibarrService.reconcileBankLine).toHaveBeenCalledWith(
                'acc1', 'line1', true, VALID_KEY
            );
        });

        it('returns 200 and success:false when reconcileBankLine returns false', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(false);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', VALID_KEY)
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
    });

    // ============================================================
    // #1542 — correções e padronização (validateBody + apiResponse +
    // userApiKey header + JSON.parse crash na importação CSV)
    // ============================================================

    describe('POST /api/banking/import/csv — JSON.parse crash (#1542)', () => {
        // Os testes abaixo enviam `format` como campo JSON (em produção,
        // chega via multipart/form-data — mas o caminho do JSON.parse é o
        // mesmo e exercita o try/catch da issue #1542 sem precisar de um
        // parser multipart real no mock).

        it('retorna 400 INVALID_JSON quando format tem JSON malformado (NÃO derruba o processo)', async () => {
            // O bug original (linha 75) era `JSON.parse(req.body.format)` sem try/catch,
            // o que fazia o servidor crashar quando o cliente mandava um JSON quebrado.
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({ format: '{invalid json' }); // string intencionalmente quebrada

            expect(res.status).toBe(400);
            // envelope padronizado via apiResponse.fail
            expect(res.body).toMatchObject({
                success: false,
                error: expect.objectContaining({ code: 'INVALID_JSON' }),
            });
            // Serviço NÃO deve ter sido chamado quando o body está inválido.
            expect(mockBankingService.parseCSV).not.toHaveBeenCalled();
        });

        it('retorna 400 INVALID_CSV_FORMAT quando o JSON é válido mas não bate com o schema', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({ format: '{"foo":"bar"}' }); // shape errado — sem dateColumn etc.

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_CSV_FORMAT');
            expect(mockBankingService.parseCSV).not.toHaveBeenCalled();
        });

        it('retorna 200 quando format é JSON válido e bem formado', async () => {
            const validFormat = JSON.stringify({
                dateColumn: 'date',
                amountColumn: 'amount',
                descriptionColumn: 'description',
                delimiter: ',',
                hasHeader: true,
            });

            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({ format: validFormat });

            expect(res.status).toBe(200);
            expect(mockBankingService.parseCSV).toHaveBeenCalled();
        });

        it('usa fallback de campos individuais quando format NÃO é enviado', async () => {
            // Sem `format` → usa dateColumn/amountColumn/etc do body.
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({ dateColumn: 'data', amountColumn: 'valor' });

            expect(res.status).toBe(200);
            expect(mockBankingService.parseCSV).toHaveBeenCalled();
        });
    });

    describe('Validação Zod via validateBody (#1542)', () => {
        it('POST /analyze/categorize rejeita payload vazio com 400 VALIDATION_ERROR', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .send({});

            expect(res.status).toBe(400);
            // envelope do errorHandler: { error: { code: 'VALIDATION_ERROR', ... } }
            expect(res.body).toMatchObject({
                error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
            });
            expect(mockBankingService.categorizeTransactions).not.toHaveBeenCalled();
        });

        it('POST /analyze/categorize rejeita transactions sem o campo amount (não-numérico) com 400', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .send({ transactions: [{ date: '2024-01-01', amount: 'not-a-number' }] });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockBankingService.categorizeTransactions).not.toHaveBeenCalled();
        });

        it('POST /reconcile/toggle rejeita payload faltando accountId com 400', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ lineId: 'line1', reconciled: true });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockDolibarrService.reconcileBankLine).not.toHaveBeenCalled();
        });

        it('POST /reconcile/toggle rejeita reconciled não-boolean com 400', async () => {
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: 'yes' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('POST /balance/calculate rejeita initialBalance ausente com 400', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .send({ transactions: [] });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockBankingService.calculateDynamicBalance).not.toHaveBeenCalled();
        });

        it('POST /insights/cash-flow aceita transactions vazio (campo presente)', async () => {
            const res = await request(app)
                .post('/api/banking/insights/cash-flow')
                .send({ accounts: [], transactions: [] });

            expect(res.status).toBe(200);
            expect(mockBankingService.generateCashFlowInsights).toHaveBeenCalled();
        });
    });

    describe('Validação do header userApiKey (#1542)', () => {
        // Chave válida: 32 chars alfanuméricos (regex do schema).
        const VALID_KEY = 'abcdef1234567890abcdef1234567890';

        it('rejeita com 401 quando DOLAPIKEY tem formato inválido (curto demais)', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .set('DOLAPIKEY', 'too-short')
                .send({ transactions: [{ date: '2024-01-01', amount: 100 }] });

            expect(res.status).toBe(401);
            expect(res.body).toMatchObject({
                error: expect.objectContaining({ code: 'UNAUTHORIZED' }),
            });
            expect(mockBankingService.categorizeTransactions).not.toHaveBeenCalled();
        });

        it('rejeita com 401 quando DOLAPIKEY tem caracteres não-alfanuméricos', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .set('DOLAPIKEY', 'invalid-key-with-dashes-and-symbols!!')
                .send({ transactions: [{ date: '2024-01-01', amount: 100 }] });

            expect(res.status).toBe(401);
            expect(mockBankingService.categorizeTransactions).not.toHaveBeenCalled();
        });

        it('rejeita com 401 quando DOLAPIKEY é maior que 128 caracteres', async () => {
            const longKey = 'a'.repeat(129);
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .set('DOLAPIKEY', longKey)
                .send({ transactions: [{ date: '2024-01-01', amount: 100 }] });

            expect(res.status).toBe(401);
            expect(mockBankingService.categorizeTransactions).not.toHaveBeenCalled();
        });

        it('rejeita com 401 quando userApiKey é inválido', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .set('userApiKey', 'invalida')
                .send({});

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
            expect(mockBankingService.categorizeTransactions).not.toHaveBeenCalled();
        });

        it('aceita (200) quando DOLAPIKEY tem formato válido', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .set('DOLAPIKEY', VALID_KEY)
                .send({ transactions: [{ date: '2024-01-01', amount: 100 }] });

            expect(res.status).toBe(200);
            expect(mockBankingService.categorizeTransactions).toHaveBeenCalled();
        });

        it('aceita (200) quando NÃO há DOLAPIKEY (sessão/cookie já autenticou)', async () => {
            // Ausente → passa — outras formas de auth (sessão/cookie) já passaram em
            // requireDolibarrLogin. Esta defesa é só para tokens com formato claramente
            // malformado.
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .send({ transactions: [{ date: '2024-01-01', amount: 100 }] });

            expect(res.status).toBe(200);
        });
    });

    describe('Envelopes apiResponse ok/fail (#1542)', () => {
        it('resposta de sucesso de /analyze/categorize usa { success: true, data: ... }', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/categorize')
                .send({ transactions: [{ date: '2024-01-01', amount: 100, description: 'X' }] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body).toHaveProperty('data');
        });

        it('resposta de sucesso de /analyze/anomalies inclui data e total em meta', async () => {
            const res = await request(app)
                .post('/api/banking/analyze/anomalies')
                .send({ transactions: [{ date: '2024-01-01', amount: 100, description: 'X' }] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body).toHaveProperty('data');
            expect(res.body).toHaveProperty('meta.total');
        });

        it('resposta de sucesso de /reconcile/toggle usa o envelope padronizado', async () => {
            mockDolibarrService.reconcileBankLine.mockResolvedValue(true);
            const res = await request(app)
                .post('/api/banking/reconcile/toggle')
                .set('DOLAPIKEY', 'abcdef1234567890abcdef1234567890')
                .send({ accountId: 'acc1', lineId: 'line1', reconciled: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.success).toBe(true);
            expect(res.body.data.message).toMatch(/sucesso/i);
        });
    });
});
