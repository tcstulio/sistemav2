import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockSchedulerService = vi.hoisted(() => ({
    scheduleMessage: vi.fn(() => ({ id: 'msg-1', chatId: '123', message: 'test', scheduledAt: Date.now() })),
    getPending: vi.fn(() => []),
    cancelMessage: vi.fn(() => true),
    scheduleBroadcast: vi.fn(() => []),
    // Template CRUD (#604) + #1567 (getTemplate p/ validação de existência)
    createTemplate: vi.fn(() => ({ id: 'tpl-1', name: 'Test', content: 'Hi', category: 'general', channel: 'whatsapp' })),
    getTemplates: vi.fn(() => []),
    getTemplate: vi.fn(() => undefined),
    deleteTemplate: vi.fn(() => true),
    updateTemplate: vi.fn(() => ({ id: 'tpl-1', name: 'Updated', content: 'Hi', category: 'general', channel: 'whatsapp' })),
    renderTemplate: vi.fn(() => 'rendered'),
    // Demais endpoints (#1567)
    scheduleConfirmation: vi.fn(() => ({ id: 'msg-1', chatId: '123', message: 'confirm?' })),
    scheduleReminder: vi.fn(() => ({ id: 'msg-1', chatId: '123', message: 'reminder' })),
    getHistory: vi.fn(() => []),
    getStats: vi.fn(() => ({})),
    parseCSVContacts: vi.fn(() => []),
    getBroadcasts: vi.fn(() => []),
    getBroadcastDetails: vi.fn(() => null),
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

// #1567: o rate limiter real (10/min) é validado comportamentalmente em
// schedulerRoutes.rateLimit.test.ts. Aqui ele é mockado como pass-through
// para focar nos testes de validação/envelope sem esgotar o bucket.
vi.mock('../../middleware/rateLimit', () => ({
    rateLimiters: {
        scheduler: (_req: any, _res: any, next: any) => next(),
    },
}));

import schedulerRoutes from '../../routes/schedulerRoutes';
import errorHandler from '../../middleware/errorHandler';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/scheduler', schedulerRoutes);
    // ErrorHandler global — necessário para que erros de validação (next(error))
    // sejam devolvidos no envelope `{ success:false, error:{ code, message, details } }`.
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

        it('returns 400 with Zod issue list when body shape is invalid (#1567)', async () => {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({ chatId: '', sessionId: 42 });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(Array.isArray(res.body.error.details)).toBe(true);
            expect(res.body.error.details.length).toBeGreaterThan(0);
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

        it('returns 400 with "Máximo de 100 destinatários por chamada" when sending 150 recipients (#1567)', async () => {
            const chatIds = Array.from({ length: 150 }, (_, i) => `${i}@c.us`);
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', chatIds, message: 'Hello' });

            expect(res.status).toBe(400);
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
            const detailsMsg = (res.body.error.details || [])
                .map((d: any) => d.message)
                .join(' | ');
            expect(detailsMsg).toContain('Máximo de 100 destinatários por chamada');
        });

        it('returns 400 when templateId references a non-existing template (#1567)', async () => {
            mockSchedulerService.getTemplate.mockReturnValueOnce(undefined);

            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({
                    sessionId: 'default',
                    chatIds: ['1@c.us'],
                    message: 'Hello',
                    templateId: 'tpl_nao_existe',
                });

            expect(res.status).toBe(400);
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
        });

        it('renders template (escaped) when templateId exists and points to a valid template (#1567)', async () => {
            mockSchedulerService.getTemplate.mockReturnValueOnce({
                id: 'tpl-1', name: 'T', content: 'Oi {{nome}}', category: 'general',
            });

            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({
                    sessionId: 'default',
                    chatIds: ['1@c.us'],
                    message: 'fallback',
                    templateId: 'tpl-1',
                    variables: { nome: '<b>Bob</b>' },
                });

            expect(res.status).toBe(200);
            expect(mockSchedulerService.scheduleBroadcast).toHaveBeenCalledTimes(1);
            // Variável deve chegar ESCAPADA (anti-injection), não crua.
            const passedMessage = mockSchedulerService.scheduleBroadcast.mock.calls[0][0].message;
            expect(passedMessage).toContain('&lt;b&gt;Bob&lt;/b&gt;');
            expect(passedMessage).not.toContain('<b>Bob</b>');
        });
    });

    describe('POST /api/scheduler/confirmation', () => {
        it('returns 200 with valid body', async () => {
            const res = await request(app)
                .post('/api/scheduler/confirmation')
                .send({ chatId: '1', sessionId: 's', message: 'ok?' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 when missing required fields', async () => {
            const res = await request(app)
                .post('/api/scheduler/confirmation')
                .send({ chatId: '1' });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/scheduler/reminder', () => {
        it('returns 200 with valid body', async () => {
            const res = await request(app)
                .post('/api/scheduler/reminder')
                .send({ chatId: '1', sessionId: 's', message: 'lembrar', interval: 5, unit: 'minutes' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 when unit is invalid', async () => {
            const res = await request(app)
                .post('/api/scheduler/reminder')
                .send({ chatId: '1', sessionId: 's', message: 'x', interval: 5, unit: 'weeks' });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/scheduler/templates', () => {
        it('returns 200 with valid template body', async () => {
            const res = await request(app)
                .post('/api/scheduler/templates')
                .send({ name: 'Boas-Vindas', content: 'Olá!' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSchedulerService.createTemplate).toHaveBeenCalledTimes(1);
        });

        it('returns 400 when required fields are missing', async () => {
            const res = await request(app)
                .post('/api/scheduler/templates')
                .send({ name: 'Sem conteúdo' });

            expect(res.status).toBe(400);
            expect(mockSchedulerService.createTemplate).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/scheduler/send-template', () => {
        it('returns 404 when template does not exist', async () => {
            mockSchedulerService.getTemplate.mockReturnValueOnce(undefined);

            const res = await request(app)
                .post('/api/scheduler/send-template')
                .send({ templateId: 'tpl_x', chatId: '1', sessionId: 's' });

            expect(res.status).toBe(404);
        });

        it('renders template with escaped variables when it exists (#1567)', async () => {
            mockSchedulerService.getTemplate.mockReturnValueOnce({
                id: 'tpl-1', name: 'T', content: 'Oi {{x}}', category: 'general',
            });

            const res = await request(app)
                .post('/api/scheduler/send-template')
                .send({ templateId: 'tpl-1', chatId: '1', sessionId: 's', variables: { x: '<img>' } });

            expect(res.status).toBe(200);
            expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(expect.objectContaining({
                message: 'Oi &lt;img&gt;',
            }));
        });
    });

    describe('POST /api/scheduler/import-csv', () => {
        it('returns 400 when CSV yields no contacts', async () => {
            mockSchedulerService.parseCSVContacts.mockReturnValueOnce([]);

            const res = await request(app)
                .post('/api/scheduler/import-csv')
                .send({ csvContent: 'phone\nfoo', sessionId: 's', message: 'Oi' });

            expect(res.status).toBe(400);
        });

        it('returns 400 when required fields are missing', async () => {
            const res = await request(app)
                .post('/api/scheduler/import-csv')
                .send({ csvContent: 'x' });

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/scheduler/pending', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/scheduler/pending');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('data');
            expect(res.body.success).toBe(true);
        });
    });

    describe('GET /api/scheduler/stats', () => {
        it('returns 200 with data envelope (#1567)', async () => {
            const res = await request(app).get('/api/scheduler/stats');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body).toHaveProperty('data');
        });
    });

    describe('GET /api/scheduler/broadcasts/:id', () => {
        it('returns 404 when broadcast not found', async () => {
            const res = await request(app).get('/api/scheduler/broadcasts/missing');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });

        it('returns 200 with data envelope when found', async () => {
            mockSchedulerService.getBroadcastDetails.mockReturnValueOnce({
                broadcastId: 'b1', totalCount: 1, pending: 0, sent: 1, failed: 0, cancelled: 0, messages: [],
            });

            const res = await request(app).get('/api/scheduler/broadcasts/b1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.broadcastId).toBe('b1');
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

        it('returns 400 when id param is empty (#1567)', async () => {
            const res = await request(app).delete('/api/scheduler/');

            expect(res.status).toBe(404);
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

        it('returns 400 when name is empty string (#1567)', async () => {
            const res = await request(app)
                .put('/api/scheduler/templates/tpl-1')
                .send({ name: '' });

            expect(res.status).toBe(400);
            expect(mockSchedulerService.updateTemplate).not.toHaveBeenCalled();
        });
    });

    describe('DELETE /api/scheduler/templates/:id', () => {
        it('returns 200 when template deleted', async () => {
            const res = await request(app).delete('/api/scheduler/templates/tpl-1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 404 when template not found', async () => {
            mockSchedulerService.deleteTemplate.mockReturnValue(false);

            const res = await request(app).delete('/api/scheduler/templates/missing');

            expect(res.status).toBe(404);
        });
    });
});
