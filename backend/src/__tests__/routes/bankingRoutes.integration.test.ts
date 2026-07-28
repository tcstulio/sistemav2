/**
 * Integration tests for bankingRoutes — issue #1542 + #1330.
 *
 * Foco: o endpoint POST /api/banking/import/csv NÃO pode derrubar o processo
 * quando `req.body.format` é um JSON malformado (o JSON.parse da linha ~75
 * precisa estar protegido por try/catch e retornar 400 INVALID_JSON).
 *
 * O mock do multer injeta um `req.file` com buffer para que a requisição
 * chegue ao ponto do JSON.parse; o `format` chega via corpo JSON normal.
 *
 * #1330: as rotas POST exigem o header `userApiKey` (CNPJ 14 dígitos ou UUID)
 * via `requireUserApiKey`. O limiter `bankingPost` (10/15min) é resetado
 * entre testes via `resetBankingPostLimiter` para não gerar 429 espúrio.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockBankingService = vi.hoisted(() => ({
    parseOFX: vi.fn(() => ({ transactions: [], accountNumber: '123', balance: 0 })),
    parseCSV: vi.fn(() => ({ transactions: [{ date: '2024-01-01', amount: 100 }], metadata: {} })),
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

// Mock do multer que injeta um arquivo para exercitar o caminho do JSON.parse.
vi.mock('multer', () => {
    const multerMock: any = (_options?: any) => ({
        single: () => (req: any, _res: any, next: any) => {
            req.file = {
                buffer: Buffer.from('date,amount,description\n2024-01-01,100,test'),
                originalname: 'statement.csv',
            };
            next();
        },
        array: () => (_req: any, _res: any, next: any) => next(),
        fields: () => (_req: any, _res: any, next: any) => next(),
        none: () => (_req: any, _res: any, next: any) => next(),
    });
    multerMock.memoryStorage = () => ({});
    multerMock.diskStorage = () => ({});
    return { default: multerMock };
});

import bankingRoutes from '../../routes/bankingRoutes';
// #1330 — importado para o helper `resetBankingPostLimiter` (limpa o bucket do
// limiter entre testes; sem isso, após 10 writes os testes seguintes receberiam
// 429 mesmo não sendo do fluxo de rate-limit).
import { rateLimiters } from '../../middleware/rateLimit';
// Sem o errorHandler global, as rotas que propagam erro via `next(new AppError(...))`
// respondem só com status (sem envelope), quebrando as asserções em
// `res.body.error.code/...`. Adicionado em #1330 porque `/import/csv` agora
// usa `next(AppError(...))` em vez de `apiResponse.fail(...)`.
import { errorHandler } from '../../middleware/errorHandler';

// #1330 — chave CNPJ 14 dígitos para passar no `requireUserApiKey`.
const VALID_CNPJ_KEY = '12345678901234';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/banking', bankingRoutes);
    app.use(errorHandler);
    return app;
}

/**
 * Reseta o bucket do `bankingPost` limiter para o IP de loopback
 * (supertest usa `::ffff:127.0.0.1` por padrão).
 */
function resetBankingPostLimiter() {
    const limiter: any = rateLimiters.bankingPost as any;
    if (typeof limiter?.resetKey !== 'function') return;
    for (const ip of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
        try { limiter.resetKey(ip); } catch { /* ignore */ }
    }
}

