/**
 * #1574 — Núcleo de streaming SSE com buffer de eventos.
 *
 * Fundação do streaming de progresso do agente: um store em memória, por jobId, que:
 *   - Mantém um EventEmitter DEDICADO por jobId (canal isolado, cleanup simples).
 *   - Bufferiza os últimos N eventos por job (Map<jobId, Event[]>) para suportar retomada
 *     (Last-Event-ID) e reconexão de clientes SSE.
 *   - Atribui IDs monotônicos por job (Last-Event-ID) para ordenação e dedup de replay.
 *   - Expulsa jobs inativos após TTL configurável (default 10 min) via GC periódico.
 *   - Expõe `subscribe(jobId, lastEventId?)` que devolve um AsyncIterable<StreamEvent>
 *     entregando eventos EM ORDEM (replay do buffer pós-lastEventId + ao vivo).
 *
 * Eventos terminais ('done' | 'cancelled' | 'error') fecham o iterator de cada
 * subscriber APÓS a entrega, sinalizando fim do stream ao consumidor.
 *
 * Este módulo é PURAMENTE o core de streaming — não conhece o loop do agente. A
 * instrumentação do loop (emissão de tool_call/tool_result/thinking/etc.) vive em
 * `agentLoop.ts`, que consome este store.
 */
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

const log = createLogger('ProgressStream');

// === Tipos padronizados de evento (#1574) ==============================================
export type StreamEventType =
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'text_delta'
    | 'done'
    | 'cancelled'
    | 'error';

/** Eventos que fecham o iterator do subscriber após entregues. */
const TERMINAL_TYPES: ReadonlySet<StreamEventType> = new Set(['done', 'cancelled', 'error']);

export interface StreamEvent<P = unknown> {
    /** ID monotônico por job (Last-Event-ID). */
    id: number;
    type: StreamEventType;
    payload: P;
    /** Epoch em ms. */
    ts: number;
    jobId: string;
}

export interface ProgressStreamOptions {
    /** TTL do buffer por job quando sem subscribers ativos (default 10 min). */
    ttlMs?: number;
    /** Máximo de eventos bufferizados por job (default 500). */
    maxBufferSize?: number;
    /** Intervalo da varredura de GC (default 60s). */
    gcIntervalMs?: number;
    /** Teto da fila por subscriber (slow-consumer backpressure; default 1000). */
    maxSubscriberQueue?: number;
}

interface JobBuffer {
    events: StreamEvent[];
    nextId: number;
    lastActivity: number;
}

const DEFAULTS: Required<ProgressStreamOptions> = {
    ttlMs: 10 * 60 * 1000, // 10 min
    maxBufferSize: 500,
    gcIntervalMs: 60 * 1000,
    maxSubscriberQueue: 1000,
};

// === Subscriber: fila async por consumidor =============================================
/**
 * Fila por subscriber. O listener do EventEmitter empurra eventos aqui; o iterator
 * drena. Quando a fila enche (slow consumer), descarta o MAIS ANTIGO e loga — preferimos
 * perder eventos antigos (que estão no buffer p/ replay) a estourar memória.
 *
 * Em `close()`, resolvers pendentes são liberados para que `next()` devolva `done`.
 */
class Subscriber implements AsyncIterable<StreamEvent> {
    private queue: StreamEvent[] = [];
    private closed = false;
    private waiters: Array<() => void> = [];

    constructor(
        private readonly maxQueue: number,
        /** Callback de desalocação (remove do Set de subscribers + listener). */
        private readonly onDispose: () => void,
    ) {}

    handleEvent(event: StreamEvent): void {
        if (this.closed) return;
        this.queue.push(event);
        if (this.queue.length > this.maxQueue) {
            this.queue.splice(0, this.queue.length - this.maxQueue);
            log.warn(`Subscriber com fila cheia (> ${this.maxQueue}) — descartando eventos antigos.`);
        }
        const resolve = this.waiters.shift();
        if (resolve) resolve();
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        const pending = this.waiters;
        this.waiters = [];
        for (const resolve of pending) resolve();
        this.onDispose();
    }

