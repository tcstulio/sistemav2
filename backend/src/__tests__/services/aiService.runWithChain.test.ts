/**
 * Testes para aiService.runWithChain + probeProvider (#793)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks hoistados (vi.hoisted garante execução antes do vi.mock factory) ──

const {
    mockGetFallbackChain,
    mockIsRunWithChainEnabled,
    mockIsAvailable,
    mockRecordSuccess,
    mockRecordQuotaError,
    mockRecordTransientError,
    mockIsQuotaError,
} = vi.hoisted(() => ({
    mockGetFallbackChain: vi.fn(),
    mockIsRunWithChainEnabled: vi.fn(() => false),
    mockIsAvailable: vi.fn(() => true),
    mockRecordSuccess: vi.fn(),
    mockRecordQuotaError: vi.fn(),
    mockRecordTransientError: vi.fn(),
    mockIsQuotaError: vi.fn((msg: string) => !!(msg?.includes('429') || msg?.includes('rate limit'))),
}));

vi.mock('../../services/configService', () => ({
    configService: {
        getFallbackChain: mockGetFallbackChain,
        isRunWithChainEnabled: mockIsRunWithChainEnabled,
        getModuleConfig: vi.fn(() => ({ provider: 'glm', model: 'glm-5.1' })),
    },
    ConfigService: class {},
}));

vi.mock('../../services/llmHealthService', () => ({
    llmHealthService: {
        isAvailable: mockIsAvailable,
        recordSuccess: mockRecordSuccess,
        recordQuotaError: mockRecordQuotaError,
        recordTransientError: mockRecordTransientError,
        resetProvider: vi.fn(),
    },
}));

vi.mock('../../services/llmCallLogService', () => ({
    llmCallLogService: { record: vi.fn() },
}));

vi.mock('../../services/llmQuotaState', () => ({
    isQuotaError: mockIsQuotaError,
    markQuotaExhausted: vi.fn(),
    clearQuotaExhausted: vi.fn(),
    isQuotaExhausted: vi.fn(() => false),
    quotaStatus: vi.fn(() => ({ exhausted: false, since: null, reason: '' })),
}));

vi.mock('../../services/agentTools', () => ({
    TOOLS_PROMPT: '',
    // #1498: aiService.ts agora importa getToolsPrompt direto em vez do TOOLS_PROMPT wrapper.
    getToolsPrompt: () => '',
    executeTool: vi.fn(),
}));

vi.mock('../../services/agentConfigService', () => ({
    agentConfigService: { getSystemPrompt: vi.fn(() => '') },
}));

vi.mock('../../utils/logger', () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../config/env', () => ({
    config: {
        llmProvider: 'glm',
        zaiBaseUrl: 'http://zai.local',
        zaiModel: 'glm-5.1',
        zaiApiKey: 'key-zai',
        minimaxBaseUrl: 'http://minimax.local',
        minimaxModel: 'minimax-m3',
        minimaxApiKey: 'key-minimax',
        googleApiKey: '',
        geminiModel: 'gemini-2.0-flash',
        localLlmUrl: 'http://local.local',
        localModelName: 'llama3',
        llmPrimaryTimeoutMs: 5000,
        llmRetryDeadlineMs: 500,
    },
}));

vi.mock('../../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn(),
}));

vi.mock('../../services/tunnelService', () => ({
    tunnelService: { getUrl: vi.fn(() => null) },
}));

// ── Importa após os mocks ────────────────────────────────────────────────────

import { aiService } from '../../services/aiService';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeQuotaError(msg = 'HTTP 429 rate limit') {
    const err: any = new Error(msg);
    err.response = { status: 429, data: { error: msg } };
    return err;
}

// ── Testes ───────────────────────────────────────────────────────────────────

describe('aiService.runWithChain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAvailable.mockReturnValue(true);
        mockIsQuotaError.mockImplementation((msg: string) => !!(msg?.includes('429') || msg?.includes('rate limit')));
    });

    it('tenta o próximo provider em erro de cota', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const exec = vi.fn()
            .mockRejectedValueOnce(makeQuotaError())   // glm: 429
            .mockResolvedValueOnce('ok-minimax');      // minimax: ok

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe('ok-minimax');
        expect(exec).toHaveBeenCalledTimes(2);
        expect(exec).toHaveBeenNthCalledWith(1, 'glm', expect.objectContaining({ seenToolCalls: expect.any(Set), messages: expect.any(Array) }));
        expect(exec).toHaveBeenNthCalledWith(2, 'minimax', expect.objectContaining({ seenToolCalls: expect.any(Set), messages: expect.any(Array) }));
        expect(mockRecordQuotaError).toHaveBeenCalledWith('glm', expect.any(Error));
        expect(mockRecordSuccess).toHaveBeenCalledWith('minimax');
    });

    it('pula provider indisponível (em cooldown)', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax', 'google']);
        mockIsAvailable.mockImplementation((p: string) => p !== 'glm');

        const exec = vi.fn().mockResolvedValue('ok-minimax');

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe('ok-minimax');
        expect(exec).toHaveBeenCalledTimes(1);
        expect(exec).toHaveBeenCalledWith('minimax', expect.objectContaining({ seenToolCalls: expect.any(Set), messages: expect.any(Array) }));
        expect(mockRecordSuccess).toHaveBeenCalledWith('minimax');
    });

    it('sucesso registra recordSuccess no provider correto', async () => {
        mockGetFallbackChain.mockReturnValue(['glm']);
        mockIsAvailable.mockReturnValue(true);

        const exec = vi.fn().mockResolvedValue('resultado');

        await aiService.runWithChain('system_analysis', exec);

        expect(mockRecordSuccess).toHaveBeenCalledWith('glm');
        expect(mockRecordQuotaError).not.toHaveBeenCalled();
        expect(mockRecordTransientError).not.toHaveBeenCalled();
    });

    it('lança o último erro se todos os providers falharem', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);
        mockIsAvailable.mockReturnValue(true);

        const err1 = makeQuotaError('429 glm');
        const err2 = makeQuotaError('429 minimax');

        const exec = vi.fn()
            .mockRejectedValueOnce(err1)
            .mockRejectedValueOnce(err2);

        await expect(aiService.runWithChain('chat', exec)).rejects.toBe(err2);
    });

    it('lança erro se todos estão em cooldown (nenhum disponível)', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);
        mockIsAvailable.mockReturnValue(false);

        const exec = vi.fn().mockResolvedValue('nunca chamado');

        await expect(aiService.runWithChain('chat', exec)).rejects.toThrow();
        expect(exec).not.toHaveBeenCalled();
    });

    it('erro transiente (ECONNRESET) usa recordTransientError', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);
        mockIsAvailable.mockReturnValue(true);
        mockIsQuotaError.mockReturnValue(false); // não é erro de cota

        const networkErr = new Error('ECONNRESET');
        (networkErr as any).code = 'ECONNRESET';

        const exec = vi.fn()
            .mockRejectedValueOnce(networkErr)
            .mockResolvedValueOnce('ok');

        await aiService.runWithChain('chat', exec);

        expect(mockRecordTransientError).toHaveBeenCalledWith('glm', networkErr);
        expect(mockRecordSuccess).toHaveBeenCalledWith('minimax');
    });
});

describe('aiService.runWithChain — preserva contexto ao trocar de provider (#1010)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAvailable.mockReturnValue(true);
        mockIsQuotaError.mockImplementation((msg: string) => !!(msg?.includes('429') || msg?.includes('rate limit')));
    });

    it('fallback vê seenToolCalls do primário e NÃO reexecuta a ferramenta', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const executedTools: string[] = [];
        const exec = vi.fn(async (provider: string, state: any) => {
            const sig = 'search_customer|{"q":"Acme"}';
            if (provider === 'glm') {
                // Primário: executa uma tool_call e acumula o estado...
                state.seenToolCalls.add(sig);
                state.messages.push({ role: 'assistant', content: '<tool_call: search_customer>' });
                state.messages.push({ role: 'tool', tool_call_id: 'x', content: 'cliente Acme encontrado' });
                state.context += '[TOOL RESULT search_customer]: cliente Acme encontrado';
                executedTools.push('search_customer@glm');
                // ...mas a chamada de synthesize falha (cota) -> troca de provider.
                throw makeQuotaError();
            }
            // Fallback: o modelo re-emite a MESMA tool_call; já está no seenToolCalls.
            expect(state.seenToolCalls.has(sig)).toBe(true);
            // Como já foi executada, NÃO repete — usa o progresso parcial.
            if (state.seenToolCalls.has(sig)) return 'resposta usando dados coletados pelo primário';
            executedTools.push('search_customer@minimax');
            return 'repetiu a tool';
        });

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe('resposta usando dados coletados pelo primário');
        // ferramenta executada UMA vez apenas (no primário) — fallback não repetiu.
        expect(executedTools).toEqual(['search_customer@glm']);
        expect(exec).toHaveBeenCalledTimes(2);
    });

    it('messages.length cresce (não reseta) entre trocas de provider', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);
        const lengthsAtExec: number[] = [];

        const exec = vi.fn(async (provider: string, state: any) => {
            lengthsAtExec.push(state.messages.length);
            if (provider === 'glm') {
                state.messages.push({ role: 'assistant', content: 'raciocínio parcial' });
                state.messages.push({ role: 'tool', content: 'tool result A' });
                throw makeQuotaError();
            }
            // fallback: vê messages.length = 2 (não 0 — não resetou).
            expect(state.messages.length).toBe(2);
            state.messages.push({ role: 'assistant', content: 'final' });
            return 'ok';
        });

        await aiService.runWithChain('chat', exec);

        // 1ª exec (glm): 0 mensagens; após falha, messages cresceu p/ 2.
        // 2ª exec (minimax): vê 2 (não resetou p/ 0).
        expect(lengthsAtExec).toEqual([0, 2]);
    });

    it('falha primário -> sucesso fallback -> sem duplicação de tool_results', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const toolResults: string[] = [];
        const exec = vi.fn(async (provider: string, state: any) => {
            const sig = 'get_stock|{"sku":"A1"}';
            if (provider === 'glm') {
                state.seenToolCalls.add(sig);
                state.messages.push({ role: 'assistant', content: 'chamei get_stock' });
                state.messages.push({ role: 'tool', tool_call_id: 't1', name: 'get_stock', content: 'estoque=10' });
                toolResults.push('get_stock@glm');
                throw makeQuotaError();
            }
            // fallback: modelo re-emite get_stock; já está em seenToolCalls -> descarta.
            expect(state.seenToolCalls.has(sig)).toBe(true);
            if (!state.seenToolCalls.has(sig)) {
                toolResults.push('get_stock@minimax'); // nunca entra aqui
            }
            return 'estoque do produto A1 é 10';
        });

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe('estoque do produto A1 é 10');
        // só UM tool_result registrado (no primário); fallback não repetiu.
        expect(toolResults).toHaveLength(1);
        expect(toolResults).toEqual(['get_stock@glm']);
    });

    it('honra semente via opts.initialState (retoma cadeia interrompida)', async () => {
        mockGetFallbackChain.mockReturnValue(['glm']);
        const seededSeen = new Set<string>(['existing_tool|x']);

        const exec = vi.fn(async (_provider: string, state: any) => {
            expect(state.seenToolCalls.has('existing_tool|x')).toBe(true);
            expect(state.messages).toHaveLength(1);
            expect(state.context).toBe('ctx-previo');
            return 'ok';
        });

        await aiService.runWithChain('chat', exec, {
            initialState: { messages: [{ role: 'user', content: 'oi' }], seenToolCalls: seededSeen, context: 'ctx-previo' },
        });

        expect(exec).toHaveBeenCalledWith('glm', expect.any(Object));
    });

    it('objeto state é a MESMA referência entre providers (mutações persistem)', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);
        const refs: any[] = [];

        const exec = vi.fn(async (provider: string, state: any) => {
            refs.push(state);
            if (provider === 'glm') {
                state.seenToolCalls.add('keep|me');
                throw makeQuotaError();
            }
            return 'ok';
        });

        await aiService.runWithChain('chat', exec);

        expect(refs).toHaveLength(2);
        expect(refs[0]).toBe(refs[1]); // mesma referência
        expect(refs[1].seenToolCalls.has('keep|me')).toBe(true);
    });
});

describe('aiService — flag OFF mantém caminho legado (não usa runWithChain)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsRunWithChainEnabled.mockReturnValue(false);
        mockIsAvailable.mockReturnValue(true);
    });

    it('generateReply não consulta getFallbackChain quando flag OFF', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        try {
            await aiService.generateReply([], 'ctx', undefined, 'chat');
        } catch {
            // provider fake vai falhar — não importa
        }

        // No caminho legado, getFallbackChain nunca é chamado
        expect(mockGetFallbackChain).not.toHaveBeenCalled();
    });

    it('analyzeSentiment não consulta getFallbackChain quando flag OFF', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        try {
            await aiService.analyzeSentiment('hello', 'chat');
        } catch {
            // esperado — sem provider real
        }

        expect(mockGetFallbackChain).not.toHaveBeenCalled();
    });
});
