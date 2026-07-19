/**
 * #1574 — Núcleo de streaming SSE com buffer de eventos por jobId.
 *
 * Este módulo é a FUNDAMENTO do streaming de progresso do agente: mantém, para cada
 * `jobId`, um BUFFER EM MEMÓRIA dos últimos eventos emitidos (com IDs monotônicos para
 * suportar retomada via `Last-Event-ID`) e um conjunto de SUBSCRIBERS ativos que recebem
 * os eventos ao vivo. O `subscribe(jobId, lastEventId?)` devolve um `AsyncIterable<ProgressEvent>`
 * que (a) repõe primeiro os eventos do buffer com `id > lastEventId` (resume) e (b) em
 * seguida drena eventos novos na ordem em que chegam — terminando ao receber um evento
 * terminal ('done' | 'cancelled' | 'error') ou quando o subscriber aborta.
 *
 * Decisões de design:
 *   - BUFFER por job, NÃO log global: cada job tem sua linha do tempo isolada.
 *   - IDs MONOTÔNICOS POR JOB (1, 2, 3, ...): o cabeçalho SSE `Last-Event-ID` carrega o
 *     último `id` visto pelo cliente; ao reconectar, o cliente passa esse `id` e o servidor
 *     repõe apenas o que houver de mais novo no buffer. IDs NÃO são globais porque dois
 *     clientes reconectando em jobs diferentes não podem colidir.
 *   - TTL por job baseado em `lastActivity` (default 10 min). Eventos de um job parado
 *     continuam acessíveis para retomada até o TTL expirar; depois o job é varrido
 *     (libera memória). O sweep roda em interval (unref — não impede o processo de sair).
 *   - LIMITE DE TAMANHO do buffer (default 500 eventos): ao estourar, descarta os MAIS
 *     ANTIGOS mantendo os recentes (janela deslizante). Esta é a defesa contra um job
 *     verboso (muitos text_delta) estourar a memória — a retomada só consegue recompor
 *     os últimos N eventos, o que é compatível com o SSE padrão.
 *   - EVENTOS TERMINAIS ('done' | 'cancelled' | 'error') fecham os subscribers vivos mas
 *     NÃO apagam o buffer imediatamente: um cliente que reconecta logo após o término
 *     ainda recebe o evento terminal via replay. O TTL cuida da limpeza.
 *   - Cada subscriber tem sua própria fila + waiters: backpressure natural (produtor não
 *     bloqueia; consumidor drena no seu ritmo). Cleanup no `return()` do iterator remove
 *     o subscriber do Set — sem timers de polling.
 */
import { createLogger } from '../utils/logger';

const log = createLogger('ProgressStream');

export type ProgressEventType =
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'text_delta'
    | 'done'
    | 'cancelled'
    | 'error';

export interface BasePayload {}

export interface ThinkingPayload extends BasePayload {
    note?: string | null;
    iteration?: number;
}

export interface ToolCallPayload extends BasePayload {
    name: string;
    args: unknown;
}

export interface ToolResultPayload extends BasePayload {
    name: string;
    summary: string;
    ok: boolean;
}

export interface TextDeltaPayload extends BasePayload {
    delta: string;
}

export interface DonePayload extends BasePayload {
    summary?: string | null;
}

export interface CancelledPayload extends BasePayload {
    reason?: string;
}

export interface ErrorPayload extends BasePayload {
    message: string;
    code?: string;
}

export type ProgressPayload =
    | ThinkingPayload
    | ToolCallPayload
    | ToolResultPayload
    | TextDeltaPayload
    | DonePayload
    | CancelledPayload
    | ErrorPayload
    | unknown;

/** Evento padronizado de progresso de um job. `id` é monotônico POR JOB. */
export interface ProgressEvent<T extends ProgressPayload = ProgressPayload> {
    id: number;
    jobId: string;
    type: ProgressEventType;
    payload: T;
    ts: number;
}

/** Eventos que fecham o stream ao vivo para um subscriber (fim do job). */
export const TERMINAL_PROGRESS_TYPES: ReadonlySet<ProgressEventType> = new Set([
    'done',
    'cancelled',
    'error',
]);

export interface ProgressStreamOptions {
    /** Tempo de vida de um job parado (ms). Default: 10 minutos. */
    ttlMs?: number;
    /** Máximo de eventos armazenados por job (janela deslizante). Default: 500. */
    maxBufferSize?: number;
    /** Intervalo da varredura de TTL (ms). 0 = desativa. Default: 60 segundos. */
    sweepIntervalMs?: number;
    /** Override de `now()` para testes determinísticos. */
    now?: () => number;
}

interface JobState {
    jobId: string;
    events: ProgressEvent[];
    nextId: number;
    lastActivity: number;
    /** Marcado quando um evento terminal é emitido — novos subscribers só fazem replay. */
    closedAt: number | null;
    subscribers: Set<Subscriber>;
}

