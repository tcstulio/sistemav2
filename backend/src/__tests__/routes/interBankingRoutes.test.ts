import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

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
            expect(res.body).toHaveProperty('txid');
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
});
