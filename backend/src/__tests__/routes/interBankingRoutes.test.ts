import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

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
import { errorHandler } from '../../middleware/errorHandler';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/inter', interBankingRoutes);
    // errorHandler necessário porque validateBody propaga erros via next(error);
    // sem ele, Express cai no default handler (texto puro, sem envelope JSON).
    app.use(errorHandler);
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
            expect(res.body).toHaveProperty('data.txid');
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
                .send({ valor: { original: '100.00' }, chave: 'teste@email.com' });

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/inter/pix/recebidos', () => {
        it('returns 400 when missing params', async () => {
            const res = await request(app).get('/api/inter/pix/recebidos');

            expect(res.status).toBe(400);
        });
    });

    // ============================================================
    // #1542 — webhook signature verification (incondicional quando
    // x-webhook-signature é enviado) e validateBody padronizado
    // ============================================================

    describe('Webhook signature verification (#1542) — sempre roda quando x-webhook-signature está presente', () => {
        const SECRET = 'inter-test-secret';
        let restoreSecret: string;
        let restoreEnv: string | undefined;

        beforeEach(async () => {
            const { config } = await import('../../config/env');
            restoreSecret = (config as any).interWebhookSecret;
            (config as any).interWebhookSecret = SECRET;
            restoreEnv = process.env.NODE_ENV;
            // #1542: o teste prova que a verificação roda MESMO em development
            process.env.NODE_ENV = 'development';
        });

        afterEach(async () => {
            const { config } = await import('../../config/env');
            (config as any).interWebhookSecret = restoreSecret;
            if (restoreEnv === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = restoreEnv;
            }
        });

        const sign = (body: any) =>
            crypto.createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex');

        it('rejeita (401 INVALID_SIGNATURE) webhook com x-webhook-signature inválido, mesmo em NODE_ENV=development', async () => {
            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .set('x-webhook-signature', 'deadbeef')
                .send({ pix: [] });

            expect(res.status).toBe(401);
            expect(res.body).toMatchObject({
                success: false,
                error: expect.objectContaining({ code: 'INVALID_SIGNATURE' }),
            });
            expect(mockBankingService.processInterWebhook).not.toHaveBeenCalled();
        });

        it('aceita (200) webhook com x-webhook-signature HMAC válido em NODE_ENV=development', async () => {
            const body = { pix: [] };
            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .set('x-webhook-signature', sign(body))
                .send(body);

            expect(res.status).toBe(200);
            expect(mockBankingService.processInterWebhook).toHaveBeenCalled();
        });

        it('rejeita (401) webhook do Boleto com x-webhook-signature inválido, mesmo em dev', async () => {
            const res = await request(app)
                .post('/api/inter/webhook/boleto')
                .set('x-webhook-signature', 'deadbeef')
                .send({ nossoNumero: '123', situacao: 'PAGO' });

            expect(res.status).toBe(401);
            expect(res.body).toMatchObject({
                error: expect.objectContaining({ code: 'INVALID_SIGNATURE' }),
            });
            expect(mockBankingService.processInterWebhook).not.toHaveBeenCalled();
        });

        it('aceita (200) webhook do Boleto com x-webhook-signature válido em dev', async () => {
            const body = { nossoNumero: '123', situacao: 'PAGO' };
            const res = await request(app)
                .post('/api/inter/webhook/boleto')
                .set('x-webhook-signature', sign(body))
                .send(body);

            expect(res.status).toBe(200);
        });
    });

    describe('Webhook sem x-webhook-signature (compat de dev) (#1542)', () => {
        // Sem secret configurado + sem header + dev → passa (compat).
        // Sem secret configurado + sem header + prod → 503.

        it('em development sem secret: webhook sem header passa (compat)', async () => {
            const { config } = await import('../../config/env');
            const restoreSecret = (config as any).interWebhookSecret;
            (config as any).interWebhookSecret = '';
            const restoreEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            try {
                const res = await request(app)
                    .post('/api/inter/webhook/pix')
                    .send({ pix: [] });

                expect(res.status).toBe(200);
                expect(mockBankingService.processInterWebhook).toHaveBeenCalled();
            } finally {
                (config as any).interWebhookSecret = restoreSecret;
                if (restoreEnv === undefined) delete process.env.NODE_ENV;
                else process.env.NODE_ENV = restoreEnv;
            }
        });

        it('em production sem secret: webhook sem header é rejeitado com 503', async () => {
            const { config } = await import('../../config/env');
            const restoreSecret = (config as any).interWebhookSecret;
            (config as any).interWebhookSecret = '';
            const restoreEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            try {
                const res = await request(app)
                    .post('/api/inter/webhook/pix')
                    .send({ pix: [] });

                expect(res.status).toBe(503);
                expect(res.body).toMatchObject({
                    error: expect.objectContaining({ code: 'WEBHOOK_NOT_CONFIGURED' }),
                });
                expect(mockBankingService.processInterWebhook).not.toHaveBeenCalled();
            } finally {
                (config as any).interWebhookSecret = restoreSecret;
                if (restoreEnv === undefined) delete process.env.NODE_ENV;
                else process.env.NODE_ENV = restoreEnv;
            }
        });

        it('com secret configurado mas sem header: webhook é rejeitado com 401 MISSING_SIGNATURE', async () => {
            const { config } = await import('../../config/env');
            const restoreSecret = (config as any).interWebhookSecret;
            (config as any).interWebhookSecret = 'some-secret';

            try {
                const res = await request(app)
                    .post('/api/inter/webhook/pix')
                    .send({ pix: [] });

                expect(res.status).toBe(401);
                expect(res.body).toMatchObject({
                    error: expect.objectContaining({ code: 'MISSING_SIGNATURE' }),
                });
                expect(mockBankingService.processInterWebhook).not.toHaveBeenCalled();
            } finally {
                (config as any).interWebhookSecret = restoreSecret;
            }
        });
    });

    describe('Validação Zod via validateBody (#1542)', () => {
        it('POST /pix/cobranca rejeita payload faltando campos obrigatórios com 400', async () => {
            const res = await request(app)
                .post('/api/inter/pix/cobranca')
                .send({}); // sem valor.original nem chave

            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({
                error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
            });
            expect(mockInterApiService.criarPixCobranca).not.toHaveBeenCalled();
        });

        it('POST /pix/cobranca rejeita valor.original com formato errado com 400', async () => {
            const res = await request(app)
                .post('/api/inter/pix/cobranca')
                .send({ valor: { original: 'not-a-number' }, chave: 'teste@email.com' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockInterApiService.criarPixCobranca).not.toHaveBeenCalled();
        });

        it('POST /pagamento/boleto rejeita codBarraLinhaDigitavel inválido com 400', async () => {
            const res = await request(app)
                .post('/api/inter/pagamento/boleto')
                .send({
                    codBarraLinhaDigitavel: 'short',
                    valorPagar: 100,
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockInterApiService.pagarBoleto).not.toHaveBeenCalled();
        });

        it('PUT /webhook/pix/config rejeita payload sem chave com 400', async () => {
            const res = await request(app)
                .put('/api/inter/webhook/pix/config')
                .send({ webhookUrl: 'https://example.com/hook' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockInterApiService.configurarWebhookPix).not.toHaveBeenCalled();
        });

        it('PUT /webhook/pix/config rejeita webhookUrl inválida com 400', async () => {
            const res = await request(app)
                .put('/api/inter/webhook/pix/config')
                .send({ chave: 'minha-chave', webhookUrl: 'not-a-url' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('PUT /webhook/pix/config aceita payload válido com 200', async () => {
            mockInterApiService.configurarWebhookPix.mockResolvedValue(undefined);
            const res = await request(app)
                .put('/api/inter/webhook/pix/config')
                .send({ chave: 'minha-chave', webhookUrl: 'https://example.com/hook' });

            expect(res.status).toBe(200);
            expect(mockInterApiService.configurarWebhookPix).toHaveBeenCalled();
        });
    });

    describe('Envelopes apiResponse ok/fail (#1542)', () => {
        it('GET /saldo retorna { success: true, data: ... }', async () => {
            const res = await request(app).get('/api/inter/saldo');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body).toHaveProperty('data');
        });

        it('GET /txid/generate retorna { success: true, data: { txid } }', async () => {
            const res = await request(app).get('/api/inter/txid/generate');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('txid');
        });

        it('GET /pix/recebidos retorna { success: true, data: { pix } }', async () => {
            const res = await request(app)
                .get('/api/inter/pix/recebidos')
                .query({ inicio: '2024-01-01T00:00:00Z', fim: '2024-01-31T23:59:59Z' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('pix');
        });

        it('GET /pix/recebidos sem parametros retorna 400 com envelope { error: ... }', async () => {
            const res = await request(app).get('/api/inter/pix/recebidos');

            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({
                success: false,
                error: expect.objectContaining({ code: 'MISSING_PARAMS' }),
            });
        });

        it('POST /test com falha de init retorna { success: false, error: ... }', async () => {
            mockInterApiService.initialize.mockResolvedValue(false);

            const res = await request(app).post('/api/inter/test').send({});

            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({
                success: false,
                error: expect.objectContaining({ code: 'INIT_FAILED' }),
            });
        });
    });
});
