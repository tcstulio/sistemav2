/**
 * #1408 — Testes de ENFORCEMENT dos dials do agente no runner (LocalProvider).
 *
 * Prova que os dois dials que antes eram TEATRO agora governam o loop de verdade:
 *  (a) mudar `maxToolCallsPerConversation` muda o teto de tool-calls OBSERVÁVEL (nº de
 *      executeTool disparados) e, ao estourar, interrompe com ERRO EXPLÍCITO (não silêncio);
 *  (b) mudar `requireConfirmationFor` muda o gate de aprovação: sem aprovação a tool NÃO executa
 *      (mensagem clara); com aprovação (ou admin) executa.
 *
 * Estratégia: mocka o `agentConfigService` (fonte de verdade, mutável entre os casos) e o
 * `executeTool` (espião), dirigindo as respostas do LLM via axios. Assim o teste isola o
 * comportamento do RUNNER dado o config — que é exatamente o critério de aceite da issue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
        this.models = { generateContent: vi.fn(), list: vi.fn() };
    }),
}));

vi.mock('fs/promises', () => ({
    default: { readFile: vi.fn().mockRejectedValue(new Error('File not found')) },
}));

vi.mock('../../config/env', () => ({
    config: {
        googleApiKey: 'test-api-key',
        geminiModel: 'gemini-2.0-flash',
        llmProvider: 'local',
        localLlmUrl: 'http://localhost:11434/v1',
        localModelName: 'llama3',
        llmPrimaryTimeoutMs: 5000,
        llmRetryDeadlineMs: 0,
        agentContextBudgetPct: 0.72,
        // #1408: null => a fonte de verdade é o config service (sem override de cold-start).
        agentMaxIterations: null,
    },
}));

// #1408: config service mockado com estado MUTÁVEL — mudá-lo entre os casos é o que prova
// "mudar o dial muda o comportamento do runner".
const dialState = vi.hoisted(() => ({ maxToolCalls: 50, requireConfirmationFor: [] as string[], isAdmin: false }));
vi.mock('../../services/agentConfigService', () => ({
    agentConfigService: {
        getSystemPrompt: () => '',
        getMaxToolCalls: () => dialState.maxToolCalls,
        requiresConfirmation: (tool: string) => dialState.requireConfirmationFor.includes(tool),
    },
}));

// #1408: executeTool espião + getToolContext controlável (admin bypass). TOOLS_PROMPT trivial.
const toolState = vi.hoisted(() => ({ isAdmin: false }));
const executeToolMock = vi.hoisted(() => vi.fn(async () => 'RESULTADO OK'));
vi.mock('../../services/agentTools', () => ({
    TOOLS_PROMPT: 'FERRAMENTAS',
    executeTool: executeToolMock,
    getToolContext: () => ({ listener: null, isAdmin: toolState.isAdmin }),
}));

// Serviços pesados que o módulo aiService carrega no import — stubs mínimos.
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/llmHealthService', () => ({
    llmHealthService: {
        isAvailable: vi.fn(() => true), recordSuccess: vi.fn(), recordQuotaError: vi.fn(),
        recordTransientError: vi.fn(), resetProvider: vi.fn(),
    },
}));
vi.mock('../../services/configService', () => ({
    configService: {
        getModuleConfig: vi.fn().mockReturnValue({ provider: 'local', model: 'llama3' }),
        isRunWithChainEnabled: vi.fn().mockReturnValue(false),
        getFallbackChain: vi.fn().mockReturnValue(['local']),
    },
    ConfigService: class {},
}));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: vi.fn(() => true) }));
vi.mock('../../services/scraperService', () => ({
    ScraperService: { searchGoogle: vi.fn(), fetchPageContent: vi.fn() },
}));

import { LocalProvider, TOOL_BUDGET_EXHAUSTED_MSG } from '../../services/aiService';

/** Faz o axios devolver, em sequência, os conteúdos de `replies` (o resto repete o último). */
function scriptLlm(replies: string[]) {
    let i = 0;
    (axios.post as any).mockImplementation(async () => {
        const content = replies[Math.min(i, replies.length - 1)];
        i++;
        return { data: { choices: [{ message: { content } }] } };
    });
}

const user = [{ role: 'user', parts: 'faça a tarefa' } as any];

