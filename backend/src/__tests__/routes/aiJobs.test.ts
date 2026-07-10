import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// #1011: testa o contrato HTTP do endpoint de heartbeat. O aiJobService é mockado
// (getJobStatus) para controle determinístico dos ramos 200/404 — a lógica de status
// em si é coberta em __tests__/services/aiJobService.test.ts. O auth é mockado p/ passar.

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: '1', login: 'testadmin', admin: '1' };
    next();
}));

const mockGetJobStatus = vi.hoisted(() => vi.fn());

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../../services/aiJobService', () => ({
    aiJobService: { getJobStatus: mockGetJobStatus },
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
    logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import aiJobsRoutes from '../../routes/aiJobs';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/ai-jobs', aiJobsRoutes);
    return app;
}

// Shape completo que o endpoint deve devolver (espelha AiJobStatusInfo).
const FULL_STATUS = {
    id: 'job-123',
    status: 'running' as const,
    alive: true,
    startedAt: '2025-07-09T12:00:00.000Z',
    lastHeartbeat: '2025-07-09T12:00:05.000Z',
    currentProvider: 'gemini',
    progressPct: 42,
    queuePosition: null,
};

describe('aiJobsRoutes #1011 — GET /api/ai-jobs/:id/status', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetJobStatus.mockReset();
        app = createApp();
    });

    it('exige login (requireDolibarrLogin aplicado à rota)', async () => {
        mockGetJobStatus.mockReturnValue({ ok: true, status: FULL_STATUS });
        await request(app).get('/api/ai-jobs/job-123/status');
        expect(mockRequireDolibarrLogin).toHaveBeenCalled();
    });

    it('retorna 200 com o shape completo para um job existente', async () => {
        mockGetJobStatus.mockReturnValue({ ok: true, status: FULL_STATUS });

        const res = await request(app).get('/api/ai-jobs/job-123/status');

        expect(res.status).toBe(200);
        expect(res.body).toEqual(FULL_STATUS);
        expect(mockGetJobStatus).toHaveBeenCalledWith('job-123');
    });

    it('retorna 404 com { reason: "not_found" } para id desconhecido', async () => {
        mockGetJobStatus.mockReturnValue({ ok: false, reason: 'missing' });

        const res = await request(app).get('/api/ai-jobs/desconhecido/status');

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ reason: 'not_found' });
    });

    it('retorna 404 com { reason: "expired" } para job expirado (distinto de not_found)', async () => {
        mockGetJobStatus.mockReturnValue({ ok: false, reason: 'expired' });

        const res = await request(app).get('/api/ai-jobs/velho/status');

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ reason: 'expired' });
        expect(res.body.reason).not.toBe('not_found');
    });

    it('mapeia apenas o :id da URL (não vaza outros segmentos)', async () => {
        mockGetJobStatus.mockReturnValue({ ok: true, status: { ...FULL_STATUS, id: 'abc' } });

        const res = await request(app).get('/api/ai-jobs/abc/status');

        expect(res.status).toBe(200);
        expect(mockGetJobStatus).toHaveBeenCalledWith('abc');
    });
});
