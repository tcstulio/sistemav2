import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockAuthState = vi.hoisted(() => ({ authenticated: true }));
const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((_req: any, res: any, next: any) => {
    if (!mockAuthState.authenticated) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }
    return next();
}));

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
    // #1439 — resolução de sessionId por precedência (rule > uiConfig > unset).
    resolveRuleSessionId: vi.fn(() => ({ sessionId: '', source: 'unset' as const })),
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

const mockEventRouter = vi.hoisted(() => ({
    route: vi.fn(),
    processEvent: vi.fn(),
}));

vi.mock('../../services/eventRouter', () => ({
    eventRouter: mockEventRouter,
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
        vi.stubEnv('NODE_ENV', 'development');
        mockAuthState.authenticated = true;
        app = createApp();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
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
            expect(res.body.data).toHaveProperty('invoice_created');
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

    describe('proteção das rotas', () => {
        const protectedEndpoints = [
            ['post', '/api/webhooks/trigger'],
            ['post', '/api/webhooks/dolibarr/invoice'],
            ['post', '/api/webhooks/dolibarr/ticket'],
            ['post', '/api/webhooks/dolibarr/order'],
            ['get', '/api/webhooks/rules'],
            ['post', '/api/webhooks/rules'],
            ['delete', '/api/webhooks/rules/rule-1'],
            ['put', '/api/webhooks/rules/rule-1'],
            ['patch', '/api/webhooks/rules/rule-1/toggle'],
            ['get', '/api/webhooks/logs'],
            ['get', '/api/webhooks/flows'],
            ['post', '/api/webhooks/flows'],
            ['put', '/api/webhooks/flows/flow-1'],
            ['delete', '/api/webhooks/flows/flow-1'],
            ['patch', '/api/webhooks/flows/flow-1/toggle'],
            ['post', '/api/webhooks/rules/rule-1/test'],
            ['post', '/api/webhooks/simulate'],
            ['get', '/api/webhooks/variables'],
        ] as const;

        it.each(protectedEndpoints)('%s %s retorna 401 sem autenticação', async (method, path) => {
            mockAuthState.authenticated = false;

            const res = await (request(app) as any)[method](path).send({});

            expect(res.status).toBe(401);
        });

        it('mantém /receive/:source acessível sem autenticação', async () => {
            mockAuthState.authenticated = false;

            const res = await request(app).post('/api/webhooks/receive/dolibarr').send({ id: '1' });

            expect(res.status).toBe(200);
            expect(mockRequireDolibarrLogin).not.toHaveBeenCalled();
            expect(mockEventRouter.processEvent).toHaveBeenCalledWith('dolibarr', { id: '1' });
        });

        it('retorna 404 para /simulate em produção antes da autenticação', async () => {
            vi.stubEnv('NODE_ENV', 'production');
            mockAuthState.authenticated = false;

            const res = await request(app).post('/api/webhooks/simulate').send({ event: 'invoice_created' });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
            expect(mockRequireDolibarrLogin).not.toHaveBeenCalled();
        });
    });

    describe('validação anti-ReDoS', () => {
        it('rejeita pattern aninhado com mais de 200 caracteres', async () => {
            const res = await request(app)
                .post('/api/webhooks/rules')
                .send({ name: 'Test', event: 'custom', sessionId: 'default', conditions: { pattern: 'a'.repeat(201) } });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PATTERN');
            expect(mockSchedulerService.createRule).not.toHaveBeenCalled();
        });

        it('rejeita pattern no corpo com mais de 200 caracteres', async () => {
            const res = await request(app)
                .post('/api/webhooks/rules')
                .send({ name: 'Test', event: 'custom', sessionId: 'default', pattern: 'a'.repeat(201) });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PATTERN');
            expect(mockSchedulerService.createRule).not.toHaveBeenCalled();
        });

        it.each(['(a+)+$', '.*.*.*'])('rejeita pattern aninhado inseguro %s', async (pattern) => {
            const res = await request(app)
                .post('/api/webhooks/rules')
                .send({ name: 'Test', event: 'custom', sessionId: 'default', conditions: { pattern } });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PATTERN');
            expect(mockSchedulerService.createRule).not.toHaveBeenCalled();
        });

        it.each(['(a+)+$', '.*.*.*'])('rejeita pattern inseguro no corpo %s', async (pattern) => {
            const res = await request(app)
                .post('/api/webhooks/rules')
                .send({ name: 'Test', event: 'custom', sessionId: 'default', pattern });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PATTERN');
            expect(mockSchedulerService.createRule).not.toHaveBeenCalled();
        });

        it('rejeita caracteres fora da whitelist', async () => {
            const res = await request(app)
                .post('/api/webhooks/rules')
                .send({ name: 'Test', event: 'custom', sessionId: 'default', pattern: 'invoice paid' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PATTERN');
            expect(mockSchedulerService.createRule).not.toHaveBeenCalled();
        });

        it('rejeita regex inválida mesmo com caracteres permitidos', async () => {
            const res = await request(app)
                .post('/api/webhooks/rules')
                .send({ name: 'Test', event: 'custom', sessionId: 'default', pattern: '[invoice' });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PATTERN');
            expect(mockSchedulerService.createRule).not.toHaveBeenCalled();
        });

        it('aceita pattern válido com até 200 caracteres', async () => {
            const res = await request(app)
                .post('/api/webhooks/rules')
                .send({ name: 'Test', event: 'custom', sessionId: 'default', pattern: 'invoice_[0-9]+' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockSchedulerService.createRule).toHaveBeenCalledOnce();
        });

        it('valida pattern ao atualizar uma regra', async () => {
            const res = await request(app)
                .put('/api/webhooks/rules/rule-1')
                .send({ pattern: 'a'.repeat(201) });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_PATTERN');
            expect(mockSchedulerService.updateRule).not.toHaveBeenCalled();
        });
    });

    // #1439 — /api/webhooks/simulate usa o helper de resolução de sessionId.
    describe('POST /api/webhooks/simulate (#1439)', () => {
        it('regra COM sessionId próprio → usa o sessionId da regra (não o do body nem o config)', async () => {
            mockSchedulerService.getRules.mockReturnValue([
                { id: 'r1', name: 'Regra com sessão', event: 'invoice_created', enabled: true, channel: 'whatsapp', sessionId: 'minha-sess', message: 'Olá {{customerName}}' },
            ]);
            mockSchedulerService.resolveRuleSessionId.mockReturnValue({ sessionId: 'minha-sess', source: 'rule' });

            const res = await request(app)
                .post('/api/webhooks/simulate')
                .send({ event: 'invoice_created', mockPhone: '11999999999', sessionId: 'sessionId-do-body' });

            expect(res.status).toBe(200);
            expect(mockSchedulerService.resolveRuleSessionId).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: 'minha-sess' }),
            );
            expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: 'minha-sess' }),
            );
            expect(mockSchedulerService.addLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadata: expect.objectContaining({ sessionIdSource: 'rule' }),
                }),
            );
        });

        it('regra SEM sessionId + body COM sessionId → cai no sessionId do body (override de teste)', async () => {
            mockSchedulerService.getRules.mockReturnValue([
                { id: 'r1', name: 'Regra sem sessão', event: 'invoice_created', enabled: true, channel: 'whatsapp', sessionId: '', message: 'Oi' },
            ]);
            // helper devolve string vazia (sem default config) → caller usa o sessionId do body
            mockSchedulerService.resolveRuleSessionId.mockReturnValue({ sessionId: '', source: 'unset' });

            const res = await request(app)
                .post('/api/webhooks/simulate')
                .send({ event: 'invoice_created', mockPhone: '11999999999', sessionId: 'sessionId-do-body' });

            expect(res.status).toBe(200);
            expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: 'sessionId-do-body' }),
            );
        });

        it('regra SEM sessionId + body SEM sessionId + helper devolve config default → usa o default', async () => {
            mockSchedulerService.getRules.mockReturnValue([
                { id: 'r1', name: 'Regra', event: 'invoice_created', enabled: true, channel: 'whatsapp', sessionId: '', message: 'Oi' },
            ]);
            mockSchedulerService.resolveRuleSessionId.mockReturnValue({ sessionId: 'global-sess', source: 'config' });

            const res = await request(app)
                .post('/api/webhooks/simulate')
                .send({ event: 'invoice_created', mockPhone: '11999999999' });

            expect(res.status).toBe(200);
            expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: 'global-sess' }),
            );
        });
    });
});