describe('#1408 — enforcement de maxToolCallsPerConversation no runner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dialState.maxToolCalls = 50;
        dialState.requireConfirmationFor = [];
        toolState.isAdmin = false;
        executeToolMock.mockImplementation(async () => 'RESULTADO OK');
    });

    it('teto=2: a 3ª tool call é INTERROMPIDA com erro explícito (não silenciosa)', async () => {
        dialState.maxToolCalls = 2;
        // O modelo insiste em chamar ferramentas com args SEMPRE distintos (nunca conclui) —
        // sem o teto, isso rodaria indefinidamente; com o teto=2, para na 3ª.
        let n = 0;
        (axios.post as any).mockImplementation(async () => {
            n++;
            return { data: { choices: [{ message: { content: `{"tool":"list_users","args":{"search":"q${n}"}}` } }] } };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        const result = await provider.generateReply(user, 'ctx');

        // Exatamente 2 execuções — a 3ª foi barrada ANTES de executar.
        expect(executeToolMock).toHaveBeenCalledTimes(2);
        // Interrupção EXPLÍCITA (mensagem de teto), não uma síntese silenciosa.
        expect(result.text).toBe(TOOL_BUDGET_EXHAUSTED_MSG(2));
    });

    it('mudar o teto muda o comportamento observável: teto=4 executa mais ferramentas que teto=2', async () => {
        const distinctToolCallLlm = () => {
            let n = 0;
            (axios.post as any).mockImplementation(async () => {
                n++;
                return { data: { choices: [{ message: { content: `{"tool":"list_users","args":{"search":"q${n}"}}` } }] } };
            });
        };

        dialState.maxToolCalls = 2;
        distinctToolCallLlm();
        await new LocalProvider('http://localhost:11434/v1', 'llama3').generateReply(user, 'ctx');
        const comTeto2 = executeToolMock.mock.calls.length;

        vi.clearAllMocks();
        executeToolMock.mockImplementation(async () => 'RESULTADO OK');
        dialState.maxToolCalls = 4;
        distinctToolCallLlm();
        await new LocalProvider('http://localhost:11434/v1', 'llama3').generateReply(user, 'ctx');
        const comTeto4 = executeToolMock.mock.calls.length;

        expect(comTeto2).toBe(2);
        expect(comTeto4).toBe(4);
        expect(comTeto4).toBeGreaterThan(comTeto2); // o dial move o teto de verdade
    });
});

describe('#1408 — enforcement de requireConfirmationFor (gate de aprovação) no runner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dialState.maxToolCalls = 50;
        dialState.requireConfirmationFor = [];
        toolState.isAdmin = false;
        executeToolMock.mockImplementation(async () => 'Fatura 5 removida do sistema.');
    });

    it('lista VAZIA: deleteInvoice executa sem aprovação (baseline)', async () => {
        dialState.requireConfirmationFor = [];
        scriptLlm([
            '{"tool":"deleteInvoice","args":{"id":5}}',
            'Operação concluída conforme o resultado da ferramenta.',
        ]);

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(user, 'ctx');

        expect(executeToolMock).toHaveBeenCalledWith('deleteInvoice', { id: 5 });
    });

    it('com deleteInvoice na lista e SEM aprovação: NÃO executa e devolve mensagem clara', async () => {
        dialState.requireConfirmationFor = ['deleteInvoice'];
        scriptLlm([
            '{"tool":"deleteInvoice","args":{"id":5}}',
            'Preciso que você confirme antes de prosseguir com a remoção da fatura 5.',
        ]);

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        const result = await provider.generateReply(user, 'ctx');

        // A tool que exige confirmação NÃO foi executada.
        expect(executeToolMock).not.toHaveBeenCalledWith('deleteInvoice', expect.anything());
        expect(executeToolMock).not.toHaveBeenCalled();
        // O runner injetou a instrução de confirmação no contexto (visível no prompt seguinte).
        const secondCallMessages = (axios.post as any).mock.calls[1][1].messages;
        expect(secondCallMessages[0].content).toContain('CONFIRMAÇÃO NECESSÁRIA deleteInvoice');
        // E o turno terminou pedindo a confirmação (não afirmou sucesso).
        expect(result.text).toContain('confirme');
    });

    it('com deleteInvoice na lista e COM aprovação (approvedTools): executa normalmente', async () => {
        dialState.requireConfirmationFor = ['deleteInvoice'];
        scriptLlm([
            '{"tool":"deleteInvoice","args":{"id":5}}',
            'Pronto, segui com base no resultado da ferramenta.',
        ]);

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(user, 'ctx', undefined, { approvedTools: ['deleteInvoice'] });

        expect(executeToolMock).toHaveBeenCalledWith('deleteInvoice', { id: 5 });
    });

    it('bypass de admin: com a tool na lista mas chamador admin, executa sem approvedTools', async () => {
        dialState.requireConfirmationFor = ['deleteInvoice'];
        toolState.isAdmin = true;
        scriptLlm([
            '{"tool":"deleteInvoice","args":{"id":5}}',
            'Pronto, segui com base no resultado da ferramenta.',
        ]);

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(user, 'ctx');

        expect(executeToolMock).toHaveBeenCalledWith('deleteInvoice', { id: 5 });
    });
});
