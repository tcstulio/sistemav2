/**
 * Testes do endpoint GET /api/users/me (#1003).
 * Valida que o celular (phone_mobile) e o fax são mapeados na resposta JSON e
 * que campos sensíveis (api_key) nunca vazam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../config/env', () => ({ config: {} }));

// Middleware mock: injeta req.user controlado por teste.
const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => { req.user = MOCK_USER; next(); }));
let MOCK_USER: any = null;
vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import userRoutes from '../../routes/userRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/users', userRoutes);
    return app;
}

describe('GET /api/users/me (#1003)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        MOCK_USER = null;
        app = createApp();
    });

    it('mapeia phone_mobile do usuário logado na resposta', async () => {
        MOCK_USER = {
            id: '7', login: 'tulio.silva', firstname: 'Tulio', lastname: 'Silva',
            email: 'tulio@coolgroove.com.br', job: 'Produtor',
            phone_mobile: '+55 11 99999-0000', office_phone: '+55 11 3333-0000', fax: '+55 11 3333-0001',
            statut: 1, admin: '0', api_key: 'SUPERSECRETO', photo: 'x.jpg',
        };
        const res = await request(app).get('/api/users/me');
        expect(res.status).toBe(200);
        expect(res.body.phone_mobile).toBe('+55 11 99999-0000');
        expect(res.body.fax).toBe('+55 11 3333-0001');
        expect(res.body.phone).toBe('+55 11 3333-0000');
        expect(res.body.login).toBe('tulio.silva');
        expect(res.body.job).toBe('Produtor');
        // Whitelist: api_key nunca deve vazar.
        expect(res.body).not.toHaveProperty('api_key');
    });

    it('usa user_mobile como fallback de phone_mobile', async () => {
        MOCK_USER = { id: '1', login: 'bob', user_mobile: '11988887777' };
        const res = await request(app).get('/api/users/me');
        expect(res.status).toBe(200);
        expect(res.body.phone_mobile).toBe('11988887777');
    });

    it('retorna phone_mobile null quando o usuário não tem celular', async () => {
        MOCK_USER = { id: '2', login: 'semcel', email: 's@x.com' };
        const res = await request(app).get('/api/users/me');
        expect(res.status).toBe(200);
        expect(res.body.phone_mobile).toBeNull();
        expect(res.body.fax).toBeNull();
    });

    it('retorna 401 quando não há usuário autenticado em req.user', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => { req.user = null; next(); });
        const res = await request(app).get('/api/users/me');
        expect(res.status).toBe(401);
    });

    it('exige middleware requireDolibarrLogin', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((_req: any, res: any) => res.status(401).json({ error: 'no auth' }));
        const res = await request(app).get('/api/users/me');
        expect(res.status).toBe(401);
        expect(mockRequireDolibarrLogin).toHaveBeenCalled();
    });
});
