import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    // #1569: authMiddleware real popula req.user — replicamos para que o log de
    // userId em /sync/run tenha um valor determinístico nos testes.
    (req as any).user = { id: 'u-1', login: 'tester' };
    next();
}));

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

// #1569 (critério #5): Logger mock acessível para inspeção — a rota /sync/run
// deve logar cada chamada com entity/autoCreate/autoLink/dryRun/userId. Sem
// expor este mock, o teste só consegue validar o envelope, não a auditoria.
const mockLogger = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
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
    createLogger: () => mockLogger,
}));

vi.mock('../../config/features', () => ({
    FEATURES: mockFeATURES,
    isUsingMoltbot: vi.fn(() => false),
    isTulipaActive: vi.fn(() => true),
    getAllFeatures: vi.fn(() => ({})),
}));

import integrationRoutes from '../../routes/integrationRoutes';
// #1569: preset REAL de middleware/rateLimit.ts + errorHandler global — mesmas
// instâncias usadas em server.ts, para validar o rate limit de sync end-to-end.
import { errorHandler } from '../../middleware/errorHandler';
import { rateLimiters } from '../../middleware/rateLimit';

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

    describe('POST /api/integration/sync/run (#1569)', () => {
        beforeEach(() => {
            mockSyncService.isEnabled.mockReturnValue(true);
            mockSyncService.getPeopleWithMatches.mockResolvedValue([]);
            mockSyncService.syncAll.mockResolvedValue({
                success: true, matched: 0, created: 0, updated: 0, failed: 0, errors: [], details: []
            });
        });

        // ADAPTADO (#1569): o body mínimo válido agora exige `entity` + (autoCreate=true
        // OU dryRun=true). A asserção equivalente (request válido → 200) é preservada com
        // um payload que satisfaz o novo schema.
        it('returns 200 with a valid body (dryRun preview)', async () => {
            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'customer', dryRun: true });
            expect(res.status).toBe(200);
        });

        // Critério de aceite #1569: dryRun=true retorna preview SEM persistir.
        it('dryRun=true returns preview envelope and does NOT persist (syncAll not called)', async () => {
            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'customer', dryRun: true });

            expect(res.status).toBe(200);
            // #1569: envelope padrão { success, data }.
            expect(res.body.success).toBe(true);
            expect(res.body.data.dryRun).toBe(true);
            expect(res.body.data.entity).toBe('customer');
            // Preview computado via getPeopleWithMatches (read-only).
            expect(mockSyncService.getPeopleWithMatches).toHaveBeenCalledTimes(1);
            // dryRun JAMAIS persiste — syncAll não pode ser chamado.
            expect(mockSyncService.syncAll).not.toHaveBeenCalled();
        });

        // Critério de aceite #1569: { entity:'customer', autoCreate:false } (sem dryRun) → 400.
        it('returns 400 when autoCreate=false and dryRun omitted (refine rule)', async () => {
            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'customer', autoCreate: false });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            // Mensagem exigida pelo critério de aceite.
            const refineDetail = res.body.error.details.find((d: any) => /autoCreate=false/i.test(d.message));
            expect(refineDetail).toBeDefined();
            expect(refineDetail.message).toMatch(/Quando autoCreate=false, dryRun deve ser true/);
            expect(mockSyncService.syncAll).not.toHaveBeenCalled();
        });

        // Critério de aceite #1569: entity fora do enum → 400.
        it('returns 400 when entity is outside the enum', async () => {
            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'unknown', dryRun: true });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when entity is missing', async () => {
            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ dryRun: true });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('returns 400 when limit is out of range (> 500)', async () => {
            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'customer', dryRun: true, limit: 501 });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        // autoCreate=true satisfaz o refine (dryRun pode ficar default false) → executa sync real.
        it('executes real sync when autoCreate=true (dryRun defaults to false)', async () => {
            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'customer', autoCreate: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.dryRun).toBe(false);
            expect(mockSyncService.syncAll).toHaveBeenCalledWith({ autoCreate: true, autoLink: true });
            // syncAll chamado, preview NÃO.
            expect(mockSyncService.getPeopleWithMatches).not.toHaveBeenCalled();
        });

        it('`limit` caps the number of records considered in dryRun preview', async () => {
            mockSyncService.getPeopleWithMatches.mockResolvedValue([
                { brainPerson: { id: '1' }, dolibarrCustomer: null, confidence: 'none' },
                { brainPerson: { id: '2' }, dolibarrCustomer: null, confidence: 'none' },
                { brainPerson: { id: '3' }, dolibarrCustomer: null, confidence: 'none' },
            ]);

            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'customer', dryRun: true, limit: 2 });

            expect(res.status).toBe(200);
            expect(res.body.data.preview.totalAvailable).toBe(3);
            expect(res.body.data.preview.totalConsidered).toBe(2);
            // Sem autoCreate/autoLink match → todos skipped.
            expect(res.body.data.preview.wouldSkip).toBe(2);
        });

        it('non-customer entity returns preview with note (no data source yet)', async () => {
            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'product', dryRun: true });

            expect(res.status).toBe(200);
            expect(res.body.data.preview.totalAvailable).toBe(0);
            expect(res.body.data.preview.note).toMatch(/product/i);
        });

        it('logs the call with entity/autoCreate/autoLink/dryRun/userId (#1569 critério #5)', async () => {
            // #1569: a rota deve logar cada chamada com entity, autoCreate, autoLink,
            // dryRun e userId. Aqui validamos de verdade (não só o envelope) inspecionando
            // o mock do logger — cobrindo o critério de aceite #5 que era stub antes.
            mockLogger.info.mockClear();

            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'invoice', autoCreate: true, autoLink: false });

            expect(res.status).toBe(200);
            expect(res.body.data.entity).toBe('invoice');
            expect(res.body.data.autoCreate).toBe(true);
            expect(res.body.data.autoLink).toBe(false);

            // Auditoria: primeira chamada de log.info carrega TODOS os campos exigidos
            // pela issue (#1569): entity, autoCreate, autoLink, dryRun, userId.
            const auditCall = mockLogger.info.mock.calls.find(
                (args: any[]) => typeof args[0] === 'string' && /sync\/run invoked/i.test(args[0])
            );
            expect(auditCall).toBeDefined();
            const auditPayload = auditCall![1];
            expect(auditPayload).toMatchObject({
                entity: 'invoice',
                autoCreate: true,
                autoLink: false,
                dryRun: false,
                userId: 'tester'
            });
        });

        it('returns 400 (envelope) when sync is not enabled', async () => {
            mockSyncService.isEnabled.mockReturnValue(false);

            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'customer', dryRun: true });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });
});

