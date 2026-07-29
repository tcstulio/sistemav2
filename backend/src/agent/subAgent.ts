/**
 * #964/#1036 — `runSubAgent`: executa um sub-agente com CONTEXTO PRÓPRIO.
 *
 * A tool `delegate` (em `agent/tools/delegate.ts`) é a única chamadora direta: ela recebe o
 * `objective` do agente pai, resolve o conjunto de tools permitido e repassa para cá. O
 * sub-agente roda um loop independente (`runAgentLoop`) — só o `objective` + dados relevantes
 * entram no contexto; o contexto inflado do pai (buscas longas, listas grandes) fica de fora.
 *
 * Contrato com o pai (#1036):
 *   - recebe `parentDepth` = (depth do pai + 1); roda o loop filho num ToolContext com
 *     `depth: parentDepth` para encadear a profundidade;
 *   - devolve `{ summary }` — só o RESUMO volta para o pai (string curta). O pai recebe isso
 *     como `[TOOL RESULT delegate]`.
 *
 * Isolamento de tools (defesa em profundidade):
 *   - O sub-agente só pode chamar tools cujo nome esteja no conjunto `tools` informado. Qualquer
 *     tool fora do conjunto é recusada com mensagem clara (não executa). Isto fecha o bypass de
 *     um modelo filho tentar escapar do sandbox via injeção/alucinação de nome de tool.
 *   - Quando a chamadora OMITE `tools`, a tool `delegate` injeta `DEFAULT_SUBAGENT_TOOLS`
 *     (somente leitura) — então o sub-agente jamais tem acesso a tools destrutivas por padrão
 *     (create_, update_, validate_ e prepare_create/edit).
 *
 * Tetos:
 *   - `MAX_SUBAGENT_DEPTH` (2): impede recursão infinita (filho delegando para neto de neto…).
 *     Ultrapassado ⇒ retorna summary de erro, sem disparar o loop.
 *   - `maxIterations` (default 5, clampado em [1, 10] — espelha o schema da tool `delegate`).
 */
import { runAgentLoop, type LlmCaller, type AgentLoopResult } from './agentLoop';
import { runWithToolContext, getToolContext, type ToolContext } from '../services/agentTools';
import { ProgressStream } from './progressStream';
import { createLogger } from '../utils/logger';

const log = createLogger('SubAgent');

// === Constantes públicas ===

/**
 * Conjunto padrão de tools de LEITURA que um sub-agente recebe quando a chamadora omite `tools`
 * (#1036: "se omitido, sub-agente tem acesso ao conjunto padrão de leitura"). NENHUMA delas é
 * destrutiva (create_, update_, validate_ e prepare_create/edit) — fail-safe: um sub-agente sem escopo explícito só lê.
 *
 * Os nomes são CANÔNICOS do dispatcher `executeTool` em `services/agentTools.ts` (cada um é um
 * `case` real E está documentado no `TOOLS_PROMPT`). Correção do Judge: `list_customers` só
 * funcionava via alias → `search_customer` (indireção frágil), e `search_web` é um case legado
 * (ScraperService/SERPER_API_KEY) — o canônico é `web_search` (tool #86, via zaiSearchService).
 */
export const DEFAULT_SUBAGENT_TOOLS: readonly string[] = [
    'search',
    'list_products',
    'search_customer',
    'get_customer_details',
    'web_search',
];

/** Profundidade máxima de aninhamento (epic #964: "profundidade máx 1-2 níveis"). depth 1 = filho. */
export const MAX_SUBAGENT_DEPTH = 2;

/** Iterações padrão do sub-agente (espelha o `default` do schema da tool `delegate`). */
export const DEFAULT_SUBAGENT_MAX_ITERATIONS = 5;

/** Teto absoluto de iterações (espelha o `maximum: 10` do schema da tool `delegate`). */
export const MAX_SUBAGENT_MAX_ITERATIONS = 10;

// === Tipos ===

export interface RunSubAgentOptions {
    /** Objetivo claro e autossuficiente do sub-agente (o "prompt" dele). */
    objective: string;
    /**
     * Conjunto de tools permitido ao sub-agente (nomes lógicos, ex.: 'search', 'list_products').
     * Se omitido/vazio ⇒ `DEFAULT_SUBAGENT_TOOLS` (somente leitura). Qualquer tool fora do
     * conjunto é bloqueada pelo executor do loop.
     */
    tools?: readonly string[];
    /** Orçamento de iterações do loop (default 5; clampado em [1, 10]). */
    maxIterations?: number;
    /**
     * Profundidade a ser ASSUMIDA pelo sub-agente = (depth do pai + 1). `runSubAgent` roda o
     * loop num ToolContext com `depth: parentDepth`. Se > MAX_SUBAGENT_DEPTH, recusa sem rodar.
     */
    parentDepth: number;
}

export interface SubAgentResult {
    /** Resumo curto que volta para o agente pai como `[TOOL RESULT delegate]`. */
    summary: string;
    /** Profundidade em que o sub-agente rodou (= parentDepth). */
    depth: number;
    /** Iterações efetivamente consumidas pelo loop. */
    iterations: number;
    /** Tool-calls efetivamente executadas pelo loop. */
    toolCalls: number;
}

