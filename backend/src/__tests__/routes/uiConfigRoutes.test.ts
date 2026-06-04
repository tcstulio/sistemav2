import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));
const mockRequireDolibarrAdmin = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));
const mockUiConfigService = vi.hoisted(() => ({
    get: vi.fn(() => ({ companyName: 'CoolGroove', logoText: 'D', themeColor: 'indigo' })),
    update: vi.fn((p: any) => ({ companyName: 'CoolGroove', logoText: 'D', themeColor: 'indigo', ...p })),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: mockRequireDolibarrAdmin,
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfigService }));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import uiConfigRoutes from '../../routes/uiConfigRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/ui-config', uiConfigRoutes);
    return app;
}

describe('uiConfigRoutes', () => {
    let app: express.Application;
    beforeEach(() => { vi.clearAllMocks(); app = createApp(); });

    it('GET retorna a config da organização', async () => {
        const res = await request(app).get('/api/ui-config');
        expect(res.status).toBe(200);
        expect(res.body.companyName).toBe('CoolGroove');
    });

    it('PUT (admin) atualiza e repassa só os campos enviados', async () => {
        const res = await request(app).put('/api/ui-config').send({ companyName: 'ACME', themeColor: 'emerald' });
        expect(res.status).toBe(200);
        expect(mockUiConfigService.update).toHaveBeenCalledWith({ companyName: 'ACME', themeColor: 'emerald' });
    });

    it('PUT valida o corpo (rejeita companyName vazio)', async () => {
        const res = await request(app).put('/api/ui-config').send({ companyName: '' });
        expect(res.status).toBe(400);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });

    it('PUT exige admin (middleware bloqueia)', async () => {
        mockRequireDolibarrAdmin.mockImplementationOnce((_req: any, res: any) => res.status(403).json({ error: 'forbidden' }));
        const res = await request(app).put('/api/ui-config').send({ companyName: 'X' });
        expect(res.status).toBe(403);
        expect(mockUiConfigService.update).not.toHaveBeenCalled();
    });
});
