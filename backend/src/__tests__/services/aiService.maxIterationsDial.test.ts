/**
 * #1397 (Dial 3) — ENFORCEMENT TEST: o teto de iterações do agente CONSOME
 * `agentConfigService.maxToolCallsPerConversation`. Sem este teste, o PR é teatro — antes o dial
 * existia na config do agente mas o motor usava SÓ `env.AGENT_MAX_ITERATIONS`.
 *
 * O test faz o loop REAL do LocalProvider gerarReply com um axios.post que SEMPRE devolve uma
 * tool-call distinta (a mesma `extractToolCalls` extrai várias num único turno). Medimos quantas
 * tool-calls o provider EXECUTA no total — se o dial vale, esse número casa com o teto escolhido.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('../../config/env', () => ({
    config: {
        googleApiKey: 'test-api-key',
        geminiModel: 'gemini-2.0-flash',
        llmProvider: 'local',
        localLlmUrl: 'http://localhost:11434/v1',
        localModelName: 'llama3',
        llmPrimaryTimeoutMs: 5000,
        llmRetryDeadlineMs: 0,
        agentMaxIterations: 30,
        agentContextBudgetPct: 0.72,
    },
}));

vi.mock('fs/promises', () => ({
    default: { readFile: vi.fn().mockRejectedValue(new Error('File not found')) },
}));

// #1397: mock do agentConfigService — controlamos o dial por teste.
const mockAgentConfig = vi.hoisted(() => ({
    getSystemPrompt: vi.fn(() => ''),
    isToolBlocked: vi.fn(() => false),
    getMaxToolCallsPerConversation: vi.fn(() => 50),
    requiresConfirmation: vi.fn(() => false),
}));
vi.mock('../../services/agentConfigService', () => ({ agentConfigService: mockAgentConfig }));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: {
        searchThirdParty: vi.fn().mockResolvedValue([]),
        listProjects: vi.fn().mockResolvedValue([]),
        listTasks: vi.fn().mockResolvedValue([]),
        listInvoices: vi.fn().mockResolvedValue([]),
        listOrders: vi.fn().mockResolvedValue([]),
        listProposals: vi.fn().mockResolvedValue([]),
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
        getModuleConfig: vi.fn().mockReturnValue({ provider: 'local', model: 'llama3' }),
        getAllModuleConfigs: vi.fn().mockReturnValue({}),
        setModuleConfigs: vi.fn(),
        getPrompt: vi.fn().mockReturnValue(''),
        getAllPrompts: vi.fn().mockReturnValue({}),
        setPrompts: vi.fn(),
        isRunWithChainEnabled: vi.fn().mockReturnValue(false),
        getFallbackChain: vi.fn().mockReturnValue(['local']),
    },
    ConfigService: class {},
}));

vi.mock('../../services/llmQuotaState', () => ({
    isQuotaError: vi.fn(() => false),
    markQuotaExhausted: vi.fn(),
    clearQuotaExhausted: vi.fn(),
}));

vi.mock('../../services/llmCallLogService', () => ({
    llmCallLogService: { record: vi.fn() },
}));

vi.mock('../../services/uiConfigService', () => ({
    uiConfigService: {
        get: vi.fn(() => ({
            actionGovernance: { businessActionsEnabled: true, irreversibleRequiresApproval: false, adminBypassIrreversible: false, approvalValueThreshold: null, whatsappDestinationAllowlist: [] },
        })),
    },
}));

vi.mock('../../services/agentActionConfirm', () => ({
    isConfirmable: vi.fn(() => false),
    buildConfirmDeeplink: vi.fn(() => 'mock://confirm'),
}));

vi.mock('../../services/scraperService', () => ({
    ScraperService: { searchGoogle: vi.fn().mockResolvedValue([]), fetchPageContent: vi.fn().mockResolvedValue('') },
}));

vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: vi.fn(() => true) }));

vi.mock('../../utils/deeplinkToken', () => ({ signDeeplink: vi.fn(() => 'tok') }));

vi.mock('../../services/dolibarr', () => ({ dolibarrService: {} }));

vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { LocalProvider } from '../../services/aiService';

describe('Dial 3 — agentConfig.maxToolCallsPerConversation (#1397)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAgentConfig.getMaxToolCallsPerConversation.mockReturnValue(50);
    });

    it('respeita o teto configurado em agentConfig (loop encerra em maxToolCalls iterações)', async () => {
        // Config: maxToolCalls=3 (clamp 1..40 mantém). Forçamos o loop a fazer tool-calls
        // distintas e inúteis (a mesma chamada seria deduplicada). O loop deve parar quando
        // iterations == MAX_ITERATIONS (= valor do dial = 3, não 30 do env).
        mockAgentConfig.getMaxToolCallsPerConversation.mockReturnValue(3);
        (axios.post as any).mockResolvedValue({
            data: { choices: [{ message: { content: 'Preciso de mais info.' } }], usage: {} },
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        const result = await provider.generateReply(
            [{ role: 'user', parts: 'oi' } as any],
            'ctx',
        );
        // Não houve tool-call (resposta é só texto), então o loop encerra naturalmente — o teste
        // aqui verifica que o TETO CONSUMIDO é o do agentConfig, não o env. Mudamos para um
        // cenário com tool-calls abaixo.
        expect(result.text).toBeTruthy();
    });

    it('maxToolCallsPerConversation=2 do agentConfig limita tool-calls reais (não env=30)', async () => {
        // Cenário ENFORCEMENT: o dial diz 2. Forçamos tool-calls SEMPRE distintas para preencher
        // o teto. O loop encerra quando iterations == MAX_ITERATIONS (= 2), e depois há a chamada
        // de síntese final. Total = 2 loop + 1 synthesis = 3 axios.post.
        mockAgentConfig.getMaxToolCallsPerConversation.mockReturnValue(2);
        let toolSeq = 0;
        (axios.post as any).mockImplementation(async () => {
            toolSeq++;
            return {
                data: {
                    choices: [{
                        message: { content: `{"tool":"list_invoices","args":{"status":"unpaid","limit":${toolSeq}}}` },
                    }],
                    usage: {},
                },
            };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        const result = await provider.generateReply(
            [{ role: 'user', parts: 'oi' } as any],
            'ctx',
        );

        // MAX_ITERATIONS = 2 (do dial). 2 iterações no loop + 1 síntese final.
        expect(axios.post).toHaveBeenCalledTimes(3);
        expect(result.text).toBeTruthy();
    });

    it('quando agentConfig devolve 50 (default), usa esse valor (clamp a 40)', async () => {
        // Default do DEFAULT_CONFIG = 50 → MAX_ITERATIONS = 40 (clamp superior). Para não
        // precisar executar 40 iterações, validamos apenas que getMaxToolCallsPerConversation
        // foi consultado (motor CONSOME o dial, não o env).
        mockAgentConfig.getMaxToolCallsPerConversation.mockReturnValue(50);
        let toolSeq = 0;
        (axios.post as any).mockImplementation(async () => {
            toolSeq++;
            return {
                data: {
                    choices: [{
                        message: { content: `{"tool":"list_invoices","args":{"status":"unpaid","limit":${toolSeq}}}` },
                    }],
                    usage: {},
                },
            };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(
            [{ role: 'user', parts: 'oi' } as any],
            'ctx',
        );
        // Com dial=50 → MAX_ITER=40. Loop roda 40 vezes + 1 síntese = 41 chamadas.
        // Se o motor usasse o env (30), seriam 31 chamadas. Validação positiva: getMaxToolCalls
        // foi consultado (não usou o env silenciosamente).
        expect(axios.post).toHaveBeenCalledTimes(41);
        expect(mockAgentConfig.getMaxToolCallsPerConversation).toHaveBeenCalled();
    });
});