    private async next(): Promise<IteratorResult<StreamEvent>> {
        // Drena a fila ANTES de checar `closed` — garante que o evento terminal
        // (empilhado antes do close) seja entregue antes do `done: true`.
        if (this.queue.length > 0) {
            return { value: this.queue.shift() as StreamEvent, done: false };
        }
        if (this.closed) {
            return { value: undefined, done: true };
        }
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        if (this.queue.length > 0) {
            return { value: this.queue.shift() as StreamEvent, done: false };
        }
        return { value: undefined, done: true };
    }

    [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
        return {
            next: () => this.next(),
            // Consumidor fez `break` / `for-await-of` saiu — libera recursos.
            return: (value?: unknown) => {
                this.close();
                return Promise.resolve({ value, done: true as const });
            },
        };
    }
}

// === Store ==============================================================================
export class ProgressStream {
    private readonly opts: Required<ProgressStreamOptions>;
    private readonly buffers = new Map<string, JobBuffer>();
    private readonly emitters = new Map<string, EventEmitter>();
    private readonly subscribers = new Map<string, Set<Subscriber>>();
    private gcTimer: NodeJS.Timeout | null = null;
    private disposed = false;

    constructor(options: ProgressStreamOptions = {}) {
        this.opts = { ...DEFAULTS, ...options };
        // GC de jobs inativos (sem subscribers) além do TTL. `unref` para não segurar
        // o event loop em shutdown (testes/cold-stop).
        this.gcTimer = setInterval(() => this.gc(), this.opts.gcIntervalMs);
        this.gcTimer.unref?.();
    }

    /** Cria (se preciso) o buffer + emitter + set de subscribers do job. */
    private ensureJob(jobId: string): JobBuffer {
        let buf = this.buffers.get(jobId);
        if (!buf) {
            buf = { events: [], nextId: 1, lastActivity: Date.now() };
            this.buffers.set(jobId, buf);
            const emitter = new EventEmitter();
            emitter.setMaxListeners(0); // muitos clientes SSE por job é normal
            this.emitters.set(jobId, emitter);
            this.subscribers.set(jobId, new Set());
        }
        return buf;
    }

    /**
     * Emite um evento no canal do job. Bufferiza (com cap de `maxBufferSize`),
     * notifica subscribers ao vivo e — se for terminal — agenda o close dos
     * subscribers após a entrega.
     */
    emit<P = unknown>(jobId: string, type: StreamEventType, payload: P): StreamEvent<P> {
        if (this.disposed) {
            log.warn(`emit() em ProgressStream disposado (job=${jobId}, type=${type}) — ignorado.`);
            // Ainda devolve o evento construído p/ não quebrar o caller; apenas não bufferiza.
            return { id: -1, type, payload, ts: Date.now(), jobId };
        }
        const buf = this.ensureJob(jobId);
        buf.lastActivity = Date.now();
        const event: StreamEvent<P> = { id: buf.nextId++, type, payload, ts: Date.now(), jobId };
        buf.events.push(event as StreamEvent);
        if (buf.events.length > this.opts.maxBufferSize) {
            // Descarta os mais antigos — mantém os recentes p/ replay de retomada.
            buf.events.splice(0, buf.events.length - this.opts.maxBufferSize);
        }
        const emitter = this.emitters.get(jobId);
        if (emitter) emitter.emit(jobId, event);
        if (TERMINAL_TYPES.has(type)) {
            // Close ASSÍNCRONO: a entrega síncrona já empurrou o terminal para as filas;
            // o setImmediate garante que o consumer veja o terminal ANTES do done:true.
            const subs = this.subscribers.get(jobId);
            if (subs && subs.size > 0) {
                for (const s of Array.from(subs)) setImmediate(() => s.close());
            }
        }
        return event;
    }