// =====================================================
// #1569: syncLimiter — 31ª chamada em 1min retorna 429.
// O limiter é montado em /api/integration/sync no server.ts. Aqui replicamos o
// mount com a MESMA instância `rateLimiters.sync` (single source) + errorHandler
// global para validar o critério de aceite end-to-end (envelope RATE_LIMIT).
// =====================================================
describe('#1569: syncLimiter — 31ª chamada em 1min → 429', () => {
    function createAppWithSyncLimiter() {
        const app = express();
        app.use(express.json());
        // Mesmo mount order de server.ts: limiter no prefixo /sync antes do router.
        app.use('/api/integration/sync', rateLimiters.sync);
        app.use('/api/integration', integrationRoutes);
        app.use(errorHandler);
        return app;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockSyncService.isEnabled.mockReturnValue(true);
        mockSyncService.getPeopleWithMatches.mockResolvedValue([]);
        mockSyncService.syncAll.mockResolvedValue({
            success: true, matched: 0, created: 0, updated: 0, failed: 0, errors: [], details: []
        });
    });

    it('30 chamadas OK; a 31ª retorna 429 (envelope RATE_LIMIT)', async () => {
        const app = createAppWithSyncLimiter();

        for (let i = 0; i < 30; i++) {
            const res = await request(app)
                .post('/api/integration/sync/run')
                .send({ entity: 'customer', dryRun: true });
            expect(res.status).toBe(200);
        }

        const blocked = await request(app)
            .post('/api/integration/sync/run')
            .send({ entity: 'customer', dryRun: true });

        expect(blocked.status).toBe(429);
        // #1569: 429 renderizado pelo errorHandler no envelope padronizado.
        expect(blocked.body.success).toBe(false);
        expect(blocked.body.error.code).toBe('RATE_LIMIT');
        expect(typeof blocked.body.error.message).toBe('string');
        expect(blocked.body.error.message.length).toBeGreaterThan(0);
    });
});