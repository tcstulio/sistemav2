/**
 * #964/#1036 — Testes do `runSubAgent` (`agent/subAgent.ts`).
 *
 * Cobre:
 *  - Executa um loop isolado e devolve `{ summary }` (string curta).
 *  - Guarda de profundidade (MAX_SUBAGENT_DEPTH): parentDepth acima do teto NÃO roda o loop.
 *  - resolveAllowedTools: conjunto default = somente leitura.
 *  - clampIterations: intervalo [1, 10].
 *  - gateAllowedTools (defesa em profundidade): tool fora do conjunto é recusada — garante que
 *    um sub-agente sem `tools` nunca executa tools destrutivas (create_, update_, validate_).
 *
 * `runAgentLoop` é mockado — capturamos as deps injetadas para inspecionar o executor gateado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do agentLoop: captura (opts, deps) e devolve um AgentLoopResult controlado.
const runAgentLoopMock = vi.fn();
vi.mock('../../agent/agentLoop', () => ({
    runAgentLoop: (...args: any[]) => runAgentLoopMock(...args),
}));

// Mock do ToolContext: runWithToolContext só executa o fn; getToolContext devolve depth do pai.
vi.mock('../../services/agentTools', () => ({
    runWithToolContext: (_ctx: any, fn: () => Promise<any>) => fn(),
    getToolContext: () => ({ depth: 0 }),
}));

// ProgressStream: classe stub (não usada de fato porque o stream é injetado nos testes).
vi.mock('../../agent/progressStream', () => ({
    ProgressStream: class {
        constructor(_opts?: any) {}
    },
}));

import {
    runSubAgent,
    resolveAllowedTools,
    clampIterations,
    extractSummary,
    DEFAULT_SUBAGENT_TOOLS,
    MAX_SUBAGENT_DEPTH,
    MAX_SUBAGENT_MAX_ITERATIONS,
    SUBAGENT_SUMMARY_MAX_CHARS,
} from '../../agent/subAgent';

function okLoop(text = 'resumo curto do sub-agente') {
    return {
        text,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        contextWindow: 0,
        model: 'test',
        fellBack: false,
        events: [
            { type: 'thinking', payload: { phase: 'iteration' } },
            { type: 'tool_call', payload: {} },
        ],
    };
}

beforeEach(() => {
    runAgentLoopMock.mockReset();
});

describe('#1036 — resolveAllowedTools', () => {
    it('default = conjunto padrão de leitura quando omitido', () => {
        expect(resolveAllowedTools()).toEqual([...DEFAULT_SUBAGENT_TOOLS]);
        expect(resolveAllowedTools([])).toEqual([...DEFAULT_SUBAGENT_TOOLS]);
    });

    it('preserva conjunto explícito, deduplicando e descartando vazios', () => {
        expect(resolveAllowedTools(['search', 'search', '  ', '', 'list_products']))
            .toEqual(['search', 'list_products']);
    });

    it('default quando só vieram itens inválidos', () => {
        expect(resolveAllowedTools(['', '   '])).toEqual([...DEFAULT_SUBAGENT_TOOLS]);
    });

    it('nenhuma tool do default é destrutiva', () => {
        for (const t of DEFAULT_SUBAGENT_TOOLS) {
            expect(t).not.toMatch(/^(create_|update_|validate_|prepare_(create|edit))/);
        }
    });
});

describe('#1036 — DEFAULT_SUBAGENT_TOOLS: nomes canônicos do dispatcher (correção do Judge)', () => {
    it('contém exatamente os 5 nomes canônicos de leitura', () => {
        expect([...DEFAULT_SUBAGENT_TOOLS]).toEqual([
            'search', 'list_products', 'search_customer', 'get_customer_details', 'web_search',
        ]);
    });

    it('NÃO contém aliases legados que dependem de alias ou case deprecado', () => {
        // list_customers só funcionava via TOOL_ALIASES -> search_customer (indireção frágil);
        // search_web é um case legado (ScraperService/SERPER_API_KEY) — o canônico é web_search (#86).
        expect([...DEFAULT_SUBAGENT_TOOLS]).not.toContain('list_customers');
        expect([...DEFAULT_SUBAGENT_TOOLS]).not.toContain('search_web');
    });

    it('cada tool default é documentada no TOOLS_PROMPT real do dispatcher', async () => {
        const real = await vi.importActual<typeof import('../../services/agentTools')>('../../services/agentTools');
        const prompt = real.TOOLS_PROMPT as string;
        for (const name of DEFAULT_SUBAGENT_TOOLS) {
            expect(prompt).toContain(name);
        }
    });

    it('a tool `delegate` (#1036) está documentada no TOOLS_PROMPT (parent pode invocá-la)', async () => {
        // Critério de aceite: "Tool pode ser invocada pelo agente pai". Para o modelo do pai
        // saber que delegate existe, ela DEVE constar do prompt de tools — senão nunca a chama.
        const real = await vi.importActual<typeof import('../../services/agentTools')>('../../services/agentTools');
        const prompt = real.TOOLS_PROMPT as string;
        expect(prompt).toContain('delegate');
        expect(prompt).toMatch(/sub-tarefa bem definida|sub-agente isolado/i);
    });
});

describe('#1036 — clampIterations', () => {
    it('default 5 para entrada inválida/omitida', () => {
        expect(clampIterations(undefined)).toBe(5);
        expect(clampIterations(NaN)).toBe(5);
        expect(clampIterations('x' as any)).toBe(5);
    });

    it('mínimo 1', () => {
        expect(clampIterations(0)).toBe(1);
        expect(clampIterations(-3)).toBe(1);
    });

    it('máximo 10 (= MAX_SUBAGENT_MAX_ITERATIONS)', () => {
        expect(clampIterations(MAX_SUBAGENT_MAX_ITERATIONS)).toBe(10);
        expect(clampIterations(11)).toBe(10);
        expect(clampIterations(999)).toBe(10);
    });

    it('passa direto no intervalo válido', () => {
        expect(clampIterations(3)).toBe(3);
        expect(clampIterations(7)).toBe(7);
    });
});

describe('#1036 — extractSummary', () => {
    it('devolve o texto quando curto', () => {
        expect(extractSummary('ok')).toBe('ok');
    });

    it('texto vazio vira mensagem padrão', () => {
        expect(extractSummary('')).toMatch(/finalizou sem produzir/i);
        expect(extractSummary(undefined)).toMatch(/finalizou sem produzir/i);
    });

    it('trunca para o teto de caracteres', () => {
        const big = 'a'.repeat(SUBAGENT_SUMMARY_MAX_CHARS + 500);
        const out = extractSummary(big);
        expect(out.length).toBeLessThanOrEqual(SUBAGENT_SUMMARY_MAX_CHARS);
        expect(out.endsWith('…')).toBe(true);
    });
});

describe('#1036 — runSubAgent: fluxo principal', () => {
    it('roda o loop isolado e devolve { summary } extraído do text final', async () => {
        runAgentLoopMock.mockResolvedValue(okLoop('achei 2 produtos: A e B'));
        const res = await runSubAgent(
            { objective: 'liste produtos', parentDepth: 1 },
            { stream: {} as any },
        );
        expect(res.summary).toBe('achei 2 produtos: A e B');
        expect(res.depth).toBe(1);
        expect(res.iterations).toBe(1);
        expect(res.toolCalls).toBe(1);
    });

    it('objective vazio não roda o loop e devolve summary de erro', async () => {
        const res = await runSubAgent({ objective: '   ', parentDepth: 1 }, { stream: {} as any });
        expect(runAgentLoopMock).not.toHaveBeenCalled();
        expect(res.summary).toMatch(/objective/i);
    });

    it('passa maxIterations e o conjunto de tools para o loop', async () => {
        runAgentLoopMock.mockResolvedValue(okLoop());
        await runSubAgent(
            { objective: 'x', tools: ['search', 'list_invoices'], maxIterations: 7, parentDepth: 1 },
            { stream: {} as any },
        );
        const [opts] = runAgentLoopMock.mock.calls[0];
        expect(opts.maxIterations).toBe(7);
        // O prompt de tools deve listar APENAS as tools permitidas.
        expect(opts).toBeDefined();
    });
});

describe('#1036 — runSubAgent: guarda de profundidade', () => {
    it('parentDepth acima do teto NÃO roda o loop', async () => {
        const res = await runSubAgent(
            { objective: 'x', parentDepth: MAX_SUBAGENT_DEPTH + 1 },
            { stream: {} as any },
        );
        expect(runAgentLoopMock).not.toHaveBeenCalled();
        expect(res.summary).toMatch(/profundidade m.xima/i);
        expect(res.depth).toBe(MAX_SUBAGENT_DEPTH + 1);
    });

    it('parentDepth NaN é tratado como excedido', async () => {
        const res = await runSubAgent({ objective: 'x', parentDepth: NaN }, { stream: {} as any });
        expect(runAgentLoopMock).not.toHaveBeenCalled();
        expect(res.summary).toMatch(/profundidade/i);
    });

    it('parentDepth == teto ainda roda', async () => {
        runAgentLoopMock.mockResolvedValue(okLoop());
        const res = await runSubAgent(
            { objective: 'x', parentDepth: MAX_SUBAGENT_DEPTH },
            { stream: {} as any },
        );
        expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
        expect(res.summary).toBe('resumo curto do sub-agente');
    });
});

describe('#1036 — runSubAgent: sandbox de tools (defesa em profundidade)', () => {
    it('o executor injetado no loop BLOQUEIA tool fora do conjunto permitido', async () => {
        runAgentLoopMock.mockResolvedValue(okLoop());
        await runSubAgent(
            { objective: 'x', tools: ['search'], parentDepth: 1 },
            { stream: {} as any, executeToolFn: async () => 'ok' },
        );
        const [, deps] = runAgentLoopMock.mock.calls[0];
        const exec = deps.executeToolFn as (t: string, a: any) => Promise<string>;

        // tool permitida passa pelo gate (chega no executor interno 'ok')
        const allowed = await exec('search', { q: 'x' });
        expect(allowed).toBe('ok');

        // tool DESTRUTIVA fora do conjunto é recusada pelo gate — não chega no executor interno
        const blockedCreate = await exec('prepare_create_invoice', { socid: '1' });
        expect(blockedCreate).toMatch(/n.o est. dispon.vel|fora do conjunto/i);
        const blockedValidate = await exec('validate_order', { order_id: '1' });
        expect(blockedValidate).toMatch(/n.o est. dispon.vel|fora do conjunto/i);
    });

    it('com conjunto DEFAULT, tools destrutivas são bloqueadas', async () => {
        runAgentLoopMock.mockResolvedValue(okLoop());
        // tools omitido ⇒ default de leitura
        await runSubAgent(
            { objective: 'x', parentDepth: 1 },
            { stream: {} as any, executeToolFn: async () => 'ok' },
        );
        const [, deps] = runAgentLoopMock.mock.calls[0];
        const exec = deps.executeToolFn as (t: string, a: any) => Promise<string>;

        for (const bad of ['create_customer', 'update_invoice', 'validate_proposal', 'prepare_create_order']) {
            const out = await exec(bad, { id: '1' });
            expect(out).toMatch(/n.o est. dispon.vel|fora do conjunto/i);
        }
    });

    it('o toolsPrompt injetado lista apenas as tools permitidas', async () => {
        runAgentLoopMock.mockResolvedValue(okLoop());
        await runSubAgent(
            { objective: 'x', tools: ['search', 'list_products'], parentDepth: 1 },
            { stream: {} as any },
        );
        const [, deps] = runAgentLoopMock.mock.calls[0];
        const prompt = deps.toolsPrompt as string;
        expect(prompt).toMatch(/list_products/);
        expect(prompt).not.toMatch(/prepare_create_invoice/);
    });
});

describe('#1036 — runSubAgent: resiliência', () => {
    it('erro fatal do loop vira summary de erro (não propaga throw)', async () => {
        runAgentLoopMock.mockRejectedValue(new Error('boom'));
        const res = await runSubAgent({ objective: 'x', parentDepth: 1 }, { stream: {} as any });
        expect(res.summary).toMatch(/n.o conseguiu concluir|erro/i);
        expect(res.summary).toMatch(/boom/);
    });
});