/** Fila privada de um subscriber — produtor empurra; consumidor drena via async iterator. */
class Subscriber {
    private queue: ProgressEvent[] = [];
    private waiters: Array<(r: { value?: ProgressEvent; done: boolean }) => void> = [];
    private closed = false;
    /** Chamado quando o iterator é encerrado (return/throw/break) — remove do Set do job. */
    onDetach: (() => void) | null = null;

    push(ev: ProgressEvent): void {
        if (this.closed) return;
        const waiter = this.waiters.shift();
        if (waiter) {
            waiter({ value: ev, done: false });
        } else {
            this.queue.push(ev);
        }
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        while (this.waiters.length) {
            const w = this.waiters.shift()!;
            w({ done: true });
        }
    }

    get isClosed(): boolean {
        return this.closed;
    }

    iterator(signal?: AbortSignal): AsyncIterator<ProgressEvent> {
        const self = this;
        const detach = () => {
            self.close();
            self.onDetach?.();
        };
        const next = (): Promise<IteratorResult<ProgressEvent>> => {
            if (self.queue.length) {
                return Promise.resolve({ value: self.queue.shift()!, done: false });
            }
            if (self.closed) {
                return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => {
                const w = (r: { value?: ProgressEvent; done: boolean }) => {
                    if (r.done) resolve({ value: undefined, done: true });
                    else resolve({ value: r.value!, done: false });
                };
                self.waiters.push(w);
                if (signal) {
                    if (signal.aborted) {
                        const idx = self.waiters.indexOf(w);
                        if (idx >= 0) self.waiters.splice(idx, 1);
                        resolve({ value: undefined, done: true });
                        detach();
                    } else {
                        signal.addEventListener(
                            'abort',
                            () => {
                                const i = self.waiters.indexOf(w);
                                if (i >= 0) self.waiters.splice(i, 1);
                                resolve({ value: undefined, done: true });
                                detach();
                            },
                            { once: true },
                        );
                    }
                }
            });
        };
        const iterator: AsyncIterator<ProgressEvent> = {
            next,
        };
        // `return()` é chamado pelo runtime em for-await-of ao break/return/throw.
        // Garante que o subscriber seja desligado mesmo sem evento terminal.
        (iterator as AsyncIterator<ProgressEvent> & { return?: () => Promise<IteratorResult<ProgressEvent>> }).return =
            async (): Promise<IteratorResult<ProgressEvent>> => {
                detach();
                return { value: undefined, done: true };
            };
        (iterator as AsyncIterator<ProgressEvent> & { throw?: (e: unknown) => Promise<IteratorResult<ProgressEvent>> }).throw =
            async (e: unknown): Promise<IteratorResult<ProgressEvent>> => {
                detach();
                throw e;
            };
        return iterator;
    }
}

export class ProgressStream {
    private readonly jobs = new Map<string, JobState>();
    private readonly ttlMs: number;
    private readonly maxBufferSize: number;
    private readonly sweepIntervalMs: number;
    private readonly now: () => number;
    private sweepTimer: NodeJS.Timeout | null = null;

    constructor(opts: ProgressStreamOptions = {}) {
        this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
        this.maxBufferSize = opts.maxBufferSize ?? 500;
        this.sweepIntervalMs = opts.sweepIntervalMs ?? 60 * 1000;
        this.now = opts.now ?? (() => Date.now());
        if (this.sweepIntervalMs > 0) {
            // unref() para não impedir o processo de sair (testes, scripts curtos).
            this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
            this.sweepTimer.unref?.();
        }
    }

    private getOrCreate(jobId: string): JobState {
        let state = this.jobs.get(jobId);
        if (!state) {
            state = {
                jobId,
                events: [],
                nextId: 1,
                lastActivity: this.now(),
                closedAt: null,
                subscribers: new Set(),
            };
            this.jobs.set(jobId, state);
        }
        return state;
    }

    /**
     * Emite um evento para o job. Retorna o evento gravado (com `id` atribuído) ou
     * `null` quando `jobId` é vazio (compat com callers que ainda não plumbearam jobId).
     */
    emit<T extends ProgressPayload>(
        jobId: string,
        type: ProgressEventType,
        payload: T,
    ): ProgressEvent<T> | null {
        if (!jobId) return null;
        const state = this.getOrCreate(jobId);
        if (state.closedAt !== null) {
            // Job já terminou — ignora emissões tardias (evita reviver um stream fechado).
            log.debug(`emit() em job já fechado ignorado: job=${jobId} type=${type}`);
            return null;
        }
        const id = state.nextId++;
        const ev = {
            id,
            jobId,
            type,
            payload,
            ts: this.now(),
        } as ProgressEvent<T>;
        state.events.push(ev as ProgressEvent);
        if (state.events.length > this.maxBufferSize) {
            // Janela deslizante: descarta os mais antigos.
            state.events.splice(0, state.events.length - this.maxBufferSize);
        }
        state.lastActivity = ev.ts;
        for (const sub of state.subscribers) {
            sub.push(ev as ProgressEvent);
        }
        if (TERMINAL_PROGRESS_TYPES.has(type)) {
            state.closedAt = ev.ts;
            for (const sub of state.subscribers) {
                sub.close();
            }
            state.subscribers.clear();
        }
        return ev;
    }

