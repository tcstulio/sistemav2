import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../middleware/errorHandler';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

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
    // #1567: usado pela rota /broadcast e /send-template para validar existência
    // do templateId antes de renderizar (anti-injection).
    getTemplate: vi.fn(() => undefined),
    // Usado em /import-csv
    parseCSVContacts: vi.fn(() => []),
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
import { schedulerLimiter } from '../../middleware/rateLimit';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/scheduler', schedulerRoutes);
    app.use(errorHandler);
    return app;
}

function createAppWithLimiter() {
    return createApp();
}

function resetSchedulerLimiter() {
    void schedulerLimiter.resetKey('::ffff:127.0.0.1');
    void schedulerLimiter.resetKey('127.0.0.1');
}

describe('schedulerRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        resetSchedulerLimiter();
        // Restaura defaults dos mocks após clearAllMocks
        mockSchedulerService.scheduleMessage.mockReturnValue({ id: 'msg-1', chatId: '123', message: 'test', scheduledAt: Date.now() });
        mockSchedulerService.getPending.mockReturnValue([]);
        mockSchedulerService.cancelMessage.mockReturnValue(true);
        mockSchedulerService.scheduleBroadcast.mockReturnValue([]);
        mockSchedulerService.createTemplate.mockReturnValue({ id: 'tpl-1', name: 'Test', content: 'Hi', category: 'general', channel: 'whatsapp' });
        mockSchedulerService.getTemplates.mockReturnValue([]);
        mockSchedulerService.deleteTemplate.mockReturnValue(true);
        mockSchedulerService.updateTemplate.mockReturnValue({ id: 'tpl-1', name: 'Updated', content: 'Hi', category: 'general', channel: 'whatsapp' });
        mockSchedulerService.getStats.mockReturnValue({});
        mockSchedulerService.getTemplate.mockReturnValue(undefined);
        mockSchedulerService.parseCSVContacts.mockReturnValue([]);
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

        // #1567 — critério de aceite: 150 destinatários → 400 com a mensagem exata.
        it('returns 400 with exact message when 150 recipients are sent', async () => {
            const recipients = Array.from({ length: 150 }, (_, i) => `${i}@c.us`);
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', recipients, message: 'Hello' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            // #1567: o middleware validateBody retorna a mensagem genérica "Validation failed"
            // no topo, e o erro específico do Zod no array `details` (campo recipients).
            const recipientsError = res.body.error.details?.find((d: any) => d.field === 'recipients');
            expect(recipientsError?.message).toBe('Máximo de 100 destinatários por chamada');
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
        });

        // #1567 — critério de aceite: templateId inexistente → 400.
        it('returns 400 when broadcast references a non-existent templateId (anti-injection)', async () => {
            mockSchedulerService.getTemplate.mockReturnValue(undefined);

            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({
                    sessionId: 'default',
                    chatIds: ['1@c.us'],
                    message: 'Hello',
                    templateId: 'tpl-nonexistent'
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toMatch(/tpl-nonexistent/);
            expect(res.body.error.message).toMatch(/não encontrado/);
            expect(mockSchedulerService.scheduleBroadcast).not.toHaveBeenCalled();
        });

        it('accepts broadcast with valid templateId and renders template', async () => {
            mockSchedulerService.getTemplate.mockReturnValue({
                id: 'tpl-1',
                name: 'Welcome',
                content: 'Olá!',
                category: 'general',
                channel: 'whatsapp',
                createdAt: Date.now()
            });

            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({
                    sessionId: 'default',
                    chatIds: ['1@c.us'],
                    message: 'fallback',
                    templateId: 'tpl-1'
                });

            expect(res.status).toBe(200);
            expect(mockSchedulerService.scheduleBroadcast).toHaveBeenCalled();
            const callArgs = mockSchedulerService.scheduleBroadcast.mock.calls[0][0];
            expect(callArgs.message).toBe('Olá!');
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

    describe('DELETE /api/scheduler/:id', () => {
        it('returns 200 when message cancelled', async () => {
            const res = await request(app).delete('/api/scheduler/msg-1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 404 when message not found', async () => {
            mockSchedulerService.cancelMessage.mockReturnValue(false);

            const res = await request(app).delete('/api/scheduler/not-found');

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

        // #1567 — Zod rejeita body vazio em update (refine "pelo menos um campo").
        it('returns 400 when no fields provided in update body', async () => {
            const res = await request(app)
                .put('/api/scheduler/templates/tpl-1')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(mockSchedulerService.updateTemplate).not.toHaveBeenCalled();
        });
    });

    // #1567 — critério de aceite: body inválido em qualquer rota → 400 com lista de erros do Zod.
    describe('#1567: Zod validation error envelope', () => {
        it('POST /schedule returns 400 with details array of Zod issues when body is missing fields', async () => {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(Array.isArray(res.body.error.details)).toBe(true);
            expect(res.body.error.details.length).toBeGreaterThan(0);
            const fields = res.body.error.details.map((d: any) => d.field);
            expect(fields).toContain('chatId');
            expect(fields).toContain('sessionId');
            expect(fields).toContain('message');
        });

        it('POST /broadcast returns 400 with details when message is too long', async () => {
            const res = await request(app)
                .post('/api/scheduler/broadcast')
                .send({ sessionId: 'default', chatIds: ['1@c.us'], message: 'x'.repeat(5000) });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(Array.isArray(res.body.error.details)).toBe(true);
        });

        it('POST /templates returns 400 when name is missing', async () => {
            const res = await request(app)
                .post('/api/scheduler/templates')
                .send({ content: 'Hi' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details.some((d: any) => d.field === 'name')).toBe(true);
        });

        it('POST /confirmation returns 400 when required fields missing', async () => {
            const res = await request(app)
                .post('/api/scheduler/confirmation')
                .send({ chatId: '123' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('POST /reminder returns 400 when unit is invalid', async () => {
            const res = await request(app)
                .post('/api/scheduler/reminder')
                .send({ chatId: '123', sessionId: 's', message: 'm', interval: 5, unit: 'years' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('POST /send-template returns 400 when templateId does not exist (anti-injection)', async () => {
            mockSchedulerService.getTemplate.mockReturnValue(undefined);

            const res = await request(app)
                .post('/api/scheduler/send-template')
                .send({
                    templateId: 'tpl-bad',
                    chatId: '123',
                    sessionId: 's',
                    variables: { name: '<script>alert(1)</script>' }
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toMatch(/tpl-bad/);
        });

        it('POST /send-template sanitizes template variables to prevent nested expansion', async () => {
            mockSchedulerService.getTemplate.mockReturnValue({
                id: 'tpl-x',
                name: 'X',
                content: 'Hello {{name}}!',
                category: 'general',
                channel: 'whatsapp',
                createdAt: Date.now()
            });

            const res = await request(app)
                .post('/api/scheduler/send-template')
                .send({
                    templateId: 'tpl-x',
                    chatId: '123',
                    sessionId: 's',
                    // Tentativa de injeção aninhada: valor contém {{secret}} que seria
                    // expandido se o renderizador não sanitizar.
                    variables: { name: 'Bob {{secret}}' }
                });

            expect(res.status).toBe(200);
            const callArgs = mockSchedulerService.scheduleMessage.mock.calls[0][0];
            // O par {{secret}} dentro da variável name deve ter sido REMOVIDO INTEIRO
            // (não apenas os delimitadores) — sem isso, a string resultante ainda
            // conteria {{}} parciais que poderiam enganar um renderer ingênuo.
            expect(callArgs.message).not.toMatch(/\{\{secret\}\}/);
            expect(callArgs.message).not.toMatch(/\{\{/);
            expect(callArgs.message).not.toMatch(/\}\}/);
            // Confirma que o nome válido (Bob) sobrevive à sanitização.
            expect(callArgs.message).toMatch(/Hello Bob/);
        });
    });

    describe('#1567: standard envelope for success responses', () => {
        it('success response wraps payload in { success: true, data }', async () => {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({ chatId: '123', sessionId: 'default', message: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('success', true);
            expect(res.body).toHaveProperty('data');
            // Não deve vazar campos crus fora do envelope
            expect(res.body.error).toBeUndefined();
        });

        it('success response on DELETE wraps payload in { success: true, data }', async () => {
            const res = await request(app).delete('/api/scheduler/msg-1');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('success', true);
            expect(res.body).toHaveProperty('data');
            expect(res.body.data).toMatchObject({ id: 'msg-1', cancelled: true });
        });

        it('error response uses { success: false, error: { code, message } }', async () => {
            mockSchedulerService.cancelMessage.mockReturnValue(false);

            const res = await request(app).delete('/api/scheduler/not-found');

            expect(res.status).toBe(404);
            expect(res.body).toHaveProperty('success', false);
            expect(res.body).toHaveProperty('error');
            expect(res.body.error).toHaveProperty('code', 'NOT_FOUND');
            expect(res.body.error).toHaveProperty('message');
        });
    });
});

// =====================================================
// #1567 — schedulerLimiter: 11ª chamada POST em 1min → 429.
// Mesma instância de rateLimiters.scheduler que server.ts aplica globalmente
// em /api/scheduler. Sem recriar config, sem mock — valida o contrato real.
// Os outros suites deste arquivo NÃO montam o limiter para não contaminar
// o contador com requests não-relacionados ao teste de rate limit.
// =====================================================
describe('#1567: schedulerLimiter — 11ª chamada POST em 1min → 429', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetSchedulerLimiter();
        mockSchedulerService.scheduleMessage.mockReturnValue({ id: 'msg-x', chatId: '123', message: 'm', scheduledAt: Date.now() });
    });

    it('10 POSTs OK; a 11ª retorna 429 com envelope padronizado', async () => {
        const app = createAppWithLimiter();

        for (let i = 0; i < 10; i++) {
            const res = await request(app)
                .post('/api/scheduler/schedule')
                .send({ chatId: '123', sessionId: 'default', message: 'Hello' });
            expect(res.status).toBe(200);
        }

        const blocked = await request(app)
            .post('/api/scheduler/schedule')
            .send({ chatId: '123', sessionId: 'default', message: 'Hello' });

        // #1567 — envelope padronizado entregue pelo errorHandler (handler do
        // rateLimiters.scheduler delega via next(err)).
        expect(blocked.status).toBe(429);
        expect(blocked.body.success).toBe(false);
        expect(blocked.body.error.code).toBe('RATE_LIMIT');
        expect(typeof blocked.body.error.message).toBe('string');
        expect(blocked.body.error.message.length).toBeGreaterThan(0);
    });
});
