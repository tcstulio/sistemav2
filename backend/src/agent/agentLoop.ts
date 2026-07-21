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
    summarizeToolResult,
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
    /**
     * Executor de tools injetável. Recebe o `AbortSignal` para permitir cancelamento
     * COOPERATIVO em tools que o honram. O default (`executeTool` de `services/agentTools`)
     * é um dispatch atômico que NÃO consulta o signal — por isso o loop também corre a
     * chamada contra o abort (`awaitToolOrAbort`), de modo que um `signal` acionado não
     * fica bloqueado esperando uma tool longa terminar. Default: `executeTool`.
     */
    executeToolFn?: (tool: string, args: any, signal?: AbortSignal) => Promise<string>;
    /**
     * Parser de tool-calls do texto do LLM. Injetável para testes determinísticos sem
     * depender do parser real. Default: `extractToolCalls` de `services/aiService`.
     */
    parseToolCalls?: (text: string) => Array<{ tool: string; args: any }>;
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
    const executeToolFn = deps.executeToolFn ?? ((tool, args) => executeTool(tool, args));
    const parseToolCalls = deps.parseToolCalls ?? extractToolCalls;
    const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxToolCalls = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

    const signal = opts.signal;
    if (signal?.aborted) {
        stream.cancel(opts.jobId, signal.reason || 'aborted-before-start');
        throw new Error(`runAgentLoop: aborted before start (${signal.reason})`);
    }

    // Resolve cfg cedo para que o early-return do cancel-assíncrono possa usar
    // `modelName` no `AgentLoopResult` (não precisamos de `accUsage` aqui — é zero).
    const isAdmin = opts.isAdmin ?? getToolContext().isAdmin ?? false;
    const toolsPrompt = deps.toolsPrompt ?? getToolsPrompt({ isAdmin: isAdmin === true });
    const baseUrl = envConfig.localLlmUrl.replace(/\/+$/, '');
    const modelName = opts.model ?? envConfig.localModelName;
    const apiKey = (envConfig as any).localLlmApiKey || undefined;

    // #1575: cancelamento assíncrono via flag (POST /chat/jobs/:id/cancel). Se o cancel
    // chegou ANTES do loop começar, emitimos 'cancelled' com summary (vazio) e fechamos
    // o job — o caller ainda recebe uma resposta rápida sem executar tool alguma.
    if (stream.isCancelled(opts.jobId)) {
        const summary = buildCancelSummary(stream.getCompletedToolCalls(opts.jobId));
        stream.close(opts.jobId, 'cancelled', { reason: 'user-cancel', summary });
        const result: AgentLoopResult = {
            text: summary,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            contextWindow: 0,
            model: modelName,
            fellBack: false,
            events: stream.getBuffer(opts.jobId),
        };
        return result;
    }

    // === Início: emite 'thinking' com a fase inicial ===
    stream.emit(opts.jobId, 'thinking', { phase: 'start', origin: opts.origin ?? 'agent' });

    let currentContext = opts.context;
    const accUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let toolCallsUsed = 0;
    let iterations = 0;
    let lastText = '';
    // Sinaliza que o turno foi cancelado (abort durante uma tool) — encerra os dois loops.
    let aborted = false;

    const onAbort = () => {
        stream.cancel(opts.jobId, signal?.reason || 'aborted');
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
        while (iterations < maxIterations) {
            if (signal?.aborted) break;

            // #1575: checa a flag de cancelamento ANTES de gastar mais uma iteração do LLM.
            // Se setada (via POST /chat/jobs/:id/cancel), emite 'cancelled' com summary
            // listando tool_calls já completados e fecha o job. Tempo alvo: O(1).
            // NOTA: AbortSignal tem PRECEDÊNCIA — se ambos estiverem acionados, o bloco
            // final trata como abort (path já testado). Aqui só chegamos com signal vivo.
            if (stream.isCancelled(opts.jobId)) {
                const summary = buildCancelSummary(stream.getCompletedToolCalls(opts.jobId));
                stream.close(opts.jobId, 'cancelled', { reason: 'user-cancel', summary });
                lastText = summary;
                aborted = true;
                break;
            }

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
            const toolCalls = parseToolCalls(content);

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

                // #1575: cancelamento por flag entre tools — interrompe o batch e fecha
                // o job com summary. Evita continuar chamando tools caras depois que o
                // usuário clicou em "cancelar".
                if (stream.isCancelled(opts.jobId)) {
                    const summary = buildCancelSummary(stream.getCompletedToolCalls(opts.jobId));
                    stream.close(opts.jobId, 'cancelled', { reason: 'user-cancel', summary });
                    lastText = summary;
                    aborted = true;
                    break;
                }

                if (toolCallsUsed >= maxToolCalls) {
                    const msg = `Limite de ${maxToolCalls} tool call(s) atingido — encerrando o turno.`;
                    log.warn(`agentLoop[${opts.jobId}]: ${msg}`);
                    // Terminal ÚNICO: fecha com 'error' (o turno não pôde concluir dentro do
                    // teto). `aborted` encerra os dois loops e o job já fechado faz o bloco
                    // final pular o 'done' — sem 'error' seguido de 'done' contraditório.
                    stream.close(opts.jobId, 'error', { message: msg });
                    lastText = msg;
                    aborted = true;
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
                    // Corre a tool contra o abort: se o signal disparar no meio de uma tool
                    // longa (não-cooperativa), NÃO ficamos bloqueados esperando — a Promise
                    // rejeita com AbortError e o cancelamento é honrado imediatamente. A tool
                    // pode terminar em background (sem cooperação não há como matá-la), mas o
                    // stream/loop é liberado na hora.
                    const result = await awaitToolOrAbort(executeToolFn(tc.tool, tc.args ?? {}, signal), signal);
                    const s = String(result ?? '');
                    // Summary curto p/ o payload (não despeja o tool result inteiro no evento).
                    summary = summarizeToolResult(result);
                    currentContext += `\n\n[TOOL RESULT ${tc.tool}]: ${s}`;
                } catch (e: any) {
                    // Cancelamento cooperativo: o signal abortou DURANTE a tool. O listener
                    // onAbort já emitiu 'cancelled' e fechou o job — não emitimos tool_result
                    // nem tratamos como erro; só encerramos os dois loops.
                    if (isAbortError(e) || signal?.aborted) {
                        aborted = true;
                        break;
                    }
                    if (e?.name === 'AskUserInterrupt') {
                        lastText = e.question ?? '';
                        // Interrupção do usuário: terminal ÚNICO 'cancelled' (o turno pausa
                        // aguardando input). `aborted` encerra os loops e, com o job fechado,
                        // o bloco final NÃO emite 'done' por cima.
                        stream.close(opts.jobId, 'cancelled', { reason: 'user-interrupt', question: e.question });
                        aborted = true;
                        break;
                    }
                    const detail = e?.message || String(e);
                    log.warn(`agentLoop[${opts.jobId}]: tool ${tc.tool} falhou: ${detail}`);
                    summary = summarizeToolResult(e, false);
                    currentContext += `\n\n[ERRO NA FERRAMENTA ${tc.tool}]: ${detail}`;
                }

                // #1574: emite 'tool_result' {name, summary} DEPOIS de executar.
                stream.emit(opts.jobId, 'tool_result', { name: tc.tool, summary });

                // #1575: checa cancel flag DEPOIS da tool terminar — race-resolved cancel
                // (cliente clicou enquanto a tool rodava; ela terminou sozinha, mas não
                // devemos gastar outra iteração de LLM).
                if (stream.isCancelled(opts.jobId)) {
                    const summary = buildCancelSummary(stream.getCompletedToolCalls(opts.jobId));
                    stream.close(opts.jobId, 'cancelled', { reason: 'user-cancel', summary });
                    lastText = summary;
                    aborted = true;
                    break;
                }

                // Aborto que chegou logo após a tool retornar (race resolveu com valor):
                // encerra antes de gastar outra iteração de LLM.
                if (signal?.aborted) {
                    aborted = true;
                    break;
                }
            }

            if (aborted) break;

            iterations++;
            if (deps.iterationDelayMs) await sleep(deps.iterationDelayMs);
        }

        // === Fim: fecha o job com o terminal 'done' e o texto final ===
        // `close()` JÁ emite o evento terminal no buffer — NÃO chamamos `emit('done')`
        // antes, senão o consumidor veria dois 'done' (terminal duplicado).
        if (signal?.aborted) {
            // Já emitimos 'cancelled' no listener onAbort — apenas garantimos o fechamento.
            if (!stream.isClosed(opts.jobId)) stream.close(opts.jobId);
        } else if (!stream.isClosed(opts.jobId)) {
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
        // `close()` já emite o terminal 'error' — não duplicamos com um emit antes.
        if (!stream.isClosed(opts.jobId)) {
            stream.close(opts.jobId, 'error', { message: msg });
        }
        throw e;
    } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
    }
}

