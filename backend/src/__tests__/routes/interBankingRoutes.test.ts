import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock de config/env: webhook secret vazio para que os testes desta suíte
// simulem o cenário "sem segredo configurado" (verificação HMAC pulada em
// dev). Os testes de assinatura estão em interBankingRoutes.webhook.test.ts.
vi.mock('../../config/env', () => ({
    config: { interWebhookSecret: '' },
}));

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockInterApiService = vi.hoisted(() => ({
    getStatus: vi.fn(() => ({ connected: true })),
    initialize: vi.fn(() => true),
    getSaldo: vi.fn(() => ({ saldo: 1000 })),
    getExtratoCompleto: vi.fn(() => []),
    pagarBoleto: vi.fn(() => ({})),
    getComprovantePagamento: vi.fn(() => Buffer.from('PDF')),
    criarPixCobranca: vi.fn(() => ({})),
    criarPixCobrancaVencimento: vi.fn(() => ({})),
    consultarPixCobranca: vi.fn(() => ({})),
    enviarPix: vi.fn(() => ({})),
    listarPixRecebidos: vi.fn(() => []),
    consultarPix: vi.fn(() => ({})),
    getPixQRCode: vi.fn(() => ({})),
    emitirBoleto: vi.fn(() => ({})),
    listarBoletos: vi.fn(() => ({})),
    consultarBoleto: vi.fn(() => ({})),
    downloadBoletoPDF: vi.fn(() => Buffer.from('PDF')),
    cancelarBoleto: vi.fn(),
    configurarWebhookPix: vi.fn(),
    consultarWebhookPix: vi.fn(() => ({})),
    deletarWebhookPix: vi.fn(),
    generateTxId: vi.fn(() => 'txid-123'),
}));

const mockBankingService = vi.hoisted(() => ({
    processInterWebhook: vi.fn(),
}));

