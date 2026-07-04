import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import fs from 'fs/promises';

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn().mockImplementation(function(this: any, { apiKey }: any) {
        this.models = {
            generateContent: vi.fn(),
            list: vi.fn(),
        };
    }),
}));

vi.mock('fs/promises', () => ({
    default: {
        readFile: vi.fn().mockRejectedValue(new Error('File not found')),
    },
}));

vi.mock('../../config/env', () => ({
    config: {
        googleApiKey: 'test-api-key',
        geminiModel: 'gemini-2.0-flash',
        llmProvider: 'google',
        localLlmUrl: 'http://localhost:11434/v1',
        localModelName: 'llama3',
        // Resiliência LLM (#719): deadline curto p/ testes não esperarem backoff real.
        // Cada teste pode sobrescrever via (config as any).llmRetryDeadlineMs = <valor>.
        llmPrimaryTimeoutMs: 5000,
        llmRetryDeadlineMs: 0,
    },
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: {
        searchThirdParty: vi.fn(),
        getCustomerContext: vi.fn(),
        listInvoices: vi.fn(),
        listProjects: vi.fn(),
        listOrders: vi.fn(),
        listProposals: vi.fn(),
        listTickets: vi.fn(),
        listProducts: vi.fn(),
        listBankAccounts: vi.fn(),
        listContracts: vi.fn(),
        listShipments: vi.fn(),
        listSupplierInvoices: vi.fn(),
        listExpenseReports: vi.fn(),
        listUsers: vi.fn(),
        listWarehouses: vi.fn(),
        listTasks: vi.fn(),
        listUserTasks: vi.fn(),
        listEvents: vi.fn(),
        listContacts: vi.fn(),
        listCategories: vi.fn(),
        listSuppliers: vi.fn(),
        listSupplierOrders: vi.fn(),
        listPayments: vi.fn(),
        listBankLines: vi.fn(),
        listStockMovements: vi.fn(),
        listInterventions: vi.fn(),
        listLeaveRequests: vi.fn(),
        listBOMs: vi.fn(),
        listManufacturingOrders: vi.fn(),
        listCandidates: vi.fn(),
        listJobPositions: vi.fn(),
    },
}));

vi.mock('../../services/llmHealthService', () => ({
    llmHealthService: {
        isAvailable: vi.fn(() => true),
        recordSuccess: vi.fn(),
        recordQuotaError: vi.fn(),
        recordTransientError: vi.fn(),
        resetProvider: vi.fn(),
    },
}));

vi.mock('../../services/configService', () => ({
    configService: {
        getModuleConfig: vi.fn().mockReturnValue({ provider: 'google', model: 'gemini-2.0-flash' }),
        getAllModuleConfigs: vi.fn().mockReturnValue({}),
        setModuleConfigs: vi.fn(),
        getPrompt: vi.fn().mockReturnValue(''),
        getAllPrompts: vi.fn().mockReturnValue({}),
        setPrompts: vi.fn(),
        isRunWithChainEnabled: vi.fn().mockReturnValue(false),
        getFallbackChain: vi.fn().mockReturnValue(['google']),
    },
    ConfigService: class {},
}));

vi.mock('../../utils/urlValidation', () => ({
    isValidExternalUrl: vi.fn(() => true),
}));

vi.mock('../../services/scraperService', () => ({
    ScraperService: {
        searchGoogle: vi.fn().mockResolvedValue([{ title: 'Result' }]),
        fetchPageContent: vi.fn().mockResolvedValue('Page content'),
    },
}));

import { aiService, LocalProvider, aggregateInvoicesToMonthlySeries, estimateTokens, pruneContext, toolCallSignature, stableStringify, evaluateConclusionGate, looksLikeUnfinishedAnnouncement, MAX_CONCLUSION_NUDGES } from '../../services/aiService';
import { GoogleGenAI } from '@google/genai';
import { dolibarrService } from '../../services/dolibarrService';
import { ScraperService } from '../../services/scraperService';
import { isValidExternalUrl } from '../../utils/urlValidation';

function setupGoogleMock(generateContentFn: any) {
    (GoogleGenAI as any).mockImplementation(function(this: any) {
        this.models = {
            generateContent: generateContentFn,
            list: vi.fn(),
        };
    });
    aiService.setConfig('google', undefined, 'test-key', 'gemini-2.0-flash');
}

