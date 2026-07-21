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
                .send({ nossoNumero: '123', seuNumero: 'pedido-123', situacao: 'PAGO' });

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
            // #1542: PixCobrancaSchema exige `devedor` (cpf OU cnpj) — obrigatório,
            // regressão `.optional()` revertida. Payload válido inclui o devedor.
            const res = await request(app)
                .post('/api/inter/pix/cobranca')
                .send({
                    valor: { original: '100.00' },
                    chave: 'teste@email.com',
                    devedor: { cpf: '12345678901', nome: 'Joao da Silva' },
                });

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

        it('executa timingSafeEqual para x-signature em NODE_ENV=development', async () => {
            const timingSafeEqual = vi.spyOn(crypto, 'timingSafeEqual');
            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .set('x-signature', '0'.repeat(64))
                .send({ pix: [] });

            expect(res.status).toBe(401);
            expect(timingSafeEqual).toHaveBeenCalledOnce();
        });

        it('valida o body somente depois de aceitar a assinatura', async () => {
            const body = {};
            const res = await request(app)
                .post('/api/inter/webhook/pix')
                .set('x-signature', sign(body))
                .send(body);

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockBankingService.processInterWebhook).not.toHaveBeenCalled();
        });

        it('rejeita (401) webhook do Boleto com x-webhook-signature inválido, mesmo em dev', async () => {
            const res = await request(app)
                .post('/api/inter/webhook/boleto')
                .set('x-webhook-signature', 'deadbeef')
                .send({ nossoNumero: '123', seuNumero: 'pedido-123', situacao: 'PAGO' });

            expect(res.status).toBe(401);
            expect(res.body).toMatchObject({
                error: expect.objectContaining({ code: 'INVALID_SIGNATURE' }),
            });
            expect(mockBankingService.processInterWebhook).not.toHaveBeenCalled();
        });

        it('aceita (200) webhook do Boleto com x-webhook-signature válido em dev', async () => {
            const body = { nossoNumero: '123', seuNumero: 'pedido-123', situacao: 'PAGO' };
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

        it('POST /pix/cobranca sem devedor retorna 400 (#1542 — devedor é obrigatório)', async () => {
            // Garantia explícita contra a regressão de #1542: o campo `devedor` é
            // OBRIGATÓRIO no PixCobrancaSchema (com refine exigindo cpf OU cnpj).
            // Sem `devedor` o payload NÃO pode passar pela validação.
            const res = await request(app)
                .post('/api/inter/pix/cobranca')
                .send({
                    valor: { original: '100.00' },
                    chave: 'teste@email.com',
                    // devedor ausente de propósito
                });

            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({
                error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
            });
            // O detalhe deve apontar para `devedor` no path Zod.
            const details = (res.body.error?.details ?? []) as Array<{ field: string }>;
            expect(details.some((d) => d.field.startsWith('devedor'))).toBe(true);
            expect(mockInterApiService.criarPixCobranca).not.toHaveBeenCalled();
        });

        it('POST /pix/cobranca com devedor sem cpf/cnpj retorna 400 (refine)', async () => {
            // Mesmo que o objeto `devedor` esteja presente, é obrigatório ter
            // cpf OU cnpj (.refine). Payload sem ambos deve falhar a validação.
            const res = await request(app)
                .post('/api/inter/pix/cobranca')
                .send({
                    valor: { original: '100.00' },
                    chave: 'teste@email.com',
                    devedor: { nome: 'Maria' }, // sem cpf nem cnpj
                });

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

        // ===== Cobertura completa: 19 endpoints da issue #1542 =====
        // Cada POST/PUT que aceita JSON body deve passar por validateBody e
        // rejeitar payload inválido com 400 VALIDATION_ERROR. Webhooks
        // (/webhook/pix, /webhook/boleto) usam HMAC e são testados acima.

        it('POST /pix/cobranca-vencimento rejeita txid inválido com 400', async () => {
            const res = await request(app)
                .post('/api/inter/pix/cobranca-vencimento')
                .send({ txid: 'curto' }); // 5 chars < 26 mínimo

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockInterApiService.criarPixCobrancaVencimento).not.toHaveBeenCalled();
        });

        it('POST /pix/cobranca-vencimento aceita txid válido (26-35 alfanumérico) com 200', async () => {
            mockInterApiService.criarPixCobrancaVencimento.mockResolvedValue({ txid: 'x' });
            const validTxid = 'a'.repeat(26);
            const res = await request(app)
                .post('/api/inter/pix/cobranca-vencimento')
                .send({
                    txid: validTxid,
                    valor: { original: '100.00' },
                    chave: 'teste@email.com',
                    devedor: { cpf: '12345678901', nome: 'Joao da Silva' },
                });

            expect(res.status).toBe(200);
            expect(mockInterApiService.criarPixCobrancaVencimento).toHaveBeenCalledWith(
                validTxid,
                expect.objectContaining({ chave: 'teste@email.com' })
            );
        });

        it('POST /pix/enviar rejeita valor ausente com 400', async () => {
            const res = await request(app)
                .post('/api/inter/pix/enviar')
                .send({ destinatario: { tipo: 'CHAVE', chave: 'x' } });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockInterApiService.enviarPix).not.toHaveBeenCalled();
        });

        it('POST /pix/enviar aceita payload válido com 200', async () => {
            mockInterApiService.enviarPix.mockResolvedValue({ endToEndId: 'e2e' });
            const res = await request(app)
                .post('/api/inter/pix/enviar')
                .send({
                    valor: '100.50',
                    destinatario: { tipo: 'CHAVE', chave: 'teste@email.com' },
                });

            expect(res.status).toBe(200);
            expect(mockInterApiService.enviarPix).toHaveBeenCalled();
        });

        it('POST /boleto rejeita payload sem pagador com 400', async () => {
            const res = await request(app)
                .post('/api/inter/boleto')
                .send({
                    seuNumero: '123',
                    valorNominal: 100,
                    dataVencimento: '2024-06-01',
                    // sem pagador → 400
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockInterApiService.emitirBoleto).not.toHaveBeenCalled();
        });

        it('POST /boleto aceita payload válido com 200', async () => {
            mockInterApiService.emitirBoleto.mockResolvedValue({ nossoNumero: 'xyz' });
            const res = await request(app)
                .post('/api/inter/boleto')
                .send({
                    seuNumero: '123',
                    valorNominal: 100,
                    dataVencimento: '2024-06-01',
                    pagador: {
                        cpfCnpj: '12345678901',
                        tipoPessoa: 'FISICA',
                        nome: 'Joao',
                        endereco: 'Rua 1',
                        bairro: 'Centro',
                        cidade: 'Sao Paulo',
                        uf: 'SP',
                        cep: '12345678',
                    },
                });

            expect(res.status).toBe(200);
            expect(mockInterApiService.emitirBoleto).toHaveBeenCalled();
        });

        it('POST /boleto/:nossoNumero/cancelar aceita body vazio (motivo tem default) com 200', async () => {
            mockInterApiService.cancelarBoleto.mockResolvedValue(undefined);
            const res = await request(app)
                .post('/api/inter/boleto/xyz/cancelar')
                .send({});

            expect(res.status).toBe(200);
            // motivo default 'Cancelado pelo usuário' aplicado pelo Zod
            expect(mockInterApiService.cancelarBoleto).toHaveBeenCalledWith('xyz', 'Cancelado pelo usuário');
        });

        it('POST /boleto/:nossoNumero/cancelar aceita motivo customizado com 200', async () => {
            mockInterApiService.cancelarBoleto.mockResolvedValue(undefined);
            const res = await request(app)
                .post('/api/inter/boleto/xyz/cancelar')
                .send({ motivo: 'Pedido do cliente' });

            expect(res.status).toBe(200);
            expect(mockInterApiService.cancelarBoleto).toHaveBeenCalledWith('xyz', 'Pedido do cliente');
        });

        it('POST /boleto/:nossoNumero/cancelar rejeita motivo > 500 chars com 400', async () => {
            const res = await request(app)
                .post('/api/inter/boleto/xyz/cancelar')
                .send({ motivo: 'a'.repeat(501) });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockInterApiService.cancelarBoleto).not.toHaveBeenCalled();
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

        it('DELETE /webhook/pix/config/:chave chama service e retorna 200', async () => {
            mockInterApiService.deletarWebhookPix.mockResolvedValue(undefined);
            const res = await request(app).delete('/api/inter/webhook/pix/config/minha-chave');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockInterApiService.deletarWebhookPix).toHaveBeenCalledWith('minha-chave');
        });

        it('POST /test com sucesso retorna 200 + saldo', async () => {
            mockInterApiService.initialize.mockResolvedValue(true);
            mockInterApiService.getSaldo.mockResolvedValue({ saldo: 500 });

            const res = await request(app).post('/api/inter/test').send({});

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('saldo');
            expect(mockInterApiService.initialize).toHaveBeenCalled();
        });

        it('POST /test propaga erro 500 do service via next(error)', async () => {
            mockInterApiService.initialize.mockRejectedValue(new Error('boom-init'));

            const res = await request(app).post('/api/inter/test').send({});

            // asyncHandler → next(error) → errorHandler → 500
            expect(res.status).toBe(500);
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
            // #1542: validateQuery propaga via next(ValidationError) → errorHandler
            // emite envelope `{ error: { code: 'VALIDATION_ERROR', ... } }`.
            expect(res.body).toMatchObject({
                error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
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

    // ============================================================
    // Cobertura completa dos endpoints restantes (#1542)
    // GETs que não passam por validateBody mas usam o service —
    // garantem que a rota existe, retorna 200, e usa o envelope
    // apiResponse padronizado.
    // ============================================================

    describe('Cobertura GET endpoints restantes (#1542)', () => {
        it('GET /pix/cobranca/:txid retorna 200 com envelope padronizado', async () => {
            mockInterApiService.consultarPixCobranca.mockResolvedValue({ txid: 'abc', status: 'ATIVA' });
            const txid = 'a'.repeat(26);
            const res = await request(app).get(`/api/inter/pix/cobranca/${txid}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('txid');
            expect(mockInterApiService.consultarPixCobranca).toHaveBeenCalledWith(txid);
        });

        it('GET /pix/:e2eid retorna 200 com envelope padronizado', async () => {
            mockInterApiService.consultarPix.mockResolvedValue({ endToEndId: 'e2eid-1' });
            const res = await request(app).get('/api/inter/pix/e2eid-1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('endToEndId');
            expect(mockInterApiService.consultarPix).toHaveBeenCalledWith('e2eid-1');
        });

        it('GET /boleto/:nossoNumero retorna 200 com envelope padronizado', async () => {
            mockInterApiService.consultarBoleto.mockResolvedValue({ nossoNumero: 'xyz' });
            const res = await request(app).get('/api/inter/boleto/xyz');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('nossoNumero');
            expect(mockInterApiService.consultarBoleto).toHaveBeenCalledWith('xyz');
        });

        it('GET /boleto/:nossoNumero/pdf retorna application/pdf', async () => {
            const pdfBuffer = Buffer.from('%PDF-1.4 mock-pdf-content');
            mockInterApiService.downloadBoletoPDF.mockResolvedValue(pdfBuffer);
            const res = await request(app).get('/api/inter/boleto/xyz/pdf');

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/application\/pdf/);
            expect(res.headers['content-disposition']).toMatch(/attachment.*xyz\.pdf/);
        });

        it('GET /pagamento/:id/comprovante retorna application/pdf', async () => {
            const pdfBuffer = Buffer.from('%PDF-1.4 mock-receipt-content');
            mockInterApiService.getComprovantePagamento.mockResolvedValue(pdfBuffer);
            const res = await request(app).get('/api/inter/pagamento/123/comprovante');

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/application\/pdf/);
            expect(res.headers['content-disposition']).toMatch(/attachment.*123\.pdf/);
        });

        it('GET /webhook/pix/config/:chave retorna 200 com envelope padronizado', async () => {
            mockInterApiService.consultarWebhookPix.mockResolvedValue({ chave: 'minha-chave' });
            const res = await request(app).get('/api/inter/webhook/pix/config/minha-chave');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockInterApiService.consultarWebhookPix).toHaveBeenCalledWith('minha-chave');
        });

        it('GET /boleto (listagem com filtros) aceita filtros válidos com 200', async () => {
            mockInterApiService.listarBoletos.mockResolvedValue({ items: [] });
            const res = await request(app)
                .get('/api/inter/boleto')
                .query({ dataInicial: '2024-01-01', dataFinal: '2024-01-31', situacao: 'PAGO' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockInterApiService.listarBoletos).toHaveBeenCalled();
        });

        it('GET /boleto rejeita situacao inválida com 400 (validateQuery)', async () => {
            const res = await request(app)
                .get('/api/inter/boleto')
                .query({ dataInicial: '2024-01-01', dataFinal: '2024-01-31', situacao: 'INVALID_STATUS' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(mockInterApiService.listarBoletos).not.toHaveBeenCalled();
        });
    });
});
