/**
 * #1408 — Teste de INTEGRAÇÃO (sem mock do config service) do runner do agente.
 *
 * Complementa `aiService.enforcement.test.ts` (que mocka o `agentConfigService` para isolar
 * o loop) e `agentConfigService.dials.test.ts` (que cobre os dials isoladamente): este teste
 * prova que o CAMINHO COMPLETO `config service → runner` funciona sem o mock do config —
 * o `agentConfigService` REAL é carregado em memória, semeado com o config de produção, e o
 * `LocalProvider` consulta o dial verdadeiro.
 *
 * Por que isso importa: o critério de aceite da issue é literal — "mudar o dial muda o
 * comportamento observável". O teste do enforcement garante isso isolando os dois lados
 * (config + runner), mas se algo desconectar o fio entre eles (ex.: refactor que troca a
 * chamada por uma constante congelada) os mocks não pegam. Este teste pega.
 *
 * Estratégia: NÃO mockar `agentConfigService` (o objeto real é importado e usado). Em vez
 * disso, semeamos `(svc as any).profile = ...` para evitar a chamada de rede ao Dolibarr
 * em `refresh()`. O `axios` (chamada HTTP ao LLM) e `executeTool` (chamada de ferramentas
 * de produção) continuam mockados — o que está sob teste é o ACOPLAMENTO entre os dois.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// #1408: o config service NÃO é mockado aqui. Usamos o singleton real.
vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
        this.models = { generateContent: vi.fn(), list: vi.fn() };
    }),
}));

vi.mock('fs/promises', () => ({
    default: { readFile: vi.fn().mockRejectedValue(new Error('File not found')) },
}));

// env mockado — `agentMaxIterations` null para garantir que o config service é a fonte de verdade.
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
        agentMaxIterations: null,
    },
}));

vi.mock('../../services/agentPromptStore', () => ({
    agentPromptStore: { getBasePrompt: vi.fn(() => '') },
}));

// #1408: `executeTool` continua mockado — não queremos chamar ferramentas de produção
// (que dependem de Dolibarr, banco, etc.). O que está sob teste é o ACOPLAMENTO config→runner.
const toolState = vi.hoisted(() => ({ isAdmin: false }));
const executeToolMock = vi.hoisted(() => vi.fn(async () => 'RESULTADO OK'));
vi.mock('../../services/agentTools', () => ({
    TOOLS_PROMPT: 'FERRAMENTAS',
    executeTool: executeToolMock,
    getToolContext: () => ({ listener: null, isAdmin: toolState.isAdmin }),
}));

// #1408: `dolibarrService` é mockado para IMPEDIR a chamada de rede quando o
// `agentConfigService.refresh()` for acionado. O `refresh()` é lazy (chamado em
// `getConfig()` se o profile não estiver carregado) — semeamos `profile` direto
// para nunca chegar lá. Mas o `require()` lazy do `dolibarrService` em refresh()
// ainda precisa de um stub válido.
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

// IMPORTS: agentConfigService REAL (não mockado) + LocalProvider.
import { agentConfigService } from '../../services/agentConfigService';
import { LocalProvider, TOOL_BUDGET_EXHAUSTED_MSG } from '../../services/aiService';

const user = [{ role: 'user', parts: 'faça a tarefa' } as any];

/**
 * Semeia o profile REAL do singleton com o config MÍNIMO necessário para o loop rodar.
 * O `getSystemPrompt()` consome várias chaves (blockedTools, allowedTools, etc.) — semeamos
 * só as pedidas pelos dials sob teste (maxToolCallsPerConversation, requireConfirmationFor)
 * + defaults vazios para satisfazer o consumer sem mexer no que não está sob teste.
 */
function seedRealProfile(cfg: {
    maxToolCallsPerConversation?: number;
    requireConfirmationFor?: string[];
}) {
    (agentConfigService as any).profile = {
        config: {
            blockedTools: [],
            allowedTools: 'all',
            requireConfirmationFor: [],
            maxToolCallsPerConversation: 50,
            ...cfg,
        },
    };
    // Invalida o cache para forçar releitura do profile semeado.
    (agentConfigService as any).lastFetch = Date.now();
}

