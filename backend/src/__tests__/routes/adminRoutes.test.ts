import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockConfigService = vi.hoisted(() => ({
    getAllModuleConfigs: vi.fn(() => ({})),
    setModuleConfigs: vi.fn(),
    getAllPrompts: vi.fn(() => ({})),
    setPrompts: vi.fn(),
}));

vi.mock('../../services/configService', () => ({
    configService: mockConfigService,
}));

const mockSessionService = vi.hoisted(() => ({
    getStatus: vi.fn(),
    startSession: vi.fn(),
}));

const mockRequireDolibarrAdmin = vi.hoisted(() => vi.fn((req: any, res: any, next: any) => next()));

const mockGetAllFeatures = vi.hoisted(() => vi.fn(() => ({})));
const mockIsUsingMoltbot = vi.hoisted(() => vi.fn(() => false));
const mockIsTulipaActive = vi.hoisted(() => vi.fn(() => false));
const mockLogFeatures = vi.hoisted(() => vi.fn());
// objeto mutável: o handler /integration/brain/stats checa FEATURES.TULIPA_ENABLED diretamente.
const mockFeatures = vi.hoisted(() => ({ MOLTBOT_ENABLED: false, TULIPA_ENABLED: false, WHATSAPP_PROVIDER: 'legacy' }));

const mockChannelRouter = vi.hoisted(() => ({
    getWhatsAppProvider: vi.fn(() => 'legacy'),
    setWhatsAppProvider: vi.fn(),
    getAllChannelsStatus: vi.fn(() => []),
}));

const mockMoltbotGateway = vi.hoisted(() => ({
    getStatus: vi.fn(() => ({ healthy: true, uptime: 1000 })),
}));

const mockTulipaService = vi.hoisted(() => ({
    getQuickStatus: vi.fn(() => ({ healthy: true })),
    getSystemStatus: vi.fn(() => ({ healthy: true, uptime: 500 })),
    getEventsStats: vi.fn(() => ({})),
    getBrainSummary: vi.fn(() => ({})),
}));

const mockAiService = vi.hoisted(() => ({
    getModels: vi.fn(() => ['gemini-1.5-flash']),
    setConfig: vi.fn(),
    analyzeSystem: vi.fn(() => 'AI response'),
}));

const mockUserPermsService = vi.hoisted(() => {
    const sample = {
        role: 'usuario', dolibarrModules: {}, frontendScreens: {},
        agent: {
            canCreate: [], canEdit: [], canValidate: [], canDelete: [],
            canSendEmail: false, canSendWhatsapp: false, canAccessFinancial: false,
            canAccessAccounting: false, canAccessHR: false, canManageWebhooks: false,
            canCreateIssues: false, canStartTasks: false, canMergePRs: false,
            maxInvoiceAmount: null, maxOrderAmount: null, restrictedCustomers: [], restrictedProjects: [],
        },
        computedAt: '2026-01-01T00:00:00.000Z',
    };
    return {
        getProfile: vi.fn(async () => JSON.parse(JSON.stringify(sample))),
        invalidateCache: vi.fn(),
    };
});

const mockDolibarrSvc = vi.hoisted(() => ({
    setUserPermissionProfile: vi.fn(async () => ({ id: '5' })),
}));

const mockAdminAudit = vi.hoisted(() => ({
    record: vi.fn(() => ({ id: 'a1', ts: 0 })),
    list: vi.fn(() => [{ id: 'a1', ts: 1, adminId: '1', adminLogin: 'admin', action: 'user.permissions.update', target: '5' }]),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrAdmin: mockRequireDolibarrAdmin,
}));

vi.mock('../../config/features', () => ({
    FEATURES: mockFeatures,
    getAllFeatures: mockGetAllFeatures,
    isUsingMoltbot: mockIsUsingMoltbot,
    isTulipaActive: mockIsTulipaActive,
    logFeatures: mockLogFeatures,
}));

vi.mock('../../services/channelRouter', () => ({
    channelRouter: mockChannelRouter,
}));

vi.mock('../../services/moltbotGateway', () => ({
    moltbotGateway: mockMoltbotGateway,
}));

vi.mock('../../services/tulipaService', () => ({
    tulipaService: mockTulipaService,
}));

vi.mock('../../services/aiService', () => ({
    aiService: mockAiService,
}));

vi.mock('../../services/userPermissionsService', () => ({
    userPermissionsService: mockUserPermsService,
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: mockDolibarrSvc,
}));

vi.mock('../../services/adminAuditService', () => ({
    adminAuditService: mockAdminAudit,
}));

