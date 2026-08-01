import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

// Mock de config/env: webhook secret vazio para que os testes desta suíte
// simulem o cenário "sem segredo configurado" (verificação HMAC pulada em
// dev). Os testes de assinatura — que mutam o segredo no objeto real —
// depois re-escrevem o valor de `itauWebhookSecret` e o restauram.
vi.mock('../../config/env', () => ({
    config: { itauWebhookSecret: '' },
}));

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockItauApiService = vi.hoisted(() => ({
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
    baixarBoleto: vi.fn(),
    configurarWebhookPix: vi.fn(),
    consultarWebhookPix: vi.fn(() => ({})),
    deletarWebhookPix: vi.fn(),
    generateTxId: vi.fn(() => 'txid-123'),
}));

vi.mock('../../services/dolibarr', () => ({
    dolibarrService: {
        getAccountsPayable: vi.fn(() => Promise.resolve([])),
    },
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/itauApiService', () => ({
    itauApiService: mockItauApiService,
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

import itauBankingRoutes from '../../routes/itauBankingRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/itau', itauBankingRoutes);
    return app;
}

describe('itauBankingRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('POST /api/itau/webhook/pix', () => {
        it('returns 200 with valid pix webhook', async () => {
            const res = await request(app)
                .post('/api/itau/webhook/pix')
                .send({ pix: [] });

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/itau/webhook/boleto', () => {
        it('returns 200 with valid boleto webhook', async () => {
            const res = await request(app)
                .post('/api/itau/webhook/boleto')
                .send({ nossoNumero: '123', evento: 'LIQUIDACAO' });

            expect(res.status).toBe(200);
        });
    });

    describe('Webhook signature verification (ITAU_WEBHOOK_SECRET)', () => {
        // Mutamos o segredo no objeto mockado p/ exercitar a verificação.
        const SECRET = 'itau-test-secret';
        let restore: string;
        beforeEach(async () => {
            const { config } = await import('../../config/env');
            restore = (config as any).itauWebhookSecret;
            (config as any).itauWebhookSecret = SECRET;
        });
        afterEach(async () => {
            const { config } = await import('../../config/env');
            (config as any).itauWebhookSecret = restore;
        });

        const sign = (body: any) => crypto.createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex');

        it('rejeita (401) webhook sem assinatura quando o segredo está setado', async () => {
            const res = await request(app).post('/api/itau/webhook/pix').send({ pix: [] });
            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_SIGNATURE');
        });

        it('rejeita (401) assinatura inválida', async () => {
            const res = await request(app)
                .post('/api/itau/webhook/pix')
                .set('x-webhook-signature', 'deadbeef')
                .send({ pix: [] });
            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_SIGNATURE');
        });

        it('aceita (200) assinatura HMAC válida', async () => {
            const body = { pix: [] };
            const res = await request(app)
                .post('/api/itau/webhook/pix')
                .set('x-webhook-signature', sign(body))
                .send(body);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('aceita (200) assinatura HMAC válida no webhook de boleto', async () => {
            const body = { nossoNumero: '123', evento: 'LIQUIDACAO' };
            const res = await request(app)
                .post('/api/itau/webhook/boleto')
                .set('x-webhook-signature', sign(body))
                .send(body);
            expect(res.status).toBe(200);
        });

        it('rejeita (401) webhook de boleto sem assinatura', async () => {
            const res = await request(app)
                .post('/api/itau/webhook/boleto')
                .send({ nossoNumero: '123', evento: 'LIQUIDACAO' });
            expect(res.status).toBe(401);
        });
    });

    describe('GET /api/itau/status', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/itau/status');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/itau/saldo', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/itau/saldo');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/itau/extrato', () => {
        it('returns 400 when missing params', async () => {
            const res = await request(app).get('/api/itau/extrato');

            expect(res.status).toBe(400);
        });

        it('returns 200 with valid params', async () => {
            const res = await request(app)
                .get('/api/itau/extrato')
                .query({ dataInicio: '2024-01-01', dataFim: '2024-01-31' });

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/itau/txid/generate', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/itau/txid/generate');

            expect(res.status).toBe(200);
            // #1758: envelope padronizado — o txid agora viaja em `data`.
            expect(res.body).toHaveProperty('data');
            expect(res.body.data).toHaveProperty('txid');
        });
    });

    describe('POST /api/itau/pix/cobranca', () => {
        it('returns 400 when missing required fields', async () => {
            const res = await request(app)
                .post('/api/itau/pix/cobranca')
                .send({});

            expect(res.status).toBe(400);
        });

        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/itau/pix/cobranca')
                .send({ valor: { original: 100 }, chave: 'teste@email.com' });

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/itau/pix/recebidos', () => {
        it('returns 400 when missing params', async () => {
            const res = await request(app).get('/api/itau/pix/recebidos');

            expect(res.status).toBe(400);
        });
    });

    // #1758: `requireAuth` (= `requireDolibarrLogin`) deve barrar todos os
    // endpoints autenticados (status, saldo, extrato, pix/*, boleto/*, webhook
    // config, txid/*) sem token. Webhooks (/webhook/pix, /webhook/boleto) NÃO
    // usam `requireAuth` — usam HMAC.
    describe('requireAuth (#1758) — bloqueia endpoints autenticados sem token', () => {
        const rotasProtegidas: { method: 'get' | 'post' | 'put' | 'delete'; path: string; body?: unknown }[] = [
            { method: 'get', path: '/api/itau/status' },
            { method: 'post', path: '/api/itau/test' },
            { method: 'post', path: '/api/itau/certificates' },
            { method: 'get', path: '/api/itau/saldo' },
            { method: 'get', path: '/api/itau/extrato' },
            { method: 'get', path: '/api/itau/extrato', body: { dataInicio: '2024-01-01', dataFim: '2024-01-31' } },
            { method: 'post', path: '/api/itau/pagamento/boleto' },
            { method: 'get', path: '/api/itau/pagamento/123/comprovante' },
            { method: 'post', path: '/api/itau/pix/cobranca', body: { valor: { original: '1.00' }, chave: 'a@b.c' } },
            { method: 'post', path: '/api/itau/pix/cobranca-vencimento', body: { txid: 'x' } },
            { method: 'get', path: '/api/itau/pix/cobranca/abc123' },
            { method: 'post', path: '/api/itau/pix/enviar', body: { valor: '1.00', pagamento: { valor: '1.00' } } },
            { method: 'get', path: '/api/itau/pix/recebidos' },
            { method: 'get', path: '/api/itau/pix/E2EID123' },
            { method: 'post', path: '/api/itau/boleto', body: { dado_boleto: { valor_total_titulo: '1.00', data_vencimento: '2024-01-01' } } },
            { method: 'get', path: '/api/itau/boleto' },
            { method: 'get', path: '/api/itau/boleto/123' },
            { method: 'get', path: '/api/itau/boleto/123/pdf' },
            { method: 'post', path: '/api/itau/boleto/123/baixar', body: {} },
            { method: 'put', path: '/api/itau/webhook/pix/config', body: { chave: 'x', webhookUrl: 'https://example.com' } },
            { method: 'get', path: '/api/itau/webhook/pix/config/x' },
            { method: 'delete', path: '/api/itau/webhook/pix/config/x' },
            { method: 'get', path: '/api/itau/txid/generate' },
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
        it('POST /api/itau/webhook/pix não chama requireAuth', async () => {
            mockRequireDolibarrLogin.mockClear();
            const res = await request(app)
                .post('/api/itau/webhook/pix')
                .send({ pix: [] });
            expect(res.status).toBe(200);
            expect(mockRequireDolibarrLogin).not.toHaveBeenCalled();
        });

        it('POST /api/itau/webhook/boleto não chama requireAuth', async () => {
            mockRequireDolibarrLogin.mockClear();
            const res = await request(app)
                .post('/api/itau/webhook/boleto')
                .send({ nossoNumero: '123', evento: 'LIQUIDACAO' });
            expect(res.status).toBe(200);
            expect(mockRequireDolibarrLogin).not.toHaveBeenCalled();
        });
    });
});
