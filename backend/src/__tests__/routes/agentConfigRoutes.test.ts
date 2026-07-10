import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: '1', login: 'admin', firstname: 'Admin', lastname: 'Test', admin: '1' };
    next();
}));
const mockRequireDolibarrAdmin = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));

const mockStore = vi.hoisted(() => ({
    getSnapshot: vi.fn((canEdit: boolean) => ({ systemPrompt: 'atual', defaultPrompt: 'padrao', history: [], canEdit })),
    update: vi.fn(() => ({ systemPrompt: 'novo', defaultPrompt: 'padrao', history: [{ id: 'h1' }], canEdit: true })),
    restoreDefault: vi.fn(() => ({ systemPrompt: 'padrao', defaultPrompt: 'padrao', history: [{ id: 'h1' }], canEdit: true })),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: mockRequireDolibarrAdmin,
}));
vi.mock('../../services/agentPromptStore', () => ({ agentPromptStore: mockStore }));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import agentConfigRoutes from '../../routes/agentConfigRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/agent', agentConfigRoutes);
    return app;
}

describe('agentConfigRoutes — issue #1005', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequireDolibarrLogin.mockImplementation((req: any, _res: any, next: any) => {
            req.user = { id: '1', login: 'admin', firstname: 'Admin', lastname: 'Test', admin: '1' };
            next();
        });
        mockRequireDolibarrAdmin.mockImplementation((_req: any, _res: any, next: any) => next());
        app = createApp();
    });

    describe('GET /api/agent/config', () => {
        it('retorna o snapshot do prompt + histórico (admin)', async () => {
            const res = await request(app).get('/api/agent/config');
            expect(res.status).toBe(200);
            expect(res.body.systemPrompt).toBe('atual');
            expect(res.body.defaultPrompt).toBe('padrao');
            expect(res.body.history).toEqual([]);
            expect(res.body.canEdit).toBe(true);
            expect(mockStore.getSnapshot).toHaveBeenCalledWith(true);
        });

        it('non-admin recebe canEdit=false', async () => {
            mockRequireDolibarrLogin.mockImplementation((req: any, _res: any, next: any) => {
                req.user = { id: '2', login: 'user', admin: '0' };
                next();
            });
            const res = await request(app).get('/api/agent/config');
            expect(res.status).toBe(200);
            expect(res.body.canEdit).toBe(false);
            expect(mockStore.getSnapshot).toHaveBeenCalledWith(false);
        });
    });

    describe('PUT /api/agent/config', () => {
        it('salva novo system prompt e registra histórico', async () => {
            const res = await request(app).put('/api/agent/config').send({ systemPrompt: 'novo texto' });
            expect(res.status).toBe(200);
            expect(res.body.systemPrompt).toBe('novo');
            expect(mockStore.update).toHaveBeenCalledTimes(1);
            expect(mockStore.update).toHaveBeenCalledWith(
                'novo texto',
                expect.objectContaining({ login: 'admin', name: 'Admin Test' }),
                true,
            );
        });

        it('restaura padrão com restoreDefault=true', async () => {
            const res = await request(app).put('/api/agent/config').send({ restoreDefault: true });
            expect(res.status).toBe(200);
            expect(res.body.systemPrompt).toBe('padrao');
            expect(mockStore.restoreDefault).toHaveBeenCalledTimes(1);
            expect(mockStore.update).not.toHaveBeenCalled();
        });

        it('rejeita body vazio com 400', async () => {
            const res = await request(app).put('/api/agent/config').send({});
            expect(res.status).toBe(400);
            expect(mockStore.update).not.toHaveBeenCalled();
        });

        it('rejeita systemPrompt vazio com 400', async () => {
            const res = await request(app).put('/api/agent/config').send({ systemPrompt: '   ' });
            expect(res.status).toBe(400);
            expect(mockStore.update).not.toHaveBeenCalled();
        });

        it('non-admin recebe 403 (requireDolibarrAdmin bloqueia)', async () => {
            mockRequireDolibarrAdmin.mockImplementation((_req: any, res: any) => {
                res.status(403).json({ error: 'Access Denied' });
            });
            const res = await request(app).put('/api/agent/config').send({ systemPrompt: 'x' });
            expect(res.status).toBe(403);
            expect(mockStore.update).not.toHaveBeenCalled();
        });
    });
});