/**
 * Dependências injetáveis (testes determinísticos). Espelha o padrão de `AgentLoopDeps` — quando
 * omitidas, `runSubAgent` usa o loop real (LLM local + executeTool + ProgressStream singleton).
 */
export interface SubAgentDeps {
    /** Caller LLM injetável (mesma assinatura de `LlmCaller` do agentLoop). */
    llmCall?: LlmCaller;
    /**
     * Executor de tools do sub-agente. Recebe (tool, args) e devolve string. Default: envolve o
     * `executeTool` de agentTools com o gate de conjunto-permitido. Em testes, injete um stub.
     */
    executeToolFn?: (tool: string, args: any) => Promise<string>;
    /** Prompt de tools custom (default: texto derivado do conjunto permitido). */
    toolsPrompt?: string;
    /** Stream destino (default: instância isolada descartável — sub-agent não polui o stream do pai). */
    stream?: ProgressStream;
    /** Parser de tool-calls (default: o mesmo do agentLoop). */
    parseToolCalls?: (text: string) => Array<{ tool: string; args: any }>;
}

// === Implementação ===

/**
 * Executa um sub-agente isolado e devolve `{ summary }` (o resumo que volta para o pai).
 *
 * Passos:
 *   1. Guarda de profundidade — `parentDepth > MAX` ⇒ retorna summary de erro sem rodar.
 *   2. Resolve conjunto de tools (default somente-leitura).
 *   3. Monta executor de tools que BLOQUEIA qualquer tool fora do conjunto permitido.
 *   4. Roda `runAgentLoop` dentro de um `runWithToolContext({ depth: parentDepth })` — o
 *      ToolContext propagado garante que o gate de profundidade encadeie se o filho chamar
 *      `delegate` novamente.
 *   5. Extrai o `text` final do loop como `summary`.
 *
 * Não lança em falha "esperada" (limite de tool-calls, erro de LLM tratado pelo loop): nessas
 * situações o loop já devolve um texto humano e ele vira o summary. Erros fatais (loop throws)
 * são capturados e viram summary de erro — o pai nunca recebe um throw de uma tool.
 */