describe('AiService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('setConfig', () => {
        it('switches to local provider', () => {
            aiService.setConfig('local', 'http://localhost:11434/v1', undefined, 'llama3');
        });

        it('switches to google provider', () => {
            setupGoogleMock(vi.fn());
        });
    });

    describe('GoogleProvider - analyzeSystem', () => {
        it('throws when AI not configured', async () => {
            aiService.setConfig('google', undefined, '', '');
            await expect(aiService.analyzeSystem('test')).rejects.toThrow();
        });

        it('returns analysis result', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: 'Analysis result' });
            setupGoogleMock(mockGen);
            (fs.readFile as any).mockResolvedValue('file content');

            const result = await aiService.analyzeSystem('What does this code do?');
            expect(result).toBe('Analysis result');
        });

        it('handles analysis error', async () => {
            const mockGen = vi.fn().mockRejectedValue(new Error('API fail'));
            setupGoogleMock(mockGen);
            (fs.readFile as any).mockRejectedValue(new Error('no file'));

            await expect(aiService.analyzeSystem('test query')).rejects.toThrow();
        });
    });

    describe('GoogleProvider - analyzeSentiment', () => {
        it('returns sentiment score', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: '{"score": 80, "label": "Positive"}' });
            setupGoogleMock(mockGen);

            const result = await aiService.analyzeSentiment('Great service!');
            expect(result.score).toBe(80);
            expect(result.label).toBe('Positive');
        });

        it('handles error', async () => {
            const mockGen = vi.fn().mockRejectedValue(new Error('fail'));
            setupGoogleMock(mockGen);

            const result = await aiService.analyzeSentiment('test');
            expect(result.label).toBe('Error');
        });
    });

    describe('GoogleProvider - extractCustomerInfo', () => {
        it('extracts customer info', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: '{"name":"John","email":"john@test.com","phone":"123"}' });
            setupGoogleMock(mockGen);

            const result = await aiService.extractCustomerInfo('John, john@test.com, 123');
            expect(result.name).toBe('John');
        });

        it('handles parse error', async () => {
            const mockGen = vi.fn().mockRejectedValue(new Error('parse fail'));
            setupGoogleMock(mockGen);

            const result = await aiService.extractCustomerInfo('test');
            expect(result).toBeNull();
        });
    });

    describe('GoogleProvider - extractReceiptData', () => {
        it('extracts receipt data from image', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: '{"vendor":"Store","total":100,"items":[]}' });
            setupGoogleMock(mockGen);

            const result = await aiService.extractReceiptData('base64data');
            expect(result.vendor).toBe('Store');
            expect(result.total).toBe(100);
        });
    });

    describe('GoogleProvider - analyzeFinancialHealth', () => {
        it('returns financial analysis', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: 'Financial analysis report' });
            setupGoogleMock(mockGen);

            const result = await aiService.analyzeFinancialHealth({ revenue: 1000 });
            expect(result).toBe('Financial analysis report');
        });
    });

    describe('GoogleProvider - fixApiCall', () => {
        it('returns fix analysis', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: 'Fixed code here' });
            setupGoogleMock(mockGen);

            const result = await aiService.fixApiCall({ error: 'timeout' });
            expect(result).toBe('Fixed code here');
        });
    });

    describe('GoogleProvider - generateCode', () => {
        it('returns generated code', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: 'const fn = () => {}' });
            setupGoogleMock(mockGen);

            const result = await aiService.generateCode('/api/test', 'GET', 'test endpoint');
            expect(result).toBe('const fn = () => {}');
        });
    });

    describe('GoogleProvider - transcribeAudio', () => {
        it('returns transcription', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: 'Hello world' });
            setupGoogleMock(mockGen);

            const result = await aiService.transcribeAudio('base64audio');
            expect(result).toBe('Hello world');
        });

        it('handles transcription failure', async () => {
            const mockGen = vi.fn().mockRejectedValue(new Error('fail'));
            setupGoogleMock(mockGen);

            const result = await aiService.transcribeAudio('base64audio');
            expect(result).toContain('Erro');
        });
    });

    describe('GoogleProvider - draftCollectionEmail', () => {
        it('returns email draft', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: '{"subject":"Cobrança","body":"Dear customer"}' });
            setupGoogleMock(mockGen);

            const result = await aiService.draftCollectionEmail({ name: 'John' }, 100);
            const parsed = JSON.parse(result);
            expect(parsed.subject).toContain('Cobran');
        });

        it('handles AI error', async () => {
            const mockGen = vi.fn().mockRejectedValue(new Error('fail'));
            setupGoogleMock(mockGen);

            const result = await aiService.draftCollectionEmail({ name: 'John' }, 100);
            const parsed = JSON.parse(result);
            expect(parsed.subject).toBeDefined();
        });
    });

    describe('GoogleProvider - generateSalesForecast', () => {
        it('returns forecast', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: '{"forecast":[],"summary":"Positive outlook","trend":"up"}' });
            setupGoogleMock(mockGen);

            const result = await aiService.generateSalesForecast([{ date: '2025-01-01', total_ttc: 1000, status: 1 }], { referenceDate: '2025-06-01' });
            const parsed = JSON.parse(result);
            expect(parsed.trend).toBe('up');
        });
    });

    describe('GoogleProvider - analyzeCustomerSentiment', () => {
        it('returns customer sentiment', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: '{"score":80,"label":"Positive","insights":"Good customer"}' });
            setupGoogleMock(mockGen);

            const result = await aiService.analyzeCustomerSentiment({ name: 'John', status: 1 }, []);
            const parsed = JSON.parse(result);
            expect(parsed.label).toBe('Positive');
        });
    });

    describe('GoogleProvider - auditProposal', () => {
        it('returns audit result', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: '{"score":85,"status":"Aprovada","issues":[]}' });
            setupGoogleMock(mockGen);

            const result = await aiService.auditProposal({ ref: 'P001' });
            const parsed = JSON.parse(result);
            expect(parsed.status).toBe('Aprovada');
        });
    });

    describe('GoogleProvider - auditProject', () => {
        it('returns project audit', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: '{"health":"Saudável","score":90,"risks":[]}' });
            setupGoogleMock(mockGen);

            const result = await aiService.auditProject({ title: 'Project A' });
            const parsed = JSON.parse(result);
            expect(parsed.health).toBe('Saudável');
        });
    });

    describe('GoogleProvider - analyzeSystemLogs', () => {
        it('returns log analysis', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: '[{"type":"error","count":5}]' });
            setupGoogleMock(mockGen);

            const result = await aiService.analyzeSystemLogs([{ type: 'api', status: 500, duration_ms: 1000 }]);
            expect(result).toContain('error');
        });
    });

    describe('GoogleProvider - analyzeMonthlyReport', () => {
        it('returns monthly report', async () => {
            const mockGen = vi.fn().mockResolvedValue({ text: 'Monthly Report Summary' });
            setupGoogleMock(mockGen);

            const result = await aiService.analyzeMonthlyReport({ month: 'Jan', revenue: 10000 });
            expect(result).toContain('Monthly Report');
        });

        it('handles error', async () => {
            const mockGen = vi.fn().mockRejectedValue(new Error('fail'));
            setupGoogleMock(mockGen);

            const result = await aiService.analyzeMonthlyReport({});
            expect(result).toBeDefined();
        });
    });

    describe('GoogleProvider - getModels', () => {
        it('returns model list', async () => {
            const asyncIterator = {
                async *[Symbol.asyncIterator]() {
                    yield { name: 'models/gemini-2.0-flash' };
                    yield { name: 'models/gemini-1.5-pro' };
                }
            };
            const mockList = vi.fn().mockReturnValue(asyncIterator);
            (GoogleGenAI as any).mockImplementation(function(this: any) {
                this.models = {
                    generateContent: vi.fn(),
                    list: mockList,
                };
            });
            aiService.setConfig('google', undefined, 'test-key', 'gemini-2.0-flash');

            const result = await aiService.getModels();
            expect(result.length).toBeGreaterThan(0);
            expect(result[0]).toContain('gemini');
        });

        it('returns fallback on error', async () => {
            const mockList = vi.fn().mockImplementation(() => { throw new Error('API fail'); });
            (GoogleGenAI as any).mockImplementation(function(this: any) {
                this.models = {
                    generateContent: vi.fn(),
                    list: mockList,
                };
            });
            aiService.setConfig('google', undefined, 'test-key', 'gemini-2.0-flash');

            const result = await aiService.getModels();
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('LocalProvider', () => {
        beforeEach(() => {
            aiService.setConfig('local', 'http://localhost:11434/v1', undefined, 'llama3');
        });

        it('getModels with OpenAI format', async () => {
            (axios.get as any).mockResolvedValue({ data: { data: [{ id: 'llama3' }, { id: 'mistral' }] } });
            const result = await aiService.getModels();
            expect(result).toEqual(['llama3', 'mistral']);
        });

        it('getModels with Ollama format', async () => {
            (axios.get as any).mockResolvedValue({ data: { models: [{ name: 'llama3:latest' }] } });
            const result = await aiService.getModels();
            expect(result).toEqual(['llama3:latest']);
        });

        it('getModels handles error', async () => {
            (axios.get as any).mockRejectedValue(new Error('fail'));
            const result = await aiService.getModels();
            expect(result).toEqual([]);
        });

        it('analyzeSystem returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: 'Code analysis' } }] } });
            const result = await aiService.analyzeSystem('test');
            expect(result).toBe('Code analysis');
        });

        it('analyzeSystem handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            await expect(aiService.analyzeSystem('test')).rejects.toThrow('fail');
        });

        it('analyzeSentiment returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '{"score":70,"label":"Positive"}' } }] } });
            const result = await aiService.analyzeSentiment('test');
            expect(result.score).toBe(70);
        });

        it('analyzeSentiment handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            await expect(aiService.analyzeSentiment('test')).rejects.toThrow('fail');
        });

        it('extractCustomerInfo returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '{"name":"John","email":"j@t.com"}' } }] } });
            const result = await aiService.extractCustomerInfo('John john@test.com');
            expect(result.name).toBe('John');
        });

        it('extractCustomerInfo handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            await expect(aiService.extractCustomerInfo('test')).rejects.toThrow('fail');
        });

        it('extractReceiptData roteia para Google quando provider de texto é local', async () => {
            // #57 Peça 3: LocalProvider não tem visão -> a chamada vai para o Google.
            (GoogleGenAI as any).mockImplementation(function (this: any) {
                this.models = {
                    generateContent: vi.fn().mockResolvedValue({ text: '{"vendor":"Loja","total":50,"items":[]}' }),
                    list: vi.fn(),
                };
            });
            const result = await aiService.extractReceiptData('base64');
            expect(result.vendor).toBe('Loja');
        });

        it('extractReceiptData usa GLM-4.6V (axios) quando provider glm tem visão', async () => {
            // Fase 1 (#55/#57): com provider glm + chave, o OCR vai pro GLM-4.6V (sem Google).
            aiService.setConfig('glm', 'https://api.z.ai/api/coding/paas/v4', 'zkey', 'glm-5.1');
            (axios.post as any).mockResolvedValue({
                data: { choices: [{ message: { content: '{"vendor":"Loja GLM","total":42,"items":[]}' } }] },
            });
            const result = await aiService.extractReceiptData('base64img');
            expect(result.vendor).toBe('Loja GLM');
            // chamou o endpoint de visão (chat/completions), não o SDK Google
            expect((axios.post as any).mock.calls[0][0]).toContain('/chat/completions');
            // restaura provider local p/ não vazar estado pros próximos testes
            aiService.setConfig('local', 'http://localhost:11434/v1', undefined, 'llama3');
        });

        it('extractReceiptData do glm lança erro se a visão falhar (deixa runWithChain rotear)', async () => {
            // #786: LocalProvider re-lança erros em vez de devolver null. O wrapper
            // runWithChain (WS-D) é quem decide se roteia para Google ou propaga.
            aiService.setConfig('glm', 'https://api.z.ai/api/coding/paas/v4', 'zkey', 'glm-5.1');
            (axios.post as any).mockRejectedValue(new Error('vision down'));
            await expect(aiService.extractReceiptData('base64img')).rejects.toThrow('vision down');
            aiService.setConfig('local', 'http://localhost:11434/v1', undefined, 'llama3');
        });

        it('analyzeFinancialHealth returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: 'Finance report' } }] } });
            const result = await aiService.analyzeFinancialHealth({ data: 1 });
            expect(result).toBe('Finance report');
        });

        it('analyzeFinancialHealth handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            await expect(aiService.analyzeFinancialHealth({})).rejects.toThrow('fail');
        });

        it('fixApiCall returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: 'Fix: check timeout' } }] } });
            const result = await aiService.fixApiCall({ error: 'timeout' });
            expect(result).toBe('Fix: check timeout');
        });

        it('fixApiCall handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            await expect(aiService.fixApiCall({})).rejects.toThrow('fail');
        });

        it('generateCode returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: 'function test() {}' } }] } });
            const result = await aiService.generateCode('/api/test', 'GET');
            expect(result).toBe('function test() {}');
        });

        it('generateCode handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            await expect(aiService.generateCode('/api/test', 'GET')).rejects.toThrow('fail');
        });

        it('transcribeAudio transcreve via GLM-ASR no próprio LocalProvider (#936, sem Google)', async () => {
            aiService.setConfig('glm', 'https://api.z.ai/api/coding/paas/v4', 'zkey', 'glm-5.1');
            (axios.post as any).mockResolvedValue({ data: { text: 'olá, teste de voz' } });
            const result = await aiService.transcribeAudio('base64audio', 'audio/webm;codecs=opus');
            expect(result).toBe('olá, teste de voz');
            // chamou o endpoint de ASR da Z.AI (multipart), não o SDK Google
            const url = (axios.post as any).mock.calls.at(-1)[0];
            expect(url).toContain('/audio/transcriptions');
        });

        it('transcribeAudio devolve mensagem clara quando a PaaS está sem saldo (1113)', async () => {
            aiService.setConfig('glm', 'https://api.z.ai/api/coding/paas/v4', 'zkey', 'glm-5.1');
            (axios.post as any).mockRejectedValue({ response: { data: { error: { code: '1113', message: 'Insufficient balance' } } } });
            const result = await aiService.transcribeAudio('base64audio');
            expect(result).toContain('saldo');
        });

        // #123: o LocalProvider (GLM/local) AGORA implementa esses métodos (antes caía no fallback).
        it('draftCollectionEmail (local) parseia o JSON do modelo', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '{"subject":"Cobrança","body":"Olá"}' } }] } });
            const parsed = JSON.parse(await aiService.draftCollectionEmail({ name: 'John' }, 100));
            expect(parsed.subject).toBe('Cobrança');
        });

        it('generateSalesForecast (local) retorna o forecast do modelo', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '{"forecast":[],"summary":"ok","trend":"up"}' } }] } });
            const parsed = JSON.parse(await aiService.generateSalesForecast([]));
            expect(parsed.trend).toBe('up');
        });

        it('analyzeCustomerSentiment (local) parseia JSON', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '{"score":80,"label":"Positive"}' } }] } });
            const parsed = JSON.parse(await aiService.analyzeCustomerSentiment({}, []));
            expect(parsed.label).toBe('Positive');
        });

        it('auditProposal (local) parseia JSON', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '{"score":85,"status":"Aprovada"}' } }] } });
            const parsed = JSON.parse(await aiService.auditProposal({}));
            expect(parsed.score).toBe(85);
        });

        it('auditProject (local) parseia JSON', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '{"health":"Saudável","score":90}' } }] } });
            const parsed = JSON.parse(await aiService.auditProject({}));
            expect(parsed.health).toBe('Saudável');
        });

        it('analyzeSystemLogs (local) retorna o array do modelo', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '[{"type":"error","title":"x"}]' } }] } });
            const result = await aiService.analyzeSystemLogs([]);
            expect(result).toContain('error');
        });

        it('analyzeMonthlyReport (local) retorna o markdown do modelo', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '## Resumo Executivo\nTudo certo.' } }] } });
            const result = await aiService.analyzeMonthlyReport({});
            expect(result).toContain('Resumo Executivo');
        });

        it('generateReply: loop sem progresso vira resposta final (não "Max iterations reached")', async () => {
            (dolibarrService.listUsers as any).mockResolvedValue([]); // a tool não quebra

            let call = 0;
            (axios.post as any).mockImplementation(async () => {
                call++;
                if (call <= 2) {
                    // modelo insiste na MESMA tool call (loop sem progresso)
                    return { data: { choices: [{ message: { content: '{"tool":"list_users","args":{"search":"marcus"}}' } }] } };
                }
                // chamada de resposta final (sem ferramentas)
                return { data: { choices: [{ message: { content: 'Não encontrei usuários chamados marcus.' } }] } };
            });

            // testa o LocalProvider direto (a wrapper aiService.generateReply usa require dinâmico
            // de configService, que não resolve sob o vitest).
            const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
            const result = await provider.generateReply([{ role: 'user', parts: 'tarefas do marcus' } as any], 'ctx');
            expect(result.text).toBe('Não encontrei usuários chamados marcus.');
            expect(result.text).not.toContain('Max iterations');
        });

        // #718: GenerateReplyResult deve incluir model e fellBack ─────────────────────────────────

        it('generateReply: inclui model e fellBack=false quando o primário responde', async () => {
            (axios.post as any).mockResolvedValue({
                data: { choices: [{ message: { content: 'Resposta do primário.' } }], usage: {} },
            });
            const provider = new LocalProvider('http://localhost:11434/v1', 'glm-5.2');
            const result = await provider.generateReply([{ role: 'user', parts: 'oi' } as any], 'ctx');
            expect(result.text).toBe('Resposta do primário.');
            expect(result.model).toBe('glm-5.2');
            expect(result.fellBack).toBe(false);
        });

        it('generateReply: inclui model=fallback e fellBack=true quando o primário falha com 429', async () => {
            const fallbackConfig = { baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M3', apiKey: 'fb-key' };
            (axios.post as any).mockImplementation(async (url: string) => {
                if (url.includes('localhost')) {
                    // Primário retorna 429 (retryable → aciona fallback)
                    const err: any = new Error('Rate limited');
                    err.response = { status: 429, data: {} };
                    throw err;
                }
                // Fallback (MiniMax)
                return { data: { choices: [{ message: { content: 'Resposta do MiniMax.' } }], usage: {} } };
            });
            // constructor: (baseUrl, modelName, apiKey?, visionConfig?, fallbackConfig?)
            const provider = new LocalProvider('http://localhost:11434/v1', 'glm-5.2', undefined, undefined, fallbackConfig);
            const result = await provider.generateReply([{ role: 'user', parts: 'oi' } as any], 'ctx');
            expect(result.text).toBe('Resposta do MiniMax.');
            expect(result.model).toBe('MiniMax-M3');
            expect(result.fellBack).toBe(true);
        });

        // ── #956: orçamento de contexto + poda de TOOL RESULTs ──────────────────────────────

        it('generateReply (#956): poda TOOL RESULTs antigos e mantém os recentes inteiros', async () => {
            // list_products formata o array em HTML (~5K chars p/ 40 itens). 3 buscas -> 3 blocos
            // (~15K) excedem o orçamento do llama3 (11796 chars); 2 recentes (~10K) cabem inteiros.
            let prodCall = 0;
            (dolibarrService.listProducts as any).mockImplementation(async () => {
                prodCall++;
                const n = prodCall;
                return Array.from({ length: 40 }, (_, i) => ({
                    id: i, ref: `PROD${n}-${i}`, label: 'X'.repeat(30), price: 10,
                }));
            });

            let call = 0;
            const terms = ['p1', 'p2', 'p3'];
            (axios.post as any).mockImplementation(async () => {
                call++;
                if (call <= 3) {
                    // 3 buscas DISTINTAS (args diferentes) -> 3 execuções (não dedupado).
                    return { data: { choices: [{ message: { content: `{"tool":"list_products","args":{"search":"${terms[call - 1]}"}}` } }] } };
                }
                return { data: { choices: [{ message: { content: 'Proposta montada com os produtos.' } }] } };
            });

            const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
            const result = await provider.generateReply([{ role: 'user', parts: 'cotacao com varios produtos' } as any], 'ctx');
            expect(result.text).toBe('Proposta montada com os produtos.');

            // A última chamada (que devolveu a resposta final) usou o currentContext PODADO.
            const lastMessages = (axios.post as any).mock.calls.at(-1)[1].messages;
            const sys = lastMessages[0].content;
            // bloco antigo (PROD1) foi resumido -> último item (PROD1-39) sumiu e há marcador de poda.
            expect(sys).toContain('poda de contexto');
            expect(sys).not.toContain('PROD1-39');
            // blocos recentes (PROD2/PROD3) seguem inteiros -> último item ainda presente.
            expect(sys).toContain('PROD2-39');
            expect(sys).toContain('PROD3-39');
        });

        it('generateReply (#956): interrompe por ORÇAMENTO de contexto e sintetiza (não estoura a janela)', async () => {
            // llama3: ctxWindow 8192 -> contextBudgetTokens = floor(8192*0.72) = 5898.
            // call 1 devolve prompt_tokens=6000 (>5898) + tool call -> na 2ª iteração o guarda dispara.
            (dolibarrService.listUsers as any).mockResolvedValue([]);

            let call = 0;
            (axios.post as any).mockImplementation(async () => {
                call++;
                if (call === 1) {
                    return {
                        data: {
                            choices: [{ message: { content: '{"tool":"list_users","args":{"search":"x"}}' } }],
                            usage: { prompt_tokens: 6000, completion_tokens: 5, total_tokens: 6005 },
                        },
                    };
                }
                // síntese final (proíbe ferramentas)
                return { data: { choices: [{ message: { content: 'Resumo parcial com o que coletei.' } }] } };
            });

            const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
            const result = await provider.generateReply([{ role: 'user', parts: 'alguma coisa' } as any], 'ctx');
            expect(result.text).toBe('Resumo parcial com o que coletei.');

            // Só 2 chamadas ao LLM: 1 (tool) + 1 (síntese). Não houve loop nem estouro.
            expect((axios.post as any).mock.calls.length).toBe(2);
            // A síntese foi avisada do orçamento esgotado (path budgetExhausted).
            const synthMessages = (axios.post as any).mock.calls.at(-1)[1].messages;
            expect(synthMessages[0].content).toContain('orçamento de contexto foi atingido');
        });
    });

    // ── #719/#727: postChatCompletion — fallback, backoff, não-recuperável, deadline ──────────────
    describe('LocalProvider - postChatCompletion fallback (#719/#727)', () => {
        const fallbackConfig = { baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M3', apiKey: 'fb-key' };

        // Acesso ao config mockado para ajustar deadline por teste (deadline=0 → pula backoff).
        let configMock: any;
        beforeEach(async () => {
            configMock = (await import('../../config/env')).config;
            configMock.llmRetryDeadlineMs = 0; // sem espera; deadline esgota imediatamente
            configMock.llmPrimaryTimeoutMs = 5000;
        });
        afterEach(() => {
            vi.clearAllMocks();
        });

        it('cenário 1: primário responde → retorna texto do primário, fellBack=false, provider=glm', async () => {
            (axios.post as any).mockResolvedValue({
                data: { choices: [{ message: { content: 'Texto do GLM.' } }], usage: { total_tokens: 10 } },
            });
            const provider = new LocalProvider('http://localhost:11434/v1', 'glm-5.2', undefined, undefined, fallbackConfig);
            const result = await provider.generateReply([{ role: 'user', parts: 'oi' } as any], 'ctx');
            expect(result.text).toBe('Texto do GLM.');
            expect(result.model).toBe('glm-5.2');
            expect(result.fellBack).toBe(false);
        });

        it('cenário 2: primário 429 → fallback MiniMax acionado, fellBack=true, provider=MiniMax-M3', async () => {
            (axios.post as any).mockImplementation(async (url: string) => {
                if (url.includes('localhost')) {
                    const err: any = new Error('HTTP 429 rate limit');
                    err.response = { status: 429, data: {} };
                    throw err;
                }
                return { data: { choices: [{ message: { content: 'Texto do MiniMax.' } }], usage: {} } };
            });
            const provider = new LocalProvider('http://localhost:11434/v1', 'glm-5.2', undefined, undefined, fallbackConfig);
            const result = await provider.generateReply([{ role: 'user', parts: 'oi' } as any], 'ctx');
            expect(result.text).toBe('Texto do MiniMax.');
            expect(result.model).toBe('MiniMax-M3');
            expect(result.fellBack).toBe(true);
        });

        it('cenário 3: primário ECONNREFUSED → fallback MiniMax acionado', async () => {
            (axios.post as any).mockImplementation(async (url: string) => {
                if (url.includes('localhost')) {
                    const err: any = new Error('connect ECONNREFUSED 127.0.0.1:11434');
                    err.code = 'ECONNREFUSED';
                    throw err;
                }
                return { data: { choices: [{ message: { content: 'MiniMax via ECONNREFUSED.' } }], usage: {} } };
            });
            const provider = new LocalProvider('http://localhost:11434/v1', 'glm-5.2', undefined, undefined, fallbackConfig);
            const result = await provider.generateReply([{ role: 'user', parts: 'oi' } as any], 'ctx');
            expect(result.text).toBe('MiniMax via ECONNREFUSED.');
            expect(result.fellBack).toBe(true);
        });

        it('cenário 4: primário falha com 400 (não-recuperável) → fallback NÃO acionado, erro lançado', async () => {
            (axios.post as any).mockImplementation(async (url: string) => {
                if (url.includes('localhost')) {
                    const err: any = new Error('Bad Request');
                    err.response = { status: 400, data: { error: 'invalid input' } };
                    throw err;
                }
                // Fallback NÃO deve ser chamado neste cenário
                return { data: { choices: [{ message: { content: 'NÃO DEVE CHEGAR AQUI' } }], usage: {} } };
            });
            const provider = new LocalProvider('http://localhost:11434/v1', 'glm-5.2', undefined, undefined, fallbackConfig);
            // #786: generateReply re-lança o erro (antes capturava e devolvia texto sintético).
            await expect(provider.generateReply([{ role: 'user', parts: 'oi' } as any], 'ctx')).rejects.toThrow('Bad Request');
            // O fallback NÃO foi chamado: só 1 chamada (primário)
            expect((axios.post as any).mock.calls.length).toBe(1);
        });

        it('cenário 5: fallback desativado (LLM_FALLBACK_ENABLED=false) + primário 429 → sem fallback, erro lançado', async () => {
            // Sem fallbackConfig = fallback desativado
            (axios.post as any).mockImplementation(async () => {
                const err: any = new Error('rate limited');
                err.response = { status: 429, data: {} };
                throw err;
            });
            const providerSemFallback = new LocalProvider('http://localhost:11434/v1', 'glm-5.2');
            // #786: erro é lançado em vez de capturado como texto.
            await expect(providerSemFallback.generateReply([{ role: 'user', parts: 'oi' } as any], 'ctx')).rejects.toThrow('rate limited');
            // Só 1 tentativa ao primário (deadline=0 → sem backoff)
            expect((axios.post as any).mock.calls.length).toBe(1);
        });

        it('cenário 6: ambos falham (primário 429 + MiniMax 429) → erro lançado', async () => {
            (axios.post as any).mockImplementation(async () => {
                const err: any = new Error('rate limited both');
                err.response = { status: 429, data: {} };
                throw err;
            });
            const provider = new LocalProvider('http://localhost:11434/v1', 'glm-5.2', undefined, undefined, fallbackConfig);
            // #786: erro é lançado em vez de capturado como texto de fallback.
            await expect(provider.generateReply([{ role: 'user', parts: 'oi' } as any], 'ctx')).rejects.toThrow('rate limited');
        });

        it('cenário 6b: backoff exponencial — 429 repetido dentro do deadline → eventualmente sucede', async () => {
            // Deadline longo o suficiente para 1 retry (2s backoff inicial).
            // Usamos fake timers para não esperar 2s reais.
            vi.useFakeTimers();
            configMock.llmRetryDeadlineMs = 10000; // 10s de deadline
            let calls = 0;
            (axios.post as any).mockImplementation(async (url: string) => {
                calls++;
                if (calls <= 2) {
                    // Primeiras 2 chamadas: 429
                    const err: any = new Error('rate limited');
                    err.response = { status: 429, data: {} };
                    throw err;
                }
                // 3ª chamada: sucesso
                return { data: { choices: [{ message: { content: 'Sucesso após retry.' } }], usage: {} } };
            });
            const provider = new LocalProvider('http://localhost:11434/v1', 'glm-5.2');
            const promise = provider.generateReply([{ role: 'user', parts: 'oi' } as any], 'ctx');
            // Avança os timers para cobrir os delays de backoff (2s + 4s)
            await vi.runAllTimersAsync();
            const result = await promise;
            expect(result.text).toBe('Sucesso após retry.');
            expect(result.fellBack).toBe(false);
            vi.useRealTimers();
        });

        it('smoke test: generateReply mantém assinatura esperada (text, usage, fellBack, model)', async () => {
            (axios.post as any).mockResolvedValue({
                data: { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
            });
            const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
            const result = await provider.generateReply([{ role: 'user', parts: 'smoke' } as any], '');
            expect(typeof result.text).toBe('string');
            expect(result.usage).toBeDefined();
            expect(typeof result.fellBack).toBe('boolean');
        });
    });
});

