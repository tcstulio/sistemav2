import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../middleware/errorHandler';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));
const mockSchedulerLimiter = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockSchedulerService = vi.hoisted(() => ({
    scheduleMessage: vi.fn(() => ({ id: 'msg-1', chatId: '123', message: 'test', scheduledAt: Date.now() })),
    getPending: vi.fn(() => []),
    cancelMessage: vi.fn(() => true),
    scheduleBroadcast: vi.fn(() => []),
    // Template CRUD (#604)
    createTemplate: vi.fn(() => ({ id: 'tpl-1', name: 'Test', content: 'Hi', category: 'general', channel: 'whatsapp' })),
    getTemplates: vi.fn(() => []),
    deleteTemplate: vi.fn(() => true),
    updateTemplate: vi.fn(() => ({ id: 'tpl-1', name: 'Updated', content: 'Hi', category: 'general', channel: 'whatsapp' })),
    getStats: vi.fn(() => ({})),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../middleware/rateLimit', () => ({
    rateLimiters: { scheduler: mockSchedulerLimiter },
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
    app.use(errorHandler);
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

        it('supports POST /jobs with scheduler rate limiting', async () => {
            const res = await request(app)
                .post('/api/scheduler/jobs')
                .send({ chatId: '123', sessionId: 'default', message: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSchedulerLimiter).toHaveBeenCalledTimes(1);
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

    describe('POST /api/scheduler/broadcast', () => {
        it('returns 200 with a valid broadcast', async () => {
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', chatIds: ['1@c.us', '2@c.us'], message: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSchedulerService.scheduleBroadcast).toHaveBeenCalledTimes(1);
            expect(mockSchedulerLimiter).toHaveBeenCalledTimes(1);
        });

        it('returns 400 when chatIds is empty', async () => {
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', chatIds: [], message: 'Hello' });

            expect(res.status).toBe(400);
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
        });

        it('returns 400 when chatIds exceeds the cap (anti-spam)', async () => {
            const chatIds = Array.from({ length: 501 }, (_, i) => `${i}@c.us`);
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', chatIds, message: 'Hello' });

            expect(res.status).toBe(400);
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
        });

        it('returns 400 with a clear message for 101 recipients', async () => {
            const chatIds = Array.from({ length: 101 }, (_, i) => `${i}@c.us`);
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', chatIds, message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toContain('100');
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
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

    describe('POST /api/scheduler/templates', () => {
        it('validates and rate-limits template creation', async () => {
            const res = await request(app)
                .post('/api/scheduler/templates')
                .send({ name: 'Welcome', content: 'Hello {{name}}' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSchedulerLimiter).toHaveBeenCalledTimes(1);
            expect(mockSchedulerService.createTemplate).toHaveBeenCalledWith(expect.objectContaining({
                name: 'Welcome',
                content: 'Hello {{name}}',
            }));
        });
    });

    describe('PUT /api/scheduler/templates/:id (#604)', () => {
        it('returns 200 and updated template when found', async () => {
            mockSchedulerService.updateTemplate.mockReturnValue({ id: 'tpl-1', name: 'Novo Nome', content: 'Hi', category: 'general', channel: 'whatsapp' });

            const res = await request(app)
                .put('/api/scheduler/templates/tpl-1')
                .send({ name: 'Novo Nome' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('Novo Nome');
            expect(mockSchedulerService.updateTemplate).toHaveBeenCalledWith('tpl-1', expect.objectContaining({ name: 'Novo Nome' }));
        });

        it('returns 404 when template not found', async () => {
            mockSchedulerService.updateTemplate.mockReturnValue(null);

            const res = await request(app)
                .put('/api/scheduler/templates/nonexistent')
                .send({ name: 'X' });

            expect(res.status).toBe(404);
        });
    });
});
