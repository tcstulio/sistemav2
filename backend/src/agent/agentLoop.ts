/**
 * #1574 — Instrumentação do loop do agente com eventos de progresso.
 *
 * Camada fina entre o loop real (implementação concreta em `services/aiService.ts`,
 * fachada em `agent/runner.ts`) e o core de streaming (`agent/progressStream.ts`).
 * Fornece os pontos de emissão padronizados para que o loop publique progresso sem
 * conhecer detalhes do transporte (SSE/WS/etc.):
 *
 *   - `runAgentLoop(jobId, run, { signal })`: envelope que publica `done`/`error`/
 *     `cancelled` em torno de uma execução (turno do agente), propagando o resultado.
 *   - `wrapToolExecutor(executor, jobId)`: envolve `executeTool` publicando
 *     `tool_call {name, args}` ANTES de cada chamada e `tool_result {name, summary}`
 *     DEPOIS (sucesso ou erro) — paridade 1:1 exigida pelo critério de aceite #3.
 *   - Helpers diretos: `emitThinking`, `emitTextDelta`, `emitDone`, `emitCancelled`,
 *     `emitError` — para os pontos de "pensar", deltas de texto e finais explícitos.
 *
 * Esta camada NÃO reescreve o loop de 2k+ linhas do `aiService.ts`; ela oferece o
 * contrato de instrumentação que o loop consome (baixo risco, alta testabilidade),
 * seguindo o mesmo padrão de fachada de `agent/runner.ts`.
 */
import { createLogger } from '../utils/logger';
import {
    progressStream,
    type StreamEvent,
    type StreamEventType,
} from './progressStream';

export { progressStream };
export type { StreamEvent, StreamEventType };

const log = createLogger('AgentLoop');

// === Tipos ==============================================================================
/** Contrato de `services/agentTools.executeTool` (compatível p/ wrap). */
export type ToolExecutor = (
    tool: string,
    args: Record<string, unknown>,
) => Promise<string>;

/** Payloads padronizados por tipo — consumidor SSE pode fazer narrowing seguro. */
export type ThinkingPayload = { text: string };
export type ToolCallPayload = { name: string; args: Record<string, unknown> };
export type ToolResultPayload = { name: string; summary: string };
export type TextDeltaPayload = { text: string };
export type DonePayload = { text?: string };
export type CancelledPayload = { reason?: string };
export type ErrorPayload = { message: string; code?: string };

