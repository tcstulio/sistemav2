import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => { req.user = { login: 'tester' }; next(); }));
const mockService = vi.hoisted(() => ({
    get: vi.fn(() => ({ financialAnalysis: null, salesForecast: null })),
    setFinancialAnalysis: vi.fn((text: string, by: string) => ({ value: text, generatedBy: by, generatedAt: 1 })),
    setSalesForecast: vi.fn((data: any, by: string) => ({ value: data, generatedBy: by, generatedAt: 1 })),
}));

vi.mock('../../middleware/authMiddleware', () => ({ requireDolibarrLogin: mockRequireDolibarrLogin }));
vi.mock('../../services/dashboardArtifactsService', () => ({ dashboardArtifactsService: mockService }));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import dashboardRoutes from '../../routes/dashboardRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/dashboard', dashboardRoutes);
    return app;
}

describe('dashboardRoutes', () => {
    let app: express.Application;
    beforeEach(() => { vi.clearAllMocks(); app = createApp(); });

    it('GET /artifacts retorna o store', async () => {
        const res = await request(app).get('/api/dashboard/artifacts');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('financialAnalysis');
    });

    it('PUT /artifacts/financial persiste com o autor logado', async () => {
        const res = await request(app).put('/api/dashboard/artifacts/financial').send({ text: '## Resumo' });
        expect(res.status).toBe(200);
        expect(mockService.setFinancialAnalysis).toHaveBeenCalledWith('## Resumo', 'tester');
    });

    it('PUT /artifacts/financial rejeita texto vazio', async () => {
        const res = await request(app).put('/api/dashboard/artifacts/financial').send({ text: '' });
        expect(res.status).toBe(400);
    });

    it('PUT /artifacts/forecast persiste o objeto', async () => {
        const res = await request(app).put('/api/dashboard/artifacts/forecast').send({ data: { trend: 'up' } });
        expect(res.status).toBe(200);
        expect(mockService.setSalesForecast).toHaveBeenCalledWith({ trend: 'up' }, 'tester');
    });
});
