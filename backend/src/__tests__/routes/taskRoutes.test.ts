import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));
const mockRequireDolibarrAdmin = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));
const mockGetDailyRoundsStatus = vi.hoisted(() => vi.fn());

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: mockRequireDolibarrAdmin,
}));
vi.mock('../../services/taskRunnerService', () => ({ taskRunnerService: { getDailyRoundsStatus: mockGetDailyRoundsStatus } }));
vi.mock('../../services/screenshotService', () => ({ screenshotService: { getScreenshotPath: vi.fn() } }));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import taskRoutes from '../../routes/taskRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/tasks', taskRoutes);
    return app;
}

describe('#1187 — GET /api/tasks/status expõe o orçamento diário de rodadas', () => {
    let app: express.Application;
    beforeEach(() => { vi.clearAllMocks(); app = createApp(); });

    it('responde 200 com { dailyRoundsUsed, dailyRoundBudget }', async () => {
        mockGetDailyRoundsStatus.mockReturnValueOnce({ dailyRoundsUsed: 3, dailyRoundBudget: 200 });
        const res = await request(app).get('/api/tasks/status');
        expect(res.status).toBe(200);
        expect(mockGetDailyRoundsStatus).toHaveBeenCalledTimes(1);
        expect(res.body).toEqual({ dailyRoundsUsed: 3, dailyRoundBudget: 200 });
    });

    it('reflete N rodadas contabilizadas pelo Runner (used === N)', async () => {
        mockGetDailyRoundsStatus.mockReturnValueOnce({ dailyRoundsUsed: 7, dailyRoundBudget: 50 });
        const res = await request(app).get('/api/tasks/status');
        expect(res.status).toBe(200);
        expect(res.body.dailyRoundsUsed).toBe(7);
        expect(res.body.dailyRoundBudget).toBe(50);
    });

    it('requer login (middleware bloqueia → 401)', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((_req: any, res: any) => res.status(401).json({ error: 'unauthorized' }));
        const res = await request(app).get('/api/tasks/status');
        expect(res.status).toBe(401);
        expect(mockGetDailyRoundsStatus).not.toHaveBeenCalled();
    });
});
