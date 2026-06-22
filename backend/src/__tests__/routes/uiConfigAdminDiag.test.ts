/**
 * Testes do endpoint GET /api/ui-config/admin/users-missing-phone (#532)
 * e da derivação scope no GET /api/notifications (#531)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Mock da config de env ──────────────────────────────────────────────────
vi.mock('../../config/env', () => ({
    config: {
        dolibarrUrl: 'http://fake-doli/api/index.php',
        dolibarrKey: 'fakekey',
        adminKey: 'adminkey',
    },
}));

// ── Mock axios para simular Dolibarr ──────────────────────────────────────
const mockAxiosGet = vi.fn();
vi.mock('axios', () => ({
    default: { get: (...args: any[]) => mockAxiosGet(...args) },
}));

// ── Middlewares mock ──────────────────────────────────────────────────────
const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => { req.user = { id: 'u1', login: 'u1' }; next(); }));
const mockRequireDolibarrAdmin = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: mockRequireDolibarrAdmin,
}));

vi.mock('../../services/uiConfigService', () => ({
    uiConfigService: {
        get: vi.fn(() => ({ companyName: 'Test', logoText: 'T', themeColor: 'indigo' })),
        update: vi.fn((p: any) => p),
    },
}));
vi.mock('../../services/adminAuditService', () => ({ adminAuditService: { record: vi.fn() } }));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import uiConfigRoutes from '../../routes/uiConfigRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/ui-config', uiConfigRoutes);
    return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────
const userWithPhone = { id: '1', login: 'alice', firstname: 'Alice', lastname: 'A', statut: 1, phone_mobile: '+55 11 99999-0000', email: 'a@a.com' };
const userWithoutPhone = { id: '2', login: 'bob', firstname: 'Bob', lastname: 'B', statut: 1, phone_mobile: '', email: 'b@b.com' };
const userNullPhone = { id: '3', login: 'carol', firstname: 'Carol', lastname: 'C', statut: 1, phone_mobile: null, email: null };

describe('GET /api/ui-config/admin/users-missing-phone (#532)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    it('retorna 200 com lista de usuários sem telefone', async () => {
        mockAxiosGet.mockResolvedValueOnce({ data: [userWithPhone, userWithoutPhone, userNullPhone] });
        const res = await request(app).get('/api/ui-config/admin/users-missing-phone');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(3);
        expect(res.body.missingCount).toBe(2); // bob + carol
        expect(res.body.users.map((u: any) => u.login)).toEqual(expect.arrayContaining(['bob', 'carol']));
        expect(res.body.users.map((u: any) => u.login)).not.toContain('alice');
    });

    it('retorna 0 usuários sem telefone quando todos têm phone_mobile', async () => {
        mockAxiosGet.mockResolvedValueOnce({ data: [userWithPhone] });
        const res = await request(app).get('/api/ui-config/admin/users-missing-phone');
        expect(res.status).toBe(200);
        expect(res.body.missingCount).toBe(0);
        expect(res.body.users).toHaveLength(0);
    });

    it('exige middleware requireDolibarrAdmin', async () => {
        mockRequireDolibarrAdmin.mockImplementationOnce((_req: any, res: any) => res.status(403).json({ error: 'forbidden' }));
        const res = await request(app).get('/api/ui-config/admin/users-missing-phone');
        expect(res.status).toBe(403);
    });

    it('pagina automaticamente quando a primeira página retorna PAGE_SIZE (100) itens', async () => {
        // Primeira chamada: 100 usuários (todos com telefone)
        const page1 = Array.from({ length: 100 }, (_, i) => ({
            id: String(i + 1), login: `u${i}`, firstname: '', lastname: '', statut: 1, phone_mobile: '+55 11', email: null,
        }));
        // Segunda chamada: 2 usuários (1 sem telefone)
        const page2 = [
            { id: '101', login: 'sem_fone', firstname: 'S', lastname: 'F', statut: 1, phone_mobile: '', email: null },
            { id: '102', login: 'com_fone', firstname: 'C', lastname: 'F', statut: 1, phone_mobile: '+55', email: null },
        ];
        mockAxiosGet
            .mockResolvedValueOnce({ data: page1 })
            .mockResolvedValueOnce({ data: page2 });

        const res = await request(app).get('/api/ui-config/admin/users-missing-phone');
        expect(res.status).toBe(200);
        expect(mockAxiosGet).toHaveBeenCalledTimes(2);
        expect(res.body.total).toBe(102);
        expect(res.body.missingCount).toBe(1);
        expect(res.body.users[0].login).toBe('sem_fone');
    });
});

// Testes de scope do GET /notifications estão em notificationRoutes.test.ts