describe('aggregateInvoicesToMonthlySeries (#915)', () => {
    it('agrega por mês somando revenue e contando faturas', () => {
        const series = aggregateInvoicesToMonthlySeries([
            { date: '2026-01-10', total_ttc: 100 },
            { date: '2026-01-20', total_ttc: 50.5 },
            { date: '2026-02-05', total_ttc: 200 },
        ]);
        expect(series).toEqual([
            { period: '2026-01', revenue: 150.5, count: 2 },
            { period: '2026-02', revenue: 200, count: 1 },
        ]);
    });

    it('aceita timestamp em segundos e em ms', () => {
        const secs = Math.floor(Date.UTC(2025, 4, 15) / 1000); // maio/2025 em segundos
        const ms = Date.UTC(2025, 4, 20); // maio/2025 em ms
        const series = aggregateInvoicesToMonthlySeries([
            { date: secs, total_ttc: 10 },
            { date: ms, total_ttc: 20 },
        ]);
        expect(series).toEqual([{ period: '2025-05', revenue: 30, count: 2 }]);
    });

    it('ordena por período e ignora datas inválidas', () => {
        const series = aggregateInvoicesToMonthlySeries([
            { date: '2026-03-01', total_ttc: 5 },
            { date: 'lixo', total_ttc: 999 },
            { date: '2026-01-01', total_ttc: 5 },
        ]);
        expect(series.map(s => s.period)).toEqual(['2026-01', '2026-03']);
    });

    it('retorna [] para lista vazia/nula', () => {
        expect(aggregateInvoicesToMonthlySeries([])).toEqual([]);
        expect(aggregateInvoicesToMonthlySeries(null as any)).toEqual([]);
    });
});