describe('#1408 — integração REAL config service → runner (sem mock do config)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        toolState.isAdmin = false;
        executeToolMock.mockImplementation(async () => 'RESULTADO OK');
        // Reseta o profile do singleton para isolar entre os testes.
        (agentConfigService as any).profile = null;
    });

    it('integration #1 (a): teto=2 no config REAL → runner executa no máximo 2 tools', async () => {
        // Semeia o config real com o dial que queremos testar.
        seedRealProfile({ maxToolCallsPerConversation: 2 });

        // O LLM insiste em ferramentas com args SEMPRE distintos (nunca conclui).
        let n = 0;
        (axios.post as any).mockImplementation(async () => {
            n++;
            return { data: { choices: [{ message: { content: `{"tool":"list_users","args":{"q":"${n}"}}` } }] } };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        const result = await provider.generateReply(user, 'ctx');

        // O config REAL ditou o teto — 3ª tool call foi barrada com mensagem explícita.
        expect(executeToolMock).toHaveBeenCalledTimes(2);
        expect(result.text).toBe(TOOL_BUDGET_EXHAUSTED_MSG(2));
    });

    it('integration #1 (b): teto=5 no config REAL → runner permite mais tools (mesmo LLM)', async () => {
        seedRealProfile({ maxToolCallsPerConversation: 5 });

        let n = 0;
        (axios.post as any).mockImplementation(async () => {
            n++;
            return { data: { choices: [{ message: { content: `{"tool":"list_users","args":{"q":"${n}"}}` } }] } };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(user, 'ctx');

        // Com teto=5 o runner deixa passar 5 — prova que o ACOPLAMENTO config→runner está vivo.
        expect(executeToolMock).toHaveBeenCalledTimes(5);
    });

    it('integration #2 (a): requireConfirmationFor no config REAL bloqueia deleteInvoice sem aprovação', async () => {
        seedRealProfile({ requireConfirmationFor: ['deleteInvoice'] });

        // 1ª chamada: LLM tenta deleteInvoice. 2ª chamada (após gate): LLM pede confirmação.
        let call = 0;
        (axios.post as any).mockImplementation(async () => {
            call++;
            if (call === 1) {
                return { data: { choices: [{ message: { content: '{"tool":"deleteInvoice","args":{"id":99}}' } }] } };
            }
            // Após o gate bloquear, o runner injeta a instrução — o modelo responde pedindo
            // confirmação ao usuário (não tenta a mesma tool de novo).
            return { data: { choices: [{ message: { content: 'Preciso que você confirme a remoção da fatura 99 antes de prosseguir.' } }] } };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        const result = await provider.generateReply(user, 'ctx');

        // O config REAL ditou o gate — deleteInvoice NÃO foi executada.
        expect(executeToolMock).not.toHaveBeenCalledWith('deleteInvoice', expect.anything());
        expect(executeToolMock).not.toHaveBeenCalled();
        // E o runner injetou a instrução de confirmação no próximo prompt.
        const secondCallMessages = (axios.post as any).mock.calls[1][1].messages;
        expect(secondCallMessages[0].content).toContain('CONFIRMAÇÃO NECESSÁRIA deleteInvoice');
        expect(result.text).toContain('confirme');
    });

    it('integration #2 (b): requireConfirmationFor no config REAL libera deleteInvoice COM aprovação', async () => {
        seedRealProfile({ requireConfirmationFor: ['deleteInvoice'] });

        (axios.post as any).mockImplementation(async () => {
            return { data: { choices: [{ message: { content: '{"tool":"deleteInvoice","args":{"id":99}}' } }] } };
        });

        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(user, 'ctx', undefined, { approvedTools: ['deleteInvoice'] });

        // Com aprovação explícita, o gate do config REAL libera a execução.
        expect(executeToolMock).toHaveBeenCalledWith('deleteInvoice', { id: 99 });
    });

    it('integration #3: com dial NÃO configurado, defaults do config service vencem (sem override)', async () => {
        // #1408 (sem override de cold-start, sem profile carregado): o default 50 vale.
        // Sem o dial estar ligado ao runner, o teto seria 5 (constante antiga). 50 é a
        // assinatura de que o config service é a fonte.
        (agentConfigService as any).profile = null;
        expect(agentConfigService.getMaxToolCalls()).toBe(50);
    });
});