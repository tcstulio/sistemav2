/**
 * #1036 — Testes da tool `delegate` (`agent/tools/delegate.ts`).
 *
 * Critérios de aceite cobertos:
 *  - Schema correto (reaproveitado do registry; aqui focamos na normalização + executor).
 *  - Tool pode ser invocada e o `[TOOL RESULT]` é uma string curta (resumo).
 *  - Se `tools` não for passado, sub-agente NÃO tem acesso a tools destrutivas.
 *  - Validação: rejeita objective vazio, rejeita max_iterations > 10.
 *
 * `runSubAgent` é mockado — testamos a tool, não o loop real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do subAgent: captura os argumentos com que a tool chama runSubAgent e devolve um resumo.
const runSubAgentMock = vi.fn();
vi.mock('../../../agent/subAgent', () => ({
    runSubAgent: (...args: any[]) => runSubAgentMock(...args),
    DEFAULT_SUBAGENT_TOOLS: ['search', 'list_products', 'list_customers', 'get_customer_details', 'search_web'],
    DEFAULT_SUBAGENT_MAX_ITERATIONS: 5,
    MAX_SUBAGENT_MAX_ITERATIONS: 10,
    MAX_SUBAGENT_DEPTH: 2,
}));

// Mock do ToolContext: o agente de topo roda em depth 0 por default.
const getToolContextMock = vi.fn(() => ({ depth: 0 }));
vi.mock('../../../services/agentTools', () => ({
    getToolContext: () => getToolContextMock(),
}));

import { delegateTool, normalizeDelegateArgs, DELEGATE_DESCRIPTION } from '../../../agent/tools/delegate';

describe('#1036 — normalizeDelegateArgs', () => {
    it('rejeita objective vazio', () => {
        expect(normalizeDelegateArgs({ objective: '' }).ok).toBe(false);
        expect(normalizeDelegateArgs({ objective: '   ' }).ok).toBe(false);
        expect(normalizeDelegateArgs({}).ok).toBe(false);
        const r = normalizeDelegateArgs({ objective: '' }) as { ok: false; error: string };
        expect(r.error).toMatch(/objective/i);
    });

    it('rejeita max_iterations > 10', () => {
        const r = normalizeDelegateArgs({ objective: 'ok', max_iterations: 11 });
        expect(r.ok).toBe(false);
        expect((r as { error: string }).error).toMatch(/11.*m.ximo.*10|excede.*10/i);
    });

    it('rejeita max_iterations < 1', () => {
        const r = normalizeDelegateArgs({ objective: 'ok', max_iterations: 0 });
        expect(r.ok).toBe(false);
        expect((r as { error: string }).error).toMatch(/m.nimo.*1|inv.lido/i);
    });

    it('rejeita max_iterations não-numérico', () => {
        const r = normalizeDelegateArgs({ objective: 'ok', max_iterations: 'abc' });
        expect(r.ok).toBe(false);
    });

    it('aceita max_iterations dentro do range e aplica default 5 quando omitido', () => {
        expect((normalizeDelegateArgs({ objective: 'ok' }) as any).maxIterations).toBe(5);
        expect((normalizeDelegateArgs({ objective: 'ok', max_iterations: 10 }) as any).maxIterations).toBe(10);
        expect((normalizeDelegateArgs({ objective: 'ok', max_iterations: 1 }) as any).maxIterations).toBe(1);
    });

    it('rejeita tools que não é array', () => {
        const r = normalizeDelegateArgs({ objective: 'ok', tools: 'search' });
        expect(r.ok).toBe(false);
        expect((r as { error: string }).error).toMatch(/array/i);
    });

    it('usa o conjunto padrão de LEITURA quando tools é omitido', () => {
        const r = normalizeDelegateArgs({ objective: 'ok' }) as any;
        expect(r.ok).toBe(true);
        expect(r.tools).toEqual(['search', 'list_products', 'list_customers', 'get_customer_details', 'search_web']);
    });

    it('usa o conjunto padrão quando tools é array vazio explícito', () => {
        const r = normalizeDelegateArgs({ objective: 'ok', tools: [] }) as any;
        expect(r.ok).toBe(true);
        expect(r.tools.length).toBeGreaterThan(0);
    });

    it('preserva um conjunto de tools explícito', () => {
        const r = normalizeDelegateArgs({ objective: 'ok', tools: ['search', 'list_invoices'] }) as any;
        expect(r.ok).toBe(true);
        expect(r.tools).toEqual(['search', 'list_invoices']);
    });
});

describe('#1036 — conjunto padrão NÃO contém tools destrutivas', () => {
    // Critério de aceite: "Se tools não for passado, sub-agente NÃO tem acesso a tools
    // destrutivas (create_*, update_*, validate_*)".
    const defaults = (normalizeDelegateArgs({ objective: 'ok' }) as any).tools as string[];

    it('nenhuma tool padrão casa create_*/update_*/validate_*', () => {
        for (const t of defaults) {
            expect(t).not.toMatch(/^(create_|update_|validate_)/);
            expect(t).not.toMatch(/^prepare_(create|edit)/); // prepare_create/edit também são escrita
        }
    });

    it('o conjunto padrão é exatamente os 5 de leitura', () => {
        expect(defaults).toEqual([
            'search', 'list_products', 'list_customers', 'get_customer_details', 'search_web',
        ]);
    });
});