// ── #956: helpers de orçamento de contexto (pura) ────────────────────────────────────
describe('estimateTokens (#956)', () => {
    it('estima ~4 chars/token', () => {
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens('abcd')).toBe(1);
        expect(estimateTokens('abcdefgh')).toBe(2); // 8 chars / 4
    });

    it('tolera null/undefined sem quebrar', () => {
        expect(estimateTokens(undefined as any)).toBe(0);
    });
});

describe('pruneContext (#956)', () => {
    it('devolve intacto quando abaixo do orçamento', () => {
        const ctx = 'contexto pequeno\n\n[TOOL RESULT x]: ok';
        expect(pruneContext(ctx, 1000)).toBe(ctx);
    });

    it('devolve intacto quando acima do orçamento mas sem blocos podáveis', () => {
        const big = 'x'.repeat(2000); // > orçamento, mas nenhum [TOOL RESULT]
        expect(pruneContext(big, 500)).toBe(big);
    });

    it('trunca blocos antigos e preserva os recentes inteiros', () => {
        const head = 'BASE';
        const b1 = `\n\n[TOOL RESULT list_products]: ${'A'.repeat(5000)}`;
        const b2 = `\n\n[TOOL RESULT list_invoices]: ${'B'.repeat(5000)}`;
        const b3 = `\n\n[TOOL RESULT list_orders]: ${'C'.repeat(5000)}`;
        const ctx = head + b1 + b2 + b3; // ~15K chars > budget 11796
        const out = pruneContext(ctx, 11796, 2);

        expect(out).toContain('poda de contexto');          // b1 (antigo) foi resumido
        expect(out).not.toContain('A'.repeat(5000));        // b1 perdeu a run cheia
        expect(out).toContain('B'.repeat(5000));            // b2 (recente) intacto
        expect(out).toContain('C'.repeat(5000));            // b3 (recente) intacto
        expect(out.length).toBeLessThan(ctx.length);        // encolheu
    });

    it('sumariza o único bloco quando ele sozinho excede o orçamento', () => {
        const ctx = `H\n\n[TOOL RESULT x]: ${'Z'.repeat(2000)}`;
        const out = pruneContext(ctx, 500, 2);
        expect(out).toContain('poda de contexto');
        expect(out).not.toContain('Z'.repeat(2000));
    });

    it('também poda blocos [ERRO NA FERRAMENTA ...]', () => {
        const ctx = `H\n\n[ERRO NA FERRAMENTA x]: ${'E'.repeat(5000)}\n\n[TOOL RESULT y]: ${'T'.repeat(5000)}`;
        // budget 6000: cabe o bloco recente (TOOL RESULT) inteiro, mas não os dois -> o ERRO é podado.
        const out = pruneContext(ctx, 6000, 1);
        expect(out).toContain('poda de contexto');          // o erro (antigo) foi resumido
        expect(out).not.toContain('E'.repeat(5000));        // erro truncado
        expect(out).toContain('T'.repeat(5000));            // último bloco (recente) intacto
    });
});

