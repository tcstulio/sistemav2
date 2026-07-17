import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRequireDolibarrLogin = vi.hoisted(() => vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: '1', login: 'testadmin', admin: '1' };
    next();
}));

const mockRequireDolibarrAdmin = vi.hoisted(() => vi.fn((_req: any, _res: any, next: any) => next()));

const mockAiService = vi.hoisted(() => ({
    generateReply: vi.fn(() => ({ text: 'Generated reply text' })),
    analyzeSystem: vi.fn(() => 'System analysis result'),
    analyzeSentiment: vi.fn(() => ({ score: 0.8, label: 'positive' })),
    extractCustomerInfo: vi.fn(() => ({ name: 'John', email: 'john@test.com' })),
    extractReceiptData: vi.fn(() => ({ total: 100.50 })),
    analyzeFinancialHealth: vi.fn(() => 'Financial health report'),
    fixApiCall: vi.fn(() => 'Fixed API call suggestion'),
    generateCode: vi.fn(() => 'function example() {}'),
    transcribeAudio: vi.fn(() => 'Audio transcription text'),
    draftCollectionEmail: vi.fn(() => 'Collection email draft'),
    generateSalesForecast: vi.fn(() => 'Sales forecast report'),
    analyzeCustomerSentiment: vi.fn(() => 'Customer sentiment analysis'),
    auditProposal: vi.fn(() => 'Proposal audit result'),
    auditProject: vi.fn(() => 'Project audit result'),
    analyzeSystemLogs: vi.fn(() => 'Logs analysis result'),
    analyzeMonthlyReport: vi.fn(() => 'Monthly report analysis'),
}));

vi.mock('../../middleware/authMiddleware', () => ({
    requireDolibarrLogin: mockRequireDolibarrLogin,
    requireDolibarrAdmin: mockRequireDolibarrAdmin,
}));

vi.mock('../../services/aiService', () => ({
    aiService: mockAiService,
}));

vi.mock('../../services/dolibarr', () => ({
    dolibarrService: { findUserByLoginOrEmail: vi.fn(() => null) },
}));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }),
    logger: {
        child: () => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        }),
    },
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: {},
}));

const mockBootstrapStore = vi.hoisted(() => ({
    getConfig: vi.fn(() => ({ enabled: true, includeTasks: true, includeAgenda: true, includeFinancial: true, extraInstruction: '' })),
    updateConfig: vi.fn((p: any) => ({ enabled: true, includeTasks: true, includeAgenda: true, includeFinancial: true, extraInstruction: '', ...p })),
}));

vi.mock('../../services/agentBootstrapConfigStore', () => ({
    agentBootstrapConfigStore: mockBootstrapStore,
}));

vi.mock('../../services/agentTools', () => ({
    setToolCallListener: vi.fn(),
    runWithToolContext: mockRunWithToolContext,
    TOOLS_PROMPT: '',
    // #1498: aiService.ts agora importa getToolsPrompt direto (TOOLS_PROMPT virou wrapper
    // deprecated). Mock precisa expor getToolsPrompt pra não quebrar o import.
    getToolsPrompt: () => '',
    executeTool: mockExecuteTool,
}));

// #1500: hoist o mock de runWithToolContext para que possamos inspecionar (e mockar) os args
// passados a ele — incluindo `isAdmin` que #1500 exige propagar a partir de req.user.
const mockRunWithToolContext = vi.hoisted(() => vi.fn((ctx: any, fn: () => Promise<any>) => {
    if (ctx?.listener) {
        ctx.listener('mock_tool', { test: true }, 'mock result', 50);
    }
    return fn();
}));

// #1500: hoist o mock de executeTool — debug routes precisam ver ctx.isAdmin correto.
const mockExecuteTool = vi.hoisted(() => vi.fn(() => Promise.resolve('{}')));

// #1500: mock determinístico de `pdf-parse` para a rota /api/analyze/pdf sem introduzir
// refactor fora de escopo na produção (que continua `require('pdf-parse')`). O factory
// cria a função INLINE: se referenciássemos uma var de módulo, `vi.mock` (hoisted)
// capturaria ela em TDZ e `require('pdf-parse')` retornaria undefined. CJS default
// = módulo exporta a função chamável direta + `.default = fn` para tolerar troca futura
// para `await import()`.
vi.mock('pdf-parse', () => {
    const fn = vi.fn(async (_buf: any) => ({ text: 'conteúdo mock do PDF para teste #1500' }));
    (fn as any).default = fn;
    return fn;
});

vi.mock('../../services/agentActivityService', () => ({
    agentActivityService: {
        logActivity: vi.fn(),
        record: vi.fn(),
        getActivities: vi.fn(() => []),
    },
}));

const mockFinancialAnalysisStore = vi.hoisted(() => ({
    getAnalysis: vi.fn(() => null),
    getAutomationConfig: vi.fn(() => ({
        enabled: false,
        schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
        lastRunAt: null,
        lastRunStatus: null,
    })),
    saveAutomationConfig: vi.fn((updates: any) => ({ ...updates })),
}));

vi.mock('../../services/financialAnalysisStore', () => ({
    financialAnalysisStore: mockFinancialAnalysisStore,
}));

vi.mock('../../services/chatSessionService', () => ({
    chatSessionService: {
        createSession: vi.fn(() => ({ id: 'mock_session' })),
        addMessage: vi.fn(),
        getMessages: vi.fn(() => []),
        getSession: vi.fn(),
        getSessions: vi.fn(() => []),
        deleteSession: vi.fn(),
        deleteAllSessions: vi.fn(() => 0),
        deleteSessionsByUser: vi.fn(() => 0),
        getStats: vi.fn(() => ({ totalSessions: 0 })),
    },
}));