vi.mock('../../services/legacy/sessionService', () => ({
    sessionService: mockSessionService,
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

// importActual preserva as demais funções de os (hostname, cpus, etc.) que o Node/Express
// usam internamente ao montar a resposta; sobrescreve só as 4 que o handler /status usa.
vi.mock('os', async (importActual) => {
    const actual = await importActual<typeof import('os')>();
    const overrides = {
        platform: () => 'linux',
        release: () => '5.15.0',
        totalmem: () => 16000000000,
        freemem: () => 8000000000,
    };
    return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

// path correto (relativo ao teste) + campos completos p/ modelForProvider. vi.mock cobre
// tambem o require() dinamico de configService/env feito dentro do adminRoutes.
vi.mock('../../config/env', () => ({
    config: {
        llmProvider: 'google',
        localLlmUrl: 'http://localhost:11434',
        googleApiKey: 'test-key',
        localModelName: 'llama3',
        geminiModel: 'gemini-2.0-flash',
        zaiApiKey: 'test-zai', zaiBaseUrl: 'https://api.z.ai/', zaiModel: 'glm-5.1',
        minimaxApiKey: 'test-mm', minimaxBaseUrl: 'https://api.minimax.io/', minimaxModel: 'MiniMax-M3',
        adminKey: 'test-admin', deeplinkSecret: 'test-admin',
    },
}));

import adminRoutes from '../../routes/adminRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    return app;
}

describe('adminRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    describe('GET /api/admin/status', () => {
        it('returns 200 with system status', async () => {
            mockSessionService.getStatus.mockResolvedValue('RUNNING');

            const res = await request(app).get('/api/admin/status');

            expect(res.status).toBe(200);
            expect(res.body.uptime).toBeDefined();
            expect(res.body.timestamp).toBeDefined();
            expect(res.body.system).toBeDefined();
            expect(res.body.services).toBeDefined();
        });

        it('returns wahaStatus UNREACHABLE on error', async () => {
            mockSessionService.getStatus.mockRejectedValue(new Error('Connection failed'));

            const res = await request(app).get('/api/admin/status');

            expect(res.status).toBe(200);
            expect(res.body.services.waha).toBe('UNREACHABLE');
        });
    });

    describe('permissões do agente por usuário', () => {
        it('GET /api/admin/users/:id/permissions retorna o perfil', async () => {
            const res = await request(app).get('/api/admin/users/5/permissions');
            expect(res.status).toBe(200);
            expect(res.body.agent).toBeDefined();
            expect(mockUserPermsService.getProfile).toHaveBeenCalledWith('5');
        });

        it('PUT mescla o patch no agent, persiste, invalida cache e retorna o merged', async () => {
            const res = await request(app)
                .put('/api/admin/users/5/permissions')
                .send({ agent: { maxInvoiceAmount: 1000, canCreate: ['invoice'] } });
            expect(res.status).toBe(200);
            expect(res.body.agent.maxInvoiceAmount).toBe(1000);
            expect(res.body.agent.canCreate).toEqual(['invoice']);
            expect(res.body.agent.canEdit).toEqual([]); // campo ausente no patch é preservado (merge)
            expect(mockDolibarrSvc.setUserPermissionProfile).toHaveBeenCalledWith(
                '5', expect.objectContaining({ agent: expect.objectContaining({ maxInvoiceAmount: 1000 }) }),
            );
            expect(mockUserPermsService.invalidateCache).toHaveBeenCalledWith('5');
        });

        it('PUT rejeita valor negativo com 400 (Validation Error)', async () => {
            const res = await request(app)
                .put('/api/admin/users/5/permissions')
                .send({ agent: { maxInvoiceAmount: -50 } });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Validation Error');
            expect(mockDolibarrSvc.setUserPermissionProfile).not.toHaveBeenCalled();
        });

        it('PUT registra uma entrada de auditoria', async () => {
            await request(app)
                .put('/api/admin/users/5/permissions')
                .send({ agent: { maxInvoiceAmount: 1000 } });
            expect(mockAdminAudit.record).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'user.permissions.update', target: '5' }),
            );
        });

        it('GET /api/admin/audit retorna as entradas', async () => {
            const res = await request(app).get('/api/admin/audit');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.entries)).toBe(true);
            expect(mockAdminAudit.list).toHaveBeenCalled();
        });
    });

    describe('POST /api/admin/restart', () => {
        it('returns 200 when restart succeeds', async () => {
            mockSessionService.startSession.mockResolvedValue(undefined);

            const res = await request(app).post('/api/admin/restart');

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('success');
        });

        it('returns 500 when restart fails', async () => {
            mockSessionService.startSession.mockRejectedValue(new Error('Failed to start'));

            const res = await request(app).post('/api/admin/restart');

            expect(res.status).toBe(500);
            expect(res.body.status).toBe('error');
        });
    });

    describe('GET /api/admin/config/llm', () => {
        it('returns 200 with LLM config', async () => {
            const res = await request(app).get('/api/admin/config/llm');

            expect(res.status).toBe(200);
            expect(res.body.provider).toBeDefined();
        });
    });

    describe('GET /api/admin/config/llm/models', () => {
        it('returns 200 with models list', async () => {
            const res = await request(app).get('/api/admin/config/llm/models');

            expect(res.status).toBe(200);
            expect(res.body.models).toBeDefined();
        });

        it('returns 500 when provider fetch fails', async () => {
            mockAiService.getModels.mockRejectedValue(new Error('Failed to fetch'));

            const res = await request(app).get('/api/admin/config/llm/models');

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/admin/config/llm/test', () => {
        it('returns 400 for invalid provider', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm/test')
                .send({ provider: 'invalid' });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/admin/config/llm', () => {
        it('returns 200 when switching to local provider', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm')
                .send({ provider: 'local', url: 'http://localhost:11434', modelName: 'llama3' });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('success');
        });

        it('returns 200 when switching to google provider', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm')
                .send({ provider: 'google', key: 'test-key' });

            expect(res.status).toBe(200);
        });

        it('returns 400 for invalid provider', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm')
                .send({ provider: 'openai' });

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/admin/logs', () => {
        it('returns 200 with logs array', async () => {
            const res = await request(app).get('/api/admin/logs');

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });
    });

    describe('GET /api/admin/config/llm/modules', () => {
        it('returns 200 with module configs', async () => {
            const res = await request(app).get('/api/admin/config/llm/modules');

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/admin/config/llm/modules', () => {
        it('returns 200 when modules are set', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm/modules')
                .send({ modules: { chat: { provider: 'google' } } });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 when modules format is invalid', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm/modules')
                .send({ modules: 'invalid' });

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/admin/config/llm/prompts', () => {
        it('returns 200 with prompts', async () => {
            const res = await request(app).get('/api/admin/config/llm/prompts');

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/admin/config/llm/prompts', () => {
        it('returns 200 when prompts are set', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm/prompts')
                .send({ prompts: { system: 'You are a helpful assistant' } });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 when prompts format is invalid', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm/prompts')
                .send({ prompts: null });

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/admin/config/llm/stats', () => {
        it('returns 200 with stats', async () => {
            const res = await request(app).get('/api/admin/config/llm/stats');

            expect(res.status).toBe(200);
            expect(res.body.callsToday).toBeDefined();
        });
    });

    describe('POST /api/admin/config/llm/stats/track', () => {
        it('returns 200 when tracking succeeds', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm/stats/track')
                .send({ tokens: 100, error: null });

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/admin/config/llm/playground', () => {
        it('returns 200 when prompt is valid', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm/playground')
                .send({ prompt: 'Hello AI' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 when prompt is missing', async () => {
            const res = await request(app)
                .post('/api/admin/config/llm/playground')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/admin/config/features', () => {
        it('returns 200 with features', async () => {
            const res = await request(app).get('/api/admin/config/features');

            expect(res.status).toBe(200);
            expect(res.body.features).toBeDefined();
            expect(res.body.computed).toBeDefined();
        });
    });

    describe('POST /api/admin/config/features/provider', () => {
        it('returns 200 when switching to moltbot', async () => {
            const res = await request(app)
                .post('/api/admin/config/features/provider')
                .send({ provider: 'moltbot' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 for invalid provider', async () => {
            const res = await request(app)
                .post('/api/admin/config/features/provider')
                .send({ provider: 'invalid' });

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/admin/integration/status', () => {
        it('returns 200 with integration status', async () => {
            const res = await request(app).get('/api/admin/integration/status');

            expect(res.status).toBe(200);
            expect(res.body.features).toBeDefined();
            expect(res.body.services).toBeDefined();
        });

        it('returns 500 when service throws', async () => {
            mockMoltbotGateway.getStatus.mockRejectedValue(new Error('Service error'));

            const res = await request(app).get('/api/admin/integration/status');

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/admin/integration/test', () => {
        it('returns 200 with test results', async () => {
            const res = await request(app).post('/api/admin/integration/test');

            expect(res.status).toBe(200);
            expect(res.body.moltbot).toBeDefined();
            expect(res.body.tulipa).toBeDefined();
        });
    });

    describe('GET /api/admin/integration/brain/stats', () => {
        it('returns 200 when tulipa is enabled', async () => {
            mockFeatures.TULIPA_ENABLED = true;

            const res = await request(app).get('/api/admin/integration/brain/stats');

            expect(res.status).toBe(200);
            mockFeatures.TULIPA_ENABLED = false;
        });

        it('returns 400 when tulipa is disabled', async () => {
            mockIsTulipaActive.mockReturnValue(false);

            const res = await request(app).get('/api/admin/integration/brain/stats');

            expect(res.status).toBe(400);
        });
    });
});
