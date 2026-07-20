/**
 * #1574 — Loop do agente com emissão de eventos de progresso.
 *
 * Wrapper canônico de streaming em cima do LLM + tools. O loop em si é mais SIMPLES
 * que o `LocalProvider.generateReply` (em `services/aiService.ts`) — sem prune de
 * contexto, sem gate de nudge estrutural, sem travas anti-alucinação. Esses detalhes
 * podem ser portados depois (issue subsequente). Aqui o valor é:
 *
 *   - **Eventos padronizados** emitidos nos pontos-chave do loop, via ProgressStream.
 *   - **IDs monotônicos por job** (`seq` 1-based, `id` `<jobId>:<seq>`) — habilita
 *     retomada com `Last-Event-ID`.
 *   - **Cancelamento cooperativo** via `AbortSignal` — emite `cancelled` e fecha o job.
 *   - **Mesma superfície de tipos** que `aiService.generateReply` (`ChatMessage`,
 *     `TokenUsage`, `GenerateReplyResult`) — facilita migração futura.
 *
 * Por que NÃO substituímos `aiService.generateReply` de uma vez: a versão em produção
 * tem décadas de ajustes finos (gate #957, trava #1332, HITL #1408, etc.) e uma
 * suíte de testes extensa (ver `services/aiService.*.test.ts`). Adicionar eventos
 * retroativamente exigiria mudanças invasivas + alto risco de regressão. Esta versão
 * roda em PARALELO e oferece a base para iteração incremental.
 *
 * Como integrar:
 *   - Rotas SSE usam `getProgressStream().subscribe(jobId)` para receber eventos.
 *   - Consumers (dashboard, webhooks) chamam `runAgentLoop({ jobId, ... })` e usam
 *     o mesmo jobId para assinar o stream de eventos.
 */
import axios from 'axios';
import { config as envConfig } from '../config/env';
import { createLogger } from '../utils/logger';
import {
    getProgressStream,
    ProgressStream,
    type ProgressEvent,
} from './progressStream';
import {
    executeTool,
    getToolsPrompt,
    getToolContext,
} from '../services/agentTools';
import {
    extractToolCalls,
    type ChatMessage,
    type TokenUsage,
    type GenerateReplyResult,
} from '../services/aiService';

const log = createLogger('AgentLoop');

// === Tipos públicos ===

/** Mesma superfície do `GenerateReplyOptions` em `aiService.ts` (subset streaming). */
export interface AgentLoopOptions {
    /** ID do job — chave do buffer de eventos no ProgressStream. OBRIGATÓRIO. */
    jobId: string;
    conversationHistory: ChatMessage[];
    context: string;
    imageBase64?: string | string[];
    /** Origem (ex.: 'chat', 'taskrunner') — apenas metadado, propagado como log. */
    origin?: string;
    /** Override do provider (default: env.llmProvider). Hoje só 'local' tem caminho instrumentado. */
    provider?: 'local';
    /** Override do modelo. */
    model?: string;
    /**
     * Override do `isAdmin` — controla o filtro de DEV_TOOLS no prompt (#1498).
     * Default: cai pro `getToolContext().isAdmin` (compat com `runWithToolContext`).
     * Mesma convenção do `GenerateReplyOptions.isAdmin`.
     */
    isAdmin?: boolean;
    /** Lista de tools já aprovadas pelo usuário (gate HITL #1408) — propagada p/ `executeTool`. */
    approvedTools?: string[];
    /** Teto de iterações do loop (default: 8 — mais conservador que aiService). */
    maxIterations?: number;
    /** Teto de tool calls POR job (default: 10). Quando excedido, encerra com mensagem clara. */
    maxToolCalls?: number;
    /** Cancelamento cooperativo — quando aborted, emite `cancelled` e fecha o job. */
    signal?: AbortSignal;
}

export interface AgentLoopDeps {
    /** Stream destino dos eventos. Default: singleton de `getProgressStream()`. */
    stream?: ProgressStream;
    /**
     * Caller LLM injetável — testes substituem para respostas determinísticas.
     * Assinatura: recebe as messages e a config; devolve `{ content, usage? }`.
     * Default: chamada axios para o LLM local configurado em `env.localLlmUrl`.
     */
    llmCall?: LlmCaller;
    /** Tools prompt custom — testes injetam string simplificada. */
    toolsPrompt?: string;
    /** Sleep entre iterações (testes podem acelerar). */
    iterationDelayMs?: number;
}

export interface AgentLoopResult extends GenerateReplyResult {
    /** Snapshot final do buffer de eventos do job (útil p/ testes/sync). */
    events: ProgressEvent[];
}

