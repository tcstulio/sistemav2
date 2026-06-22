import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockSchedulerService = vi.hoisted(() => ({
    scheduleMessage: vi.fn(() => ({ id: 'msg-1', chatId: '123', message: 'test', scheduledAt: Date.now() })),
    renderTemplate: vi.fn(() => 'Rendered message'),
    getRules: vi.fn(() => []),
    createRule: vi.fn(() => ({ id: 'rule-1' })),
    deleteRule: vi.fn(() => true),
    updateRule: vi.fn(() => ({ id: 'rule-1' })),
    toggleRule: vi.fn(() => true),
    getLogs: vi.fn(() => []),
    addLog: vi.fn(),
    getFlows: vi.fn(() => []),
    createFlow: vi.fn(() => ({ id: 'flow-1' })),
    deleteFlow: vi.fn(() => true),
    toggleFlow: vi.fn(() => true),
    getFlow: vi.fn(() => ({ id: 'flow-1' })),
}));

const mockDolibarrService = vi.hoisted(() => ({
    getInvoice: vi.fn(() => ({})),
    getThirdParty: vi.fn(() => ({ name: 'Test', phone: '5511999999999' })),
    getTicket: vi.fn(() => ({})),
    getOrder: vi.fn(() => ({})),
}));

const mockEmailService = vi.hoisted(() => ({
    sendEmail: vi.fn(),
}));

const mockMessageService = vi.hoisted(() => ({
    sendText: vi.fn(),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/schedulerService', () => ({
    schedulerService: mockSchedulerService,
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: mockDolibarrService,
}));

vi.mock('../../services/emailService', () => ({
    emailService: mockEmailService,
}));

vi.mock('../../services/legacy/messageService', () => ({
    messageService: mockMessageService,
}));

vi.mock('../../services/eventRouter', () => ({
    eventRouter: {
        route: vi.fn(),
        processEvent: vi.fn(),
    },
}));

vi.mock('../../services/notificationService', () => ({
    notificationService: {
        create: vi.fn(),
    },
}));

vi.mock('../../services/notificationTemplates', () => ({
    renderTemplate: vi.fn(() => 'Rendered notification'),
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

import webhookRoutes from '../../routes/webhookRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/webhooks', webhookRoutes);
    return app;
}

describe('webhookRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('POST /api/webhooks/trigger', () => {
        it('returns 200 with valid trigger request', async () => {
            const res = await request(app)
                .post('/api/webhooks/trigger')
                .send({ sessionId: 'default', chatId: '123', message: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 when missing sessionId or chatId', async () => {
            const res = await request(app)
                .post('/api/webhooks/trigger')
                .send({ message: 'Hello' });

            expect(res.status).toBe(400);
        });
    });

    describe('WEBHOOK_SECRET (proteção opcional dos endpoints públicos)', () => {
        const SECRET = 'wh-secret';
        let restore: any;
        beforeEach(async () => {
            const { config } = await import('../../config/env');
            restore = (config as any).webhookSecret;
            (config as any).webhookSecret = SECRET;
        });
        afterEach(async () => {
            const { config } = await import('../../config/env');
            (config as any).webhookSecret = restore;
        });

        it('bloqueia /trigger sem header quando o segredo está setado', async () => {
            const res = await request(app).post('/api/webhooks/trigger')
                .send({ sessionId: 'default', chatId: '123', message: 'Hi' });
            expect(res.status).toBe(401);
        });

        it('bloqueia com segredo errado', async () => {
            const res = await request(app).post('/api/webhooks/trigger')
                .set('x-webhook-secret', 'errado')
                .send({ sessionId: 'default', chatId: '123', message: 'Hi' });
            expect(res.status).toBe(401);
        });

        it('aceita /trigger com o segredo correto', async () => {
            const res = await request(app).post('/api/webhooks/trigger')
                .set('x-webhook-secret', SECRET)
                .send({ sessionId: 'default', chatId: '123', message: 'Hi' });
            expect(res.status).toBe(200);
        });

        it('também protege /dolibarr/invoice', async () => {
            const res = await request(app).post('/api/webhooks/dolibarr/invoice').send({ invoiceId: '1' });
            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/webhooks/dolibarr/invoice', () => {
        it('returns 200 when invoice found', async () => {
            mockDolibarrService.getInvoice.mockResolvedValue({ id: '1', ref: 'FAC-001', socid: '1' });
            mockDolibarrService.getThirdParty.mockResolvedValue({ name: 'Test', phone: '5511999999999' });

            const res = await request(app)
                .post('/api/webhooks/dolibarr/invoice')
                .send({ invoiceId: '1', action: 'created', sessionId: 'default' });

            expect(res.status).toBe(200);
        });

        it('returns 400 when missing invoiceId', async () => {
            const res = await request(app)
                .post('/api/webhooks/dolibarr/invoice')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/webhooks/rules', () => {
        it('returns 200 when rule created', async () => {
            const res = await request(app)
                .post('/api/webhooks/rules')
                .send({ name: 'Test Rule', event: 'invoice_created', sessionId: 'default' });

            expect(res.status).toBe(200);
        });

        it('returns 400 when missing required fields', async () => {
            const res = await request(app)
                .post('/api/webhooks/rules')
                .send({ name: 'Test Rule' });

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/webhooks/rules', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/webhooks/rules');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('data');
        });
    });

    describe('DELETE /api/webhooks/rules/:id', () => {
        it('returns 200 when rule deleted', async () => {
            const res = await request(app).delete('/api/webhooks/rules/rule-1');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/webhooks/variables', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/webhooks/variables');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('invoice_created');
        });
    });

    describe('PUT /api/webhooks/flows/:id (#604)', () => {
        it('returns 200 and updated flow when found', async () => {
            mockSchedulerService.updateFlow = vi.fn(() => ({
                id: 'flow-1', name: 'Fluxo Editado', triggerKeywords: ['oi'], enabled: true, steps: []
            }));

            const res = await request(app)
                .put('/api/webhooks/flows/flow-1')
                .send({ name: 'Fluxo Editado', triggerKeywords: ['oi'] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('Fluxo Editado');
        });

        it('returns 404 when flow not found', async () => {
            mockSchedulerService.updateFlow = vi.fn(() => null);

            const res = await request(app)
                .put('/api/webhooks/flows/nonexistent')
                .send({ name: 'X' });

            expect(res.status).toBe(404);
        });
    });
});
