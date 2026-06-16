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

vi.mock('../../services/agentTools', () => ({
    setToolCallListener: vi.fn(),
    runWithToolContext: (ctx: any, fn: () => Promise<any>) => {
        if (ctx?.listener) {
            ctx.listener('mock_tool', { test: true }, 'mock result', 50);
        }
        return fn();
    },
    TOOLS_PROMPT: '',
    executeTool: vi.fn(),
}));

vi.mock('../../services/agentActivityService', () => ({
    agentActivityService: {
        logActivity: vi.fn(),
        record: vi.fn(),
        getActivities: vi.fn(() => []),
    },
}));

vi.mock('../../services/chatSessionService', () => ({
    chatSessionService: {
        createSession: vi.fn(() => ({ id: 'mock_session' })),
        addMessage: vi.fn(),
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

    describe('toolListener userName resolution (#358)', () => {
        it('formats userName as firstname + lastname when both present', () => {
            const user = { id: '1', login: 'jdoe', firstname: 'John', lastname: 'Doe', email: 'j@t.com' };
            const userName = [user?.firstname, user?.lastname].filter(Boolean).join(' ') || user?.login || 'unknown';
            expect(userName).toBe('John Doe');
        });

        it('formats userName as firstname only when lastname missing', () => {
            const user = { id: '1', login: 'jdoe', firstname: 'John', email: 'j@t.com' } as any;
            const userName = [user?.firstname, user?.lastname].filter(Boolean).join(' ') || user?.login || 'unknown';
            expect(userName).toBe('John');
        });

        it('falls back to login when no firstname/lastname', () => {
            const user = { id: '1', login: 'jdoe', email: 'j@t.com' } as any;
            const userName = [user?.firstname, user?.lastname].filter(Boolean).join(' ') || user?.login || 'unknown';
            expect(userName).toBe('jdoe');
        });

        it('falls back to unknown when nothing is available', () => {
            const user = {} as any;
            const userId = user?.id || 'unknown';
            const userName = [user?.firstname, user?.lastname].filter(Boolean).join(' ') || user?.login || 'unknown';
            expect(userId).toBe('unknown');
            expect(userName).toBe('unknown');
        });

        it('uses user.id directly as userId', () => {
            const user = { id: '99', login: 'admin' } as any;
            const userId = user?.id || 'unknown';
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

        it('falls back to unknown when user is null', async () => {
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
                    userId: 'unknown',
                    userName: 'unknown',
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
});
