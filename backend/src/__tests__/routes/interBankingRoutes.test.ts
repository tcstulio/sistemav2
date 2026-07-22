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
// #1542: errorHandler global para que `next(error)` renderize o envelope padronizado.
import { errorHandler } from '../../middleware/errorHandler';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/inter', interBankingRoutes);
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

    // =========================================================
    // #1542 — webhook signature MUST be checked when x-signature
    // or x-webhook-signature is present, regardless of NODE_ENV.
    // =========================================================
    describe('Webhook signature verification (INTER_WEBHOOK_SECRET) — #1542', () => {
        const SECRET = 'inter-test-secret';
        let restore: string;

        beforeEach(async () => {
            const { config } = await import('../../config/env');
            restore = (config as any).interWebhookSecret;
            (config as any).interWebhookSecret = SECRET;
        });

        afterEach(async () => {
            const { config } = await import('../../config/env');
            (config as any).interWebhookSecret = restore;
        });

        const sign = (body: any) => crypto.createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex');

        it('rejects (401) webhook sem assinatura quando o segredo está setado', async () => {
            const res = await request(app).post('/api/inter/webhook/pix').send({ pix: [] });
            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
        });

        it('rejects (401) invalid signature on x-webhook-signature', async () => {
            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .set('x-webhook-signature', 'deadbeef')
                .send({ pix: [] });

            expect(res.status).toBe(401);
        });

        it('rejects (401) invalid signature on x-signature header (canonical Inter header) #1542', async () => {
            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .set('x-signature', 'deadbeef')
                .send({ pix: [] });

            expect(res.status).toBe(401);
        });

        it('accepts (200) valid HMAC on x-webhook-signature', async () => {
            const body = { pix: [] };
            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .set('x-webhook-signature', sign(body))
                .send(body);

            expect(res.status).toBe(200);
        });

        it('accepts (200) valid HMAC on x-signature header (canonical Inter header) #1542', async () => {
            const body = { pix: [] };
            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .set('x-signature', sign(body))
                .send(body);

            expect(res.status).toBe(200);
        });

        it('rejects (401) when x-signature is present but INTER_WEBHOOK_SECRET não está configurado (fail-closed) #1542', async () => {
            const { config } = await import('../../config/env');
            (config as any).interWebhookSecret = '';

            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .set('x-signature', 'somesig')
                .send({ pix: [] });

            expect(res.status).toBe(401);
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
        it('returns 200 with txid in data envelope', async () => {
            const res = await request(app).get('/api/inter/txid/generate');
            expect(res.status).toBe(200);
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

        it('returns 200 with valid data (canonical string valor + devedor) #1542', async () => {
            const res = await request(app)
                .post('/api/inter/pix/cobranca')
                .send({
                    valor: { original: '100.00' },
                    chave: 'teste@email.com',
                    devedor: { cpf: '12345678901', nome: 'Fulano' },
                });

            expect(res.status).toBe(200);
        });

        it('returns 400 VALIDATION_ERROR envelope when valor.original is invalid format #1542', async () => {
            const res = await request(app)
                .post('/api/inter/pix/cobranca')
                .send({ valor: { original: 'not-a-number' }, chave: 'k' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });

    describe('GET /api/inter/pix/recebidos', () => {
        it('returns 400 when missing params', async () => {
            const res = await request(app).get('/api/inter/pix/recebidos');

            expect(res.status).toBe(400);
        });
    });

    // =========================================================
    // #1542 — POST /api/inter/pix/cobranca-vencimento validation
    // =========================================================
    describe('POST /api/inter/pix/cobranca-vencimento — #1542', () => {
        it('returns 400 VALIDATION_ERROR envelope when txid is missing', async () => {
            const res = await request(app)
                .post('/api/inter/pix/cobranca-vencimento')
                .send({ valor: { original: '100.00' }, chave: 'k' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 200 with txid + valor + chave', async () => {
            const res = await request(app)
                .post('/api/inter/pix/cobranca-vencimento')
                .send({
                    txid: 'a'.repeat(26),
                    valor: { original: '100.00' },
                    chave: 'k',
                });

            expect(res.status).toBe(200);
        });
    });

    // =========================================================
    // #1542 — POST /api/inter/pix/enviar validation
    // =========================================================
    describe('POST /api/inter/pix/enviar — #1542', () => {
        it('returns 400 VALIDATION_ERROR envelope when valor is missing', async () => {
            const res = await request(app)
                .post('/api/inter/pix/enviar')
                .send({ destinatario: { tipo: 'CHAVE', chave: 'k' } });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('returns 200 with valid CHAVE payment', async () => {
            const res = await request(app)
                .post('/api/inter/pix/enviar')
                .send({
                    valor: 100,
                    destinatario: { tipo: 'CHAVE', chave: 'k@x.com' },
                });

            expect(res.status).toBe(200);
        });
    });

    // =========================================================
    // #1542 — POST /api/inter/boleto (emissão) validation
    // =========================================================
    describe('POST /api/inter/boleto — #1542', () => {
        it('returns 400 VALIDATION_ERROR envelope when missing required fields', async () => {
            const res = await request(app)
                .post('/api/inter/boleto')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 200 with valid boleto emissao', async () => {
            const res = await request(app)
                .post('/api/inter/boleto')
                .send({
                    seuNumero: '123',
                    valorNominal: 100,
                    dataVencimento: '2024-06-01',
                    pagador: {
                        cpfCnpj: '12345678901',
                        tipoPessoa: 'FISICA',
                        nome: 'Fulano',
                    },
                });

            expect(res.status).toBe(200);
        });
    });

    // =========================================================
    // #1542 — POST /api/inter/boleto/:nossoNumero/cancelar
    // =========================================================
    describe('POST /api/inter/boleto/:nossoNumero/cancelar — #1542', () => {
        it('returns 200 with motivo', async () => {
            const res = await request(app)
                .post('/api/inter/boleto/123/cancelar')
                .send({ motivo: 'Solicitacao do cliente' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockInterApiService.cancelarBoleto).toHaveBeenCalledWith('123', 'Solicitacao do cliente');
        });

        it('returns 200 without motivo (defaulted)', async () => {
            const res = await request(app)
                .post('/api/inter/boleto/123/cancelar')
                .send({});

            expect(res.status).toBe(200);
            expect(mockInterApiService.cancelarBoleto).toHaveBeenCalledWith('123', 'Cancelado pelo usuário');
        });

        it('returns 400 when motivo is too long > 500 #1542', async () => {
            const res = await request(app)
                .post('/api/inter/boleto/123/cancelar')
                .send({ motivo: 'a'.repeat(501) });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });

    // =========================================================
    // #1542 — PUT /api/inter/webhook/pix/config
    // =========================================================
    describe('PUT /api/inter/webhook/pix/config — #1542', () => {
        it('returns 400 when missing chave', async () => {
            const res = await request(app)
                .put('/api/inter/webhook/pix/config')
                .send({ webhookUrl: 'https://example.com/hook' });

            expect(res.status).toBe(400);
        });

        it('returns 400 when missing webhookUrl', async () => {
            const res = await request(app)
                .put('/api/inter/webhook/pix/config')
                .send({ chave: 'k' });

            expect(res.status).toBe(400);
        });

        it('returns 200 with valid chave + webhookUrl', async () => {
            const res = await request(app)
                .put('/api/inter/webhook/pix/config')
                .send({ chave: 'k', webhookUrl: 'https://example.com/hook' });

            expect(res.status).toBe(200);
        });

        it('returns 400 when webhookUrl is not a valid URL', async () => {
            const res = await request(app)
                .put('/api/inter/webhook/pix/config')
                .send({ chave: 'k', webhookUrl: 'not-a-url' });

            expect(res.status).toBe(400);
        });
    });

    // =========================================================
    // #1542 — POST /api/inter/pagamento/boleto (already validated)
    // =========================================================
    describe('POST /api/inter/pagamento/boleto — #1542', () => {
        it('returns 400 VALIDATION_ERROR envelope when codBarraLinhaDigitavel is too short', async () => {
            const res = await request(app)
                .post('/api/inter/pagamento/boleto')
                .send({ codBarraLinhaDigitavel: '123', valorPagar: 100 });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 200 with valid payment', async () => {
            const res = await request(app)
                .post('/api/inter/pagamento/boleto')
                .send({
                    codBarraLinhaDigitavel: '1'.repeat(44),
                    valorPagar: 100,
                });

            expect(res.status).toBe(200);
        });
    });

    // =========================================================
    // #1542 — POST /api/inter/test
    // =========================================================
    describe('POST /api/inter/test — #1542', () => {
        it('returns 400 when initialize returns false', async () => {
            mockInterApiService.initialize.mockResolvedValue(false);
            const res = await request(app).post('/api/inter/test').send({});
            expect(res.status).toBe(400);
        });

        it('returns 200 with success message when initialize succeeds', async () => {
            mockInterApiService.initialize.mockResolvedValue(true);
            const res = await request(app).post('/api/inter/test').send({});
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    // =========================================================
    // #1542 — POST /api/inter/certificates
    // =========================================================
    describe('POST /api/inter/certificates — #1542', () => {
        it('returns 400 when no files uploaded', async () => {
            const res = await request(app).post('/api/inter/certificates').send({});
            expect(res.status).toBe(400);
        });
    });

    // =========================================================
    // #1542 — DELETE /api/inter/webhook/pix/config/:chave
    // =========================================================
    describe('DELETE /api/inter/webhook/pix/config/:chave — #1542', () => {
        it('returns 200 when delete succeeds', async () => {
            const res = await request(app).delete('/api/inter/webhook/pix/config/k');
            expect(res.status).toBe(200);
            expect(mockInterApiService.deletarWebhookPix).toHaveBeenCalledWith('k');
        });
    });

    // =========================================================
    // #1542 — GET /api/inter/pagamento/:id/comprovante (binary)
    // =========================================================
    describe('GET /api/inter/pagamento/:id/comprovante — binary PDF #1542', () => {
        it('returns 200 with application/pdf content (binary preserved)', async () => {
            const res = await request(app).get('/api/inter/pagamento/123/comprovante');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('application/pdf');
        });
    });

    // =========================================================
    // #1542 — GET /api/inter/boleto/:nossoNumero/pdf (binary)
    // =========================================================
    describe('GET /api/inter/boleto/:nossoNumero/pdf — binary PDF #1542', () => {
        it('returns 200 with application/pdf content (binary preserved)', async () => {
            const res = await request(app).get('/api/inter/boleto/123/pdf');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('application/pdf');
        });
    });
});