// === Helpers de emissão =================================================================
/** Resumo compacto do resultado cru da tool — evita inflar o stream com payloads grandes. */
function summarizeToolResult(raw: unknown): string {
    const text = String(raw ?? '').trim();
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

export function emitThinking(jobId: string, text: string): StreamEvent<ThinkingPayload> {
    return progressStream.emit<ThinkingPayload>(jobId, 'thinking', { text });
}

export function emitTextDelta(jobId: string, text: string): StreamEvent<TextDeltaPayload> {
    return progressStream.emit<TextDeltaPayload>(jobId, 'text_delta', { text });
}

export function emitToolCall(
    jobId: string,
    name: string,
    args: Record<string, unknown>,
): StreamEvent<ToolCallPayload> {
    return progressStream.emit<ToolCallPayload>(jobId, 'tool_call', { name, args: args || {} });
}

export function emitToolResult(
    jobId: string,
    name: string,
    summary: string,
): StreamEvent<ToolResultPayload> {
    return progressStream.emit<ToolResultPayload>(jobId, 'tool_result', { name, summary });
}

export function emitDone(jobId: string, text?: string): StreamEvent<DonePayload> {
    return progressStream.emit<DonePayload>(jobId, 'done', { text });
}

export function emitCancelled(jobId: string, reason?: string): StreamEvent<CancelledPayload> {
    return progressStream.emit<CancelledPayload>(jobId, 'cancelled', { reason });
}

export function emitError(jobId: string, message: string, code?: string): StreamEvent<ErrorPayload> {
    return progressStream.emit<ErrorPayload>(jobId, 'error', { message, code });
}

// === Envelope do turno do agente ========================================================
export interface RunAgentLoopOptions {
    /** Sinal de cancelamento — dispara `cancelled` no stream. */
    signal?: AbortSignal;
}

/**
 * Envelopa uma execução do agente (turno/iteração principal), publicando o evento
 * terminal correspondente no stream de progresso:
 *   - sucesso → `done` (payload vazio; o caller pode ter emitido um `done` rico antes,
 *     com o texto final — neste caso `lastEventIsTerminal` evita duplicar);
 *   - abort   → `cancelled`;
 *   - erro    → `error`.
 *
 * O resultado/erro da callback `run` é sempre propagado — o stream é efeito colateral
 * de observabilidade, não altera a semântica do turno.
 */
export async function runAgentLoop<T>(
    jobId: string,
    run: () => Promise<T>,
    options: RunAgentLoopOptions = {},
): Promise<T> {
    // Abort já acionado antes de iniciar: emite terminal e rejeita (caller decide).
    if (options.signal?.aborted) {
        if (!progressStream.lastEventIsTerminal(jobId)) {
            emitCancelled(jobId, 'aborted_before_start');
        }
        throw new Error(`Agent loop ${jobId} cancelled before start`);
    }

    const onAbort = () => {
        // O handler dispara `cancelled` imediatamente (UI vê o cancelamento ao vivo).
        if (!progressStream.lastEventIsTerminal(jobId)) {
            emitCancelled(jobId, 'aborted');
        }
    };
    options.signal?.addEventListener('abort', onAbort);

    try {
        const result = await run();
        // Sucesso: publica `done` apenas se nenhum terminal já foi publicado (ex.:
        // cancelamento concorrente venceu a corrida, ou o caller já emitiu um `done`
        // com o texto final).
        if (!progressStream.lastEventIsTerminal(jobId)) {
            emitDone(jobId);
        }
        return result;
    } catch (err: unknown) {
        const e = err as { name?: string; message?: string; code?: string };
        const isAbort = e?.name === 'AbortError' || options.signal?.aborted === true;
        if (!progressStream.lastEventIsTerminal(jobId)) {
            if (isAbort) {
                emitCancelled(jobId, e?.message || 'aborted');
            } else {
                emitError(jobId, e?.message || String(err), e?.code);
            }
        } else if (isAbort) {
            // Abort venceu — nada a fazer (terminal já publicado).
        } else {
            log.warn(`Agent loop ${jobId}: erro após terminal já publicado — não reemitido.`);
        }
        throw err;
    } finally {
        options.signal?.removeEventListener('abort', onAbort);
    }
}

// === Wrap de executeTool (pontos tool_call / tool_result) ===============================
/**
 * Envolve um executor de tool (ex.: `agentTools.executeTool`) publicando os eventos
 * de progresso nos pontos exigidos pelo critério de aceite #3:
 *   - `tool_call {name, args}` ANTES de cada chamada;
 *   - `tool_result {name, summary}` DEPOIS (sucesso: sumário do resultado; erro:
 *     sumário do erro). Mesmo em erro a paridade tool_call→tool_result é mantida.
 *
 * O comportamento do executor original é preservado (retorno/throw idênticos); o
 * stream é puramente observabilidade.
 *
 * Uso típico (ponto de instrumentação do loop, ver `aiService.ts`):
 *   const exec = wrapToolExecutor(executeTool, jobId);
 *   const result = await exec(tc.tool, tc.args);
 */
export function wrapToolExecutor(executor: ToolExecutor, jobId: string): ToolExecutor {
    return async (tool: string, args: Record<string, unknown>): Promise<string> => {
        emitToolCall(jobId, tool, args || {});
        try {
            const raw = await executor(tool, args);
            emitToolResult(jobId, tool, summarizeToolResult(raw));
            return raw;
        } catch (err: unknown) {
            const e = err as { message?: string };
            emitToolResult(jobId, tool, `erro: ${e?.message || String(err)}`);
            throw err;
        }
    };
}