// ── #957: assinatura canônica de tool-call (normaliza ordem das chaves) ───────────────
describe('toolCallSignature / stableStringify (#957)', () => {
    it('gera assinatura tool:args', () => {
        expect(toolCallSignature('list_users', { search: 'marcus' })).toBe('list_users:{"search":"marcus"}');
    });

    it('ordem de chaves DIFERENTE produz a MESMA assinatura (normalização)', () => {
        const a = toolCallSignature('list_products', { search: 'x', limit: 10 });
        const b = toolCallSignature('list_products', { limit: 10, search: 'x' });
        expect(a).toBe(b);
    });

    it('normaliza recursivamente objetos aninhados', () => {
        const a = toolCallSignature('t', { filter: { b: 2, a: 1 } });
        const b = toolCallSignature('t', { filter: { a: 1, b: 2 } });
        expect(a).toBe(b);
    });

    it('PRESERVA a ordem de arrays (faz parte da semântica do args)', () => {
        expect(toolCallSignature('t', { ids: [1, 2] })).not.toBe(toolCallSignature('t', { ids: [2, 1] }));
    });

    it('args distintos geram assinaturas distintas', () => {
        expect(toolCallSignature('t', { a: 1 })).not.toBe(toolCallSignature('t', { a: 2 }));
    });

    it('tolera null/undefined nos args', () => {
        expect(toolCallSignature('t', null)).toBe(toolCallSignature('t', undefined));
        expect(typeof toolCallSignature('t', undefined)).toBe('string');
    });

    it('stableStringify é determinístico e ordena chaves de nível superior', () => {
        expect(stableStringify({ b: 2, a: 1, c: { z: 9, y: 8 } })).toBe('{"a":1,"b":2,"c":{"y":8,"z":9}}');
    });
});

