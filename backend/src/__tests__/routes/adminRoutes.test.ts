import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockConfigService = vi.hoisted(() => ({
    getAllModuleConfigs: vi.fn(() => ({})),
    setModuleConfigs: vi.fn(),
    getAllPrompts: vi.fn(() => ({})),
    setPrompts: vi.fn(),
    resetModulesToGlobal: vi.fn(),
    getFallbackChain: vi.fn((moduleName: string) => [moduleName === 'banking' ? 'google' : 'local']),
    setFallbackChain: vi.fn(),
    getAllFallbackChains: vi.fn(() => ({})),
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

const mockLlmHealthService = vi.hoisted(() => ({
    getStatus: vi.fn(() => []),
    getModuleChains: vi.fn(() => ({ chat: { chain: ['glm', 'minimax'], active: 'glm' } })),
    getStatusByModule: vi.fn((module: string) => ({
        chain: ['glm', 'minimax'],
        active: 'glm',
        providers: [],
    })),
}));

const mockLlmCallLogService = vi.hoisted(() => ({
    summary: vi.fn(() => ({ total: 0, errors: 0, fallbacks: 0, avgLatencyMs: 0, byModel: {}, byProvider: {} })),
    list: vi.fn(() => []),
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

vi.mock('../../services/llmHealthService', () => ({
    llmHealthService: mockLlmHealthService,
}));

vi.mock('../../services/llmCallLogService', () => ({
    llmCallLogService: mockLlmCallLogService,
}));

vi.mock('../../services/legacy/sessionService', () => ({
    sessionService: mockSessionService,
}));

const mockPinoInstance = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
}));

vi.mock('pino', () => ({
    default: () => mockPinoInstance,
}));

vi.mock('../../utils/logger', async (importActual) => {
    const actual = await importActual<typeof import('../../utils/logger')>();
    return {
        ...actual,
        createLogger: () => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }),
    };
});

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
import { logger, clearLogBuffer } from '../../utils/logger';

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

        it('sincroniza configService.moduleConfigs (regressao #784)', async () => {
            mockConfigService.resetModulesToGlobal.mockClear();
            const res = await request(app)
                .post('/api/admin/config/llm')
                .send({ provider: 'minimax', modelName: 'MiniMax-M3' });

            expect(res.status).toBe(200);
            expect(mockConfigService.resetModulesToGlobal).toHaveBeenCalledTimes(1);
        });
    });

    describe('GET /api/admin/logs', () => {
        beforeEach(() => {
            clearLogBuffer();
        });

        it('returns 200 with logs array', async () => {
            const res = await request(app).get('/api/admin/logs');

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('retorna entradas reais geradas via logger (timestamp ISO, level, message, meta)', async () => {
            logger.info('Backend started', { pid: 123 });
            logger.warn('Low memory');
            logger.error('DB down', { code: 'ECONNREFUSED' });

            const res = await request(app).get('/api/admin/logs?lines=200');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(3);
            expect(res.body[0]).toMatchObject({ level: 'info', message: 'Backend started', meta: { pid: 123 } });
            expect(res.body[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
            expect(res.body[1]).toMatchObject({ level: 'warn', message: 'Low memory', meta: null });
            expect(res.body[2]).toMatchObject({ level: 'error', message: 'DB down', meta: { code: 'ECONNREFUSED' } });
        });

        it('filtra por nível retornando apenas o subset correto', async () => {
            logger.info('info entry');
            logger.warn('warn entry');
            logger.error('error entry');
            logger.error('error entry 2');

            const res = await request(app).get('/api/admin/logs?lines=200&level=error');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
            expect(res.body.every((e: any) => e.level === 'error')).toBe(true);
        });

        it('filtra por nível de forma case-insensitive', async () => {
            logger.info('info entry');
            logger.warn('warn entry');

            const res = await request(app).get('/api/admin/logs?level=WARN');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].level).toBe('warn');
        });

        it('respeita ?lines limitando às entradas mais recentes', async () => {
            for (let i = 0; i < 10; i++) logger.info(`entry ${i}`);

            const res = await request(app).get('/api/admin/logs?lines=3');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(3);
            expect(res.body[2].message).toBe('entry 9');
        });

        it('level inexistente retorna array vazio', async () => {
            logger.info('info entry');

            const res = await request(app).get('/api/admin/logs?level=nonexistent');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it('é protegido por requireDolibarrAdmin (403 quando não-admin)', async () => {
            mockRequireDolibarrAdmin.mockImplementationOnce((_req: any, res: any) =>
                res.status(403).json({ error: 'admin required' }),
            );

            const res = await request(app).get('/api/admin/logs');

            expect(res.status).toBe(403);
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

        // #1410 — a rota passa pelo setter, e o setter atualiza memória + pede persistência ao
        // uiConfigService. A nota de resposta confirma p/ o admin que a mudança sobrevive ao
        // restart (não é teatro). Sem essa asserção, a mudança de UX ("Persistido, sobrevive ao
        // restart") poderia regredir silenciosamente.
        it('#1410: a resposta confirma persistência (nota "Survives server restart")', async () => {
            mockChannelRouter.setWhatsAppProvider.mockClear();
            mockChannelRouter.getWhatsAppProvider.mockReturnValue('moltbot');

            const res = await request(app)
                .post('/api/admin/config/features/provider')
                .send({ provider: 'moltbot' });

            expect(res.status).toBe(200);
            expect(mockChannelRouter.setWhatsAppProvider).toHaveBeenCalledWith('moltbot');
            expect(res.body.provider).toBe('moltbot');
            expect(res.body.note).toMatch(/Survives server restart/i);
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

    describe('GET /api/admin/llm-health', () => {
        it('retorna 200 com providers e modules', async () => {
            const res = await request(app).get('/api/admin/llm-health');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.providers)).toBe(true);
            expect(res.body.modules).toBeDefined();
            expect(mockLlmHealthService.getStatus).toHaveBeenCalled();
            expect(mockLlmHealthService.getModuleChains).toHaveBeenCalled();
        });

        it('com ?module=chat filtra pelo módulo', async () => {
            const res = await request(app).get('/api/admin/llm-health?module=chat');
            expect(res.status).toBe(200);
            expect(res.body.modules['chat']).toBeDefined();
            expect(mockLlmHealthService.getStatusByModule).toHaveBeenCalledWith('chat');
        });
    });

    describe('GET /api/admin/llm-calls (smoke — sem regressão do /logs)', () => {
        it('retorna 200 com entries', async () => {
            const res = await request(app).get('/api/admin/llm-calls?limit=10');

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.entries)).toBe(true);
            expect(mockLlmCallLogService.list).toHaveBeenCalled();
        });

        it('retorna summary quando ?summary=true', async () => {
            const res = await request(app).get('/api/admin/llm-calls?summary=true');

            expect(res.status).toBe(200);
            expect(res.body.summary).toBeDefined();
            expect(mockLlmCallLogService.summary).toHaveBeenCalled();
        });
    });
});
