/**
 * #1574 — Pontos de emissão do loop do agente.
 *
 * Este módulo é a PONTE entre o loop do agente (em `services/aiService.ts`) e o
 * `progressStream`. Expõe helpers pequenos e NOMINAIS (`emitToolCall`, `emitToolResult`,
 * etc.) que o loop chama nos pontos-chave (antes/depois de cada tool, ao pensar, ao
 * iniciar e ao terminar). Cada helper é uma NO-OP quando `jobId` é vazio — assim os
 * callers EXISTENTES (que não plumbearam `jobId`) seguem funcionando sem alteração de
 * comportamento, e o custo de ter o stream ligado é essencialmente zero quando não usado.
 *
 * Por que um módulo separado (em vez de chamar `progressStream.emit` direto no loop)?
 *   1. O loop fica LIMPO: `emitToolCall(jobId, name, args)` é auto-explicativo; um
 *      `progressStream.emit(jobId, 'tool_call', { name, args })` espalhado pelo loop
 *      polui a leitura com detalhe do protocolo.
 *   2. TIPIÇÃO forte: cada helper empacota o payload no shape exato esperado pelos
 *      clientes SSE (ToolCallPayload, ToolResultPayload, ...). Erro de digitação no
 *      nome do campo vira erro de tipo em vez de bug silencioso em runtime.
 *   3. Ponto único para evoluir a telemetria (ex.: no futuro, logar métricas por tool
 *      ou amostrar text_delta antes de emitir).
 *
 * Convenções:
 *   - `jobId` é SEMPRE o primeiro parâmetro (mesmo quando opcional/nullable) — facilidade
 *     de grep e uniformidade com `subscribe(jobId, ...)`.
 *   - Nenhum helper lança — emissão é best-effort (erro no stream nunca derruba o loop).
 *   - `summarizeToolResult` moe o `toolResult` cru (string longa, JSON, etc.) num
 *     sumário curto e legível para o cliente SSE (cru fica no currentContext do agente).
 */
import {
    progressStream,
    type ProgressEvent,
    type ProgressEventType,
    type ToolCallPayload,
    type ToolResultPayload,
    type ThinkingPayload,
    type TextDeltaPayload,
    type DonePayload,
    type CancelledPayload,
    type ErrorPayload,
} from './progressStream';

export type {
    ProgressEvent,
    ProgressEventType,
    ProgressEventType as EventType,
    ToolCallPayload,
    ToolResultPayload,
    ThinkingPayload,
    TextDeltaPayload,
    DonePayload,
    CancelledPayload,
    ErrorPayload,
};
export { progressStream, ProgressStream, TERMINAL_PROGRESS_TYPES } from './progressStream';

/** Type guard central: jobId válido = string não-vazia. */
function isLive(jobId: string | null | undefined): jobId is string {
    return typeof jobId === 'string' && jobId.length > 0;
}

/**
 * "Pensando": emitido ao iniciar o turno ou antes de uma nova iteração do loop.
 * Carrega nota livre e/ou índice da iteração (opcional — só para diagnóstico).
 */
export function emitThinking(
    jobId: string | null | undefined,
    note?: string | null,
    iteration?: number,
): void {
    if (!isLive(jobId)) return;
    const payload: ThinkingPayload = {};
    if (note != null) payload.note = note;
    if (typeof iteration === 'number') payload.iteration = iteration;
    progressStream.emit(jobId, 'thinking', payload);
}

/**
 * Antes de chamar cada tool. `name` é o nome da tool; `args` é o objeto cru que sera
 * passado a `executeTool`. Emitir ANTES da chamada permite ao cliente SSE mostrar o
 * "invocando ferramenta X..." imediatamente (UX de progresso).
 */
export function emitToolCall(
    jobId: string | null | undefined,
    name: string,
    args: unknown,
): void {
    if (!isLive(jobId)) return;
    const payload: ToolCallPayload = { name, args: args ?? {} };
    progressStream.emit(jobId, 'tool_call', payload);
}