// ── #957/#955: detector estrutural "anuncia e para" (substitui regex lexical #954) ────
describe('looksLikeUnfinishedAnnouncement (#957/#955)', () => {
    it('detecta anúncio com verbo + reticências', () => {
        expect(looksLikeUnfinishedAnnouncement('Vou verificar os logs...')).toBe(true);
    });

    it('detecta o caso que a regex #954 PERDIA: "Vou disparar as 6 ferramentas…:"', () => {
        expect(looksLikeUnfinishedAnnouncement('Vou disparar as 6 ferramentas…:')).toBe(true);
    });

    it('detecta intenção em inglês terminando com ":"', () => {
        expect(looksLikeUnfinishedAnnouncement('Let me check the logs:')).toBe(true);
    });

    it('detecta somente o sinal de continuação (":") em texto curto', () => {
        expect(looksLikeUnfinishedAnnouncement('Os resultados foram:')).toBe(true);
    });

    it('NÃO marca resposta com substância (valores) como anúncio', () => {
        expect(looksLikeUnfinishedAnnouncement('O cliente tem R$ 1.500,00 em aberto.')).toBe(false);
    });

    it('NÃO marca resposta com pergunta ao usuário como anúncio', () => {
        expect(looksLikeUnfinishedAnnouncement('Qual projeto você quer consultar?')).toBe(false);
    });

    it('NÃO marca resposta longa e detalhada como anúncio', () => {
        expect(looksLikeUnfinishedAnnouncement('Resposta detalhada. ' + 'x'.repeat(700))).toBe(false);
    });

    it('string vazia não é anúncio', () => {
        expect(looksLikeUnfinishedAnnouncement('')).toBe(false);
    });
});