vi.mock('../../services/userPermissionsService', () => ({
    userPermissionsService: {
        getProfile: vi.fn(() => Promise.resolve({ role: 'admin', agent: { canCreate: ['all'], canEdit: ['all'], canValidate: ['all'], canDelete: [], canSendEmail: true, canSendWhatsapp: true, canAccessFinancial: true, canAccessAccounting: true, canAccessHR: true, canManageWebhooks: true, canCreateIssues: true, canStartTasks: true, canMergePRs: true, maxInvoiceAmount: null, maxOrderAmount: null, restrictedCustomers: [], restrictedProjects: [] } })),
        getProfileForContext: vi.fn(() => Promise.resolve('Admin profile')),
    },
}));

import aiRoutes from '../../routes/aiRoutes';

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', aiRoutes);
    return app;
}

// Espera um job assíncrono (/generate-reply-async) atingir estado terminal.
async function waitForJob(app: express.Application, jobId: string, timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(app).get(`/api/jobs/${jobId}`);
        if (res.body.status === 'done' || res.body.status === 'error') return res.body;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`Job ${jobId} não terminou em ${timeoutMs}ms`);
}

describe('aiRoutes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp();
    });

    describe('GET /api/prefill (deeplink HITL #57)', () => {
        it('resolve um token válido devolvendo { kind, data }', async () => {
            const { signDeeplink } = await import('../../utils/deeplinkToken');
            const token = signDeeplink('create_customer', { name: 'Fulano' }, 600);
            const res = await request(app).get('/api/prefill').query({ token });
            expect(res.status).toBe(200);
            expect(res.body.kind).toBe('create_customer');
            expect(res.body.data.name).toBe('Fulano');
        });

        it('rejeita token inválido/expirado com 400', async () => {
            const res = await request(app).get('/api/prefill').query({ token: 'garbage' });
            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/generate-reply', () => {
        it('returns 200 with reply', async () => {
            const res = await request(app)
                .post('/api/generate-reply')
                .send({ context: 'Hello, I need help' });

            expect(res.status).toBe(200);
            expect(res.body.reply).toBeDefined();
        });

        it('returns 200 even when body is empty (all fields optional)', async () => {
            const res = await request(app)
                .post('/api/generate-reply')
                .send({});

            expect(res.status).toBe(200);
        });

        it('returns 500 when service throws', async () => {
            mockAiService.generateReply.mockRejectedValue(new Error('AI service error'));

            const res = await request(app)
                .post('/api/generate-reply')
                .send({ context: 'test' });

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/analyze-system', () => {
        it('returns 200 with result', async () => {
            const res = await request(app)
                .post('/api/analyze-system')
                .send({ query: 'Analyze system performance' });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 400 when query is missing', async () => {
            const res = await request(app)
                .post('/api/analyze-system')
                .send({});

            expect(res.status).toBe(400);
        });

        it('returns 500 when service throws', async () => {
            mockAiService.analyzeSystem.mockRejectedValue(new Error('Analysis failed'));

            const res = await request(app)
                .post('/api/analyze-system')
                .send({ query: 'test' });

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/analyze-sentiment', () => {
        it('returns 200 with sentiment result', async () => {
            const res = await request(app)
                .post('/api/analyze-sentiment')
                .send({ text: 'I love this product!' });

            expect(res.status).toBe(200);
            expect(res.body.score).toBeDefined();
        });

        it('returns 400 when text is missing', async () => {
            const res = await request(app)
                .post('/api/analyze-sentiment')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/extract/customer', () => {
        it('returns 200 with extracted customer info', async () => {
            const res = await request(app)
                .post('/api/extract/customer')
                .send({ text: 'Customer John from Company ABC' });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 400 when text is missing', async () => {
            const res = await request(app)
                .post('/api/extract/customer')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/extract/receipt', () => {
        it('returns 200 with receipt data', async () => {
            const res = await request(app)
                .post('/api/extract/receipt')
                .send({ image: 'base64imageencoded' });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 400 when image is missing', async () => {
            const res = await request(app)
                .post('/api/extract/receipt')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/analyze/financial', () => {
        it('returns 200 with financial analysis', async () => {
            const res = await request(app)
                .post('/api/analyze/financial')
                .send({ data: { invoices: [] } });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 200 even when data is missing (data can be any type)', async () => {
            const res = await request(app)
                .post('/api/analyze/financial')
                .send({});

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/fix/api-call', () => {
        it('returns 200 with fixed API call suggestion', async () => {
            const res = await request(app)
                .post('/api/fix/api-call')
                .send({ log: { method: 'GET', url: '/api/test' } });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 200 even when log is missing (z.any() allows any)', async () => {
            const res = await request(app)
                .post('/api/fix/api-call')
                .send({});

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/generate/code', () => {
        it('returns 200 with generated code', async () => {
            const res = await request(app)
                .post('/api/generate/code')
                .send({ endpoint: '/api/users', method: 'GET' });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 400 when endpoint is missing', async () => {
            const res = await request(app)
                .post('/api/generate/code')
                .send({ method: 'GET' });

            expect(res.status).toBe(400);
        });

        it('returns 400 when method is missing', async () => {
            const res = await request(app)
                .post('/api/generate/code')
                .send({ endpoint: '/api/users' });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/transcribe-audio', () => {
        it('returns 200 with transcription', async () => {
            const res = await request(app)
                .post('/api/transcribe-audio')
                .send({ audio: 'base64audioencoded' });

            expect(res.status).toBe(200);
            expect(res.body.transcription).toBeDefined();
        });

        it('returns 400 when audio is missing', async () => {
            const res = await request(app)
                .post('/api/transcribe-audio')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/draft/collection-email', () => {
        it('returns 200 with email draft', async () => {
            const res = await request(app)
                .post('/api/draft/collection-email')
                .send({ customer: { name: 'John' }, amount: 100 });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 400 when amount is missing', async () => {
            const res = await request(app)
                .post('/api/draft/collection-email')
                .send({ customer: { name: 'John' } });

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/analyze/sales-forecast', () => {
        it('returns 200 with sales forecast', async () => {
            const res = await request(app)
                .post('/api/analyze/sales-forecast')
                .send({ invoices: [] });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 400 when invoices is missing', async () => {
            const res = await request(app)
                .post('/api/analyze/sales-forecast')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/analyze/sales-forecast-async', () => {
        it('enfileira e retorna 202 com jobId', async () => {
            const res = await request(app)
                .post('/api/analyze/sales-forecast-async')
                .send({ invoices: [] });

            expect(res.status).toBe(202);
            expect(res.body.jobId).toBeDefined();
            expect(res.body.status).toBe('queued');
        });

        it('retorna 400 quando invoices está ausente', async () => {
            const res = await request(app)
                .post('/api/analyze/sales-forecast-async')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/analyze/customer-sentiment', () => {
        it('returns 200 with sentiment analysis', async () => {
            const res = await request(app)
                .post('/api/analyze/customer-sentiment')
                .send({ customer: {}, invoices: [] });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 200 even when customer is missing (z.any() allows any)', async () => {
            const res = await request(app)
                .post('/api/analyze/customer-sentiment')
                .send({ invoices: [] });

            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/analyze/financial-analysis/latest', () => {
        it('returns 200 with null when never ran', async () => {
            mockFinancialAnalysisStore.getAnalysis.mockReturnValue(null);
            const res = await request(app).get('/api/analyze/financial-analysis/latest');
            expect(res.status).toBe(200);
            expect(res.body).toBeNull();
        });

        it('returns 200 with the last persisted snapshot', async () => {
            const snapshot = { data: { revenue: 1000 }, lastRunAt: '2025-06-17T10:00:00.000Z', status: 'success' };
            mockFinancialAnalysisStore.getAnalysis.mockReturnValue(snapshot);
            const res = await request(app).get('/api/analyze/financial-analysis/latest');
            expect(res.status).toBe(200);
            expect(res.body).toEqual(snapshot);
            expect(mockFinancialAnalysisStore.getAnalysis).toHaveBeenCalled();
        });

        it('returns 500 when store throws', async () => {
            mockFinancialAnalysisStore.getAnalysis.mockImplementation(() => { throw new Error('disk error'); });
            const res = await request(app).get('/api/analyze/financial-analysis/latest');
            expect(res.status).toBe(500);
            expect(res.body.error).toBe('disk error');
        });
    });

    describe('GET /api/analyze/financial-analysis/automation-config', () => {
        it('returns 200 with default config', async () => {
            const cfg = { enabled: false, schedule: { dayOfWeek: 1, hour: 8, minute: 0 }, lastRunAt: null, lastRunStatus: null };
            mockFinancialAnalysisStore.getAutomationConfig.mockReturnValue(cfg);
            const res = await request(app).get('/api/analyze/financial-analysis/automation-config');
            expect(res.status).toBe(200);
            expect(res.body).toEqual(cfg);
            expect(mockFinancialAnalysisStore.getAutomationConfig).toHaveBeenCalled();
        });

        it('returns 500 when store throws', async () => {
            mockFinancialAnalysisStore.getAutomationConfig.mockImplementation(() => { throw new Error('boom'); });
            const res = await request(app).get('/api/analyze/financial-analysis/automation-config');
            expect(res.status).toBe(500);
        });
    });

    describe('PUT /api/analyze/financial-analysis/automation-config', () => {
        it('com payload válido (enabled + schedule) retorna 200 e config persistida', async () => {
            const persisted = {
                enabled: true,
                schedule: { dayOfWeek: 3, hour: 14, minute: 30 },
                lastRunAt: null,
                lastRunStatus: null,
            };
            mockFinancialAnalysisStore.saveAutomationConfig.mockReturnValue(persisted);

            const res = await request(app)
                .put('/api/analyze/financial-analysis/automation-config')
                .send({ enabled: true, schedule: { dayOfWeek: 3, hour: 14, minute: 30 } });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(persisted);
            expect(mockFinancialAnalysisStore.saveAutomationConfig).toHaveBeenCalledTimes(1);
            expect(mockFinancialAnalysisStore.saveAutomationConfig).toHaveBeenCalledWith({
                enabled: true,
                schedule: { dayOfWeek: 3, hour: 14, minute: 30 },
            });
        });

        it('updates enabled and returns 200 with merged config', async () => {
            const merged = { enabled: true, schedule: { dayOfWeek: 1, hour: 8, minute: 0 }, lastRunAt: null, lastRunStatus: null };
            mockFinancialAnalysisStore.saveAutomationConfig.mockReturnValue(merged);
            const res = await request(app)
                .put('/api/analyze/financial-analysis/automation-config')
                .send({ enabled: true });
            expect(res.status).toBe(200);
            expect(res.body).toEqual(merged);
            expect(mockFinancialAnalysisStore.saveAutomationConfig).toHaveBeenCalledWith({ enabled: true });
        });

        it('updates schedule and returns 200', async () => {
            const merged = { enabled: false, schedule: { dayOfWeek: 5, hour: 9, minute: 15 }, lastRunAt: null, lastRunStatus: null };
            mockFinancialAnalysisStore.saveAutomationConfig.mockReturnValue(merged);
            const res = await request(app)
                .put('/api/analyze/financial-analysis/automation-config')
                .send({ schedule: { dayOfWeek: 5, hour: 9, minute: 15 } });
            expect(res.status).toBe(200);
            expect(res.body.schedule).toEqual({ dayOfWeek: 5, hour: 9, minute: 15 });
        });

        it('returns 400 when schedule values are out of range', async () => {
            const res = await request(app)
                .put('/api/analyze/financial-analysis/automation-config')
                .send({ schedule: { dayOfWeek: 9, hour: 0, minute: 0 } });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Validation Error');
            expect(mockFinancialAnalysisStore.saveAutomationConfig).not.toHaveBeenCalled();
        });

        it('returns 400 when body is empty (no updatable fields)', async () => {
            const res = await request(app)
                .put('/api/analyze/financial-analysis/automation-config')
                .send({});
            expect(res.status).toBe(400);
        });

        it('returns 400 when enabled is wrong type', async () => {
            const res = await request(app)
                .put('/api/analyze/financial-analysis/automation-config')
                .send({ enabled: 'yes' });
            expect(res.status).toBe(400);
        });

        it('returns 500 when store throws', async () => {
            mockFinancialAnalysisStore.saveAutomationConfig.mockImplementation(() => { throw new Error('save fail'); });
            const res = await request(app)
                .put('/api/analyze/financial-analysis/automation-config')
                .send({ enabled: true });
            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Falha ao salvar configuração de automação');
            expect(res.body.details).toBe('save fail');
        });
    });

    describe('POST /api/audit/proposal', () => {
        it('returns 200 with proposal audit', async () => {
            const res = await request(app)
                .post('/api/audit/proposal')
                .send({ proposal: { id: 1, amount: 500 } });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 200 even when proposal is missing (z.any() allows any)', async () => {
            const res = await request(app)
                .post('/api/audit/proposal')
                .send({});

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/audit/project', () => {
        it('returns 200 with project audit', async () => {
            const res = await request(app)
                .post('/api/audit/project')
                .send({ project: { id: 1, name: 'Test Project' } });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 200 even when project is missing (z.any() allows any)', async () => {
            const res = await request(app)
                .post('/api/audit/project')
                .send({});

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/analyze/logs', () => {
        it('returns 200 with logs analysis', async () => {
            const res = await request(app)
                .post('/api/analyze/logs')
                .send({ logs: [{ level: 'error', message: 'Failed' }] });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 400 when logs is missing', async () => {
            const res = await request(app)
                .post('/api/analyze/logs')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/analyze/monthly-report', () => {
        it('returns 200 with monthly report analysis', async () => {
            const res = await request(app)
                .post('/api/analyze/monthly-report')
                .send({ data: { month: 'January' } });

            expect(res.status).toBe(200);
            expect(res.body.result).toBeDefined();
        });

        it('returns 200 even when data is missing (z.any() allows any)', async () => {
            const res = await request(app)
                .post('/api/analyze/monthly-report')
                .send({});

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/sessions', () => {
        it('creates a new chat session', async () => {
            const res = await request(app)
                .post('/api/sessions')
                .send({ firstMessage: 'Hello' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
        });
    });

    describe('GET /api/sessions', () => {
        it('returns list of sessions', async () => {
            const res = await request(app)
                .get('/api/sessions');

            expect(res.status).toBe(200);
            expect(res.body.data).toBeDefined();
        });

        it('accepts limit query param', async () => {
            const res = await request(app)
                .get('/api/sessions?limit=10');

            expect(res.status).toBe(200);
        });
    });

    describe('DELETE /api/sessions (bulk)', () => {
        it('deletes all sessions and returns count', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            (chatSessionService.deleteAllSessions as ReturnType<typeof vi.fn>).mockReturnValue(5);

            const res = await request(app)
                .delete('/api/sessions');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.deletedCount).toBe(5);
        });

        it('returns 500 when service throws', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            (chatSessionService.deleteAllSessions as ReturnType<typeof vi.fn>).mockImplementation(() => {
                throw new Error('Disk error');
            });

            const res = await request(app)
                .delete('/api/sessions');

            expect(res.status).toBe(500);
        });
    });

    describe('toolListener userName resolution (#358/#544)', () => {
        it('formats userName as firstname + lastname when both present', () => {
            const user = { id: '1', login: 'jdoe', firstname: 'John', lastname: 'Doe', email: 'j@t.com' };
            const userName = [user?.firstname, user?.lastname].filter(Boolean).join(' ') || user?.login || 'Agente';
            expect(userName).toBe('John Doe');
        });

        it('formats userName as firstname only when lastname missing', () => {
            const user = { id: '1', login: 'jdoe', firstname: 'John', email: 'j@t.com' } as any;
            const userName = [user?.firstname, user?.lastname].filter(Boolean).join(' ') || user?.login || 'Agente';
            expect(userName).toBe('John');
        });

        it('falls back to login when no firstname/lastname', () => {
            const user = { id: '1', login: 'jdoe', email: 'j@t.com' } as any;
            const userName = [user?.firstname, user?.lastname].filter(Boolean).join(' ') || user?.login || 'Agente';
            expect(userName).toBe('jdoe');
        });

        it('falls back to "Agente" (never "unknown") when nothing is available', () => {
            const user = {} as any;
            const dolibarrUserId = '';
            const userId = user?.id || dolibarrUserId || '';
            const userName = [user?.firstname, user?.lastname].filter(Boolean).join(' ') || user?.login || 'Agente';
            expect(userId).toBe('');
            expect(userName).toBe('Agente');
        });

        it('uses user.id directly as userId', () => {
            const user = { id: '99', login: 'admin' } as any;
            const dolibarrUserId = '';
            const userId = user?.id || dolibarrUserId || '';
            expect(userId).toBe('99');
        });
    });

    describe('toolListener integration: record is called with real user data (#358)', () => {
        it('records userId and userName from user directly (not userData)', async () => {
            mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
                req.user = { id: '42', login: 'jdoe', firstname: 'John', lastname: 'Doe', admin: '0' };
                next();
            });

            await request(app)
                .post('/api/generate-reply')
                .send({ sessionId: 'sess_123', module: 'chat', context: 'test' });

            const { agentActivityService } = await import('../../services/agentActivityService');
            expect(agentActivityService.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: '42',
                    userName: 'John Doe',
                })
            );
        });

        it('falls back to login when firstname/lastname are absent', async () => {
            mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
                req.user = { id: '7', login: 'admin', admin: '1' };
                next();
            });

            await request(app)
                .post('/api/generate-reply')
                .send({ sessionId: 'sess_456', module: 'chat', context: 'test' });

            const { agentActivityService } = await import('../../services/agentActivityService');
            expect(agentActivityService.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: '7',
                    userName: 'admin',
                })
            );
        });

        it('(#544) falls back to "Agente" (never "unknown") when user is null', async () => {
            mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
                req.user = null;
                next();
            });

            await request(app)
                .post('/api/generate-reply')
                .send({ sessionId: 'sess_789', module: 'chat', context: 'test' });

            const { agentActivityService } = await import('../../services/agentActivityService');
            expect(agentActivityService.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: '',
                    userName: 'Agente',
                })
            );
        });

        it('(#544) usa dolibarrUserId resolvido quando user.id está ausente (nunca "unknown")', async () => {
            mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
                req.user = { login: 'jdoe', firstname: 'John', lastname: 'Doe', admin: '0' };
                next();
            });
            const { dolibarrService } = await import('../../services/dolibarr');
            (dolibarrService.findUserByLoginOrEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: '300', login: 'jdoe' });

            await request(app)
                .post('/api/generate-reply')
                .send({ sessionId: 'sess_doli', module: 'chat', context: 'test' });

            const { agentActivityService } = await import('../../services/agentActivityService');
            expect(agentActivityService.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: '300',
                    userName: 'John Doe',
                })
            );
        });

        it('does not call record when sessionId is absent (listener is null)', async () => {
            const { agentActivityService } = await import('../../services/agentActivityService');
            (agentActivityService.record as ReturnType<typeof vi.fn>).mockClear();

            await request(app)
                .post('/api/generate-reply')
                .send({ context: 'test' });

            expect(agentActivityService.record).not.toHaveBeenCalled();
        });
    });

    describe('enrichedContext: data e hora atual (#417)', () => {
        it('inclui "Data e hora atual" no contexto passado ao aiService', async () => {
            await request(app)
                .post('/api/generate-reply')
                .send({ context: 'test' });

            expect(mockAiService.generateReply).toHaveBeenCalledTimes(1);
            const contextArg = mockAiService.generateReply.mock.calls[0][1];
            expect(contextArg).toContain('Data e hora atual');
        });
    });

    describe('isAdmin security (#417): non-admin must NOT be treated as admin', () => {
        it('user with admin=0 is NOT admin (context shows "Admin: Não")', async () => {
            mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
                req.user = { id: '2', login: 'regular', admin: 0 };
                next();
            });

            await request(app)
                .post('/api/generate-reply')
                .send({ context: 'test' });

            const contextArg = mockAiService.generateReply.mock.calls[0][1];
            expect(contextArg).toContain('Admin: Não');
            expect(contextArg).not.toContain('Admin: Sim');
        });

        it('user with admin="0" is NOT admin', async () => {
            mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
                req.user = { id: '3', login: 'regular2', admin: '0' };
                next();
            });

            await request(app)
                .post('/api/generate-reply')
                .send({ context: 'test' });

            const contextArg = mockAiService.generateReply.mock.calls[0][1];
            expect(contextArg).toContain('Admin: Não');
        });

        it('user with admin=1 IS admin (context shows "Admin: Sim")', async () => {
            mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
                req.user = { id: '4', login: 'admin2', admin: 1 };
                next();
            });

            await request(app)
                .post('/api/generate-reply')
                .send({ context: 'test' });

            const contextArg = mockAiService.generateReply.mock.calls[0][1];
            expect(contextArg).toContain('Admin: Sim');
        });
    });

    describe('DELETE /api/sessions/:id', () => {
        it('deletes a single session', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            (chatSessionService.getSession as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'chat_123', userId: '1' });
            (chatSessionService.deleteSession as ReturnType<typeof vi.fn>).mockReturnValue(true);

            const res = await request(app)
                .delete('/api/sessions/chat_123');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 404 when session not found', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            (chatSessionService.getSession as ReturnType<typeof vi.fn>).mockReturnValue(null);
            (chatSessionService.deleteSession as ReturnType<typeof vi.fn>).mockReturnValue(false);

            const res = await request(app)
                .delete('/api/sessions/nonexistent');

            expect(res.status).toBe(404);
        });
    });

    describe('Agent bootstrap config (#300 item 3)', () => {
        it('GET /api/agent/bootstrap-config returns the config', async () => {
            const res = await request(app).get('/api/agent/bootstrap-config');
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ enabled: true, includeTasks: true });
        });

        it('PUT /api/agent/bootstrap-config updates the config', async () => {
            const res = await request(app)
                .put('/api/agent/bootstrap-config')
                .send({ enabled: false, includeFinancial: false });
            expect(res.status).toBe(200);
            expect(mockBootstrapStore.updateConfig).toHaveBeenCalledWith({ enabled: false, includeFinancial: false });
            expect(res.body.enabled).toBe(false);
        });

        it('PUT rejects invalid payload with 400', async () => {
            const res = await request(app)
                .put('/api/agent/bootstrap-config')
                .send({ enabled: 'yes' });
            expect(res.status).toBe(400);
        });
    });

    // =====================================================
    // issue #1151: histórico autoritativo do servidor + persistência pré-enqueue
    // =====================================================
    describe('issue #1151: servidor autoritativo + persistência da msg antes do enqueue', () => {
        beforeEach(() => {
            // Outros describes deste arquivo usam mockRejectedValue (persistente: o
            // clearAllMocks global não reseta implementação), o que vazava para cá.
            // Garante estado "feliz" limpo para os testes que validam sucesso.
            mockAiService.generateReply.mockResolvedValue({ text: 'Generated reply text' });
        });

        it('persiste a msg do usuário ANTES de enfileirar (POST /generate-reply-async)', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            const res = await request(app)
                .post('/api/generate-reply-async')
                .send({ sessionId: 'sess_1151', message: 'busque ACME', module: 'chat' });

            expect(res.status).toBe(202);
            // A persistência da msg do usuário é síncrona, antes do enqueue → já aconteceu
            // quando o 202 foi devolvido.
            expect(chatSessionService.addMessage).toHaveBeenCalledWith('sess_1151', expect.objectContaining({
                role: 'user',
                content: 'busque ACME',
            }));
        });

        it('a ordem na tabela é: user (antes do enqueue) ANTES de model (após o job)', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            const start = await request(app)
                .post('/api/generate-reply-async')
                .send({ sessionId: 'sess_ord', message: 'msg1', module: 'chat' });
            await waitForJob(app, start.body.jobId);

            const calls = (chatSessionService.addMessage as ReturnType<typeof vi.fn>).mock.calls;
            const userCallIdx = calls.findIndex((c: any[]) => c[1]?.role === 'user');
            const modelCallIdx = calls.findIndex((c: any[]) => c[1]?.role === 'model');
            expect(userCallIdx).toBeGreaterThanOrEqual(0);
            expect(modelCallIdx).toBeGreaterThanOrEqual(0);
            expect(userCallIdx).toBeLessThan(modelCallIdx);
        });

        it('ignora o history do cliente e monta o contexto do LLM a partir de getMessages (servidor)', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            (chatSessionService.getMessages as ReturnType<typeof vi.fn>).mockReturnValue([
                { role: 'user', content: 'busque ACME' },
                { role: 'model', content: 'ACME encontrada' },
                { role: 'user', content: 'crie a fatura pra ele' },
            ]);

            await request(app)
                .post('/api/generate-reply')
                .send({
                    sessionId: 'sess_ctx',
                    message: 'crie a fatura pra ele',
                    // history do cliente propositalmente DIVERGENTE — deve ser ignorado
                    history: [{ role: 'user', parts: 'histórico obsoleto do cliente' }],
                    module: 'chat',
                });

            expect(mockAiService.generateReply).toHaveBeenCalledTimes(1);
            const historyArg = mockAiService.generateReply.mock.calls[0][0];
            expect(historyArg).toEqual([
                { role: 'user', parts: 'busque ACME' },
                { role: 'model', parts: 'ACME encontrada' },
                { role: 'user', parts: 'crie a fatura pra ele' },
            ]);
            // nada vindo do history do cliente
            expect(JSON.stringify(historyArg)).not.toContain('histórico obsoleto do cliente');
        });

        it('msg2 recebe no contexto a resposta de msg1 (getMessages autoritativo)', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            (chatSessionService.getMessages as ReturnType<typeof vi.fn>).mockReturnValue([
                { role: 'user', content: 'busque ACME' },
                { role: 'model', content: 'Encontrei a ACME Ltda.' },
                { role: 'user', content: 'crie a fatura pra ele' },
            ]);

            await request(app)
                .post('/api/generate-reply')
                .send({ sessionId: 'sess_turn', message: 'crie a fatura pra ele', module: 'chat' });

            const historyArg = mockAiService.generateReply.mock.calls[0][0];
            expect(historyArg).toEqual(
                expect.arrayContaining([
                    { role: 'user', parts: 'busque ACME' },
                    { role: 'model', parts: 'Encontrei a ACME Ltda.' },
                    { role: 'user', parts: 'crie a fatura pra ele' },
                ])
            );
        });

        it('erro do job → persiste msg de erro na sessão (não fica muda)', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            mockAiService.generateReply.mockRejectedValueOnce(new Error('LLM boom'));

            const res = await request(app)
                .post('/api/generate-reply')
                .send({ sessionId: 'sess_err', message: 'quebre aqui', module: 'chat' });

            expect(res.status).toBe(500);
            // usuário persistido (pré-enqueue) + mensagem de erro do assistente
            expect(chatSessionService.addMessage).toHaveBeenCalledWith('sess_err', expect.objectContaining({
                role: 'user',
                content: 'quebre aqui',
            }));
            expect(chatSessionService.addMessage).toHaveBeenCalledWith('sess_err', expect.objectContaining({
                role: 'model',
                content: expect.stringContaining('LLM boom'),
            }));
        });

        it('cliente envia apenas {sessionId, message} (sem history) e funciona', async () => {
            const res = await request(app)
                .post('/api/generate-reply')
                .send({ sessionId: 'sess_min', message: 'olá', module: 'chat' });

            expect(res.status).toBe(200);
            expect(res.body.reply).toBeDefined();
        });

        it('sem sessionId mantém comportamento legado (usa history do cliente, não persiste)', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            const legacyHistory = [{ role: 'user', parts: 'pergunta legada' }];

            await request(app)
                .post('/api/generate-reply')
                .send({ history: legacyHistory, module: 'chat' });

            const historyArg = mockAiService.generateReply.mock.calls[0][0];
            expect(historyArg).toEqual(legacyHistory);
            expect(chatSessionService.addMessage).not.toHaveBeenCalled();
        });

        it('persiste a msg do usuário antes do enqueue também na rota síncrona', async () => {
            const { chatSessionService } = await import('../../services/chatSessionService');
            await request(app)
                .post('/api/generate-reply')
                .send({ sessionId: 'sess_sync', message: 'msg sync', module: 'chat' });

            expect(chatSessionService.addMessage).toHaveBeenCalledWith('sess_sync', expect.objectContaining({
                role: 'user',
                content: 'msg sync',
            }));
            // e a resposta do assistente também é persistida
            expect(chatSessionService.addMessage).toHaveBeenCalledWith('sess_sync', expect.objectContaining({
                role: 'model',
            }));
        });
    });
});

