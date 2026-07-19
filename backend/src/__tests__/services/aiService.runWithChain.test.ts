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

// #1551: logger hoistado para que testes possam asserção sobre log.info/log.warn
// (em particular a linha "chain resumed with N messages, M tool calls seen").
const {
    mockLogInfo,
    mockLogWarn,
    mockLogError,
    mockLogDebug,
} = vi.hoisted(() => ({
    mockLogInfo: vi.fn(),
    mockLogWarn: vi.fn(),
    mockLogError: vi.fn(),
    mockLogDebug: vi.fn(),
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
    logger: { child: () => ({ info: mockLogInfo, warn: mockLogWarn, error: mockLogError, debug: mockLogDebug }) },
    createLogger: () => ({ info: mockLogInfo, warn: mockLogWarn, error: mockLogError, debug: mockLogDebug }),
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

import { aiService, UnrecoverableChainError } from '../../services/aiService';

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

describe('aiService.runWithChain — logs e reset controlado (#1551)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAvailable.mockReturnValue(true);
        mockIsQuotaError.mockImplementation((msg: string) => !!(msg?.includes('429') || msg?.includes('rate limit')));
    });

    // helper: conta chamadas a log.info cujo 1º arg contenha o trecho indicado.
    const countInfoContaining = (needle: string) =>
        mockLogInfo.mock.calls.filter(c => typeof c[0] === 'string' && c[0].includes(needle)).length;
    const countWarnContaining = (needle: string) =>
        mockLogWarn.mock.calls.filter(c => typeof c[0] === 'string' && c[0].includes(needle)).length;
    const infoCallsMatching = (re: RegExp) =>
        mockLogInfo.mock.calls.filter(c => typeof c[0] === 'string' && re.test(c[0]));
    const warnCallsMatching = (re: RegExp) =>
        mockLogWarn.mock.calls.filter(c => typeof c[0] === 'string' && re.test(c[0]));

    it('(c) log info "chain resumed with N messages, M tool calls seen" ao alternar de provider', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const exec = vi.fn(async (provider: string, state: any) => {
            if (provider === 'glm') {
                state.messages.push({ role: 'assistant', content: 'parcial' });
                state.messages.push({ role: 'tool', content: 'tool result' });
                state.seenToolCalls.add('search|x');
                state.seenToolCalls.add('search|y');
                throw makeQuotaError();
            }
            return 'ok-minimax';
        });

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe('ok-minimax');
        // formato exato exigido pelo critério (c)
        const resumed = infoCallsMatching(/chain resumed with \d+ messages, \d+ tool calls seen/);
        expect(resumed).toHaveLength(1);
        // N e M refletem o estado PRESERVADO (2 messages, 2 tool calls)
        expect(resumed[0][0]).toContain('chain resumed with 2 messages, 2 tool calls seen');
    });

    it('(c) log "chain resumed" NÃO dispara quando só há 1 provider na cadeia', async () => {
        mockGetFallbackChain.mockReturnValue(['glm']);

        const exec = vi.fn().mockRejectedValueOnce(makeQuotaError());

        await expect(aiService.runWithChain('chat', exec)).rejects.toThrow();

        expect(countInfoContaining('chain resumed')).toBe(0);
    });

    it('(d) primário entrega resposta válida → secundário nunca chamado e sem "chain resumed"', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const exec = vi.fn().mockResolvedValue(' resposta-final-do-primário');

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe(' resposta-final-do-primário');
        expect(exec).toHaveBeenCalledTimes(1);
        expect(exec).toHaveBeenCalledWith('glm', expect.anything());
        expect(countInfoContaining('chain resumed')).toBe(0);
    });

    it('(a/b) 429 no primário: secundário recebe messages + seenToolCalls por referência (sem reexecutar)', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);
        const reexecutions: string[] = [];
        let sameRef: any = null;

        const exec = vi.fn(async (provider: string, state: any) => {
            const sig = 'search_stock|{"sku":"A1"}';
            if (provider === 'glm') {
                sameRef = state;
                state.seenToolCalls.add(sig);
                state.messages.push({ role: 'assistant', content: 'tool_call emitido' });
                state.messages.push({ role: 'tool', tool_call_id: 't1', content: 'estoque=42' });
                throw makeQuotaError('HTTP 429 rate limit');
            }
            // fallback: mesma referência de estado; ferramenta já foi vista.
            expect(state).toBe(sameRef); // compartilhada por referência
            expect(state.seenToolCalls.has(sig)).toBe(true);
            expect(state.messages.length).toBe(2);
            if (!state.seenToolCalls.has(sig)) {
                reexecutions.push(sig);
            }
            return 'estoque A1 = 42';
        });

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe('estoque A1 = 42');
        expect(reexecutions).toEqual([]); // nada reexecutado
        expect(exec).toHaveBeenCalledTimes(2);
    });

    it('(e) UnrecoverableChainError → reset total + log "chain reset: <motivo>"', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const exec = vi.fn(async (provider: string, state: any) => {
            if (provider === 'glm') {
                state.seenToolCalls.add('keep|me');
                state.seenToolCalls.add('keep|me2');
                state.messages.push({ role: 'assistant', content: ' partial' });
                state.messages.push({ role: 'tool', content: 'partial tool result' });
                state.context = 'partial-context';
                throw new UnrecoverableChainError('schema incompatível entre providers');
            }
            // fallback: estado foi RESETADO — messages vazias, seenToolCalls vazio, contexto limpo.
            expect(state.messages).toEqual([]);
            expect(state.seenToolCalls.size).toBe(0);
            expect(state.context).toBe('');
            return 'ok-after-reset';
        });

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe('ok-after-reset');
        // log warn "chain reset: <motivo>" emitido (critério e)
        const resets = warnCallsMatching(/chain reset:/);
        expect(resets).toHaveLength(1);
        expect(resets[0][0]).toContain('chain reset: schema incompatível entre providers');
        // após reset, "chain resumed" registra 0/0
        const resumed = infoCallsMatching(/chain resumed with 0 messages, 0 tool calls seen/);
        expect(resumed).toHaveLength(1);
    });

    it('(e) HTTP 422 (schema) → reset + "chain reset"', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const schemaErr: any = new Error('HTTP 422 Unprocessable Entity');
        schemaErr.response = { status: 422, data: { error: 'validation failed' } };

        const exec = vi.fn(async (provider: string, state: any) => {
            if (provider === 'glm') {
                state.seenToolCalls.add('persistir|isto');
                state.messages.push({ role: 'user', content: 'olá' });
                throw schemaErr;
            }
            expect(state.seenToolCalls.size).toBe(0);
            expect(state.messages).toEqual([]);
            return 'ok';
        });

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe('ok');
        expect(countWarnContaining('chain reset:')).toBe(1);
    });

    it('(e) HTTP 400 (bad request) → reset', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const badReqErr: any = new Error('HTTP 400 Bad Request');
        badReqErr.response = { status: 400, data: { error: 'malformed payload' } };

        const exec = vi.fn(async (provider: string, state: any) => {
            if (provider === 'glm') {
                state.messages.push({ role: 'assistant', content: 'lixo' });
                throw badReqErr;
            }
            expect(state.messages).toEqual([]);
            return 'ok';
        });

        await aiService.runWithChain('chat', exec);

        expect(countWarnContaining('chain reset:')).toBe(1);
    });

    it('(e) flag err.unrecoverable=true → reset', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const flagged: any = new Error('something weird');
        flagged.unrecoverable = true;

        const exec = vi.fn(async (provider: string, state: any) => {
            if (provider === 'glm') {
                state.seenToolCalls.add('x|y');
                throw flagged;
            }
            expect(state.seenToolCalls.size).toBe(0);
            return 'ok';
        });

        await aiService.runWithChain('chat', exec);

        expect(countWarnContaining('chain reset:')).toBe(1);
    });

    it('(a vs e) 429 preserva estado; 422 reseta (transiente vs irrecuperável)', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const err422: any = new Error('HTTP 422 Unprocessable Entity');
        err422.response = { status: 422, data: {} };

        const exec = vi.fn(async (provider: string, state: any) => {
            if (provider === 'glm') {
                state.seenToolCalls.add('keep|me');
                state.messages.push({ role: 'assistant', content: 'partial' });
                throw err422;
            }
            // irrecuperável: resetou
            expect(state.seenToolCalls.size).toBe(0);
            expect(state.messages.length).toBe(0);
            return 'ok';
        });

        await aiService.runWithChain('chat', exec);

        expect(countWarnContaining('chain reset:')).toBe(1);
        // E NÃO registrou warn "tentando próximo (preservando"
        expect(countWarnContaining('preservando')).toBe(0);
    });

    it('(e) JSON corrompido (Unexpected token, sem status HTTP) → reset', async () => {
        // "mensagem corrompida" per criterion (e): parse de JSON ilegível vindo
        // do provider. Sem .response → detail cai p/ err.message.
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const jsonErr = new Error('Unexpected token < in JSON at position 0');

        const seen: any = {};
        const exec = vi.fn(async (provider: string, state: any) => {
            if (provider === 'glm') {
                state.seenToolCalls.add('tool|x');
                state.messages.push({ role: 'assistant', content: 'lixo' });
                state.context = 'ctx-sujo';
                throw jsonErr;
            }
            seen.messagesLen = state.messages.length;
            seen.seenSize = state.seenToolCalls.size;
            seen.context = state.context;
            return 'ok';
        });

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe('ok');
        expect(seen).toEqual({ messagesLen: 0, seenSize: 0, context: '' });
        expect(countWarnContaining('chain reset:')).toBe(1);
        const resetCall = warnCallsMatching(/chain reset:/)[0];
        expect(resetCall[0]).toMatch(/JSON|unexpected token/i);
    });

    it('(a) timeout (ETIMEDOUT, sem .response) NÃO reseta — preserva histórico como 429/5xx', async () => {
        // Critério (a) cita explicitamente "429/5xx/timeout": garante que timeout
        // de infra (err.code='ETIMEDOUT', sem err.response) é tratado como
        // TRANSIENTE e mantém messages/seenToolCalls intactos.
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax']);

        const timeoutErr: any = new Error('timeout of 5000ms exceeded');
        timeoutErr.code = 'ETIMEDOUT';

        const seen: any = {};
        const exec = vi.fn(async (provider: string, state: any) => {
            if (provider === 'glm') {
                state.seenToolCalls.add('slow|tool');
                state.messages.push({ role: 'assistant', content: 'parcial antes do timeout' });
                throw timeoutErr;
            }
            seen.messagesLen = state.messages.length;
            seen.hasSig = state.seenToolCalls.has('slow|tool');
            return 'ok';
        });

        const result = await aiService.runWithChain('chat', exec);

        expect(result).toBe('ok');
        expect(seen.messagesLen).toBe(1);
        expect(seen.hasSig).toBe(true);
        // Sem reset; com "chain resumed" registrando 1/1.
        expect(countWarnContaining('chain reset:')).toBe(0);
        const resumed = infoCallsMatching(/chain resumed with 1 messages, 1 tool calls seen/);
        expect(resumed).toHaveLength(1);
    });

    it('(b/c) seenToolCalls NUNCA recriado entre trocas — mesma instância de Set mesmo após reset', async () => {
        mockGetFallbackChain.mockReturnValue(['glm', 'minimax', 'google']);
        const setRefs: Set<string>[] = [];

        const exec = vi.fn(async (provider: string, state: any) => {
            setRefs.push(state.seenToolCalls);
            if (provider === 'glm') {
                state.seenToolCalls.add('first|glm');
                throw makeQuotaError(); // transiente: preserva
            }
            if (provider === 'minimax') {
                // ainda a MESMA instância de Set — nunca foi substituída
                expect(state.seenToolCalls.has('first|glm')).toBe(true);
                throw new UnrecoverableChainError('schema mismatch'); // irrecuperável: clear()
            }
            // google: mesmo Set (clear != recriar), mas vazio
            expect(state.seenToolCalls.size).toBe(0);
            return 'ok';
        });

        await aiService.runWithChain('chat', exec);

        // Set nunca foi recriado — clear() mantém a referça.
        expect(setRefs[0]).toBe(setRefs[1]);
        expect(setRefs[1]).toBe(setRefs[2]);
        // dois "chain resumed" (glm→minimax e minimax→google)
        expect(countInfoContaining('chain resumed')).toBe(2);
        // um reset (minimax→google)
        expect(countWarnContaining('chain reset:')).toBe(1);
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
