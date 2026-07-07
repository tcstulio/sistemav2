/**
 * Testes do GET /api/users/me (#1003).
 *
 * Foco de segurança (padrão PR #1007): garantir que a resposta usa WHITELIST e
 * NUNCA vaza `api_key`, mesmo quando o objeto Dolibarr cru o contém.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Mock do auth middleware (popula req.user) ─────────────────────────────
const mockRequireDolibarrLogin = vi.hoisted(() =>
    vi.fn((req: any, _res: any, next: any) => {
        req.user = CURRENT_USER;
        next();
    }),
);

let CURRENT_USER: any = null;

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import userRoutes, { buildMeResponse } from '../../routes/userRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/users', userRoutes);
    return app;
}

// Usuário Dolibarr "cru" representativo: inclui api_key e pass_crypted que NÃO
// podem vazar, além de phone_mobile (campo-alvo da issue #1003).
const RAW_DOLIBARR_USER = {
    id: '7',
    login: 'tulio.silva',
    firstname: 'Tulio',
    lastname: 'Silva',
    email: 'tulio@coolgroove.com.br',
    job: 'Dev',
    office_phone: '+551133330000',
    photo: 'photo.png',
    statut: '1',
    admin: '0',
    supervisor_id: '2',
    address: 'Rua X',
    zip: '01000-000',
    town: 'São Paulo',
    state_id: 'SP',
    country_id: 'BR',
    note_public: 'nota',
    color: '#fff',
    date_modification: 1700000000,
    phone_mobile: '+55 11 99999-0000',
    // Campos sensíveis que DEVEM ser descartados pela whitelist:
    api_key: 'super-secret-dolibarr-key',
    pass: 'plaintext-password',
    pass_crypted: 'hashed',
};

describe('buildMeResponse (whitelist)', () => {
    it('inclui phone_mobile resolvido', () => {
        const me = buildMeResponse(RAW_DOLIBARR_USER)!;
        expect(me.phone_mobile).toBe('+55 11 99999-0000');
    });

    it('cobi para user_mobile quando phone_mobile ausente', () => {
        const me = buildMeResponse({ ...RAW_DOLIBARR_USER, phone_mobile: '', user_mobile: '+551188888000' })!;
        expect(me.phone_mobile).toBe('+551188888000');
    });

    it('NUNCA expoe api_key, pass nem pass_crypted', () => {
        const me = buildMeResponse(RAW_DOLIBARR_USER)!;
        expect(me).not.toHaveProperty('api_key');
        expect(me).not.toHaveProperty('pass');
        expect(me).not.toHaveProperty('pass_crypted');
        // Garantia extra: stringifying, nada sensível vaza.
        const serialized = JSON.stringify(me);
        expect(serialized).not.toContain('super-secret-dolibarr-key');
        expect(serialized).not.toContain('plaintext-password');
    });

    it('mantem campos da whitelist (id, login, email, job, admin...)', () => {
        const me = buildMeResponse(RAW_DOLIBARR_USER)!;
        expect(me.id).toBe('7');
        expect(me.login).toBe('tulio.silva');
        expect(me.email).toBe('tulio@coolgroove.com.br');
        expect(me.job).toBe('Dev');
        expect(me.admin).toBe('0');
        expect(me.office_phone).toBe('+551133330000');
    });

    it('retorna null para usuario nulo', () => {
        expect(buildMeResponse(null)).toBeNull();
        expect(buildMeResponse(undefined)).toBeNull();
    });
});

describe('GET /api/users/me', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        CURRENT_USER = RAW_DOLIBARR_USER;
        app = createApp();
    });

    it('retorna 200 com o perfil do usuario logado incluindo phone_mobile', async () => {
        const res = await request(app).get('/api/users/me');
        expect(res.status).toBe(200);
        expect(res.body.login).toBe('tulio.silva');
        expect(res.body.phone_mobile).toBe('+55 11 99999-0000');
    });

    it('nao expoe api_key na resposta HTTP', async () => {
        const res = await request(app).get('/api/users/me');
        expect(res.body).not.toHaveProperty('api_key');
        expect(res.body).not.toHaveProperty('pass');
        expect(JSON.stringify(res.body)).not.toContain('super-secret-dolibarr-key');
    });

    it('retorna 401 quando o usuario nao esta autenticado (req.user ausente)', async () => {
        CURRENT_USER = null;
        const res = await request(app).get('/api/users/me');
        expect(res.status).toBe(401);
    });

    it('exige requireDolibarrLogin (middleware aplicado)', async () => {
        await request(app).get('/api/users/me');
        expect(mockRequireDolibarrLogin).toHaveBeenCalled();
    });
});
