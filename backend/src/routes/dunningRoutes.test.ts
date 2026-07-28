/**
 * dunningRoutes.test.ts — issue #1403.
 *
 * Cobertura:
 *   - GET / retorna 200 com body no formato DunningDigest
 *   - GET / repassa limit + socid (validados) ao service
 *   - GET / usa limit=50 quando ausente (default)
 *   - GET /?limit=abc → 400 (NÃO 500), service NÃO é chamado
 *   - GET /?limit=999 (>max=200) → 400
 *   - POST/PATCH/DELETE → 405 + body { error: 'method_not_allowed' }
 *
 * Mocks: o dunningService real é stubado para isolar a rota. A suíte
 * `dunningService.test.ts` já cobre o pipeline do service (incluindo
 * blast-radius zero e o template); aqui só verificamos a casca HTTP.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockBuildDunningDigest = vi.hoisted(() =>
    vi.fn(async (opts: { limit?: number; socid?: string } = {}) => ({
        geradoEm: '2024-01-01T00:00:00.000Z',
        items: [],
        totalItems: 0,
        totalReady: 0,
        totalIncomplete: 0,
        _opts: opts,
    }))
);

const mockRequireDolibarrLogin = vi.hoisted(() =>
    vi.fn((req: any, _res: any, next: any) => {
        req.user = { login: 'tester', admin: '1' };
        next();
    })
);

vi.mock('../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../services/dunningService', () => ({
    buildDunningDigest: mockBuildDunningDigest,
}));

import dunningRoutes from './dunningRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/dunning', dunningRoutes);
    return app;
}

describe('dunningRoutes (#1403)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('GET /', () => {
        it('retorna 200 com body no formato DunningDigest', async () => {
            const res = await request(app).get('/api/dunning');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('geradoEm');
            expect(res.body).toHaveProperty('items');
            expect(res.body).toHaveProperty('totalItems');
            expect(res.body).toHaveProperty('totalReady');
            expect(res.body).toHaveProperty('totalIncomplete');
            expect(mockBuildDunningDigest).toHaveBeenCalledTimes(1);
        });

        it('usa limit=50 quando ausente (default)', async () => {
            await request(app).get('/api/dunning');

            expect(mockBuildDunningDigest).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 50 })
            );
        });

        it('repassa limit e socid ao service quando informados', async () => {
            await request(app).get('/api/dunning?limit=10&socid=42');

            expect(mockBuildDunningDigest).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 10, socid: '42' })
            );
        });

        it('rejeita limit=abc com 400 (NÃO 500) e não chama o service', async () => {
            const res = await request(app).get('/api/dunning?limit=abc');

            expect(res.status).toBe(400);
            expect(mockBuildDunningDigest).not.toHaveBeenCalled();
        });

        it('rejeita limit>200 com 400', async () => {
            const res = await request(app).get('/api/dunning?limit=999');

            expect(res.status).toBe(400);
            expect(mockBuildDunningDigest).not.toHaveBeenCalled();
        });

        it('rejeita limit=0 com 400 (min=1)', async () => {
            const res = await request(app).get('/api/dunning?limit=0');

            expect(res.status).toBe(400);
            expect(mockBuildDunningDigest).not.toHaveBeenCalled();
        });

        it('exige auth — sem auth, retorna 401 do middleware', async () => {
            // Sobrepõe o mock para simular auth ausente.
            mockRequireDolibarrLogin.mockImplementationOnce((_req: any, res: any) =>
                res.status(401).json({ status: 'error', message: 'Authentication Required' })
            );

            const res = await request(app).get('/api/dunning');

            expect(res.status).toBe(401);
            expect(mockBuildDunningDigest).not.toHaveBeenCalled();
        });
    });

    describe('métodos não-GET (blast-radius zero)', () => {
        it('POST / retorna 405 + { error: "method_not_allowed" }', async () => {
            const res = await request(app).post('/api/dunning').send({ socid: 'evil' });

            expect(res.status).toBe(405);
            expect(res.body).toEqual({ error: 'method_not_allowed' });
            expect(mockBuildDunningDigest).not.toHaveBeenCalled();
        });

        it('PATCH / retorna 405', async () => {
            const res = await request(app).patch('/api/dunning').send({ socid: 'evil' });

            expect(res.status).toBe(405);
            expect(res.body).toEqual({ error: 'method_not_allowed' });
            expect(mockBuildDunningDigest).not.toHaveBeenCalled();
        });

        it('DELETE / retorna 405', async () => {
            const res = await request(app).delete('/api/dunning');

            expect(res.status).toBe(405);
            expect(res.body).toEqual({ error: 'method_not_allowed' });
            expect(mockBuildDunningDigest).not.toHaveBeenCalled();
        });

        it('PUT / retorna 405', async () => {
            const res = await request(app).put('/api/dunning').send({});

            expect(res.status).toBe(405);
            expect(res.body).toEqual({ error: 'method_not_allowed' });
        });
    });
});