    /**
     * Subscreve eventos de um job. Devolve um `AsyncIterable` que:
     *   1. repõe primeiro os eventos do buffer com `id > lastEventId` (resume),
     *   2. em seguida drena eventos novos em ordem,
     *   3. termina ao receber um evento terminal ou quando o iterator é encerrado.
     *
     * Se `lastEventId` for omitido, o subscriber só recebe eventos futuros (sem replay).
     */
    subscribe(
        jobId: string,
        lastEventId?: number,
        signal?: AbortSignal,
    ): AsyncIterable<ProgressEvent> {
        const state = this.getOrCreate(jobId);
        const sub = new Subscriber();
        sub.onDetach = () => {
            state.subscribers.delete(sub);
        };
        state.subscribers.add(sub);

        // Replay do buffer: somente eventos com id > lastEventId.
        // Se `lastEventId` for undefined, NÃO repõe (cliente novo só vê o futuro).
        if (typeof lastEventId === 'number') {
            for (const ev of state.events) {
                if (ev.id > lastEventId) {
                    sub.push(ev);
                }
            }
        }

        // Se o job JÁ está fechado (terminal emitido), o subscriber nunca verá eventos
        // novos — apenas o replay acima. Fechamos para o iterator terminar naturalmente.
        // Casos cobertos:
        //   - fresh client sem cursor em job fechado: sem replay, close imediato.
        //   - cliente com lastEventId < terminal: replay entrega o terminal, depois close.
        //   - cliente com lastEventId >= terminal: sem replay (já viu), close imediato.
        if (state.closedAt !== null) {
            sub.close();
        }

        if (signal) {
            if (signal.aborted) sub.close();
            else signal.addEventListener('abort', () => sub.close(), { once: true });
        }

        const iterable: AsyncIterable<ProgressEvent> = {
            [Symbol.asyncIterator]: () => sub.iterator(signal),
        };
        return iterable;
    }

    /** Snapshot read-only do buffer atual do job (para testes/admin). */
    getBuffer(jobId: string): ProgressEvent[] {
        const state = this.jobs.get(jobId);
        return state ? state.events.slice() : [];
    }

    /** Maior ID já emitido para o job (0 se não houver eventos). Útil para diagnóstico. */
    getLastEventId(jobId: string): number {
        const state = this.jobs.get(jobId);
        if (!state || !state.events.length) return 0;
        return state.events[state.events.length - 1]!.id;
    }

    /**
     * Marca um job como encerrado (cancelled) emitindo um evento terminal. Idempotente:
     * se já estava fechado, não faz nada. Usado para cancelamentos externos.
     */
    closeJob(jobId: string, reason: string = 'cancelled'): void {
        const state = this.jobs.get(jobId);
        if (!state) return;
        if (state.closedAt === null) {
            this.emit(jobId, 'cancelled', { reason });
        }
    }

    /** Remove o job imediatamente (buffer + subscribers). Para testes / reset. */
    clear(jobId: string): void {
        const state = this.jobs.get(jobId);
        if (!state) return;
        for (const sub of state.subscribers) sub.close();
        state.subscribers.clear();
        this.jobs.delete(jobId);
    }

    /**
     * Remove jobs cuja última atividade é mais antiga que o TTL. Retorna a quantidade
     * de jobs removidos. Idempotente, chamada pelo sweep interno e exposta para testes.
     */
    sweep(): number {
        const cutoff = this.now() - this.ttlMs;
        let removed = 0;
        for (const [jobId, state] of this.jobs) {
            if (state.lastActivity < cutoff) {
                for (const sub of state.subscribers) sub.close();
                state.subscribers.clear();
                this.jobs.delete(jobId);
                removed++;
            }
        }
        return removed;
    }

    /** Número de jobs atualmente rastreados (debug / testes). */
    getJobCount(): number {
        return this.jobs.size;
    }

    /** Para o timer de sweep e limpa tudo. Idempotente. */
    destroy(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = null;
        }
        for (const state of this.jobs.values()) {
            for (const sub of state.subscribers) sub.close();
            state.subscribers.clear();
        }
        this.jobs.clear();
    }
}

/**
 * Singleton padrão usado por toda a aplicação. Testes que precisam de isolamento
 * podem instanciar `new ProgressStream({...})` diretamente (ver progressStream.test.ts).
 */
export const progressStream = new ProgressStream();