// === Helpers ===

/**
 * #1575: monta o texto do summary do cancelamento a partir da lista de tool_calls
 * completadas. Formato humano-legível:
 *
 *   "Cancelado por você. O que já fiz:
 *    - buscar({"q":"x"}) → encontrou 3 resultados
 *    - enviar_email({"to":"..."}) → enviado"
 *
 * Caso vazio (cancel antes de qualquer tool): "Cancelado por você. Nada foi concluído
 * ainda — o turno não havia começado." Caller decide se usa a frase vazia ou essa.
 *
 * Tool_calls pendentes (tool_call emitido mas tool_result ainda não chegou — race
 * edge case) SÃO pulados: só listamos o que REALMENTE terminou. Limite duro de 50
 * entradas para não estourar o payload do SSE em jobs com tool_calls pesadas.
 */
export function buildCancelSummary(
    completedToolCalls: Array<{ name: string; args: unknown; summary: string }>,
): string {
    const completed = completedToolCalls.filter((c) => !!c.summary).slice(0, 50);
    if (completed.length === 0) {
        return 'Cancelado por você. Nada foi concluído ainda — o turno não havia começado.';
    }
    const lines = completed.map((c) => {
        const argsStr = c.args && Object.keys(c.args as object).length > 0
            ? JSON.stringify(c.args)
            : '{}';
        return `- ${c.name}(${argsStr}) → ${c.summary}`;
    });
    return `Cancelado por você. O que já fiz:\n${lines.join('\n')}`;
}

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