export type LlmCaller = (
    messages: Array<{ role: string; content: string }>,
    options: { temperature: number; model: string; baseUrl: string; apiKey?: string },
) => Promise<{ content: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }>;

// === Defaults ===

const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_MAX_TOOL_CALLS = 10;

// === Implementação ===

/**
 * Roda o loop do agente emitindo eventos de progresso. Cada iteração:
 *
 *   1. Emite `thinking` antes de chamar o LLM.
 *   2. Monta o prompt (system + history + context + tools).
 *   3. Chama o LLM (`llmCall`).
 *   4. Extrai tool-calls. Se houver:
 *      a. Para CADA tool: emite `tool_call` ANTES.
 *      b. Executa a tool (`executeTool`).
 *      c. Emite `tool_result` DEPOIS (com summary curto).
 *      d. Adiciona o resultado ao contexto e volta ao passo 1.
 *   5. Se não houver tool-call, emite `done` com o texto final e fecha o job.
 *
 * Cancelamento: se `signal` abortar, emite `cancelled` com a razão, fecha o job
 * e resolve com o último texto disponível.
 *
 * Erros: se o LLM/tool lançar, emite `error` com a mensagem, fecha o job e re-lança.
 */
export async function runAgentLoop(
    opts: AgentLoopOptions,
    deps: AgentLoopDeps = {},
): Promise<AgentLoopResult> {
    const stream = deps.stream ?? getProgressStream();
    const llmCall = deps.llmCall ?? defaultLlmCall;
    const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxToolCalls = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

    const signal = opts.signal;
    if (signal?.aborted) {
        stream.cancel(opts.jobId, signal.reason || 'aborted-before-start');
        throw new Error(`runAgentLoop: aborted before start (${signal.reason})`);
    }

    // === Início: emite 'thinking' com a fase inicial ===
    stream.emit(opts.jobId, 'thinking', { phase: 'start', origin: opts.origin ?? 'agent' });

    const isAdmin = opts.isAdmin ?? getToolContext().isAdmin ?? false;
    const toolsPrompt = deps.toolsPrompt ?? getToolsPrompt({ isAdmin: isAdmin === true });
    const baseUrl = envConfig.localLlmUrl.replace(/\/+$/, '');
    const modelName = opts.model ?? envConfig.localModelName;
    const apiKey = (envConfig as any).localLlmApiKey || undefined;

    let currentContext = opts.context;
    const accUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let toolCallsUsed = 0;
    let iterations = 0;
    let lastText = '';

    const onAbort = () => {
        stream.cancel(opts.jobId, signal?.reason || 'aborted');
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
        while (iterations < maxIterations) {
            if (signal?.aborted) break;

            // Sinaliza "pensando" — útil para o cliente SSE mostrar um spinner.
            stream.emit(opts.jobId, 'thinking', {
                phase: 'iteration',
                iteration: iterations,
            });

            const messages = buildMessages(currentContext, opts.conversationHistory, toolsPrompt);
            const t0 = Date.now();
            let llmResp;
            try {
                llmResp = await llmCall(messages, {
                    temperature: 0.5,
                    model: modelName,
                    baseUrl,
                    apiKey,
                });
            } catch (e: any) {
                const msg = e?.message || String(e);
                log.warn(`agentLoop[${opts.jobId}]: LLM call falhou: ${msg}`);
                throw new Error(`LLM call failed: ${msg}`);
            }
            const latencyMs = Date.now() - t0;
            log.debug(`agentLoop[${opts.jobId}]: LLM respondeu em ${latencyMs}ms`);

            // Acumula usage.
            if (llmResp.usage) {
                accUsage.promptTokens += llmResp.usage.prompt_tokens || 0;
                accUsage.completionTokens += llmResp.usage.completion_tokens || 0;
                accUsage.totalTokens += llmResp.usage.total_tokens || 0;
            }

            const content = llmResp.content || '';
            const toolCalls = extractToolCalls(content);

            if (toolCalls.length === 0) {
                // Sem tool-call → resposta final.
                lastText = content;
                // text_delta opcional (se o conteúdo for longo, emite um delta único —
                // chunks reais viriam quando o provider expor streaming, o que ainda
                // não é o caso para Ollama/GLM/MiniMax via chat/completions).
                if (content) stream.emit(opts.jobId, 'text_delta', { delta: content });
                break;
            }

            // Tool-calls: emite cada `tool_call` ANTES e `tool_result` DEPOIS.
            for (const tc of toolCalls) {
                if (signal?.aborted) break;

                if (toolCallsUsed >= maxToolCalls) {
                    const msg = `Limite de ${maxToolCalls} tool call(s) atingido — encerrando o turno.`;
                    log.warn(`agentLoop[${opts.jobId}]: ${msg}`);
                    stream.emit(opts.jobId, 'error', { message: msg });
                    lastText = msg;
                    iterations = maxIterations; // força saída do while externo
                    break;
                }

                // #1574: emite 'tool_call' {name, args} ANTES de executar.
                stream.emit(opts.jobId, 'tool_call', {
                    name: tc.tool,
                    args: tc.args ?? {},
                });
                toolCallsUsed++;

                let summary = '';
                try {
                    const result = await executeTool(tc.tool, tc.args ?? {});
                    const s = String(result ?? '');
                    // Summary curto p/ o payload (não despeja o tool result inteiro no evento).
                    summary = s.length > 200 ? `${s.slice(0, 200)}… (+${s.length - 200} chars)` : s;
                    currentContext += `\n\n[TOOL RESULT ${tc.tool}]: ${s}`;
                } catch (e: any) {
                    if (e?.name === 'AskUserInterrupt') {
                        summary = `__interrupt__:${e.question ?? ''}`;
                        lastText = e.question ?? '';
                        // Emite `cancelled` no lugar de error — é interrupção do usuário.
                        stream.emit(opts.jobId, 'cancelled', { reason: 'user-interrupt', question: e.question });
                        iterations = maxIterations;
                        break;
                    }
                    const detail = e?.message || String(e);
                    log.warn(`agentLoop[${opts.jobId}]: tool ${tc.tool} falhou: ${detail}`);
                    summary = `error: ${detail}`;
                    currentContext += `\n\n[ERRO NA FERRAMENTA ${tc.tool}]: ${detail}`;
                }

                // #1574: emite 'tool_result' {name, summary} DEPOIS de executar.
                stream.emit(opts.jobId, 'tool_result', { name: tc.tool, summary });
            }

            iterations++;
            if (deps.iterationDelayMs) await sleep(deps.iterationDelayMs);
        }

        // === Fim: emite 'done' com o texto final ===
        if (signal?.aborted) {
            // Já emitimos 'cancelled' no listener — apenas fechamos.
            if (!stream.isClosed(opts.jobId)) stream.close(opts.jobId);
        } else if (!stream.isClosed(opts.jobId)) {
            stream.emit(opts.jobId, 'done', { result: lastText });
            stream.close(opts.jobId, 'done', { result: lastText });
        }

        const result: AgentLoopResult = {
            text: lastText,
            usage: accUsage,
            contextWindow: 0, // streaming não precisa da janela exata por enquanto
            model: modelName,
            fellBack: false,
            events: stream.getBuffer(opts.jobId),
        };
        return result;
    } catch (e: any) {
        const msg = e?.message || String(e);
        log.error(`agentLoop[${opts.jobId}]: erro fatal: ${msg}`);
        if (!stream.isClosed(opts.jobId)) {
            stream.emit(opts.jobId, 'error', { message: msg });
            stream.close(opts.jobId, 'error', { message: msg });
        }
        throw e;
    } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
    }
}

