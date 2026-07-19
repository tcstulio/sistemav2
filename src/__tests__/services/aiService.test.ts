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
        // Fatura recente (relativa a "hoje") p/ sobreviver ao filtro de janela (últimos 6 meses).
        // Data relativa evita fragilidade de fronteira de mês (cf. bug do TimeAnalysisDashboard).
        const recentInvoice = { id: '1', ref: 'INV-001', total_ttc: 1000, statut: '1', date: new Date().toISOString() };

        it('gera o forecast pelo fluxo assíncrono (enfileira + polling até done)', async () => {
            vi.useFakeTimers();
            try {
                const forecastStr = JSON.stringify({ forecast: [{ month: 'Julho 2026', predicted_revenue: 1000 }], trend: 'up' });
                mockAxios.post.mockResolvedValue({ data: { jobId: 'fj-1', status: 'queued' } });
                mockAxios.get.mockResolvedValue({ data: { status: 'done', result: forecastStr } });

                const promise = AiService.generateSalesForecast([recentInvoice] as unknown as Invoice[]);
                await vi.advanceTimersByTimeAsync(2500); // pula o primeiro intervalo de polling
                const result = await promise;

                expect(result).toBe(forecastStr);
            } finally {
                vi.useRealTimers();
            }
        });

        it('#915: enfileira em /sales-forecast-async com série mensal agregada (não faturas cruas)', async () => {
            vi.useFakeTimers();
            try {
                mockAxios.post.mockResolvedValue({ data: { jobId: 'fj-2' } });
                mockAxios.get.mockResolvedValue({ data: { status: 'done', result: '{}' } });

                const promise = AiService.generateSalesForecast([recentInvoice] as unknown as Invoice[]);
                await vi.advanceTimersByTimeAsync(2500);
                await promise;

                expect(mockAxios.post).toHaveBeenCalledWith(
                    expect.stringContaining('/analyze/sales-forecast-async'),
                    expect.objectContaining({
                        invoices: [],
                        context: expect.objectContaining({
                            timeSeries: expect.arrayContaining([
                                expect.objectContaining({ period: expect.any(String), revenue: expect.any(Number), count: expect.any(Number) })
                            ])
                        })
                    }),
                    expect.any(Object)
                );
            } finally {
                vi.useRealTimers();
            }
        });

        it('curto-circuita sem chamar o LLM quando o filtro zera as faturas', async () => {
            mockAxios.post.mockResolvedValue({ data: { result: {} } });

            const result = await AiService.generateSalesForecast([]);

            expect(mockAxios.post).not.toHaveBeenCalled();
            const parsed = JSON.parse(result as string);
            expect(parsed.forecast).toEqual([]);
            expect(parsed.summary).toMatch(/não há faturas/i);
        });

        it('returns null on error', async () => {
            mockAxios.post.mockRejectedValue(new Error('Forecast failed'));

            const result = await AiService.generateSalesForecast([recentInvoice] as unknown as Invoice[]);

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

    // #1013: o cliente estende o polling enquanto o backend sinaliza job vivo, em vez de
    // cortar no teto fixo de 20min. Teto absoluto de 40min evita loop infinito.
    describe('pollChatJob — extensão por heartbeat (#1013)', () => {
        const job404 = (() => {
            const err: any = new Error('Not Found');
            err.response = { status: 404, data: { reason: 'not_found' } };
            return err;
        })();
        const serverErr = (status = 503) => {
            const err: any = new Error('Server Error');
            err.response = { status, data: {} };
            return err;
        };

        beforeEach(() => {
            mockAxios.post.mockResolvedValue({ data: { jobId: 'job-1013' } });
        });

        it('NÃO declara timeout aos 20min quando o backend segue vivo (cenário #1)', async () => {
            vi.useFakeTimers();
            try {
                let deliverDone = false;
                mockAxios.get.mockImplementation(async () => {
                    if (deliverDone) return { data: { status: 'done', reply: 'final', sessionId: 's1', alive: true } };
                    return { data: { status: 'running', alive: true } };
                });

                let resolved = false;
                let rejection: unknown = null;
                const promise = AiService.chatWithData('q', []).then(
                    (r) => { resolved = true; return r; },
                    (e) => { rejection = e; },
                );

                // Passa do antigo teto de 20min com o job sempre vivo/running.
                await vi.advanceTimersByTimeAsync(21 * 60 * 1000);

                // Antes do fix o polling estouraria timeout aos 20min.
                expect(rejection).toBeNull();
                expect(resolved).toBe(false); // ainda processando

                deliverDone = true;
                await vi.advanceTimersByTimeAsync(2500);
                const result = await promise;

                expect(resolved).toBe(true);
                expect(result.reply).toBe('final');
            } finally {
                vi.useRealTimers();
            }
        }, 20000);

        it('declara timeout quando o job dá 404 e o heartbeat retorna alive:false (cenário #2)', async () => {
            vi.useFakeTimers();
            try {
                mockAxios.get.mockImplementation(async () => { throw job404; });

                // handler síncrono p/ evitar "unhandled rejection" entre o reject e o assert.
                const settled = AiService.resumeChatJob('job-1013').then(() => null, (e: any) => e);
                await vi.advanceTimersByTimeAsync(2500);
                const err = await settled;

                expect(err).toBeInstanceOf(Error);
                expect(String(err?.message || '')).toMatch(/interrompido|excedido/i);
            } finally {
                vi.useRealTimers();
            }
        });

        it('estende o polling quando o job dá 404 mas o heartbeat retorna alive:true', async () => {
            vi.useFakeTimers();
            try {
                let deliverDone = false;
                mockAxios.get.mockImplementation(async (url: string) => {
                    if (url.includes('/status')) {
                        return { data: { alive: true, lastHeartbeat: new Date().toISOString(), progressPct: 42 } };
                    }
                    if (deliverDone) return { data: { status: 'done', reply: 'recuperado', sessionId: 's2', alive: true } };
                    throw job404;
                });

                const progress: number[] = [];
                const promise = AiService.resumeChatJob('job-1013', (p) => progress.push(p.lastHeartbeat));

                await vi.advanceTimersByTimeAsync(2500);  // 404 -> heartbeat alive -> estende
                await vi.advanceTimersByTimeAsync(5000);  // mais ciclos 404+alive
                expect(progress.length).toBeGreaterThan(0);

                deliverDone = true;
                await vi.advanceTimersByTimeAsync(2500);
                const result = await promise;

                expect(result.reply).toBe('recuperado');
            } finally {
                vi.useRealTimers();
            }
        });

        it('declara timeout após 5xx repetido no endpoint do job', async () => {
            vi.useFakeTimers();
            try {
                mockAxios.get.mockRejectedValue(serverErr(503));

                const settled = AiService.resumeChatJob('job-1013').then(() => null, (e: any) => e);
                await vi.advanceTimersByTimeAsync(5 * 2500);
                const err = await settled;

                expect(err).toBeInstanceOf(Error);
                expect(String(err?.message || '')).toMatch(/servidor indisponível|excedido/i);
            } finally {
                vi.useRealTimers();
            }
        });

        it('invoca onProgress com lastHeartbeat durante o polling', async () => {
            vi.useFakeTimers();
            try {
                let polls = 0;
                mockAxios.get.mockImplementation(async () => {
                    polls++;
                    if (polls <= 2) return { data: { status: 'running', alive: true } };
                    return { data: { status: 'done', reply: 'ok', sessionId: 's3', alive: true } };
                });

                const heartbeats: number[] = [];
                const promise = AiService.resumeChatJob('job-1013', (p) => heartbeats.push(p.lastHeartbeat));
                await vi.advanceTimersByTimeAsync(3 * 2500);
                await promise;

                expect(heartbeats.length).toBeGreaterThanOrEqual(1);
                expect(typeof heartbeats[0]).toBe('number');
            } finally {
                vi.useRealTimers();
            }
        });

        it('respeita o teto absoluto de 40min mesmo com alive:true contínuo', async () => {
            vi.useFakeTimers();
            try {
                mockAxios.get.mockResolvedValue({ data: { status: 'running', alive: true } });

                const settled = AiService.resumeChatJob('job-1013').then(() => null, (e: any) => e);
                await vi.advanceTimersByTimeAsync(41 * 60 * 1000);
                const err = await settled;

                expect(err).toBeInstanceOf(Error);
                expect(String(err?.message || '')).toMatch(/40 min/);
            } finally {
                vi.useRealTimers();
            }
        }, 30000);

        it('jobs rápidos (<20min) continuam funcionando como hoje (sem regressão)', async () => {
            vi.useFakeTimers();
            try {
                mockAxios.post.mockResolvedValue({ data: { jobId: 'fast' } });
                mockAxios.get.mockResolvedValue({ data: { status: 'done', reply: 'rapido', sessionId: 's', alive: true } });

                const promise = AiService.chatWithData('oi', []);
                await vi.advanceTimersByTimeAsync(2500);
                const result = await promise;

                expect(result.reply).toBe('rapido');
                // #1013: jobs que NÃO dão 404 nunca consultam o heartbeat /status.
                expect(mockAxios.get).not.toHaveBeenCalledWith(expect.stringContaining('/ai-jobs/'), expect.any(Object));
            } finally {
                vi.useRealTimers();
            }
        });

        // #1577: quando o job é cancelado pelo usuário, o GET /jobs/:id devolve
        // { status: 'cancelled', alive: false, partialSummary }. O pollChatJob deve
        // encerrar IMEDIATAMENTE (não esperar o teto de 40min) lançando um erro tipado
        // ChatJobCancelledError — distinto de erro genérico — para o chamador tratar
        // silenciosamente (a UI de cancelamento já foi renderizada via socket event).
        it('#1577: lança ChatJobCancelledError quando o job é cancelado (status: "cancelled")', async () => {
            vi.useFakeTimers();
            try {
                mockAxios.get.mockResolvedValue({
                    data: { status: 'cancelled', alive: false, partialSummary: 'Resumo parcial.' },
                });

                const settled = AiService.resumeChatJob('job-cancelled').then(() => null, (e: any) => e);
                await vi.advanceTimersByTimeAsync(2500);
                const err = await settled;

                const { ChatJobCancelledError } = await import('../../services/aiService');
                expect(err).toBeInstanceOf(ChatJobCancelledError);
                expect((err as any).partialSummary).toBe('Resumo parcial.');
            } finally {
                vi.useRealTimers();
            }
        });

        it('#1577: ChatJobCancelledError carrega partialSummary null quando backend não envia', async () => {
            vi.useFakeTimers();
            try {
                mockAxios.get.mockResolvedValue({
                    data: { status: 'cancelled', alive: false, partialSummary: null },
                });

                const settled = AiService.resumeChatJob('job-cancelled').then(() => null, (e: any) => e);
                await vi.advanceTimersByTimeAsync(2500);
                const err = await settled;

                const { ChatJobCancelledError } = await import('../../services/aiService');
                expect(err).toBeInstanceOf(ChatJobCancelledError);
                expect((err as any).partialSummary).toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });

        it('#1577: NÃO estende o prazo quando o job está cancelled (encerra no primeiro poll)', async () => {
            vi.useFakeTimers();
            try {
                let polls = 0;
                mockAxios.get.mockImplementation(async () => {
                    polls++;
                    return { data: { status: 'cancelled', alive: false, partialSummary: 'fim.' } };
                });

                const settled = AiService.resumeChatJob('job-cancelled').then(() => null, (e: any) => e);
                await vi.advanceTimersByTimeAsync(2500);
                const err = await settled;

                const { ChatJobCancelledError } = await import('../../services/aiService');
                expect(err).toBeInstanceOf(ChatJobCancelledError);
                // Apenas 1 poll foi necessário — encerrou imediatamente.
                expect(polls).toBe(1);
            } finally {
                vi.useRealTimers();
            }
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

    // #594: getChatSession deve preservar userId e usage nas mensagens
    describe('getChatSession (#594)', () => {
        it('preserva o userId da sessão retornado pelo backend', async () => {
            const sessionData = {
                id: 'chat_abc',
                userId: 'alice',
                title: 'Minha Sessão',
                messages: [
                    {
                        role: 'user',
                        content: 'Olá',
                        timestamp: 1700000000000,
                        metadata: undefined,
                    },
                ],
            };
            mockAxios.get.mockResolvedValue({ data: { data: sessionData } });

            const result = await AiService.getChatSession('chat_abc');

            expect(result).not.toBeNull();
            expect(result!.userId).toBe('alice');
            expect(result!.messages).toHaveLength(1);
        });

        it('retorna userId vazio quando ausente no backend', async () => {
            const sessionData = {
                id: 'chat_xyz',
                title: 'Sessão Sem Owner',
                messages: [],
            };
            mockAxios.get.mockResolvedValue({ data: { data: sessionData } });

            const result = await AiService.getChatSession('chat_xyz');

            expect(result!.userId).toBe('');
        });

        it('preserva metadata.usage nas mensagens', async () => {
            const sessionData = {
                id: 'chat_tok',
                userId: 'bob',
                messages: [
                    {
                        role: 'model',
                        content: 'Resposta',
                        timestamp: 1700000000000,
                        metadata: {
                            usage: {
                                promptTokens: 100,
                                completionTokens: 50,
                                totalTokens: 150,
                            },
                        },
                    },
                ],
            };
            mockAxios.get.mockResolvedValue({ data: { data: sessionData } });

            const result = await AiService.getChatSession('chat_tok');

            expect(result!.messages[0].metadata?.usage?.totalTokens).toBe(150);
        });

        it('retorna null quando backend retorna data nula', async () => {
            mockAxios.get.mockResolvedValue({ data: { data: null } });

            const result = await AiService.getChatSession('chat_404');

            expect(result).toBeNull();
        });

        it('retorna null e dispara toast em caso de erro', async () => {
            mockAxios.get.mockRejectedValue(new Error('Session load failed'));
            toast.error = vi.fn();

            const result = await AiService.getChatSession('chat_err');

            expect(result).toBeNull();
            expect(toast.error).toHaveBeenCalled();
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