describe('bankingRoutes integration — CSV JSON.parse crash guard (#1542 / #1330)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        resetBankingPostLimiter();
        app = createApp();
    });

    it('returns 400 INVALID_JSON (does NOT crash) for malformed format JSON', async () => {
        const res = await request(app)
            .post('/api/banking/import/csv')
            .set('userApiKey', VALID_CNPJ_KEY)
            .send({ format: '{invalid json' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('INVALID_JSON');
        // parseCSV nunca deve ser chamado com formato inválido.
        expect(mockBankingService.parseCSV).not.toHaveBeenCalled();
    });

    it('processes a valid format JSON with 200', async () => {
        const format = JSON.stringify({
            dateColumn: 'date',
            amountColumn: 'amount',
            descriptionColumn: 'description',
        });
        const res = await request(app)
            .post('/api/banking/import/csv')
            .set('userApiKey', VALID_CNPJ_KEY)
            .send({ format });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockBankingService.parseCSV).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-object format (e.g. bare number/string) with 400', async () => {
        const res = await request(app)
            .post('/api/banking/import/csv')
            .set('userApiKey', VALID_CNPJ_KEY)
            .send({ format: '42' });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_FORMAT');
    });

    it('survives repeated malformed input without crashing the process', async () => {
        const badInputs = ['{', '[', ']', 'not json', '{"a":}', '{"unterminated": "'];
        for (const bad of badInputs) {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ format: bad });
            expect(res.status).toBe(400);
        }
    });

    it('falls back to column defaults when no format is provided (200)', async () => {
        const res = await request(app)
            .post('/api/banking/import/csv')
            .set('userApiKey', VALID_CNPJ_KEY)
            .send({ dateColumn: 'data', amountColumn: 'valor' });

        expect(res.status).toBe(200);
        expect(mockBankingService.parseCSV).toHaveBeenCalledTimes(1);
    });

    // =====================================================
    // #1330 — Teste de regressão: `format: null` ou `format: undefined`
    // em /import/csv não devem CRASHAR o processo; retornam 400 INVALID_JSON
    // (AC: "format: null ou format: undefined retorna 400 (não crash)").
    //
    // Nota: num body JSON, `format: undefined` é serializado como ausência
    // do campo (JSON.stringify omite chaves undefined). Por isso o teste
    // cobre o caso `format: null` (que sobrevive ao JSON) e o caso
    // `format: ''` (string vazia). A garantia de "não crash" para o caso
    // "campo ausente" já é coberta por "falls back to column defaults when
    // no format is provided (200)" — o handler cai no fallback sem lançar
    // exceção.
    // =====================================================
    describe('regressão /import/csv — format null/inválido (#1330)', () => {
        it('format: null retorna 400 INVALID_JSON (não crash 500)', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ format: null });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_JSON');
            // parseCSV nunca deve ser chamado quando format é inválido.
            expect(mockBankingService.parseCSV).not.toHaveBeenCalled();
        });

        it('format: string vazia também é inválido e retorna 400 (não crash)', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ format: '' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_JSON');
            expect(mockBankingService.parseCSV).not.toHaveBeenCalled();
        });
    });

    // =====================================================
    // #1330 — /import/csv com JSON inválido usa `next(new AppError(...))`
    // e o errorHandler global renderiza o envelope padronizado
    // `{ success:false, error:{ code:'INVALID_JSON', ... } }`.
    // Garante que o crash original (HTTP 500 sem body) está coberto.
    // =====================================================
    describe('JSON.parse crash guard — delega via next(AppError) (#1330)', () => {
        it('format: \'{invalid json\' retorna 400 com code=INVALID_JSON (não crash 500)', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ format: '{invalid json' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_JSON');
        });

        it('envelope segue o shape { success: false, error: { code, message } }', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ format: '{' });

            expect(res.body).toHaveProperty('success', false);
            expect(res.body).toHaveProperty('error');
            expect(res.body.error).toHaveProperty('code');
            expect(res.body.error).toHaveProperty('message');
        });
    });

    // =====================================================
    // #1330 — POST /api/banking/export: format JSON-serializável
    // =====================================================
    describe('POST /api/banking/export (#1330)', () => {
        it('returns 200 with parsed format data', async () => {
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
    });

    // =====================================================
    // #1330 — rate-limit `bankingPost` (10/15min) configurado corretamente
    // =====================================================
    describe('rate-limit bankingPost (#1330 — 10/15min)', () => {
        it('rateLimiters.bankingPost is a callable middleware', () => {
            expect(typeof rateLimiters.bankingPost).toBe('function');
        });

        it('11ª requisição dentro da janela de 15min retorna 429', async () => {
            const format = JSON.stringify({
                dateColumn: 'date',
                amountColumn: 'amount',
                descriptionColumn: 'description',
            });

            // 10 reqs devem passar (estamos dentro do limite).
            for (let i = 0; i < 10; i++) {
                const ok = await request(app)
                    .post('/api/banking/import/csv')
                    .set('userApiKey', VALID_CNPJ_KEY)
                    .send({ format });
                expect(ok.status, `req ${i + 1}`).toBe(200);
            }

            // 11ª deve ser bloqueada pelo limiter.
            const blocked = await request(app)
                .post('/api/banking/import/csv')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ format });

            expect(blocked.status).toBe(429);
        });

        // #1330 — AC: "11ª requisição em 15min em QUALQUER rota POST retorna
        // 429". Este teste exercita o bucket COMPARTILHADO entre rotas POST
        // (todas usam `bankingPost`): 10 chamadas em /balance/validate e a
        // 11ª em /analyze/categorize já é bloqueada. Isso garante que
        // chamadas distribuídas em várias rotas não conseguem contornar o
        // limite.
        it('11ª requisição em rota POST DIFERENTE também retorna 429 (bucket compartilhado)', async () => {
            // 10 reqs em /balance/calculate (todas dentro do limite).
            for (let i = 0; i < 10; i++) {
                const ok = await request(app)
                    .post('/api/banking/balance/calculate')
                    .set('userApiKey', VALID_CNPJ_KEY)
                    .send({ initialBalance: 1000, transactions: [] });
                expect(ok.status, `req ${i + 1}`).toBe(200);
            }

            // 11ª em uma rota POST DIFERENTE deve cair no mesmo bucket e
            // ser bloqueada com 429.
            const blocked = await request(app)
                .post('/api/banking/analyze/categorize')
                .set('userApiKey', VALID_CNPJ_KEY)
                .send({ transactions: [] });

            expect(blocked.status).toBe(429);
        });
    });

    // =====================================================
    // #1330 — `requireUserApiKey` middleware (CNPJ 14 dígitos ou UUID)
    // Aplicado em TODAS as rotas POST do arquivo. Ausente ou inválido → 401.
    // =====================================================
    describe('requireUserApiKey — CNPJ/UUID (#1330)', () => {
        it('POST /import/csv sem userApiKey retorna 401 INVALID_USER_API_KEY', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .send({ format: '{}' });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_USER_API_KEY');
        });

        it('POST /balance/calculate sem userApiKey retorna 401 INVALID_USER_API_KEY', async () => {
            const res = await request(app)
                .post('/api/banking/balance/calculate')
                .send({ initialBalance: 1000, transactions: [] });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_USER_API_KEY');
        });

        it('POST /import/csv com userApiKey alfanumérico legacy (32 chars) retorna 401', async () => {
            const res = await request(app)
                .post('/api/banking/import/csv')
                .set('userApiKey', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')
                .send({ format: '{}' });

            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('INVALID_USER_API_KEY');
        });

        it('POST /import/csv com userApiKey UUID válido retorna 200', async () => {
            const validFormat = JSON.stringify({
                dateColumn: 'date',
                amountColumn: 'amount',
                descriptionColumn: 'description',
            });
            const res = await request(app)
                .post('/api/banking/import/csv')
                .set('userApiKey', 'a1b2c3d4-1234-5678-9abc-def012345678')
                .send({ format: validFormat });

            expect(res.status).toBe(200);
        });
    });
});