// =====================================================
// #1011: heartbeat do job — cada tool-call do agente vira reportProgress(jobId),
// atualizando lastHeartbeat p/ o cliente detectar liveness via GET /api/ai-jobs/:id/status.
// =====================================================
describe('#1011: heartbeat do job via reportProgress (tool-call = progresso)', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        // Garante estado "feliz" (outros describes usam mockRejectedValue que persiste).
        mockAiService.generateReply.mockResolvedValue({ text: 'Generated reply text' });
        app = createApp();
    });

    it('cada tool-call do job assíncrono dispara reportProgress(jobId)', async () => {
        const { aiJobService } = await import('../../services/aiJobService');
        const spy = vi.spyOn(aiJobService, 'reportProgress');

        const res = await request(app)
            .post('/api/generate-reply-async')
            .send({ sessionId: 'sess_hb', message: 'olá', module: 'chat' });

        expect(res.status).toBe(202);
        await waitForJob(app, res.body.jobId);

        // o listener de tool-calls (mockado p/ disparar 1x) chamou reportProgress(jobId).
        expect(spy).toHaveBeenCalledWith(res.body.jobId);
        spy.mockRestore();
    });

    it('rota síncrona (sem jobId) não atualiza heartbeat (jobId ausente)', async () => {
        const { aiJobService } = await import('../../services/aiJobService');
        const spy = vi.spyOn(aiJobService, 'reportProgress');

        await request(app)
            .post('/api/generate-reply')
            .send({ sessionId: 'sess_sync_hb', message: 'olá', module: 'chat' });

        // mesmo com listener ativo (chat session), o jobId é undefined no path síncrono
        // -> o guard `if (jobId)` bloqueia reportProgress.
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

// =====================================================
// #1500: propagação de isAdmin do req.user até o aiService.
//
// Quando #1498 introduziu DEV_TOOLS e o gate de `getToolsPrompt({ isAdmin })`, a propagação
// ficou implícita no chat path (runChatReply já chamava runWithToolContext({ isAdmin }))
// mas os outros handlers (analyze-system, extract/customer, transcribe-audio, etc.) chamavam
// `aiService.X(...)` sem contexto de tool — ou seja, isAdmin ficava undefined para essas
// rotas. Esta suíte cobre:
//   - admin=true → runWithToolContext({ isAdmin: true, ... })
//   - admin=false/0 → runWithToolContext({ isAdmin: false, ... })
//   - /analyze/pdf propaga isAdmin (usava aiService.generateReply direto, era bug)
//   - /debug/execute-tool propaga isAdmin (gate de DEV_TOOLS depende disso)
//   - req.user.admin ausente → isAdmin=false (fail-closed; não promove ninguém a admin)
// =====================================================
describe('#1500: propagação de isAdmin do req.user até aiService', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        // #1500: vi.clearAllMocks() NÃO limpa implementations — re-estabelece explicitamente
        // o estado "feliz" para CADA método aiService. Sem isso, o `mockRejectedValue` que os
        // describes de 500-error aplicam (uma única vez) persiste e quebra os testes daqui.
        mockAiService.generateReply.mockResolvedValue({ text: 'Generated reply text' });
        mockAiService.analyzeSystem.mockResolvedValue('System analysis result');
        mockAiService.analyzeSentiment.mockResolvedValue({ score: 0.8, label: 'positive' });
        mockAiService.extractCustomerInfo.mockResolvedValue({ name: 'John', email: 'john@test.com' });
        mockAiService.extractReceiptData.mockResolvedValue({ total: 100.50 });
        mockAiService.analyzeFinancialHealth.mockResolvedValue('Financial health report');
        mockAiService.fixApiCall.mockResolvedValue('Fixed API call suggestion');
        mockAiService.generateCode.mockResolvedValue('function example() {}');
        mockAiService.transcribeAudio.mockResolvedValue('Audio transcription text');
        mockAiService.draftCollectionEmail.mockResolvedValue('Collection email draft');
        mockAiService.generateSalesForecast.mockResolvedValue('Sales forecast report');
        mockAiService.analyzeCustomerSentiment.mockResolvedValue('Customer sentiment analysis');
        mockAiService.auditProposal.mockResolvedValue('Proposal audit result');
        mockAiService.auditProject.mockResolvedValue('Project audit result');
        mockAiService.analyzeSystemLogs.mockResolvedValue('Logs analysis result');
        mockAiService.analyzeMonthlyReport.mockResolvedValue('Monthly report analysis');
        app = createApp();
    });

    // Helper: último ctx passado a runWithToolContext após a requisição.
    async function lastContext(reqFn: () => Promise<any>): Promise<any> {
        mockRunWithToolContext.mockClear();
        const res = await reqFn();
        if (res && res.status && res.status >= 400) {
            throw new Error(`Request failed: ${res.status} ${JSON.stringify(res.body)}`);
        }
        const calls = mockRunWithToolContext.mock.calls;
        if (calls.length === 0) throw new Error('runWithToolContext não foi chamado');
        return calls[calls.length - 1][0];
    }

    it('admin="1": /api/generate-reply propaga isAdmin=true', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '10', login: 'admin_user', firstname: 'A', lastname: 'D', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/generate-reply').send({ context: 'oi' }));
        expect(ctx.isAdmin).toBe(true);
        expect(ctx.userLogin).toBe('admin_user');
        expect(ctx.userId).toBe('10');
    });

    it('admin="0": /api/generate-reply propaga isAdmin=false', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '20', login: 'common_user', admin: '0' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/generate-reply').send({ context: 'oi' }));
        expect(ctx.isAdmin).toBe(false);
        expect(ctx.userLogin).toBe('common_user');
    });

    it('admin=1 (number): /api/generate-reply propaga isAdmin=true', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '11', login: 'admin_num', admin: 1 };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/generate-reply').send({ context: 'oi' }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/generate-reply-async (job assíncrono) também propaga isAdmin=true', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '30', login: 'admin_async', admin: '1' };
            next();
        });
        mockRunWithToolContext.mockClear();
        const res = await request(app)
            .post('/api/generate-reply-async')
            .send({ sessionId: 'sess_async_1500', message: 'oi', module: 'chat' });
        expect(res.status).toBe(202);
        // Job roda em background — espera terminar para que `withUserToolContext` seja chamado.
        await waitForJob(app, res.body.jobId);
        const calls = mockRunWithToolContext.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        // A última chamada deve ter isAdmin=true (vinda de req.user propagada via wrapper).
        const ctx = calls[calls.length - 1][0];
        expect(ctx.isAdmin).toBe(true);
        expect(ctx.userLogin).toBe('admin_async');
    });

    it('/api/analyze/pdf (que usa aiService.generateReply direto) propaga isAdmin=true', async () => {
        // ANTES de #1500: /analyze/pdf chamava aiService.generateReply SEM runWithToolContext,
        // então aiService via `getToolContext().isAdmin === undefined` -> prompt não-admin
        // (sem DEV_TOOLS) mesmo para admin. Esta é a regressão corrigida.
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '40', login: 'admin_pdf', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze/pdf').send({ pdf: Buffer.from('hi').toString('base64') }));
        expect(ctx.isAdmin).toBe(true);
        expect(ctx.userLogin).toBe('admin_pdf');
    });

    it('/api/analyze/pdf com não-admin propaga isAdmin=false', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '41', login: 'common_pdf', admin: '0' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze/pdf').send({ pdf: Buffer.from('hi').toString('base64') }));
        expect(ctx.isAdmin).toBe(false);
    });

    it('/api/analyze-system propaga isAdmin=true (admin)', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '50', login: 'admin_sys', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze-system').send({ query: 'q' }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/analyze-system propaga isAdmin=false (não-admin)', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '51', login: 'common_sys', admin: '0' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze-system').send({ query: 'q' }));
        expect(ctx.isAdmin).toBe(false);
    });

    it('/api/analyze-sentiment propaga isAdmin', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '60', login: 'admin_sent', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze-sentiment').send({ text: 'oi' }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/extract/customer propaga isAdmin=false', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '70', login: 'common_cust', admin: '0' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/extract/customer').send({ text: 'Fulano' }));
        expect(ctx.isAdmin).toBe(false);
    });

    it('/api/extract/receipt propaga isAdmin=true (admin via number)', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '80', login: 'admin_receipt', admin: 1 };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/extract/receipt').send({ image: 'AAAA' }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/analyze/financial propaga isAdmin', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '90', login: 'admin_fin', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze/financial').send({ data: { a: 1 } }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/fix/api-call propaga isAdmin=false', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '100', login: 'common_fix', admin: '0' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/fix/api-call').send({ log: {} }));
        expect(ctx.isAdmin).toBe(false);
    });

    it('/api/generate/code propaga isAdmin=true', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '110', login: 'admin_code', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/generate/code').send({ endpoint: '/x', method: 'GET' }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/transcribe-audio propaga isAdmin', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '120', login: 'admin_audio', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/transcribe-audio').send({ audio: 'AAAA' }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/draft/collection-email propaga isAdmin=false', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '130', login: 'common_draft', admin: '0' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/draft/collection-email').send({ customer: {}, amount: 10 }));
        expect(ctx.isAdmin).toBe(false);
    });

    it('/api/analyze/sales-forecast propaga isAdmin=true', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '140', login: 'admin_fc', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze/sales-forecast').send({ invoices: [] }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/analyze/customer-sentiment propaga isAdmin', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '150', login: 'admin_cs', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze/customer-sentiment').send({ customer: {}, invoices: [] }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/audit/proposal propaga isAdmin', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '160', login: 'admin_aud', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/audit/proposal').send({ proposal: {} }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/audit/project propaga isAdmin', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '170', login: 'common_aud', admin: '0' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/audit/project').send({ project: {} }));
        expect(ctx.isAdmin).toBe(false);
    });

    it('/api/analyze/logs propaga isAdmin', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '180', login: 'admin_logs', admin: '1' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze/logs').send({ logs: [] }));
        expect(ctx.isAdmin).toBe(true);
    });

    it('/api/analyze/monthly-report propaga isAdmin', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '190', login: 'common_mr', admin: '0' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze/monthly-report').send({ data: {} }));
        expect(ctx.isAdmin).toBe(false);
    });

    it('req.user sem campo `admin` → isAdmin=false (fail-closed)', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '200', login: 'sem_flag' };
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze-system').send({ query: 'q' }));
        expect(ctx.isAdmin).toBe(false);
    });

    it('req.user=null → isAdmin=false (não crasha)', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = null;
            next();
        });
        const ctx = await lastContext(() => request(app).post('/api/analyze-system').send({ query: 'q' }));
        expect(ctx.isAdmin).toBe(false);
        expect(ctx.userId).toBe('');
        expect(ctx.userLogin).toBe('unknown');
    });

    // Não deve existir rota pública/anônima chamando aiService (#1500 item 3 — fail-closed).
    // Mesmo assim, testamos /prefill: se um dia virar pública chamando aiService, queremos
    // um "red" explícito para revisitar esta suíte.
    it('sanidade: nenhuma rota /api/* chamada sem middleware de auth chega no aiService', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((_req: any, _res: any, next: any) => {
            _res.status(401).json({ error: 'mocked-reject' });
            // Não chama next() — simula bloqueio de auth.
        });
        mockRunWithToolContext.mockClear();
        const res = await request(app).post('/api/analyze-system').send({ query: 'q' });
        expect(res.status).toBe(401);
        expect(mockRunWithToolContext).not.toHaveBeenCalled();
    });

    // Critérios de aceite da issue #1500:
    //  "Admin autenticado → prompt completo (todas as tools)."
    //  "Usuário comum autenticado → prompt sem DEV_TOOLS."
    //
    // Como getToolsPrompt é chamado dentro de aiService (mockado nos testes), validamos o
    // CONTRATO do wrapper propagando o flag correto — a chain prompt → tools é exercida nos
    // testes de integração end-to-end. Aqui garantimos que o flag chega ao context.
    it('chain completa: admin=true propaga até o context antes de chamar aiService.generateReply', async () => {
        mockRequireDolibarrLogin.mockImplementationOnce((req: any, _res: any, next: any) => {
            req.user = { id: '300', login: 'admin_chain', admin: '1' };
            next();
        });
        await request(app).post('/api/generate-reply').send({ context: 'oi' });
        const call = mockRunWithToolContext.mock.calls[mockRunWithToolContext.mock.calls.length - 1];
        const ctx = call[0];
        // isAdmin EXPLICITAMENTE true, não undefined. Garante bypass do gate de #1408.
        expect(ctx.isAdmin).toBe(true);
        // como o mock apenas chama fn() (sem preservar ctx) — o importante aqui é que
        // o wrapper **propagou** o boolean certo; o use real via AsyncLocalStorage.
        expect(typeof ctx.isAdmin).toBe('boolean');
    });
});