// === Helpers ===

/** Monta a lista de messages no formato OpenAI-compat (system + history). */
function buildMessages(
    context: string,
    history: ChatMessage[],
    toolsPrompt: string,
): Array<{ role: string; content: string }> {
    const out: Array<{ role: string; content: string }> = [];
    const systemContent = [
        'Você é um assistente ERP. Responda em Português.',
        toolsPrompt ? `\n${toolsPrompt}` : '',
        context ? `\n\nCONTEXTO: ${context}` : '',
    ]
        .filter(Boolean)
        .join('');
    if (systemContent) out.push({ role: 'system', content: systemContent });
    for (const m of history) {
        const role = m.role === 'model' ? 'assistant' : m.role;
        out.push({ role, content: String(m.parts ?? '') });
    }
    return out;
}

/** Default LLM caller: POST /chat/completions na URL local (Ollama/GLM/MiniMax). */
async function defaultLlmCall(
    messages: Array<{ role: string; content: string }>,
    opts: { temperature: number; model: string; baseUrl: string; apiKey?: string },
): Promise<{ content: string; usage?: any }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;
    const resp = await axios.post(
        `${opts.baseUrl}/chat/completions`,
        { model: opts.model, messages, temperature: opts.temperature },
        { headers, timeout: envConfig.llmPrimaryTimeoutMs ?? 180000 },
    );
    const content = resp.data?.choices?.[0]?.message?.content ?? '';
    const usage = resp.data?.usage;
    return { content, usage };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// === Re-exports para reduzir acoplamento ===

export { getProgressStream, ProgressStream } from './progressStream';
export type { ProgressEvent, ProgressEventType, SubscribeOptions } from './progressStream';