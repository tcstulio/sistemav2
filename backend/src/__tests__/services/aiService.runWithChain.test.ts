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
        expect(exec).toHaveBeenNthCalledWith(1, 'glm');
        expect(exec).toHaveBeenNthCalledWith(2, 'minimax');
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
        expect(exec).toHaveBeenCalledWith('minimax');
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