vi.mock('../../services/dolibarr', () => ({
    dolibarrService: {
        getAccountsPayable: vi.fn(() => Promise.resolve([])),
    },
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/interApiService', () => ({
    interApiService: mockInterApiService,
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

import interBankingRoutes from '../../routes/interBankingRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/inter', interBankingRoutes);
    return app;
}

describe('interBankingRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('POST /api/inter/webhook/pix', () => {
        it('returns 200 with valid pix webhook', async () => {
            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .send({ pix: [] });

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/inter/webhook/boleto', () => {
        it('returns 200 with valid boleto webhook', async () => {
            const res = await request(app)
                .post('/api/inter/webhook/boleto')
                .send({ nossoNumero: '123', situacao: 'PAGO' });

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/inter/status', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/inter/status');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/inter/saldo', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/inter/saldo');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/inter/extrato', () => {
        it('returns 400 when missing params', async () => {
            const res = await request(app).get('/api/inter/extrato');

            expect(res.status).toBe(400);
        });

        it('returns 200 with valid params', async () => {
            const res = await request(app)
                .get('/api/inter/extrato')
                .query({ dataInicio: '2024-01-01', dataFim: '2024-01-31' });

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/inter/txid/generate', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/inter/txid/generate');

            expect(res.status).toBe(200);
            // #1758: envelope padronizado — o txid agora viaja em `data`.
            expect(res.body).toHaveProperty('data');
            expect(res.body.data).toHaveProperty('txid');
        });
    });

    describe('POST /api/inter/pix/cobranca', () => {
        it('returns 400 when missing required fields', async () => {
            const res = await request(app)
                .post('/api/inter/pix/cobranca')
                .send({});

            expect(res.status).toBe(400);
        });

        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/inter/pix/cobranca')
                .send({ valor: { original: 100 }, chave: 'teste@email.com' });

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/inter/pix/recebidos', () => {
        it('returns 400 when missing params', async () => {
            const res = await request(app).get('/api/inter/pix/recebidos');

            expect(res.status).toBe(400);
        });
    });

    // #1758: `requireAuth` (= `requireDolibarrLogin`) deve barrar todos os
    // endpoints autenticados (status, saldo, extrato, pix/*, boleto/*, webhook
    // config, txid/*) sem token. Webhooks (/webhook/pix, /webhook/boleto) NÃO
    // usam `requireAuth` — usam HMAC.
    describe('requireAuth (#1758) — bloqueia endpoints autenticados sem token', () => {
        const rotasProtegidas: { method: 'get' | 'post' | 'put' | 'delete'; path: string; body?: unknown }[] = [
            { method: 'get', path: '/api/inter/status' },
            { method: 'post', path: '/api/inter/test' },
            { method: 'post', path: '/api/inter/certificates' },
            { method: 'get', path: '/api/inter/saldo' },
            { method: 'get', path: '/api/inter/extrato' },
            { method: 'get', path: '/api/inter/extrato', body: { dataInicio: '2024-01-01', dataFim: '2024-01-31' } },
            { method: 'post', path: '/api/inter/pagamento/boleto' },
            { method: 'get', path: '/api/inter/pagamento/123/comprovante' },
            { method: 'post', path: '/api/inter/pix/cobranca', body: { valor: { original: '1.00' }, chave: 'a@b.c' } },
            { method: 'post', path: '/api/inter/pix/cobranca-vencimento', body: { txid: 'x' } },
            { method: 'get', path: '/api/inter/pix/cobranca/abc123' },
            { method: 'post', path: '/api/inter/pix/enviar', body: { valor: 1, destinatario: { tipo: 'CHAVE', chave: 'x' } } },
            { method: 'get', path: '/api/inter/pix/recebidos' },
            { method: 'get', path: '/api/inter/pix/E2EID123' },
            { method: 'post', path: '/api/inter/boleto', body: { seuNumero: '1', valorNominal: 1, dataVencimento: '2024-01-01', pagador: { cpfCnpj: '00000000000', tipoPessoa: 'FISICA', nome: 'X' } } },
            { method: 'get', path: '/api/inter/boleto' },
            { method: 'get', path: '/api/inter/boleto/123' },
            { method: 'get', path: '/api/inter/boleto/123/pdf' },
            { method: 'post', path: '/api/inter/boleto/123/cancelar', body: {} },
            { method: 'put', path: '/api/inter/webhook/pix/config', body: { chave: 'x', webhookUrl: 'https://example.com' } },
            { method: 'get', path: '/api/inter/webhook/pix/config/x' },
            { method: 'delete', path: '/api/inter/webhook/pix/config/x' },
            { method: 'get', path: '/api/inter/txid/generate' },
        ];

        it.each(rotasProtegidas)('$method $path retorna 401 quando requireAuth rejeita o request', async ({ method, path, body }) => {
            mockRequireDolibarrLogin.mockImplementationOnce((_req: any, res: any) => {
                res.status(401).json({
                    success: false,
                    error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication Required: You must be logged in to Dolibarr.' },
                });
            });
            const req = request(app)[method](path);
            const res = body ? await req.send(body) : await req;
            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
        });
    });

    describe('requireAuth (#1758) — permite webhooks públicos (sem token)', () => {
        it('POST /api/inter/webhook/pix não chama requireAuth', async () => {
            mockRequireDolibarrLogin.mockClear();
            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .send({ pix: [] });
            expect(res.status).toBe(200);
            expect(mockRequireDolibarrLogin).not.toHaveBeenCalled();
        });

        it('POST /api/inter/webhook/boleto não chama requireAuth', async () => {
            mockRequireDolibarrLogin.mockClear();
            const res = await request(app)
                .post('/api/inter/webhook/boleto')
                .send({ nossoNumero: '123', situacao: 'PAGO' });
            expect(res.status).toBe(200);
            expect(mockRequireDolibarrLogin).not.toHaveBeenCalled();
        });
    });
});
