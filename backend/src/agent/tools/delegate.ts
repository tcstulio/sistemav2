/**
 * #964/#1036 — Tool `delegate`: delega uma sub-tarefa a um sub-agente isolado.
 *
 * A implementação chama `runSubAgent` (em `agent/subAgent.ts`), injetando
 * `parentDepth: currentDepth + 1` (onde `currentDepth` vem do ToolContext corrente — o agente de
 * topo roda em depth 0). Devolve SOMENTE o campo `summary` como string para o modelo do pai
 * (vira o `[TOOL RESULT delegate]` no contexto do pai — curto, para não inflar o contexto).
 *
 * Schema (#1036):
 *   - `objective` (string, OBRIGATÓRIO) — descrição clara do que o sub-agente deve fazer.
 *   - `tools` (array de string, OPCIONAL) — conjunto permitido ao sub-agente. Se omitido, o
 *     sub-agente recebe o conjunto padrão de LEITURA (DEFAULT_SUBAGENT_TOOLS) — SEM tools
 *     destrutivas (create_, update_, validate_ e prepare_create/edit).
 *   - `max_iterations` (number, OPCIONAL, default 5, máximo 10) — orçamento de iterações.
 *
 * Validação (#1036): rejeita `objective` vazio e rejeita `max_iterations > 10` (devolve mensagem
 * de erro clara em vez de disparar o sub-agente).
 */
import type { ToolDefinition } from './index';
import {
    runSubAgent,
    DEFAULT_SUBAGENT_TOOLS,
    DEFAULT_SUBAGENT_MAX_ITERATIONS,
    MAX_SUBAGENT_MAX_ITERATIONS,
} from '../subAgent';
import { getToolContext } from '../../services/agentTools';

/** Descrição exata exigida pela issue #1036 (documentada no prompt para o modelo). */
export const DELEGATE_DESCRIPTION =
    'Use esta tool para delegar uma sub-tarefa bem definida a um sub-agente isolado. ' +
    'O sub-agente tem contexto próprio — só o resumo volta para você. ' +
    'Ideal para buscas longas, cálculos repetitivos ou tarefas paralelas.';

/**
 * Lê a profundidade do agente corrente a partir do ToolContext (AsyncLocalStorage). O agente de
 * topo (sem contexto ou sem `depth`) roda em 0; cada nível de sub-agente soma 1.
 */
function currentDepth(): number {
    const ctx = getToolContext();
    const d = ctx?.depth;
    return typeof d === 'number' && Number.isFinite(d) && d >= 0 ? Math.trunc(d) : 0;
}

/**
 * Normaliza e valida os args da tool `delegate`. Devolve `{ ok, ... }` com os campos resolvidos,
 * ou `{ ok: false, error }` com a mensagem de rejeição (#1036: objective vazio / max > 10).
 */
export function normalizeDelegateArgs(args: Record<string, any>):
    | { ok: true; objective: string; tools: readonly string[]; maxIterations: number }
    | { ok: false; error: string } {
    const objective = String(args?.objective ?? '').trim();
    if (!objective) {
        return { ok: false, error: 'A ferramenta "delegate" exige "objective" (descrição clara da sub-tarefa). Tente novamente com o objetivo preenchido.' };
    }

    // max_iterations: default 5; rejeita > 10 (não clampa — o contrato é REJEITAR, cf. #1036).
    const rawMax = args?.max_iterations;
    let maxIterations = DEFAULT_SUBAGENT_MAX_ITERATIONS;
    if (rawMax !== undefined && rawMax !== null) {
        const n = Number(rawMax);
        if (!Number.isFinite(n)) {
            return { ok: false, error: `"max_iterations" deve ser um número (recebido ${JSON.stringify(rawMax)}).` };
        }
        const it = Math.trunc(n);
        if (it > MAX_SUBAGENT_MAX_ITERATIONS) {
            return { ok: false, error: `"max_iterations"=${it} excede o máximo de ${MAX_SUBAGENT_MAX_ITERATIONS}. Use um valor entre 1 e ${MAX_SUBAGENT_MAX_ITERATIONS}.` };
        }
        if (it < 1) {
            return { ok: false, error: `"max_iterations"=${it} é inválido (mínimo 1).` };
        }
        maxIterations = it;
    }

    // tools: array de string opcional. Itens inválidos são descartados em resolveAllowedTools.
    let tools: readonly string[] | undefined;
    if (args?.tools !== undefined && args?.tools !== null) {
        if (!Array.isArray(args.tools)) {
            return { ok: false, error: `"tools" deve ser um array de strings (recebido ${typeof args.tools}).` };
        }
        tools = args.tools.filter((t) => typeof t === 'string' && t.trim()) as string[];
        // Se o caller passou um array vazio explícito, tratamos como "use o default de leitura".
        if (tools.length === 0) tools = undefined;
    }

    return { ok: true, objective, tools: tools ?? DEFAULT_SUBAGENT_TOOLS, maxIterations };
}

/**
 * Definição da tool `delegate`. Registrada no registry (`agent/tools/index.ts`) no boot do módulo.
 */
export const delegateTool: ToolDefinition = {
    name: 'delegate',
    description: DELEGATE_DESCRIPTION,
    inputSchema: {
        objective: {
            type: 'string',
            description: 'Descrição clara e autossuficiente do que o sub-agente deve fazer.',
            required: true,
        },
        tools: {
            type: 'array',
            description:
                'Conjunto de ferramentas permitido ao sub-agente (nomes lógicos). ' +
                'Se omitido, o sub-agente recebe o conjunto padrão de LEITURA: ' +
                `${DEFAULT_SUBAGENT_TOOLS.join(', ')} (nenhuma ferramenta destrutiva).`,
            items: { type: 'string' },
        },
        max_iterations: {
            type: 'number',
            description: 'Orçamento de iterações do sub-agente (padrão 5, máximo 10).',
            default: DEFAULT_SUBAGENT_MAX_ITERATIONS,
            minimum: 1,
            maximum: MAX_SUBAGENT_MAX_ITERATIONS,
        },
    },
    async execute(args): Promise<string> {
        const parsed = normalizeDelegateArgs(args || {});
        if (!parsed.ok) return parsed.error;

        const depth = currentDepth();
        const result = await runSubAgent({
            objective: parsed.objective,
            tools: parsed.tools,
            maxIterations: parsed.maxIterations,
            parentDepth: depth + 1,
        });

        // #1036: retorna APENAS o campo `summary` como string para o modelo do pai.
        return result.summary;
    },
};