    /**
     * Assina o canal do job. Retorna um AsyncIterable que entrega:
     *   1. O replay dos eventos bufferizados EM ORDEM:
     *        - `lastEventId` omitido  → replay do buffer COMPLETO (consumer sem estado
     *          recebe o progresso até aqui; essencial p/ UI reconectar em job findo);
     *        - `lastEventId` informado → replay apenas dos eventos com id > lastEventId
     *          (semântica Last-Event-ID / retomada sem duplicar o que o cliente já tem).
     *   2. Eventos ao vivo dali em diante;
     *   3. `done:true` após um evento terminal ser entregue (ou se o job já terminou).
     */
    subscribe(jobId: string, lastEventId?: number): AsyncIterable<StreamEvent> {
        this.ensureJob(jobId);
        const emitter = this.emitters.get(jobId) as EventEmitter;
        const subs = this.subscribers.get(jobId) as Set<Subscriber>;

        const subscriber = new Subscriber(this.opts.maxSubscriberQueue, () => {
            emitter.removeListener(jobId, handler);
            subs.delete(subscriber);
        });
        const handler = (event: StreamEvent) => subscriber.handleEvent(event);
        emitter.on(jobId, handler);
        subs.add(subscriber);

        // Replay do buffer (EM ORDEM):
        //   - sem lastEventId: buffer COMPLETO (consumer novo recebe o progresso até aqui);
        //   - com lastEventId: só eventos com id > lastEventId (Last-Event-ID / retomada).
        const buf = this.buffers.get(jobId) as JobBuffer;
        if (lastEventId !== undefined && lastEventId >= 0) {
            for (const ev of buf.events) {
                if (ev.id > lastEventId) subscriber.handleEvent(ev);
            }
        } else {
            for (const ev of buf.events) {
                subscriber.handleEvent(ev);
            }
        }

        // Job já terminou antes desta assinatura: fecha após entregar o replay do
        // terminal (setImmediate drena o replay síncrono empilhado acima primeiro).
        if (this.lastEventIsTerminal(jobId)) {
            setImmediate(() => subscriber.close());
        }

        return subscriber;
    }

    /** Snapshot (cópia) do buffer de um job — útil p/ testes/inspeção. Vazio se inexistente. */
    getEvents(jobId: string): StreamEvent[] {
        const buf = this.buffers.get(jobId);
        return buf ? buf.events.slice() : [];
    }

    /** Número de subscribers ativos do job (telemetria / testes). */
    subscriberCount(jobId: string): number {
        return this.subscribers.get(jobId)?.size ?? 0;
    }

    /** True se o último evento bufferizado do job for terminal (done/cancelled/error). */
    lastEventIsTerminal(jobId: string): boolean {
        const buf = this.buffers.get(jobId);
        if (!buf || buf.events.length === 0) return false;
        const last = buf.events[buf.events.length - 1];
        return TERMINAL_TYPES.has(last.type);
    }

    /** Remove explicitamente o job (buffer + emitter + subscribers). Idempotente. */
    dispose(jobId: string): void {
        const emitter = this.emitters.get(jobId);
        if (emitter) emitter.removeAllListeners();
        this.emitters.delete(jobId);
        const subs = this.subscribers.get(jobId);
        if (subs) {
            for (const s of Array.from(subs)) s.close();
        }
        this.subscribers.delete(jobId);
        this.buffers.delete(jobId);
    }

    /**
     * Varredura de GC: remove jobs SEM subscribers ativos e cuja última atividade
     * ultrapassou o TTL. Jobs com subscribers ativos nunca são coletados (consumidor
     * ainda pode emitir/receber).
     */
    private gc(): void {
        const now = Date.now();
        for (const [jobId, buf] of this.buffers) {
            const subs = this.subscribers.get(jobId);
            const active = subs && subs.size > 0;
            if (!active && now - buf.lastActivity > this.opts.ttlMs) {
                log.info(`GC: removendo job inativo ${jobId} (idle ${now - buf.lastActivity}ms).`);
                this.dispose(jobId);
            }
        }
    }

    /** Para o GC timer (testes / shutdown). Após dispose(), emit() vira no-op. */
    close(): void {
        this.disposed = true;
        if (this.gcTimer) {
            clearInterval(this.gcTimer);
            this.gcTimer = null;
        }
        for (const jobId of Array.from(this.buffers.keys())) this.dispose(jobId);
    }
}

/**
 * Instância SINGLETON compartilhada pelo app. O loop do agente (agentLoop.ts) e os
 * handlers SSE (rotas) importam este objeto — um único store coordena emit + subscribe.
 *
 * Em testes, prefira instanciar `new ProgressStream({...})` com TTL curto p/ isolamento;
 * este singleton existe p/ integração entre módulos.
 */
export const progressStream = new ProgressStream();