export async function runSubAgent(
    opts: RunSubAgentOptions,
    deps: SubAgentDeps = {},
): Promise<SubAgentResult> {
    const parentDepth = opts.parentDepth;

    if (!Number.isFinite(parentDepth) || parentDepth > MAX_SUBAGENT_DEPTH) {
        const msg = `Profundidade máxima de sub-agente (${MAX_SUBAGENT_DEPTH}) excedida (recebida ${parentDepth}). Não é possível delegar mais.`;
        log.warn(msg);
        return { summary: msg, depth: parentDepth, iterations: 0, toolCalls: 0 };
    }

    const allowedTools = resolveAllowedTools(opts.tools);
    const maxIterations = clampIterations(opts.maxIterations);
    const objective = String(opts.objective ?? '').trim();

    if (!objective) {
        return {
            summary: 'Sub-agente não recebeu um objetivo (objective vazio). Nada executado.',
            depth: parentDepth,
            iterations: 0,
            toolCalls: 0,
        };
    }

    // Executor que só libera tools dentro do conjunto permitido (defesa em profundidade do
    // sandbox do sub-agente — mesmo que o modelo filho tente uma tool destrutiva, é recusada).
    const executeToolFn = deps.executeToolFn
        ? gateAllowedTools(deps.executeToolFn, allowedTools)
        : gateAllowedTools(defaultExecuteTool, allowedTools);

    const stream = deps.stream ?? makeIsolatedStream();
    const jobId = `subagent:${parentDepth}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const toolsPrompt = deps.toolsPrompt ?? buildSubAgentToolsPrompt(allowedTools);

    log.info(`runSubAgent: depth=${parentDepth} tools=[${allowedTools.join(',')}] maxIt=${maxIterations}`);

    // Propaga o ToolContext do pai, sobrescrevendo `depth` — assim o gate de profundidade
    // encadeia e as demais checagens (isAdmin/readOnly) são herdadas pelo filho.
    const parentCtx = getToolContext();
    const childCtx: Partial<ToolContext> = { ...parentCtx, depth: parentDepth };

    let result: AgentLoopResult;
    try {
        result = await runWithToolContext(childCtx, () => runAgentLoop(
            {
                jobId,
                conversationHistory: [{ role: 'user', parts: objective }],
                context: `Sub-objetivo delegado pelo agente pai (profundidade ${parentDepth}): ${objective}`,
                maxIterations,
                maxToolCalls: maxIterations * 3,
                origin: 'subagent',
            },
            {
                stream,
                executeToolFn,
                toolsPrompt,
                ...(deps.llmCall ? { llmCall: deps.llmCall } : {}),
                ...(deps.parseToolCalls ? { parseToolCalls: deps.parseToolCalls } : {}),
            },
        ));
    } catch (e: any) {
        const msg = e?.message ? String(e.message) : String(e);
        log.error(`runSubAgent falhou (depth=${parentDepth}): ${msg}`);
        return {
            summary: `O sub-agente não conseguiu concluir a sub-tarefa (erro: ${msg}).`,
            depth: parentDepth,
            iterations: 0,
            toolCalls: 0,
        };
    }

    return {
        summary: extractSummary(result.text),
        depth: parentDepth,
        iterations: countIterations(result.events),
        toolCalls: countToolCalls(result.events),
    };
}

// === Helpers ===

/** Resolve o conjunto de tools efetivo: default somente-leitura quando omitido/vazio. */
export function resolveAllowedTools(tools?: readonly string[]): readonly string[] {
    if (!tools || tools.length === 0) return DEFAULT_SUBAGENT_TOOLS;
    // Deduplica preservando ordem; descarta nomes não-string/vazios.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tools) {
        const name = typeof t === 'string' ? t.trim() : '';
        if (name && !seen.has(name)) {
            seen.add(name);
            out.push(name);
        }
    }
    return out.length ? out : DEFAULT_SUBAGENT_TOOLS;
}

/** Clamp de iterações em [1, MAX] (espelha o contrato do schema da tool `delegate`). */
export function clampIterations(n: unknown): number {
    const v = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : DEFAULT_SUBAGENT_MAX_ITERATIONS;
    if (v < 1) return 1;
    if (v > MAX_SUBAGENT_MAX_ITERATIONS) return MAX_SUBAGENT_MAX_ITERATIONS;
    return v;
}

/**
 * Envelopa um executor com o gate de conjunto-permitido: tools fora do conjunto devolvem uma
 * mensagem de recusa (não executam, não lançam). Mantém a assinatura `(tool, args) => string`
 * esperada pelo loop.
 */
function gateAllowedTools(
    inner: (tool: string, args: any) => Promise<string>,
    allowed: readonly string[],
): (tool: string, args: any) => Promise<string> {
    const allow = new Set(allowed);
    return async (tool, args) => {
        if (!allow.has(tool)) {
            return `A ferramenta "${tool}" não está disponível para este sub-agente (fora do conjunto permitido: ${allowed.join(', ')}).`;
        }
        return inner(tool, args);
    };
}

/**
 * Default executor: delega para o `executeTool` de agentTools (o dispatcher real de todas as
 * tools de ERP). Importado dinamicamente para evitar acoplar o grafo de import do subAgent ao
 * monolito agentTools em tempo de carregamento de módulo (e facilitar o mock em testes).
 */
async function defaultExecuteTool(tool: string, args: any): Promise<string> {
    const { executeTool } = await import('../services/agentTools');
    return executeTool(tool, args);
}

/** Stream isolado e descartável para o sub-agente (não polui o buffer singleton do job do pai). */
function makeIsolatedStream(): ProgressStream {
    // Instância FRESCA (não o singleton) para isolar os eventos do sub-agente do job do pai.
    return new ProgressStream({
        ttlMs: 30 * 60 * 1000,
        maxBufferSize: 500,
        autoCleanupIntervalMs: 0,
    });
}

/**
 * Prompt mínimo de tools para o sub-agente: lista apenas as tools permitidas. Não reusa o
 * `TOOLS_PROMPT` completo (85+ tools) — o sub-agente deve enxergar SÓ seu sandbox.
 */
function buildSubAgentToolsPrompt(allowed: readonly string[]): string {
    const list = allowed.map((t) => `- ${t}`).join('\n');
    return [
        'FERRAMENTAS DISPONÍVEIS (use APENAS estas):',
        list,
        '',
        'Para usar uma ferramenta, responda APENAS com um JSON: { "tool": "nome", "args": { ... } }',
        'Quando terminar a sub-tarefa, responda com um RESUMO CURTO do resultado (texto direto, sem JSON).',
    ].join('\n');
}

/**
 * Extrai o resumo curto do texto final do loop. Cola um teto de caracteres para garantir que o
 * `[TOOL RESULT delegate]` que volta ao pai seja curto (ataca o inchaço de contexto do #956).
 */
export const SUBAGENT_SUMMARY_MAX_CHARS = 800;
export function extractSummary(text: string | undefined | null): string {
    const s = String(text ?? '').trim();
    if (!s) return 'O sub-agente finalizou sem produzir um resumo.';
    if (s.length <= SUBAGENT_SUMMARY_MAX_CHARS) return s;
    return s.slice(0, SUBAGENT_SUMMARY_MAX_CHARS - 1).trimEnd() + '…';
}

/** Conta iterações consumidas a partir dos eventos do loop (cada 'thinking' phase=iteration). */
function countIterations(events: AgentLoopResult['events']): number {
    return events.filter((e) => e.type === 'thinking' && (e.payload as any)?.phase === 'iteration').length;
}

/** Conta tool-calls executadas a partir dos eventos do loop. */
function countToolCalls(events: AgentLoopResult['events']): number {
    return events.filter((e) => e.type === 'tool_call').length;
}