// ── #957/#955: gate de conclusão estruturado ─────────────────────────────────────────
describe('evaluateConclusionGate (#957/#955)', () => {
    const base = { nudgedCount: 0, iteration: 0, maxIterations: 30 };

    it('resposta substantiva -> conclude', () => {
        expect(evaluateConclusionGate({ ...base, reply: 'O saldo do cliente é R$ 2.000,00.' }).action).toBe('conclude');
    });

    it('anúncio com orçamento de nudge -> nudge', () => {
        expect(evaluateConclusionGate({ ...base, reply: 'Vou verificar os logs...' }).action).toBe('nudge');
    });

    it('anúncio após esgotar o teto de nudges -> synthesize (não devolve cru)', () => {
        const r = evaluateConclusionGate({ ...base, reply: 'Vou verificar...', nudgedCount: MAX_CONCLUSION_NUDGES });
        expect(r.action).toBe('synthesize');
    });

    it('anúncio na última iteração útil -> synthesize', () => {
        const r = evaluateConclusionGate({ ...base, reply: 'Deixa eu checar:', nudgedCount: 0, iteration: 29, maxIterations: 30 });
        expect(r.action).toBe('synthesize');
    });

    it('pode cutucar mais de 1 vez (não tem o limite de 1x do #954)', () => {
        // 1º nudge consumiu 1; ainda há orçamento para um 2º.
        expect(evaluateConclusionGate({ ...base, reply: 'Vou verificar...', nudgedCount: 1 }).action).toBe('nudge');
    });

    it('resposta vazia -> conclude', () => {
        expect(evaluateConclusionGate({ reply: '', nudgedCount: 0, iteration: 0, maxIterations: 30 }).action).toBe('conclude');
    });
});

