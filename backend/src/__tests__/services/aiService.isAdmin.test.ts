/**
 * #1499 — isAdmin propagado EXPLICITAMENTE da handler até `aiService`/`getToolsPrompt`.
 *
 * Garante que o filtro de DEV_TOOLS (#1498) usa o `isAdmin` passado via
 * `GenerateReplyOptions.isAdmin` (propagado pela handler `runChatReply` do
 * `aiRoutes.ts`), com fallback ao `getToolContext().isAdmin` apenas na ausência do param.
 *
 * Aceitação:
 *  - Caminho admin (options.isAdmin === true ou ctx.isAdmin === true): prompt CONTÉM as 13 DEV_TOOLS.
 *  - Caminho não-admin (options.isAdmin !== true e ctx.isAdmin !== true): prompt NÃO contém NENHUMA.
 *  - Param EXPLÍCITO sobrescreve o ctx (defesa em profundidade / teste determinístico).
 *  - Fallback ao ctx (sem param): comportamento herdado de #1498 permanece (não regressão).
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
        agentMaxIterations: null,
    },
}));

// Config service mocks — usado pelo wrapper aiService.generateReply (não pelo LocalProvider direto).
const configState = vi.hoisted(() => ({ runWithChain: false, provider: 'local', model: 'llama3' }));
vi.mock('../../services/agentConfigService', () => ({
    agentConfigService: {
        getSystemPrompt: () => '',
        getMaxToolCalls: () => 50,
        requiresConfirmation: () => false,
    },
}));
vi.mock('../../services/configService', () => ({
    configService: {
        getModuleConfig: vi.fn(() => ({ provider: configState.provider, model: configState.model })),
        isRunWithChainEnabled: vi.fn(() => configState.runWithChain),
        getFallbackChain: vi.fn(() => ['local']),
    },
    ConfigService: class {},
}));
vi.mock('../../services/llmHealthService', () => ({
    llmHealthService: {
        isAvailable: vi.fn(() => true), recordSuccess: vi.fn(), recordQuotaError: vi.fn(),
        recordTransientError: vi.fn(), resetProvider: vi.fn(),
    },
}));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({
    ScraperService: { searchGoogle: vi.fn(), fetchPageContent: vi.fn() },
}));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: vi.fn(() => true) }));

// `agentTools` REAL — ele é o guard de verdade do prompt (não-admin → DEV_TOOLS removidas).
// O ctx (isAdmin) é controlado por `toolState` para os testes de fallback.
import { runWithToolContext } from '../../services/agentTools';
import { DEV_TOOLS } from '../../services/agentTools';
import { LocalProvider } from '../../services/aiService';

const user = [{ role: 'user', parts: 'olá' } as any];

describe('#1499 — LocalProvider.generateReply: isAdmin via options (explícito) com fallback ao ctx', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Resposta simples do LLM (sem tool-call) para o provider encerrar o turno rápido.
        (axios.post as any).mockResolvedValue({
            data: { choices: [{ message: { content: 'oi' } }], usage: {} },
        });
    });

    // Helper: extrai o conteúdo do system prompt que vai pro LLM.
    function getSystemPromptSent(p: number = 0): string {
        return ((axios.post as any).mock.calls[p][1].messages[0].content as string);
    }

    it('options.isAdmin=true EXPLÍCITO: prompt contém todas as 13 DEV_TOOLS (caminho admin)', async () => {
        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(user, '', undefined, { isAdmin: true });

        const sys = getSystemPromptSent();
        for (const dev of DEV_TOOLS) {
            expect(sys, `dev tool "${dev}" deveria estar no prompt admin`).toContain(dev);
        }
    });

    it('options.isAdmin=false EXPLÍCITO (sem ctx): prompt NÃO contém nenhuma das 13 DEV_TOOLS (caminho não-admin)', async () => {
        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await provider.generateReply(user, '', undefined, { isAdmin: false });

        const sys = getSystemPromptSent();
        for (const dev of DEV_TOOLS) {
            expect(sys, `dev tool "${dev}" NÃO deveria estar no prompt não-admin`).not.toContain(dev);
        }
        // Lê-se como não-admin equivalente a getToolsPrompt({isAdmin:false}).
        expect(sys).toContain('search(query');
        expect(sys).toContain('prepare_create_proposal');
    });

    it('options EXPLÍCITO sobrescreve ctx (defesa em profundidade: options.isAdmin=false vence ctx.isAdmin=true)', async () => {
        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await runWithToolContext({ isAdmin: true }, () =>
            provider.generateReply(user, '', undefined, { isAdmin: false })
        );

        const sys = getSystemPromptSent();
        for (const dev of DEV_TOOLS) {
            expect(sys, `param explícito isAdmin=false devia vencer ctx.isAdmin=true: "${dev}"`).not.toContain(dev);
        }
    });

    it('sem options: fallback ao ctx — ctx.isAdmin=true mantém o prompt admin', async () => {
        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await runWithToolContext({ isAdmin: true }, () => provider.generateReply(user, '', undefined));

        const sys = getSystemPromptSent();
        for (const dev of DEV_TOOLS) {
            expect(sys, `fallback ao ctx.isAdmin=true: "${dev}" deveria estar`).toContain(dev);
        }
    });

    it('sem options: fallback ao ctx — ctx.isAdmin=false/undefined remove as DEV_TOOLS', async () => {
        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        // Sem ctx (AsyncLocalStorage vazio) → isAdmin default do getToolContext() === undefined.
        await provider.generateReply(user, '', undefined);

        const sys = getSystemPromptSent();
        for (const dev of DEV_TOOLS) {
            expect(sys, `sem ctx/admin: "${dev}" NÃO deveria estar`).not.toContain(dev);
        }
    });

    it('safety: string truthy (ex.: "1") NÃO vira admin (=== true é estrito)', async () => {
        // Defesa contra callers que repassem string "1" do req.user.admin sem normalizar
        // p/ boolean. ?? mantém o valor (não-null), mas `=== true` é estrito → cai em
        // não-admin. Mesma regra que `options.isAdmin = {}` ou `= []`. NÃO é fallback
        // ao ctx — é fail-closed contra promoção indevida.
        const provider = new LocalProvider('http://localhost:11434/v1', 'llama3');
        await runWithToolContext({ isAdmin: true }, () =>
            // bypass de tipos proposital (testamos a regra de normalização).
            provider.generateReply(user, '', undefined, { isAdmin: '1' as unknown as boolean })
        );

        const sys = getSystemPromptSent();
        for (const dev of DEV_TOOLS) {
            expect(sys, `string truthy "1" NÃO devia virar admin: "${dev}"`).not.toContain(dev);
        }
    });
});