/**
 * Depois de executar a tool. `summary` é o texto curto (já moído por
 * `summarizeToolResult`); `ok=false` sinaliza erro (tool lançou mas o loop tratou).
 */
export function emitToolResult(
    jobId: string | null | undefined,
    name: string,
    summary: string,
    ok: boolean = true,
): void {
    if (!isLive(jobId)) return;
    const payload: ToolResultPayload = { name, summary, ok };
    progressStream.emit(jobId, 'tool_result', payload);
}

/** Delta de texto incremental (streaming da resposta final). */
export function emitTextDelta(
    jobId: string | null | undefined,
    delta: string,
): void {
    if (!isLive(jobId)) return;
    if (!delta) return;
    const payload: TextDeltaPayload = { delta };
    progressStream.emit(jobId, 'text_delta', payload);
}

/** Término normal do job. `summary` opcional resume o resultado entregue ao usuário. */
export function emitDone(
    jobId: string | null | undefined,
    summary?: string | null,
): void {
    if (!isLive(jobId)) return;
    const payload: DonePayload = {};
    if (summary != null) payload.summary = summary;
    progressStream.emit(jobId, 'done', payload);
}

/** Cancelamento explícito (ex.: usuário abortou, timeout externo). */
export function emitCancelled(
    jobId: string | null | undefined,
    reason: string = 'cancelled',
): void {
    if (!isLive(jobId)) return;
    const payload: CancelledPayload = { reason };
    progressStream.emit(jobId, 'cancelled', payload);
}

/** Erro fatal do turno (LLM indisponível, exceção não tratada no loop). */
export function emitError(
    jobId: string | null | undefined,
    error: unknown,
    code?: string,
): void {
    if (!isLive(jobId)) return;
    const message = error instanceof Error ? error.message : String(error);
    const payload: ErrorPayload = code ? { message, code } : { message };
    progressStream.emit(jobId, 'error', payload);
}

/**
 * Mói o resultado cru de uma tool num sumário curto para o stream (cru continua indo
 * ao currentContext do agente). Strings ficam como estão (apenas whitespace normalizado
 * e truncadas); valores não-string são JSON-stringificados. `maxLen` default = 240 chars
 * — suficiente para diagnóstico sem inundar o cliente SSE.
 */
export function summarizeToolResult(result: unknown, maxLen: number = 240): string {
    if (result == null) return '';
    let s: string;
    if (typeof result === 'string') {
        s = result;
    } else {
        try {
            s = JSON.stringify(result);
        } catch {
            s = String(result);
        }
    }
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + '…';
}

/** Atalho para `progressStream.subscribe` — ponto canônico de consumo do stream. */
export function subscribeToJob(
    jobId: string,
    lastEventId?: number,
    signal?: AbortSignal,
): AsyncIterable<ProgressEvent> {
    return progressStream.subscribe(jobId, lastEventId, signal);
}

/** Atalho para `progressStream.getBuffer` — diagnóstico / admin. */
export function getJobBuffer(jobId: string): ProgressEvent[] {
    return progressStream.getBuffer(jobId);
}

/**
 * Envolta do corpo do turno que cuida do par thinking/done|error SEM precisar tocar
 * em cada `return` do loop. `fn` é o corpo do turno (que pode retornar em N pontos ou
 * lançar); a envolta emite `thinking` antes, `done` no retorno normal e `error` no throw.
 * Ferramenta interna usada pelos providers para plumbar o stream com mínima invasão.
 */
export async function withTurnProgress<T>(
    jobId: string | null | undefined,
    fn: () => Promise<T>,
): Promise<T> {
    if (!isLive(jobId)) return fn();
    emitThinking(jobId);
    try {
        const result = await fn();
        emitDone(jobId);
        return result;
    } catch (e) {
        emitError(jobId, e);
        throw e;
    }
}