// ── #957: integração no loop do LocalProvider (agente Marciano) ──────────────────────
describe('LocalProvider.generateReply (#957) — seenToolCalls + gate de conclusão', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        aiService.setConfig('local', 'http://localhost:11434/v1', undefined, 'llama3');
    });

    it('re-chamada legítima (mesma tool+args) NÃO encerra o turno silenciosamente: avisa e continua', async () => {
        (dolibarrService.listUsers as any).mockResolvedValue([]);

        let call = 0;
        (axios.post as any).mockImplementation(async () => {
            call++;
            if (call === 1) return { data: { choices: [{ message: { content: '{"tool":"list_users","args":{"search":"marcus"}}' } }] } };
            if (call === 2) {
                // modelo repete a MESMA chamada (args idênticos) -> duplicata.
                return { data: { choices: [{ message: { content: '{"tool":"list_users","args":{"search":"marcus"}}' } }] } };
            }
            if (call === 3) {
                // modelo atende ao aviso e VARIA os parâmetros -> executa de novo (progresso).
                return { data: { choices: [{ message: { content: '{"tool":"list_users","args":{"search":"marcus oliveira"}}' } }] } };
            }
            return { data: { choices: [{ message: { content: 'Marcus Oliveira encontrado.' } }] } };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        const result = await provider.generateReply([{ role: 'user', parts: 'ache o marcus' } as any], 'ctx');

        // Concluiu com a resposta final (não caiu em síntese prematura nem em "Max iterations").
        expect(result.text).toBe('Marcus Oliveira encontrado.');

        // O aviso de duplicata foi injetado e aproveitado na chamada seguinte (prova continue, não break).
        const promptCall3 = (axios.post as any).mock.calls[2][1].messages[0].content;
        expect(promptCall3).toContain('já chamou list_users');
    });

    it('seenToolCalls normaliza ordem de chaves: args equivalentes contam como duplicata', async () => {
        (dolibarrService.listUsers as any).mockResolvedValue([]);
        let call = 0;
        (axios.post as any).mockImplementation(async () => {
            call++;
            if (call === 1) return { data: { choices: [{ message: { content: '{"tool":"list_users","args":{"search":"x","limit":5}}' } }] } };
            if (call === 2) {
                // MESMA semântica, ordem de chaves diferente -> antes NÃO era dedupado (#957 corrige).
                return { data: { choices: [{ message: { content: '{"tool":"list_users","args":{"limit":5,"search":"x"}}' } }] } };
            }
            return { data: { choices: [{ message: { content: 'Concluído com os dados.' } }] } };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        const result = await provider.generateReply([{ role: 'user', parts: 'busca x' } as any], 'ctx');

        expect(result.text).toBe('Concluído com os dados.');
        // list_users foi executado SÓ na 1ª chamada (a 2ª foi reconhecida como duplicata normalizada).
        expect((dolibarrService.listUsers as any).mock.calls.length).toBe(1);
        const promptCall3 = (axios.post as any).mock.calls[2][1].messages[0].content;
        expect(promptCall3).toContain('já chamou list_users');
    });

    it('gate de conclusão cutuca o caso "Vou disparar as 6 ferramentas…:" que a regex #954 perdia', async () => {
        (dolibarrService.listUsers as any).mockResolvedValue([]);
        let call = 0;
        (axios.post as any).mockImplementation(async () => {
            call++;
            if (call === 1) return { data: { choices: [{ message: { content: 'Vou disparar as 6 ferramentas…:' } }] } };
            if (call === 2) return { data: { choices: [{ message: { content: '{"tool":"list_users","args":{"search":"x"}}' } }] } };
            return { data: { choices: [{ message: { content: 'Pronto, concluí o levantamento.' } }] } };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        const result = await provider.generateReply([{ role: 'user', parts: 'levanta tudo' } as any], 'ctx');

        expect(result.text).toBe('Pronto, concluí o levantamento.');
        // O gate injetou o nudge estruturado (não a regex #954) — visível no prompt da 2ª chamada.
        const promptCall2 = (axios.post as any).mock.calls[1][1].messages[0].content;
        expect(promptCall2).toContain('ANUNCIOU uma ação');
    });

    it('gate esgota o orçamento de nudges -> força síntese (não devolve o anúncio cru)', async () => {
        (dolibarrService.listUsers as any).mockResolvedValue([]);
        let call = 0;
        (axios.post as any).mockImplementation(async () => {
            call++;
            if (call <= 3) return { data: { choices: [{ message: { content: 'Vou verificar de novo…' } }] } }; // insiste no anúncio
            return { data: { choices: [{ message: { content: 'Resumo sintético do que foi coletado.' } }] } };    // síntese
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        const result = await provider.generateReply([{ role: 'user', parts: 'qualquer coisa' } as any], 'ctx');

        // Não devolveu o anúncio cru; foi para a síntese.
        expect(result.text).toBe('Resumo sintético do que foi coletado.');
        expect(result.text).not.toContain('Vou verificar');
    });
});
