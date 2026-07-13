/**
 * bankingCredentialsRoutes — testes de rota (issue #988)
 *
 * Garante que POST/GET/DELETE de credenciais bancárias funcionam, nunca expõem
 * o clientSecret, validam o body e chamam reload() no service correspondente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrAdmin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => next()));

const mockStore = vi.hoisted(() => ({
    setCredentials: vi.fn(),
    getStatus: vi.fn(),
    clearCredentials: vi.fn(),
}));

const mockInter = vi.hoisted(() => ({ reloadCredentials: vi.fn() }));
const mockItau = vi.hoisted(() => ({ reloadCredentials: vi.fn() }));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrAdmin: mockRequireDolibarrAdmin,
}));

vi.mock('../../services/bankingCredentialsStore', () => ({
    bankingCredentialsStore: mockStore,
    BankId: undefined as any,
}));

vi.mock('../../services/interApiService', () => ({ interApiService: mockInter }));
vi.mock('../../services/itauApiService', () => ({ itauApiService: mockItau }));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

import bankingCredentialsRoutes from '../../routes/bankingCredentialsRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/banking', bankingCredentialsRoutes);
    return app;
}

describe('bankingCredentialsRoutes (#988)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
        mockStore.getStatus.mockReturnValue({
            configured: false,
            hasClientId: false,
            hasClientSecret: false,
            environment: 'sandbox',
        });
    });

    describe('POST /api/banking/credentials', () => {
        it('salva credenciais e retorna status (sem expor o secret)', async () => {
            mockStore.getStatus.mockReturnValue({
                configured: true,
                hasClientId: true,
                hasClientSecret: true,
                environment: 'sandbox',
            });

            const res = await request(app)
                .post('/api/banking/credentials')
                .send({ bank: 'inter', clientId: 'cid', clientSecret: 'secret', environment: 'sandbox' });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ configured: true, hasClientId: true, hasClientSecret: true });
            expect(JSON.stringify(res.body)).not.toContain('secret');
            expect(mockStore.setCredentials).toHaveBeenCalledWith(
                'inter',
                expect.objectContaining({ clientId: 'cid', clientSecret: 'secret', sandbox: true }),
                undefined,
            );
            expect(mockInter.reloadCredentials).toHaveBeenCalled();
        });

        it('preserva o secret existente quando clientSecret vem vazio/ausente', async () => {
            const res = await request(app)
                .post('/api/banking/credentials')
                .send({ bank: 'itau', clientId: 'new-cid', environment: 'production' });

            expect(res.status).toBe(200);
            const patch = mockStore.setCredentials.mock.calls[0][1];
            expect(patch.clientSecret).toBeUndefined();
            expect(mockItau.reloadCredentials).toHaveBeenCalled();
        });

        it('persiste contaCorrente e agencia para o Itaú', async () => {
            const res = await request(app)
                .post('/api/banking/credentials')
                .send({ bank: 'itau', clientId: 'c', clientSecret: 's', contaCorrente: '12345', agencia: '0001' });

            expect(res.status).toBe(200);
            expect(mockStore.setCredentials).toHaveBeenCalledWith(
                'itau',
                expect.objectContaining({ contaCorrente: '12345', agencia: '0001' }),
                undefined,
            );
        });

        it('retorna 400 quando o bank é inválido', async () => {
            const res = await request(app)
                .post('/api/banking/credentials')
                .send({ bank: 'bradesco', clientId: 'x' });

            expect(res.status).toBe(400);
            expect(mockStore.setCredentials).not.toHaveBeenCalled();
        });

        it('aceita body só com bank (campos opcionais) — salva patch vazio e recarrega', async () => {
            const res = await request(app)
                .post('/api/banking/credentials')
                .send({ bank: 'inter', environment: 'sandbox' });

            expect(res.status).toBe(200);
            expect(mockInter.reloadCredentials).toHaveBeenCalled();
        });
    });

    describe('GET /api/banking/credentials/status', () => {
        it('retorna status de um banco específico', async () => {
            mockStore.getStatus.mockReturnValue({ configured: true, hasClientId: true, hasClientSecret: true, environment: 'production' });

            const res = await request(app).get('/api/banking/credentials/status?bank=itau');

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ configured: true, environment: 'production' });
            expect(mockStore.getStatus).toHaveBeenCalledWith('itau');
        });

        it('retorna status de ambos os bancos quando bank não é especificado', async () => {
            const res = await request(app).get('/api/banking/credentials/status');

            expect(res.status).toBe(200);
            expect(mockStore.getStatus).toHaveBeenCalledWith('inter');
            expect(mockStore.getStatus).toHaveBeenCalledWith('itau');
        });
    });

    describe('DELETE /api/banking/credentials/:bank', () => {
        it('remove credenciais e recarrega o service', async () => {
            const res = await request(app).delete('/api/banking/credentials/inter');

            expect(res.status).toBe(200);
            expect(mockStore.clearCredentials).toHaveBeenCalledWith('inter');
            expect(mockInter.reloadCredentials).toHaveBeenCalled();
        });

        it('retorna 400 quando o bank é inválido', async () => {
            const res = await request(app).delete('/api/banking/credentials/nubank');

            expect(res.status).toBe(400);
            expect(mockStore.clearCredentials).not.toHaveBeenCalled();
        });
    });

    // ── Rotas per-bank (issue #988 spec: POST /banking/itau/credentials etc.) ───

    describe('POST /api/banking/itau/credentials (per-bank)', () => {
        it('salva credenciais Itaú sem bank no body (bank vem da URL)', async () => {
            const res = await request(app)
                .post('/api/banking/itau/credentials')
                .send({ clientId: 'itau-cid', clientSecret: 'itau-sec', environment: 'production', contaCorrente: '12345', agencia: '0001' });

            expect(res.status).toBe(200);
            expect(mockStore.setCredentials).toHaveBeenCalledWith(
                'itau',
                expect.objectContaining({ clientId: 'itau-cid', clientSecret: 'itau-sec', sandbox: false, contaCorrente: '12345', agencia: '0001' }),
                undefined,
            );
            expect(mockItau.reloadCredentials).toHaveBeenCalled();
        });

        it('bank do path vence bank conflitante no body (#1414 — ordem do spread)', async () => {
            const res = await request(app)
                .post('/api/banking/itau/credentials')
                .send({ bank: 'inter', clientId: 'cid', clientSecret: 'sec', environment: 'sandbox' });

            expect(res.status).toBe(200);
            expect(mockStore.setCredentials).toHaveBeenCalledWith(
                'itau',
                expect.objectContaining({ clientId: 'cid', clientSecret: 'sec', sandbox: true }),
                undefined,
            );
            expect(mockStore.setCredentials.mock.calls[0][0]).toBe('itau');
            expect(mockInter.reloadCredentials).not.toHaveBeenCalled();
            expect(mockItau.reloadCredentials).toHaveBeenCalled();
        });
    });

    describe('POST /api/banking/inter/credentials (per-bank)', () => {
        it('salva credenciais Inter sem bank no body (bank vem da URL)', async () => {
            const res = await request(app)
                .post('/api/banking/inter/credentials')
                .send({ clientId: 'inter-cid', clientSecret: 'inter-sec', environment: 'sandbox' });

            expect(res.status).toBe(200);
            expect(mockStore.setCredentials).toHaveBeenCalledWith(
                'inter',
                expect.objectContaining({ clientId: 'inter-cid', clientSecret: 'inter-sec', sandbox: true }),
                undefined,
            );
            expect(mockInter.reloadCredentials).toHaveBeenCalled();
        });
    });

    describe('GET /api/banking/:bank/credentials/status (per-bank)', () => {
        it('retorna status do Itaú via rota per-bank', async () => {
            mockStore.getStatus.mockReturnValue({ configured: true, hasClientId: true, hasClientSecret: true, environment: 'production' });

            const res = await request(app).get('/api/banking/itau/credentials/status');

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ configured: true });
            expect(mockStore.getStatus).toHaveBeenCalledWith('itau');
        });

        it('retorna status do Inter via rota per-bank', async () => {
            const res = await request(app).get('/api/banking/inter/credentials/status');

            expect(res.status).toBe(200);
            expect(mockStore.getStatus).toHaveBeenCalledWith('inter');
        });
    });

    describe('DELETE /api/banking/:bank/credentials (per-bank)', () => {
        it('remove credenciais Itaú via rota per-bank e recarrega o service', async () => {
            const res = await request(app).delete('/api/banking/itau/credentials');

            expect(res.status).toBe(200);
            expect(mockStore.clearCredentials).toHaveBeenCalledWith('itau');
            expect(mockItau.reloadCredentials).toHaveBeenCalled();
        });

        it('remove credenciais Inter via rota per-bank e recarrega o service', async () => {
            const res = await request(app).delete('/api/banking/inter/credentials');

            expect(res.status).toBe(200);
            expect(mockStore.clearCredentials).toHaveBeenCalledWith('inter');
            expect(mockInter.reloadCredentials).toHaveBeenCalled();
        });
    });
});