describe('#1036 — delegateTool.execute', () => {
    beforeEach(() => {
        runSubAgentMock.mockReset();
        getToolContextMock.mockReset();
        getToolContextMock.mockReturnValue({ depth: 0 });
    });

    it('retorna APENAS o summary (string curta) produzido pelo sub-agente', async () => {
        runSubAgentMock.mockResolvedValue({ summary: 'achei 3 produtos: A, B, C', depth: 1, iterations: 2, toolCalls: 1 });
        const out = await delegateTool.execute({ objective: 'liste produtos' });
        expect(typeof out).toBe('string');
        expect(out).toBe('achei 3 produtos: A, B, C');
    });

    it('invoca runSubAgent com parentDepth = currentDepth + 1', async () => {
        runSubAgentMock.mockResolvedValue({ summary: 'ok', depth: 1, iterations: 1, toolCalls: 0 });
        await delegateTool.execute({ objective: 'x' });
        expect(runSubAgentMock).toHaveBeenCalledTimes(1);
        const arg = runSubAgentMock.mock.calls[0][0];
        expect(arg.parentDepth).toBe(1); // depth do pai (0) + 1
        expect(arg.objective).toBe('x');
        expect(arg.maxIterations).toBe(5);
    });

    it('encadeia a profundidade a partir do ToolContext corrente', async () => {
        getToolContextMock.mockReturnValue({ depth: 1 }); // agente já é um sub-agente (depth 1)
        runSubAgentMock.mockResolvedValue({ summary: 'ok', depth: 2, iterations: 1, toolCalls: 0 });
        await delegateTool.execute({ objective: 'x' });
        expect(runSubAgentMock.mock.calls[0][0].parentDepth).toBe(2); // 1 + 1
    });

    it('trata depth ausente como 0 (agente de topo)', async () => {
        getToolContextMock.mockReturnValue({}); // sem depth
        runSubAgentMock.mockResolvedValue({ summary: 'ok', depth: 1, iterations: 1, toolCalls: 0 });
        await delegateTool.execute({ objective: 'x' });
        expect(runSubAgentMock.mock.calls[0][0].parentDepth).toBe(1);
    });

    it('rejeita objective vazio SEM chamar runSubAgent', async () => {
        const out = await delegateTool.execute({ objective: '' });
        expect(runSubAgentMock).not.toHaveBeenCalled();
        expect(out).toMatch(/objective/i);
    });

    it('rejeita max_iterations > 10 SEM chamar runSubAgent', async () => {
        const out = await delegateTool.execute({ objective: 'ok', max_iterations: 99 });
        expect(runSubAgentMock).not.toHaveBeenCalled();
        expect(out).toMatch(/10/);
    });

    it('passa o conjunto de tools explícito adiante (não força o default)', async () => {
        runSubAgentMock.mockResolvedValue({ summary: 'ok', depth: 1, iterations: 1, toolCalls: 0 });
        await delegateTool.execute({ objective: 'ok', tools: ['search', 'get_financial_summary'] });
        expect(runSubAgentMock.mock.calls[0][0].tools).toEqual(['search', 'get_financial_summary']);
    });

    it('passa o conjunto DEFAULT quando tools é omitido', async () => {
        runSubAgentMock.mockResolvedValue({ summary: 'ok', depth: 1, iterations: 1, toolCalls: 0 });
        await delegateTool.execute({ objective: 'ok' });
        expect(runSubAgentMock.mock.calls[0][0].tools).toEqual([
            'search', 'list_products', 'list_customers', 'get_customer_details', 'search_web',
        ]);
    });
});

describe('#1036 — DELEGATE_DESCRIPTION', () => {
    it('contém as frases exigidas pela issue', () => {
        expect(DELEGATE_DESCRIPTION).toMatch(/sub-tarefa bem definida/i);
        expect(DELEGATE_DESCRIPTION).toMatch(/sub-agente isolado/i);
        expect(DELEGATE_DESCRIPTION).toMatch(/contexto pr.prio/);
        expect(DELEGATE_DESCRIPTION).toMatch(/s. o resumo volta/i);
        expect(DELEGATE_DESCRIPTION).toMatch(/buscas longas|c.lculos repetitivos|tarefas paralelas/);
    });
});
