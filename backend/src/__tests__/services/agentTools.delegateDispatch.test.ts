/**
 * #1036 — Teste de integração do dispatcher: `executeTool("delegate", ...)` roteia para
 * `delegateTool.execute` e devolve apenas o `summary` (string curta).
 *
 * Critério de aceite: "Tool pode ser invocada pelo agente pai e o `[TOOL RESULT]` retornado é
 * uma string curta (resumo)". O agente pai despacha TODAS as tools via `executeTool` (switch em
 * `services/agentTools.ts`). Este teste prova que o caminho `executeTool('delegate', {...})`
 * chega ao executor da tool `delegate` e devolve apenas o resumo.
 *
 * Apenas `runSubAgent` é mockado — `executeTool`, o switch e o dynamic import de `delegate`
 * são reais (caminho de produção).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do subAgent: stub determinístico. O dynamic import em `delegate.ts` pega este mock.
const runSubAgentMock = vi.fn();
vi.mock('../../agent/subAgent', () => ({
    runSubAgent: (...args: any[]) => runSubAgentMock(...args),
    DEFAULT_SUBAGENT_TOOLS: ['search', 'list_products', 'search_customer', 'get_customer_details', 'web_search'],
    DEFAULT_SUBAGENT_MAX_ITERATIONS: 5,
    MAX_SUBAGENT_MAX_ITERATIONS: 10,
    MAX_SUBAGENT_DEPTH: 2,
}));

import { executeTool, runWithToolContext } from '../../services/agentTools';

describe('#1036 — dispatcher executeTool("delegate")', () => {
    beforeEach(() => {
        runSubAgentMock.mockReset();
    });

    it('devolve APENAS o summary (string curta) produzido pelo sub-agente', async () => {
        runSubAgentMock.mockResolvedValue({
            summary: 'resumo do sub-agente via dispatcher',
            depth: 1, iterations: 1, toolCalls: 0,
        });
        const out = await runWithToolContext({ isAdmin: true }, () =>
            executeTool('delegate', { objective: 'liste produtos' }),
        );
        expect(typeof out).toBe('string');
        expect(out).toBe('resumo do sub-agente via dispatcher');
        expect(runSubAgentMock).toHaveBeenCalledTimes(1);
    });

    it('passa parentDepth = 1 quando o agente pai está no depth 0 (topo)', async () => {
        runSubAgentMock.mockResolvedValue({ summary: 'ok', depth: 1, iterations: 1, toolCalls: 0 });
        await runWithToolContext({ isAdmin: true, depth: 0 }, () =>
            executeTool('delegate', { objective: 'x' }),
        );
        expect(runSubAgentMock.mock.calls[0][0].parentDepth).toBe(1);
        expect(runSubAgentMock.mock.calls[0][0].objective).toBe('x');
    });

    it('rejeita objective vazio SEM chamar runSubAgent (validação roteada)', async () => {
        const out = await runWithToolContext({ isAdmin: true }, () =>
            executeTool('delegate', { objective: '' }),
        );
        expect(runSubAgentMock).not.toHaveBeenCalled();
        expect(out).toMatch(/objective/i);
    });

    it('rejeita max_iterations > 10 SEM chamar runSubAgent (validação roteada)', async () => {
        const out = await runWithToolContext({ isAdmin: true }, () =>
            executeTool('delegate', { objective: 'ok', max_iterations: 99 }),
        );
        expect(runSubAgentMock).not.toHaveBeenCalled();
        expect(out).toMatch(/10/);
    });
});
