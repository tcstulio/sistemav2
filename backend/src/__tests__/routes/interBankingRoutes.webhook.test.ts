/**
 * Webhook signature verification tests for interBankingRoutes — issue #1542.
 *
 * Critério de aceitação: o webhook do Inter verifica a assinatura HMAC-SHA256
 * SEMPRE que há um segredo configurado, INCLUSIVE em NODE_ENV=development
 * (antes, a verificação podia ser pulada fora de produção).
 *
 * Este arquivo mocka `config/env` com um segredo — isolado do
 * interBankingRoutes.test.ts, que roda sem segredo (verificação pulada).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';

const mocks = vi.hoisted(() => ({ secret: 'inter-webhook-secret-para-testes' }));

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockInterApiService = vi.hoisted(() => ({
    getStatus: vi.fn(() => ({ connected: true })),
    getSaldo: vi.fn(() => ({ saldo: 1000 })),
    generateTxId: vi.fn(() => 'txid-123'),
}));

const mockBankingService = vi.hoisted(() => ({
    processInterWebhook: vi.fn(),
}));

vi.mock('../../config/env', () => ({
    config: { interWebhookSecret: mocks.secret },
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

// dolibarrService é importado por interBankingRoutes (usado só em /extrato); ao
// mockar config/env perdemos os defaults que seu construtor exige, então
// mockamos o serviço — os endpoints de webhook não o utilizam.
vi.mock('../../services/dolibarr', () => ({
    dolibarrService: {
        getAccountsPayable: vi.fn(() => Promise.resolve([])),
    },
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

function sign(body: unknown): string {
    return crypto.createHmac('sha256', mocks.secret).update(JSON.stringify(body)).digest('hex');
}

describe('interBankingRoutes webhook signature verification (#1542)', () => {
    let app: express.Application;
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    it('accepts a Pix webhook with a valid signature', async () => {
        const body = { pix: [] };
        const res = await request(app)
            .post('/api/inter/webhook/pix')
            .set('x-webhook-signature', sign(body))
            .send(body);

        expect(res.status).toBe(200);
        expect(mockBankingService.processInterWebhook).toHaveBeenCalledTimes(1);
    });

    it('rejects a Pix webhook with an invalid signature (401)', async () => {
        const body = { pix: [] };
        const res = await request(app)
            .post('/api/inter/webhook/pix')
            .set('x-webhook-signature', 'deadbeefdeadbeef')
            .send(body);

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_SIGNATURE');
        expect(mockBankingService.processInterWebhook).not.toHaveBeenCalled();
    });

    it('verifies the signature EVEN in NODE_ENV=development', async () => {
        process.env.NODE_ENV = 'development';
        const body = { pix: [] };
        const res = await request(app)
            .post('/api/inter/webhook/pix')
            .set('x-webhook-signature', 'not-the-right-signature')
            .send(body);

        expect(res.status).toBe(401);
        expect(mockBankingService.processInterWebhook).not.toHaveBeenCalled();
    });

    it('rejects when signature header is missing but a secret is configured (401)', async () => {
        const res = await request(app)
            .post('/api/inter/webhook/pix')
            .send({ pix: [] });

        expect(res.status).toBe(401);
        expect(mockBankingService.processInterWebhook).not.toHaveBeenCalled();
    });

    it('accepts the alternate x-signature header when valid', async () => {
        const body = { nossoNumero: '123', situacao: 'PAGO' };
        const res = await request(app)
            .post('/api/inter/webhook/boleto')
            .set('x-signature', sign(body))
            .send(body);

        expect(res.status).toBe(200);
        expect(mockBankingService.processInterWebhook).toHaveBeenCalledTimes(1);
    });

    it('rejects a Boleto webhook with an invalid signature (401)', async () => {
        const body = { nossoNumero: '123', situacao: 'PAGO' };
        const res = await request(app)
            .post('/api/inter/webhook/boleto')
            .set('x-webhook-signature', 'wrong')
            .send(body);

        expect(res.status).toBe(401);
    });
});
