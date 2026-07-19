import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// NÃO mockamos express-rate-limit aqui — queremos testar o comportamento REAL
// do preset `rateLimiters.scheduler` (10/min) aplicado às rotas mutativas do
// scheduler. Sem isso, ninguém garante que a 11ª chamada POST → 429 (#1567).

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockSchedulerService = vi.hoisted(() => ({
    scheduleMessage: vi.fn(() => ({ id: 'msg-1', chatId: '1', message: 'hi', scheduledAt: Date.now() })),
    scheduleBroadcast: vi.fn(() => []),
    scheduleConfirmation: vi.fn(() => ({ id: 'msg-1' })),
    scheduleReminder: vi.fn(() => ({ id: 'msg-1' })),
    getPending: vi.fn(() => []),
    getHistory: vi.fn(() => []),
    cancelMessage: vi.fn(() => true),
    getStats: vi.fn(() => ({})),
    createTemplate: vi.fn(() => ({ id: 'tpl-1' })),
    getTemplates: vi.fn(() => []),
    getTemplate: vi.fn(() => undefined),
    updateTemplate: vi.fn(() => null),
    deleteTemplate: vi.fn(() => true),
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
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import schedulerRoutes from '../../routes/schedulerRoutes';
import errorHandler from '../../middleware/errorHandler';

function createApp() {
    const app = express();
    app.use(express.json());
    // `trust proxy` faz o supertest respeitar `X-Forwarded-For` em req.ip —
    // permitindo que cada teste use um IP distinto e tenha seu próprio bucket
    // no limiter (que é singleton por módulo).
    app.set('trust proxy', 1);
    app.use('/api/scheduler', schedulerRoutes);
    app.use(errorHandler);
    return app;
}

// IPs distintos por teste — o `rateLimiters.scheduler` é singleton (mesmo
// módulo compartilhado entre os testes deste arquivo), então cada `it()` usa
// seu próprio IP para não consumir o budget dos vizinhos.
const TEST_IP_BURST = '203.0.113.41';
const TEST_IP_GET_EXEMPT = '203.0.113.42';
const TEST_IP_PUT = '203.0.113.43';

describe('schedulerRoutes rate limiting (#1567)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    it('returns 429 on the 11th POST within 1 minute (scheduler limiter = 10/min)', async () => {
        const body = { chatId: '1', sessionId: 's', message: 'hi' };

        for (let i = 0; i < 10; i++) {
            const r = await request(app)
                .post('/api/scheduler/schedule')
                .set('X-Forwarded-For', TEST_IP_BURST)
                .send(body);
            expect(r.status, `request #${i + 1} should pass`).toBe(200);
        }

        const blocked = await request(app)
            .post('/api/scheduler/schedule')
            .set('X-Forwarded-For', TEST_IP_BURST)
            .send(body);

        expect(blocked.status).toBe(429);
        expect(blocked.body.success).toBe(false);
        expect(blocked.body.error.code).toBe('RATE_LIMIT');
    }, 15000);

    it('does not throttle GET requests via the route-level POST limiter', async () => {
        const body = { chatId: '1', sessionId: 's', message: 'hi' };

        // Esgota o bucket de POST para este IP.
        for (let i = 0; i < 11; i++) {
            await request(app)
                .post('/api/scheduler/schedule')
                .set('X-Forwarded-For', TEST_IP_GET_EXEMPT)
                .send(body);
        }

        // GET não passa pelo `rateLimiters.scheduler` (limiter só em POST/PUT/DELETE)
        // — deve continuar respondendo 200 mesmo com o bucket de POST esgotado.
        const r = await request(app)
            .get('/api/scheduler/pending')
            .set('X-Forwarded-For', TEST_IP_GET_EXEMPT);

        expect(r.status).toBe(200);
        expect(r.body.success).toBe(true);
    }, 15000);

    it('also applies the limiter to PUT/DELETE (not just POST)', async () => {
        // Consome as 10 primeiras chamadas com PUT (que também conta no limiter).
        for (let i = 0; i < 10; i++) {
            const r = await request(app)
                .put('/api/scheduler/templates/tpl-1')
                .set('X-Forwarded-For', TEST_IP_PUT)
                .send({ name: 'n' });
            // 404 (mock retorna null) — mas ainda conta para o limiter.
            expect([200, 404]).toContain(r.status);
        }

        // 11ª chamada mutativa (PUT) → 429.
        const blocked = await request(app)
            .put('/api/scheduler/templates/tpl-1')
            .set('X-Forwarded-For', TEST_IP_PUT)
            .send({ name: 'n' });

        expect(blocked.status).toBe(429);
    }, 15000);
});