/** Erro padronizado de cancelamento (name='AbortError' — convenção da Web Platform). */
function makeAbortError(reason?: unknown): Error {
    const err = new Error(typeof reason === 'string' && reason ? reason : 'aborted');
    err.name = 'AbortError';
    return err;
}

/** Identifica o erro de cancelamento produzido por `awaitToolOrAbort`/AbortSignal. */
function isAbortError(e: unknown): boolean {
    return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';
}

/**
 * Corre uma Promise contra um `AbortSignal`: resolve/rejeita com o resultado da Promise,
 * OU rejeita com `AbortError` assim que o signal disparar — o que vier primeiro. Remove
 * o listener em qualquer desfecho (sem vazamento). Sem signal, é passthrough.
 *
 * Nota honesta: isto NÃO mata a Promise subjacente (uma tool não-cooperativa segue
 * rodando em background). O ganho é liberar o LOOP imediatamente no abort, em vez de
 * ficar preso esperando uma tool longa terminar.
 */
function awaitToolOrAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return p;
    if (signal.aborted) return Promise.reject(makeAbortError(signal.reason));
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(makeAbortError(signal.reason));
        signal.addEventListener('abort', onAbort, { once: true });
        p.then(
            (v) => {
                signal.removeEventListener('abort', onAbort);
                resolve(v);
            },
            (e) => {
                signal.removeEventListener('abort', onAbort);
                reject(e);
            },
        );
    });
}

// === Re-exports para reduzir acoplamento ===

export { getProgressStream, ProgressStream } from './progressStream';
export type { ProgressEvent, ProgressEventType, SubscribeOptions } from './progressStream';
