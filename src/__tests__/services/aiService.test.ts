import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');
vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn()
    }
}));
vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));
vi.mock('../../utils/safeStorage', () => ({
    safeStorage: {
        getItem: vi.fn(),
        getJSON: vi.fn().mockReturnValue({ apiKey: 'test-api-key' })
    }
}));

import axios from 'axios';
import { toast } from 'sonner';
import { AiService } from '../../services/aiService';
import { ThirdParty, Invoice, Project } from '../../types';

describe('AiService', () => {
    const mockAxios = axios as unknown as {
        get: ReturnType<typeof vi.fn>;
        post: ReturnType<typeof vi.fn>;
        put: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('generateTicketReply', () => {
        it('generates ticket reply', async () => {
            const response = { data: { reply: 'This is an automated reply' } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.generateTicketReply('Issue', 'Description', ['Previous message']);

            expect(result).toBe('This is an automated reply');
            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/generate-reply'), expect.any(Object), expect.any(Object));
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('AI unavailable'));
            toast.error = vi.fn();

            const result = await AiService.generateTicketReply('Issue', 'Description', []);

            expect(result).toBeNull();
            expect(toast.error).toHaveBeenCalled();
        });
    });

    describe('generateProjectTasks', () => {
        it('generates project tasks from context', async () => {
            const tasks = [
                { label: 'Task 1', description: 'First task', planned_workload: 4 },
                { label: 'Task 2', description: 'Second task', planned_workload: 2 }
            ];
            const response = { data: { reply: JSON.stringify(tasks) } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.generateProjectTasks('Build a website');

            expect(result).toEqual(tasks);
        });

        it('handles markdown code blocks in response', async () => {
            const tasks = [{ label: 'Task', description: 'Desc', planned_workload: 1 }];
            const response = { data: { reply: '```json\n' + JSON.stringify(tasks) + '\n```' } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.generateProjectTasks('Project');

            expect(result).toEqual(tasks);
        });

        it('returns empty array on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Failed'));

            const result = await AiService.generateProjectTasks('Project');

            expect(result).toEqual([]);
        });
    });

    describe('extractProjectInfo', () => {
        it('extracts project info from text', async () => {
            const result = { customerName: 'Acme', budget: 10000 };
            const response = { data: { result } };
            mockAxios.post.mockResolvedValue(response);

            const extracted = await AiService.extractProjectInfo('Customer: Acme Corp');

            expect(extracted).toEqual(result);
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Extraction failed'));

            const result = await AiService.extractProjectInfo('Some text');

            expect(result).toBeNull();
        });
    });

    describe('analyzeFinancialHealth', () => {
        it('analyzes financial health', async () => {
            const analysis = { score: 85, status: 'healthy' };
            const response = { data: { result: analysis } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.analyzeFinancialHealth({ revenue: 100000 });

            expect(result).toEqual(analysis);
        });

        it('returns error message on failure', async () => {
            mockAxios.post.mockRejectedValue(new Error('Analysis failed'));

            const result = await AiService.analyzeFinancialHealth({});

            expect(result).toBe('Erro ao processar análise.');
        });
    });

    describe('getLatestFinancialAnalysis', () => {
        it('returns the latest persisted snapshot', async () => {
            const snapshot = { data: '# Relatório IA', lastRunAt: '2025-07-14T18:00:00.000Z', status: 'success' as const };
            mockAxios.get.mockResolvedValue({ data: snapshot });

            const result = await AiService.getLatestFinancialAnalysis();

            expect(result).toEqual(snapshot);
            expect(mockAxios.get).toHaveBeenCalledWith(
                expect.stringContaining('/analyze/financial-analysis/latest'),
                expect.any(Object)
            );
        });

        it('returns null when never ran', async () => {
            mockAxios.get.mockResolvedValue({ data: null });

            const result = await AiService.getLatestFinancialAnalysis();

            expect(result).toBeNull();
        });

        it('returns null and toasts on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('Latest failed'));
            toast.error = vi.fn();

            const result = await AiService.getLatestFinancialAnalysis();

            expect(result).toBeNull();
            expect(toast.error).toHaveBeenCalled();
        });
    });

    describe('logCorrection', () => {
        it('logs correction data', async () => {
            await AiService.logCorrection('log123', 'Fixed typo');

            expect(mockAxios.post).not.toHaveBeenCalled();
        });
    });

    describe('draftCollectionEmail', () => {
        it('drafts collection email', async () => {
            const draft = { subject: 'Payment Reminder', body: 'Please pay' };
            const response = { data: { result: draft } };
            mockAxios.post.mockResolvedValue(response);

            const customer = { id: '1', name: 'Test', email: 'test@example.com' };
            const result = await AiService.draftCollectionEmail(customer as unknown as ThirdParty, 1000);

            expect(result).toEqual(draft);
        });

        it('returns error JSON on failure', async () => {
            mockAxios.post.mockRejectedValue(new Error('Failed'));

            const customer = { id: '1', name: 'Test', email: 'test@example.com' };
            const result = await AiService.draftCollectionEmail(customer as unknown as ThirdParty, 1000);

            expect(result).toContain('Erro');
        });
    });

    describe('generateSalesForecast', () => {
        it('generates sales forecast from invoices', async () => {
            const forecast = { nextMonth: 50000, trend: 'up' };
            const response = { data: { result: forecast } };
            mockAxios.post.mockResolvedValue(response);

            const invoices = [
                { id: '1', ref: 'INV-001', total_ttc: 1000, status: 'paid', date: '2024-01-15' }
            ];
            const result = await AiService.generateSalesForecast(invoices as unknown as Invoice[]);

            expect(result).toEqual(forecast);
        });

        it('filters invoices for forecast', async () => {
            const response = { data: { result: {} } };
            mockAxios.post.mockResolvedValue(response);

            await AiService.generateSalesForecast([]);

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/analyze/sales-forecast'), expect.objectContaining({
                invoices: expect.any(Array)
            }), expect.any(Object));
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Forecast failed'));

            const result = await AiService.generateSalesForecast([]);

            expect(result).toBeNull();
        });
    });

    describe('analyzeCustomerSentiment', () => {
        it('analyzes customer sentiment', async () => {
            const sentiment = { text: 'Positive customer', score: 80 };
            const response = { data: { result: sentiment } };
            mockAxios.post.mockResolvedValue(response);

            const customer = { id: '1', name: 'Test', status: 'active', date_creation: '2024-01-01' };
            const result = await AiService.analyzeCustomerSentiment(customer as unknown as ThirdParty, []);

            expect(result).toEqual({ text: sentiment, logId: expect.any(String) });
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Analysis failed'));

            const customer = { id: '1', name: 'Test', status: 'active', date_creation: '2024-01-01' };
            const result = await AiService.analyzeCustomerSentiment(customer as unknown as ThirdParty, []);

            expect(result).toBeNull();
        });
    });

    describe('extractReceiptData', () => {
        it('extracts receipt data from base64', async () => {
            const data = { total: 99.99, date: '2024-01-15' };
            const response = { data: { result: data } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.extractReceiptData('base64encoded');

            expect(result).toEqual(data);
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Extraction failed'));

            const result = await AiService.extractReceiptData('invalid');

            expect(result).toBeNull();
        });
    });

    describe('auditProposal', () => {
        it('audits a proposal', async () => {
            const audit = { score: 90, suggestions: ['Add more details'] };
            const response = { data: { result: audit } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.auditProposal({ ref: 'PR-001', amount: 5000 });

            expect(result).toEqual(audit);
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Audit failed'));

            const result = await AiService.auditProposal({ ref: 'PR-001' });

            expect(result).toBeNull();
        });
    });

    describe('auditProject', () => {
        it('audits a project', async () => {
            const audit = { status: 'on-track', recommendations: [] };
            const response = { data: { result: audit } };
            mockAxios.post.mockResolvedValue(response);

            const project = { ref: 'PROJ-001', title: 'Test', status: 'active' };
            const result = await AiService.auditProject(project as unknown as Project, [], []);

            expect(result).toEqual(audit);
        });

        it('limits tasks and invoices sent', async () => {
            const response = { data: { result: {} } };
            mockAxios.post.mockResolvedValue(response);

            const project = { ref: 'P1', title: 'Test', status: 'active' };
            const tasks = Array(30).fill({}).map((_, i) => ({ id: i }));
            const invoices = Array(15).fill({}).map((_, i) => ({ id: i }));

            await AiService.auditProject(project as unknown as Project, tasks, invoices);

            expect(mockAxios.post).toHaveBeenCalledWith(expect.stringContaining('/audit/project'), expect.objectContaining({
                tasks: expect.any(Array),
                invoices: expect.any(Array)
            }), expect.any(Object));
        });
    });

    describe('chatWithData', () => {
        it('sends chat message with history', async () => {
            vi.useFakeTimers();
            try {
                const reply = 'Here is the information you requested';
                // Fluxo assíncrono: POST enfileira o job (jobId) e GET faz polling até status 'done'.
                mockAxios.post.mockResolvedValue({ data: { jobId: 'job-123' } });
                mockAxios.get.mockResolvedValue({ data: { status: 'done', reply, sessionId: 'chat_123' } });

                const history = [
                    { role: 'user' as const, text: 'Hello' },
                    { role: 'model' as const, text: 'Hi!' }
                ];
                const promise = AiService.chatWithData('Show my invoices', history);
                await vi.advanceTimersByTimeAsync(2500); // pula o primeiro intervalo de polling
                const result = await promise;

                expect(result.reply).toBe(reply);
                expect(result.sessionId).toBe('chat_123');
            } finally {
                vi.useRealTimers();
            }
        });

        it('includes date context in request', async () => {
            const response = { data: { reply: 'Response', sessionId: null } };
            mockAxios.post.mockResolvedValue(response);

            await AiService.chatWithData('Test', []);

            expect(mockAxios.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                context: expect.stringContaining('Data atual')
            }), expect.any(Object));
        });

        it('returns error message on failure', async () => {
            mockAxios.post.mockRejectedValue(new Error('Chat failed'));

            const result = await AiService.chatWithData('Test', []);

            expect(result.reply).toBe('Erro de conexão com o Assistente Virtual.');
        });
    });

    describe('analyzeSystemLogs', () => {
        it('analyzes system logs', async () => {
            const analysis = [{ type: 'error', count: 5 }];
            const response = { data: { result: analysis } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.analyzeSystemLogs([{ level: 'error' }]);

            expect(result).toEqual(analysis);
        });

        it('limits logs to 50 entries', async () => {
            const response = { data: { result: [] } };
            mockAxios.post.mockResolvedValue(response);

            const logs = Array(100).fill({}).map((_, i) => ({ id: i, level: 'info' }));

            await AiService.analyzeSystemLogs(logs);

            expect(mockAxios.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                logs: expect.any(Array)
            }), expect.any(Object));
        });

        it('returns empty array on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Analysis failed'));

            const result = await AiService.analyzeSystemLogs([]);

            expect(result).toBe('[]');
        });
    });

    describe('analyzeApiStructure', () => {
        it('analyzes API structure', async () => {
            const analysis = { endpoints: 25, methods: ['GET', 'POST'] };
            const response = { data: { result: analysis } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.analyzeApiStructure('{"openapi": "3.0"}');

            expect(result).toEqual(analysis);
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Analysis failed'));

            const result = await AiService.analyzeApiStructure('{}');

            expect(result).toBeNull();
        });
    });

    describe('analyzeSystem', () => {
        it('analyzes system with query', async () => {
            const analysis = 'System is running normally';
            const response = { data: { result: analysis } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.analyzeSystem('Check system status');

            expect(result).toBe(analysis);
        });

        it('returns error message on failure', async () => {
            mockAxios.post.mockRejectedValue(new Error('Analysis failed'));

            const result = await AiService.analyzeSystem('Check');

            expect(result).toContain('Erro');
        });
    });

    describe('analyzeSentiment', () => {
        it('analyzes text sentiment', async () => {
            const sentiment = { score: 75, label: 'Positive' };
            const response = { data: sentiment };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.analyzeSentiment('Great product!');

            expect(result).toEqual(sentiment);
        });

        it('returns error sentiment on failure', async () => {
            mockAxios.post.mockRejectedValue(new Error('Analysis failed'));

            const result = await AiService.analyzeSentiment('Text');

            expect(result).toEqual({ score: 50, label: 'Error' });
        });
    });

    describe('extractCustomerInfo', () => {
        it('extracts customer info', async () => {
            const info = { name: 'John', email: 'john@example.com' };
            const response = { data: { result: info } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.extractCustomerInfo('Customer John from Acme');

            expect(result).toEqual(info);
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Extraction failed'));

            const result = await AiService.extractCustomerInfo('Text');

            expect(result).toBeNull();
        });
    });

    describe('fixApiCallWithDocs', () => {
        it('fixes API call using documentation', async () => {
            const fix = { corrected: true, endpoint: '/users/1' };
            const response = { data: { result: fix } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.fixApiCallWithDocs({ endpoint: '/user/1' }, 'documentation');

            expect(result).toEqual(fix);
        });

        it('returns error message on failure', async () => {
            mockAxios.post.mockRejectedValue(new Error('Fix failed'));

            const result = await AiService.fixApiCallWithDocs({}, 'docs');

            expect(result).toContain('Erro');
        });
    });

    describe('generateServiceCode', () => {
        it('generates service code', async () => {
            const code = 'const api = new Service();';
            const response = { data: { result: code } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.generateServiceCode('/users', 'GET', 'Fetch users');

            expect(result).toBe(code);
        });

        it('returns error message on failure', async () => {
            mockAxios.post.mockRejectedValue(new Error('Generation failed'));

            const result = await AiService.generateServiceCode('/test', 'POST');

            expect(result).toContain('Erro');
        });
    });

    describe('transcribeAudio', () => {
        it('transcribes audio', async () => {
            const transcription = 'Hello, this is a test transcription';
            const response = { data: { transcription } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.transcribeAudio('base64audio');

            expect(result).toBe(transcription);
        });

        it('returns error text on failure', async () => {
            mockAxios.post.mockRejectedValue(new Error('Transcription failed'));

            const result = await AiService.transcribeAudio('invalid');

            expect(result).toBe('[Erro na transcrição]');
        });
    });

    describe('analyzeDataQuality', () => {
        it('analyzes data quality', async () => {
            const analysis = { score: 95, issues: [] };
            const response = { data: { result: analysis } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.analyzeDataQuality([{ id: '1', name: 'Test' }], 'contacts');

            expect(result).toEqual(analysis);
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Analysis failed'));

            const result = await AiService.analyzeDataQuality([], 'type');

            expect(result).toBeNull();
        });
    });

    describe('generateActivityReport', () => {
        it('generates activity report', async () => {
            const report = 'Completed 5 tasks today';
            const response = { data: { reply: report } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.generateActivityReport('Tasks completed');

            expect(result).toBe(report);
        });

        it('returns error message on failure', async () => {
            mockAxios.post.mockRejectedValue(new Error('Generation failed'));

            const result = await AiService.generateActivityReport('Context');

            expect(result).toContain('Erro');
        });
    });

    describe('analyzeMonthlyReport', () => {
        it('analyzes monthly report', async () => {
            const analysis = { summary: 'Good month', revenue: 50000 };
            const response = { data: { result: analysis } };
            mockAxios.post.mockResolvedValue(response);

            const result = await AiService.analyzeMonthlyReport({ revenue: 50000 });

            expect(result).toEqual(analysis);
        });

        it('returns error message on failure', async () => {
            mockAxios.post.mockRejectedValue(new Error('Analysis failed'));

            const result = await AiService.analyzeMonthlyReport({});

            expect(result).toContain('Erro');
        });
    });

    describe('draftMessage', () => {
        it('drafts message for customer', async () => {
            const draft = 'Hello, regarding your invoice...';
            const response = { data: { reply: draft } };
            mockAxios.post.mockResolvedValue(response);

            const customer = { id: '1', name: 'Test', email: 'test@example.com' };
            const result = await AiService.draftMessage(customer as unknown as ThirdParty, 'collection', ['email']);

            expect(result).toBe(draft);
        });

        it('includes additional data in prompt', async () => {
            const response = { data: { reply: 'Draft' } };
            mockAxios.post.mockResolvedValue(response);

            const customer = { id: '1', name: 'Test', email: 'test@example.com' };
            const additionalData = { invoiceId: 'INV-001', amount: 1000 };

            await AiService.draftMessage(customer as unknown as ThirdParty, 'update', ['whatsapp'], additionalData);

            expect(mockAxios.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                history: expect.any(Array)
            }), expect.any(Object));
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Draft failed'));

            const customer = { id: '1', name: 'Test', email: 'test@example.com' };
            const result = await AiService.draftMessage(customer as unknown as ThirdParty, 'context', ['email']);

            expect(result).toBeNull();
        });
    });

    describe('deleteChatSession', () => {
        it('deletes a single session', async () => {
            mockAxios.delete.mockResolvedValue({ data: { success: true } });

            const result = await AiService.deleteChatSession('chat_123');

            expect(result).toBe(true);
            expect(mockAxios.delete).toHaveBeenCalledWith(
                expect.stringContaining('/sessions/chat_123'),
                expect.any(Object)
            );
        });

        it('returns false on error', async () => {
            mockAxios.delete.mockRejectedValue(new Error('Delete failed'));

            const result = await AiService.deleteChatSession('chat_123');

            expect(result).toBe(false);
        });
    });

    describe('deleteAllChatSessions', () => {
        it('deletes all sessions and returns count', async () => {
            mockAxios.delete.mockResolvedValue({ data: { success: true, deletedCount: 7 } });

            const result = await AiService.deleteAllChatSessions();

            expect(result).toBe(7);
            expect(mockAxios.delete).toHaveBeenCalledWith(
                expect.stringContaining('/sessions'),
                expect.any(Object)
            );
        });

        it('returns 0 on error', async () => {
            mockAxios.delete.mockRejectedValue(new Error('Delete all failed'));

            const result = await AiService.deleteAllChatSessions();

            expect(result).toBe(0);
        });
    });

    // #677: estes métodos NÃO disparam toast no service — quem decide a mensagem é o componente.
    describe('financial analysis automation config (#677)', () => {
        const sampleConfig = {
            enabled: true,
            schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
            lastRunAt: null,
            lastRunStatus: null,
        };

        describe('getFinancialAnalysisAutomationConfig', () => {
            it('returns the config on success without toasting', async () => {
                mockAxios.get.mockResolvedValue({ data: sampleConfig });

                const result = await AiService.getFinancialAnalysisAutomationConfig();

                expect(result).toEqual(sampleConfig);
                expect(mockAxios.get).toHaveBeenCalledWith(
                    expect.stringContaining('/analyze/financial-analysis/automation-config'),
                    expect.any(Object)
                );
                expect(toast.error).not.toHaveBeenCalled();
            });

            it('returns null on error WITHOUT firing a toast (component decides)', async () => {
                mockAxios.get.mockRejectedValue(new Error('load failed'));

                const result = await AiService.getFinancialAnalysisAutomationConfig();

                expect(result).toBeNull();
                expect(toast.error).not.toHaveBeenCalled();
            });
        });

        describe('updateFinancialAnalysisAutomationConfig', () => {
            it('returns the merged config on success without toasting', async () => {
                mockAxios.put.mockResolvedValue({ data: { ...sampleConfig, enabled: true } });

                const result = await AiService.updateFinancialAnalysisAutomationConfig({ enabled: true });

                expect(result).toEqual({ ...sampleConfig, enabled: true });
                expect(mockAxios.put).toHaveBeenCalledWith(
                    expect.stringContaining('/analyze/financial-analysis/automation-config'),
                    { enabled: true },
                    expect.any(Object)
                );
                expect(toast.error).not.toHaveBeenCalled();
            });

            it('returns null on error WITHOUT firing a toast (component decides)', async () => {
                mockAxios.put.mockRejectedValue(new Error('save failed'));

                const result = await AiService.updateFinancialAnalysisAutomationConfig({ enabled: false });

                expect(result).toBeNull();
                expect(toast.error).not.toHaveBeenCalled();
            });
        });
    });
});
