import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockMoltbotGateway = vi.hoisted(() => ({
    getStatus: vi.fn(() => ({ connected: true })),
    getWhatsAppStatus: vi.fn(() => ({ status: 'connected' })),
}));

const mockTulipaService = vi.hoisted(() => ({
    getQuickStatus: vi.fn(() => ({ healthy: true })),
    getSystemStatus: vi.fn(() => ({ healthy: true })),
    getPeople: vi.fn(() => []),
    getPerson: vi.fn(() => ({ id: '1', name: 'Test' })),
    linkPersonToCustomer: vi.fn(() => true),
    getEvents: vi.fn(() => []),
    getEventsStats: vi.fn(() => ({})),
    getBrainSummary: vi.fn(() => ({})),
    getTasks: vi.fn(() => []),
    getAvailableTasks: vi.fn(() => []),
    createTask: vi.fn(() => ({ id: '1' })),
    getProjects: vi.fn(() => []),
    getActiveAgents: vi.fn(() => []),
    triggerBrainSync: vi.fn(() => true),
}));

const mockChannelRouter = vi.hoisted(() => ({
    getAllChannelsStatus: vi.fn(() => []),
    send: vi.fn(() => ({ success: true })),
    getWhatsAppProvider: vi.fn(() => 'legacy'),
    setWhatsAppProvider: vi.fn(),
}));

const mockSyncService = vi.hoisted(() => ({
    getSyncStatus: vi.fn(() => ({ status: 'idle' })),
    getPeopleWithMatches: vi.fn(() => []),
    linkPersonToCustomer: vi.fn(() => true),
    createCustomerFromPerson: vi.fn(() => '1'),
    syncAll: vi.fn(() => ({ synced: 0 })),
    isEnabled: vi.fn(() => true),
}));

const mockFeATURES = vi.hoisted(() => ({
    TULIPA_ENABLED: true,
    TULIPA_TASKS_ENABLED: true,
    MOLTBOT_ENABLED: false,
    WHATSAPP_PROVIDER: 'legacy',
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
}));

vi.mock('../../services/moltbotGateway', () => ({
    moltbotGateway: mockMoltbotGateway,
}));

vi.mock('../../services/tulipaService', () => ({
    tulipaService: mockTulipaService,
}));

vi.mock('../../services/channelRouter', () => ({
    channelRouter: mockChannelRouter,
}));

vi.mock('../../services/syncService', () => ({
    syncService: mockSyncService,
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

vi.mock('../../config/features', () => ({
    FEATURES: mockFeATURES,
    isUsingMoltbot: vi.fn(() => false),
    isTulipaActive: vi.fn(() => true),
    getAllFeatures: vi.fn(() => ({})),
}));

import integrationRoutes from '../../routes/integrationRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/integration', integrationRoutes);
    return app;
}

describe('integrationRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        app = createApp();
        vi.clearAllMocks();
    });

    describe('GET /api/integration/status', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/integration/status');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/integration/moltbot/status', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/integration/moltbot/status');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/integration/tulipa/status', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/integration/tulipa/status');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/integration/brain/people', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/integration/brain/people');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/integration/brain/people/:id', () => {
        it('returns 200 when person found', async () => {
            const res = await request(app).get('/api/integration/brain/people/1');
            expect(res.status).toBe(200);
        });

        it('returns 404 when person not found', async () => {
            mockTulipaService.getPerson.mockResolvedValue(null);
            const res = await request(app).get('/api/integration/brain/people/not-found');
            expect(res.status).toBe(404);
        });
    });

    describe('POST /api/integration/brain/people/:id/link', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/integration/brain/people/1/link')
                .send({ customerId: '1' });
            expect(res.status).toBe(200);
        });

        it('returns 400 when customerId missing', async () => {
            const res = await request(app)
                .post('/api/integration/brain/people/1/link')
                .send({});
            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/integration/tasks', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/integration/tasks');
            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/integration/tasks', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/integration/tasks')
                .send({ name: 'Test Task' });
            expect(res.status).toBe(200);
        });

        it('returns 400 when name missing', async () => {
            const res = await request(app)
                .post('/api/integration/tasks')
                .send({});
            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/integration/channels/send', () => {
        it('returns 200 with valid data', async () => {
            const res = await request(app)
                .post('/api/integration/channels/send')
                .send({ channel: 'whatsapp', recipient: '123', content: 'Hello' });
            expect(res.status).toBe(200);
        });

        it('returns 400 when missing fields', async () => {
            const res = await request(app)
                .post('/api/integration/channels/send')
                .send({ channel: 'whatsapp' });
            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/integration/features/provider', () => {
        it('returns 200 with valid provider', async () => {
            const res = await request(app)
                .post('/api/integration/features/provider')
                .send({ provider: 'legacy' });
            expect(res.status).toBe(200);
        });

        it('returns 400 with invalid provider', async () => {
            const res = await request(app)
                .post('/api/integration/features/provider')
                .send({ provider: 'invalid' });
            expect(res.status).toBe(400);
        });

        // #1410 — espelho do teste da rota admin: a integração também passa pelo setter (que
        // persiste). A nota de resposta confirma persistência; sem essa asserção a regressão
        // para "runtime only" passaria despercebida.
        it('#1410: a resposta confirma persistência (nota "Survives server restart")', async () => {
            mockChannelRouter.setWhatsAppProvider.mockClear();
            mockChannelRouter.getWhatsAppProvider.mockReturnValue('moltbot');

            const res = await request(app)
                .post('/api/integration/features/provider')
                .send({ provider: 'moltbot' });

            expect(res.status).toBe(200);
            expect(mockChannelRouter.setWhatsAppProvider).toHaveBeenCalledWith('moltbot');
            expect(res.body.provider).toBe('moltbot');
            expect(res.body.note).toMatch(/Survives server restart/i);
        });
    });

    describe('GET /api/integration/features', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/integration/features');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/integration/sync/status', () => {
        it('returns 200', async () => {
            const res = await request(app).get('/api/integration/sync/status');
            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/integration/sync/run', () => {
        it('returns 200', async () => {
            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({});
            expect(res.status).toBe(200);
        });
    });
});