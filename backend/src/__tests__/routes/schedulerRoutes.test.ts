import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockSchedulerService = vi.hoisted(() => ({
    scheduleMessage: vi.fn(() => ({ id: 'msg-1', chatId: '123', message: 'test', scheduledAt: Date.now() })),
    getPending: vi.fn(() => []),
    cancelMessage: vi.fn(() => true),
    scheduleBroadcast: vi.fn(() => []),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/schedulerService', () => ({
    schedulerService: mockSchedulerService,
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
}));

import schedulerRoutes from '../../routes/schedulerRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/scheduler', schedulerRoutes);
    return app;
}

describe('schedulerRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('POST /api/scheduler/schedule', () => {
        it('returns 200 with valid schedule request', async () => {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({ chatId: '123', sessionId: 'default', message: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 when missing required fields', async () => {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({ chatId: '123' });

            expect(res.status).toBe(400);
        });

        it('returns 400 for invalid relative time format', async () => {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({ chatId: '123', sessionId: 'default', message: 'Hello', scheduledAt: '+5x' });

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/scheduler/pending', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/scheduler/pending');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('data');
        });
    });

    describe('DELETE /api/scheduler/:id', () => {
        it('returns 200 when message cancelled', async () => {
            const res = await request(app).delete('/api/scheduler/msg-1');

            expect(res.status).toBe(200);
        });

        it('returns 404 when message not found', async () => {
            mockSchedulerService.cancelMessage.mockReturnValue(false);

            const res = await request(app).delete('/api/scheduler/not-found');

            expect(res.status).toBe(404);
        });
    });
});
