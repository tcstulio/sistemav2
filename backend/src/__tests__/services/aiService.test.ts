import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('../../services/configService', () => ({
    configService: {
        getModuleConfig: vi.fn().mockReturnValue({ provider: 'google', model: 'gemini-2.0-flash' }),
        getAllModuleConfigs: vi.fn().mockReturnValue({}),
        setModuleConfigs: vi.fn(),
        getPrompt: vi.fn().mockReturnValue(''),
        getAllPrompts: vi.fn().mockReturnValue({}),
        setPrompts: vi.fn(),
    },
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

import { aiService } from '../../services/aiService';
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
            const result = await aiService.analyzeSystem('test');
            expect(typeof result).toBe('string');
        });

        it('analyzeSentiment returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '{"score":70,"label":"Positive"}' } }] } });
            const result = await aiService.analyzeSentiment('test');
            expect(result.score).toBe(70);
        });

        it('analyzeSentiment handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            const result = await aiService.analyzeSentiment('test');
            expect(result.label).toBe('Error');
        });

        it('extractCustomerInfo returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: '{"name":"John","email":"j@t.com"}' } }] } });
            const result = await aiService.extractCustomerInfo('John john@test.com');
            expect(result.name).toBe('John');
        });

        it('extractCustomerInfo handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            const result = await aiService.extractCustomerInfo('test');
            expect(result).toEqual({});
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

        it('analyzeFinancialHealth returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: 'Finance report' } }] } });
            const result = await aiService.analyzeFinancialHealth({ data: 1 });
            expect(result).toBe('Finance report');
        });

        it('analyzeFinancialHealth handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            const result = await aiService.analyzeFinancialHealth({});
            expect(typeof result).toBe('string');
        });

        it('fixApiCall returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: 'Fix: check timeout' } }] } });
            const result = await aiService.fixApiCall({ error: 'timeout' });
            expect(result).toBe('Fix: check timeout');
        });

        it('fixApiCall handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            const result = await aiService.fixApiCall({});
            expect(typeof result).toBe('string');
        });

        it('generateCode returns result', async () => {
            (axios.post as any).mockResolvedValue({ data: { choices: [{ message: { content: 'function test() {}' } }] } });
            const result = await aiService.generateCode('/api/test', 'GET');
            expect(result).toBe('function test() {}');
        });

        it('generateCode handles error', async () => {
            (axios.post as any).mockRejectedValue(new Error('fail'));
            const result = await aiService.generateCode('/api/test', 'GET');
            expect(result).toBe('// Local Gen Failed');
        });

        it('transcribeAudio roteia para Google quando provider de texto é local', async () => {
            // #57 Peça 3: LocalProvider não transcreve áudio -> roteia para o Google.
            (GoogleGenAI as any).mockImplementation(function (this: any) {
                this.models = {
                    generateContent: vi.fn().mockResolvedValue({ text: 'Roteado para Google' }),
                    list: vi.fn(),
                };
            });
            const result = await aiService.transcribeAudio('base64audio');
            expect(result).toBe('Roteado para Google');
        });

        it('transcribeAudio cai para mensagem indisponível sem provider multimodal', async () => {
            // Sem googleApiKey não há fallback multimodal -> mantém o LocalProvider (degradação graciosa).
            const { config } = await import('../../config/env');
            const original = (config as any).googleApiKey;
            (config as any).googleApiKey = '';
            try {
                const result = await aiService.transcribeAudio('base64audio');
                expect(result).toContain('dispon');
            } finally {
                (config as any).googleApiKey = original;
            }
        });

        it('draftCollectionEmail falls back for local provider', async () => {
            const result = await aiService.draftCollectionEmail({ name: 'John' }, 100);
            const parsed = JSON.parse(result);
            expect(parsed.subject).toBe('N/A');
        });

        it('generateSalesForecast falls back for local provider', async () => {
            const result = await aiService.generateSalesForecast([]);
            const parsed = JSON.parse(result);
            expect(parsed.summary).toContain('dispon');
        });

        it('analyzeCustomerSentiment falls back for local provider', async () => {
            const result = await aiService.analyzeCustomerSentiment({}, []);
            const parsed = JSON.parse(result);
            expect(parsed.label).toBe('N/A');
        });

        it('auditProposal falls back for local provider', async () => {
            const result = await aiService.auditProposal({});
            const parsed = JSON.parse(result);
            expect(parsed.score).toBe(0);
        });

        it('auditProject falls back for local provider', async () => {
            const result = await aiService.auditProject({});
            const parsed = JSON.parse(result);
            expect(parsed.health).toBe('unknown');
        });

        it('analyzeSystemLogs falls back for local provider', async () => {
            const result = await aiService.analyzeSystemLogs([]);
            expect(result).toBe('[]');
        });

        it('analyzeMonthlyReport falls back for local provider', async () => {
            const result = await aiService.analyzeMonthlyReport({});
            expect(result).toContain('dispon');
        });
    });
});
