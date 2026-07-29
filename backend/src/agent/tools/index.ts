/**
 * #964/#1036 — Registry CANÔNICO de tools do agente.
 *
 * Antes deste módulo, as tools do agente viviam como um switch monolítico em
 * `services/agentTools.ts` (dispatcher `executeTool`) e um prompt de 85+ entradas. Não havia
 * "registry" consultável por código — só a string do prompt e o switch. Este módulo introduz um
 * REGISTRO ESTRUTURADO (`listTools()` / `getTool()` / `hasTool()`), com cada tool declarada como
 * um `ToolDefinition` (nome + descrição + inputSchema + executor). Isso permite:
 *
 *   - Enumerar tools com schema (#1036: "Tool `delegate` aparece em `listTools()` com schema
 *     correto") — base para gerar prompts dinâmicos, UIs de inspeção e validação de args.
 *   - Invocar uma tool pelo nome via `getTool(name).execute(args)` — caminho usado pela tool
 *     `delegate` e por integradores externos.
 *   - Registrar novas tools sem editar o switch gigante (registry por composição).
 *
 * SCOPO desta primeira entrega (#1036): o registry existe e registra a tool `delegate`. As tools
 * de ERP (`search`, `list_products`, etc.) continuam sendo despachadas por `services/agentTools`
 * — a migração delas para o registry é incremental e fica para issues subsequentes.
 */
import { delegateTool } from './delegate';

// === Tipos públicos ===

/** Tipos primitivos suportados no schema de entrada de uma tool (subset de JSON-Schema). */
export type ToolParamType = 'string' | 'number' | 'array' | 'boolean' | 'object';

/** Schema de um parâmetro de entrada de uma tool. */
export interface ToolParamSchema {
    type: ToolParamType;
    description: string;
    /** Parâmetro obrigatório (default: false). */
    required?: boolean;
    /** Para `type: 'array'` — tipo do elemento. */
    items?: { type: 'string' | 'number' | 'boolean' };
    /** Valor default quando o parâmetro for omitido. */
    default?: unknown;
    /** Para `type: 'number'` — valor mínimo (inclusivo). */
    minimum?: number;
    /** Para `type: 'number'` — valor máximo (inclusivo). */
    maximum?: number;
}

/**
 * Definição de uma tool registrável. O `execute` devolve sempre uma `string` (contrato do loop do
 * agente: o `[TOOL RESULT]` é texto injetado no contexto). Erros tratáveis viram strings de erro;
 * apenas falhas irrecuperáveis lançam (tratadas pelo loop como erro de tool).
 */
export interface ToolDefinition {
    /** Nome único pelo qual o modelo/agente invoca a tool (ex.: 'delegate'). */
    name: string;
    /** Documentação mostrada ao modelo no prompt — orienta QUANDO usar a tool. */
    description: string;
    /** Schema estruturado dos parâmetros (chave = nome do arg). */
    inputSchema: Record<string, ToolParamSchema>;
    /** Executor: recebe os args normalizados e devolve o resultado como string. */
    execute: (args: Record<string, any>) => Promise<string>;
}

// === Registry ===

const registry = new Map<string, ToolDefinition>();

/**
 * Registra (ou substitui) uma tool no registry. Idempotente para o mesmo `name`. Retorna a
 * definição registrada para encadeamento.
 */
export function registerTool<T extends ToolDefinition>(def: T): T {
    if (!def || typeof def.name !== 'string' || !def.name.trim()) {
        throw new Error('registerTool: definição inválida (name ausente).');
    }
    registry.set(def.name, def);
    return def;
}

/** Remove uma tool do registry (uso principal: isolamento entre testes). */
export function unregisterTool(name: string): boolean {
    return registry.delete(name);
}

/** Limpa o registry inteiro (uso principal: isolamento entre testes). */
export function clearTools(): void {
    registry.clear();
}

/** True se a tool `name` está registrada. */
export function hasTool(name: string): boolean {
    return registry.has(name);
}

/**
 * Devolve a definição da tool `name`, ou `undefined` se não registrada. #1036 critério de
 * aceite: o caminho canônico para obter o executor/schema de uma tool por nome.
 */
export function getTool(name: string): ToolDefinition | undefined {
    return registry.get(name);
}

/**
 * #1036 — Lista todas as tools registradas com nome + descrição + schema. Ordem determinística
 * (ordem de registro) para snapshots de teste estáveis.
 */
export function listTools(): ToolDefinition[] {
    return Array.from(registry.values());
}

/** Apenas os nomes registrados (útil para validação/inspeção rápida). */
export function listToolNames(): string[] {
    return Array.from(registry.keys());
}

// === Bootstrap: registra as tools conhecidas no carregamento do módulo ===

// A tool `delegate` (#1036) é registrada aqui para que `listTools()` já a exija logo após o
// `import`. Ferramentas subsequentes seguem o mesmo padrão (importar a def + registerTool).
registerTool(delegateTool);

// Re-exporta a definição para conveniência de quem importa o registry.
export { delegateTool } from './delegate';
