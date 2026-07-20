/**
 * #1574 — Núcleo de streaming SSE do agente.
 *
 * Fundação do streaming: cada job (`jobId`) tem seu próprio EventEmitter interno +
 * buffer em memória dos últimos N eventos. Consumidores (rotas SSE, dashboards de
 * progresso, integrações externas) recebem um `AsyncIterable` via `subscribe(jobId)`,
 * que:
 *
 *   1. ENTREGA o histórico do buffer em ordem (suporta retomada via `lastEventId`).
 *   2. BLOQUEIA até o próximo evento live, sem polling.
 *   3. ENCERRA quando o job é fechado (`done` | `cancelled` | `error`).
 *
 * IDs monotônicos POR JOB (não globais) — `seq` é inteiro 1-based e `id` é a versão
 * string-friendly (`<jobId>:<seq>`) para uso com o cabeçalho HTTP `Last-Event-ID` da
 * spec SSE. Retomada: `subscribe(jobId, { lastEventId: 'job-1:7' })` re-emite do
 * evento 8 em diante, deduplicando o que já foi visto.
 *
 * Buffer com TTL configurável (default 10 min) e limite de tamanho (FIFO sobre N) —
 * sustenta o caso de "cliente desconectou, voltou 9 minutos depois, pede Last-Event-ID".
 * Após o TTL, o estado do job é purgado do Map; `cleanup()` varre os expirados e
 * devolve a contagem (para testes/métricas).
 *
 * Purga AUTOMÁTICA: além do `cleanup()` manual, o construtor arma um `setInterval`
 * interno (default 1 min, `.unref()` para não segurar o processo) que varre os jobs
 * expirados sozinho — assim o Map NÃO cresce indefinidamente se ninguém chamar
 * `cleanup()` em produção. Passe `autoCleanupIntervalMs: 0` para desligar o timer
 * (testes determinísticos) e `stopAutoCleanup()` para pará-lo ao descartar a instância.
 *
 * Concorrência: `subscribe()` retorna IMEDIATAMENTE um AsyncIterable — não bloqueia
 * o emit(). Eventos emitidos ANTES do subscribe() ficam no buffer (e são entregues
 * na primeira iteração, a menos que `lastEventId` indique o ponto de retomada).
 *
 * Por que EventEmitter + AsyncIterable (e não só EventEmitter): o consumidor SSE
 * prefere `for await (const ev of subscribe(jobId))` — padrão idiomático, sem
 * callbacks manuais nem leak de listeners.
 */
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

const log = createLogger('ProgressStream');

// === Tipos públicos ===

/**
 * Eventos padronizados do stream. O `payload` é opaco (`unknown`) e o consumidor
 * narrowing com base no `type` — mantém o contrato estreito e extensível (novos
 * tipos não quebram compilação).
 */
export type ProgressEventType =
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'text_delta'
    | 'done'
    | 'cancelled'
    | 'error';

export interface ProgressEvent<P = unknown> {
    /** ID string-friendly (`<jobId>:<seq>`) — formato aceito pelo cabeçalho `Last-Event-ID`. */
    id: string;
    /** Sequência monotônica 1-based POR JOB (não global). */
    seq: number;
    type: ProgressEventType;
    payload: P;
    /** Epoch ms do momento do emit. */
    ts: number;
}

/** Tipo discriminado por type — narrowing seguro no consumidor. */
export type ProgressEventAny =
    | ProgressEvent<{ phase: string }>
    | ProgressEvent<{ name: string; args: unknown }>
    | ProgressEvent<{ name: string; summary: string }>
    | ProgressEvent<{ delta: string }>
    | ProgressEvent<{ result: string }>
    | ProgressEvent<{ reason: string }>
    | ProgressEvent<{ message: string }>;

/** Opções de subscribe — controle de retomada e cancelamento. */
export interface SubscribeOptions {
    /**
     * `Last-Event-ID` recebido do cliente SSE: o stream re-emite TUDO a partir do
     * próximo seq. Aceita o formato completo (`<jobId>:<seq>`) ou só o seq numérico
     * (legado / atalhos de teste). Eventos com `seq <= lastSeq` são pulados.
     */
    lastEventId?: string | number;
    /** Aborta a iteração sem fechar o job (o buffer continua disponível para outro subscribe). */
    signal?: AbortSignal;
}

export interface ProgressStreamConfig {
    /** TTL em ms — default 10 minutos. Após o TTL, o job é purgado do Map em cleanup(). */
    ttlMs?: number;
    /** Tamanho máximo do buffer circular POR JOB (FIFO). Default: 500 eventos. */
    maxBufferSize?: number;
    /** Limite de listeners por job — protege contra vazamento em clientes zumbi. Default: 100. */
    maxListeners?: number;
    /**
     * Intervalo (ms) da varredura AUTOMÁTICA de jobs expirados. Default: 60_000 (1 min).
     * Passe 0 para DESLIGAR o timer interno — útil em testes determinísticos ou quando
     * o caller prefere orquestrar `cleanup()` manualmente. O timer usa `.unref()`, então
     * NÃO impede o processo Node de encerrar.
     */
    autoCleanupIntervalMs?: number;
}

/** Estado interno por job. */
interface JobState {
    events: ProgressEvent[];
    nextSeq: number;
    /** Epoch ms em que o job deve ser purgado se não receber mais atividade. */
    expireAt: number;
    emitter: EventEmitter;
    closed: boolean;
    /** Set para deduplicação de listeners (mesmo handler inscrito múltiplas vezes é idempotente). */
    subscribers: Set<AsyncPushController>;
}

// === AsyncIterable controller ===
//
// Implementa o AsyncIterable de subscribe() sem bibliotecas externas. Cada subscribe()
// cria um `controller` que recebe pushes do EventEmitter do job; o iterador `next()`
// espera `Promise` resolvida quando há push ou quando o job fecha.

interface AsyncPushController {
    /**
     * Empilha o próximo evento para o consumidor OU retorna o evento imediatamente
     * se a fila interna está vazia. Idempotente (push concorrente não corrompe).
     */
    push(event: ProgressEvent): void;
    /** Encerra o iterator com `done: true` — usado no `close()` do job. */
    close(): void;
    /** Marca como aborted — próxima iteração joga. */
    abort(reason: string): void;
    /** Indica se o consumer já viu este seq (deduplicação por lastEventId). */
    shouldSkip(seq: number): boolean;
    /** Iterator subjacente (async generator). */
    iterator: AsyncIterator<ProgressEvent>;
    /** AsyncIterable subjacente (entregue ao consumer). */
    iterable: AsyncIterable<ProgressEvent>;
    /** Indica se o controller já encerrou (done=true). */
    isDone(): boolean;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_BUFFER = 500;
const DEFAULT_MAX_LISTENERS = 100;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000;

export class ProgressStream {
    private readonly ttlMs: number;
    private readonly maxBufferSize: number;
    private readonly jobs = new Map<string, JobState>();
    private _maxListenersPerJob: number;
    /** Handle do timer de varredura automática (null quando desligado/parado). */
    private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor(config: ProgressStreamConfig = {}) {
        this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
        this.maxBufferSize = config.maxBufferSize ?? DEFAULT_MAX_BUFFER;
        const maxListeners = config.maxListeners ?? DEFAULT_MAX_LISTENERS;
        const autoCleanupIntervalMs = config.autoCleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
        // Validação fail-fast: valores não-finitos ou não-positivos são erro de
        // programação (config inválida no boot), não algo a tolerar em runtime.
        if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) throw new Error('ProgressStream: ttlMs deve ser > 0');
        if (!Number.isFinite(this.maxBufferSize) || this.maxBufferSize <= 0) throw new Error('ProgressStream: maxBufferSize deve ser > 0');
        if (!Number.isFinite(maxListeners) || maxListeners <= 0) throw new Error('ProgressStream: maxListeners deve ser > 0');
        if (!Number.isFinite(autoCleanupIntervalMs) || autoCleanupIntervalMs < 0) {
            throw new Error('ProgressStream: autoCleanupIntervalMs deve ser >= 0');
        }
        // Marca um campo interno (lido apenas em testes/diagnóstico — `maxListeners` é
        // por job, aplicado no emitter de cada JobState).
        this._maxListenersPerJob = maxListeners;

        // Timer interno de varredura de TTL. Sem ele, jobs abandonados (cliente sumiu
        // sem close) só sairiam do Map via `cleanup()` manual — e se ninguém chamar,
        // o Map cresce até o processo cair. `.unref()` garante que o timer NÃO segura
        // o event loop (o processo encerra normalmente mesmo com o timer armado).
        if (autoCleanupIntervalMs > 0) {
            const timer = setInterval(() => {
                try {
                    this.cleanup();
                } catch (err) {
                    log.warn(`auto-cleanup falhou: ${(err as Error)?.message ?? err}`);
                }
            }, autoCleanupIntervalMs);
            if (typeof (timer as { unref?: () => void }).unref === 'function') {
                (timer as { unref: () => void }).unref();
            }
            this._cleanupTimer = timer;
        }
    }

    // === API pública ===

    /**
     * Inscreve um consumidor no stream de eventos do job. Devolve um `AsyncIterable`
     * que, na primeira iteração, entrega o histórico do buffer (filtrado por
     * `lastEventId` se informado) e depois bloqueia até o próximo evento live.
     *
     * Ordem é GARANTIDA: eventos saem na mesma ordem em que foram emitidos.
     * Concorrência: múltiplos `subscribe()` no mesmo jobId recebem os mesmos eventos
     * (fan-out via EventEmitter).
     *
     * Semântica de fechamento: a iteração termina APENAS quando (a) o job for fechado
     * (`close()` ou `cancel()`), (b) o AbortSignal for acionado, ou (c) o consumidor
     * chamar `iterator.return()`. Se o job nunca foi emitido E nunca foi fechado, o
     * iterator fica bloqueado indefinidamente — use `AbortSignal` com timeout para
     * limitar a espera.
     *
     * Quando o job JÁ estava fechado no momento do subscribe, o iterator entrega o
     * buffer inteiro (incluindo o evento terminal) e em seguida devolve `done: true`.
     */
    subscribe(jobId: string, opts: SubscribeOptions = {}): AsyncIterable<ProgressEvent> {
        const state = this.ensureJob(jobId);
        const lastSeq = parseLastEventId(opts.lastEventId);
        const signal = opts.signal;
        const sub = createAsyncPushController(lastSeq);
        state.subscribers.add(sub);

        // Cleanup DEVE ser registrado antes do drain para que sub.close()/sub.abort()
        // consigam remover o listener mesmo se a job estiver fechada no momento.
        const cleanup = () => {
            state.emitter.off('event', onEvent);
            state.subscribers.delete(sub);
            if (signal) signal.removeEventListener('abort', onAbort);
        };
        sub.iteratorFinally = cleanup;

        const onAbort = () => {
            state.subscribers.delete(sub);
            sub.abort(signal?.reason || 'aborted');
        };
        if (signal) {
            if (signal.aborted) {
                onAbort();
            } else {
                signal.addEventListener('abort', onAbort, { once: true });
            }
        }

        // Listener do EventEmitter: empurra o evento para o controller.
        const onEvent = (ev: ProgressEvent) => {
            if (sub.shouldSkip(ev.seq)) return;
            sub.push(ev);
        };
        state.emitter.on('event', onEvent);

        // Drain inicial do buffer — entrega o histórico respeitando lastEventId.
        // IMPORTANTE: tira uma CÓPIA para evitar race com emit() que pode estar
        // rodando em outra thread (mesmo sendo single-threaded em JS, o await de
        // iterator.next() cede o controle e pode haver emit() interleaved).
        const snapshot = state.events.slice();
        for (const ev of snapshot) {
            if (sub.shouldSkip(ev.seq)) continue;
            sub.push(ev);
        }
        // Se o job já estava fechado quando o subscribe rolou, marca o iterator
        // como done (o evento terminal já foi entregue via drain).
        if (state.closed && !sub.isDone()) {
            sub.close();
        }

        return sub.iterable;
    }

    /**
     * Emite um evento para o job. Cria o estado do job se for a primeira vez.
     * Retorna o evento emitido (incluindo `id` e `seq` finais) — útil para
     * logs/métricas e para testes determinísticos.
     */
    emit<P>(jobId: string, type: ProgressEventType, payload: P): ProgressEvent<P> {
        const state = this.ensureJob(jobId);
        if (state.closed) {
            // Job já fechado: ignora emits subsequentes (defesa contra race com
            // cleanup()). Logamos em debug para diagnóstico.
            log.debug(`emit() em job já fechado [${jobId}] — ignorado`);
            // Devolve um evento "fantasma" só para satisfazer o tipo — caller pode
            // detectar pelo seq=0 que não foi persistido.
            return { id: `${jobId}:0`, seq: 0, type, payload, ts: Date.now() };
        }
        const seq = state.nextSeq++;
        const event: ProgressEvent<P> = {
            id: `${jobId}:${seq}`,
            seq,
            type,
            payload,
            ts: Date.now(),
        };
        // Push no buffer com eviction FIFO.
        state.events.push(event as ProgressEvent);
        if (state.events.length > this.maxBufferSize) {
            state.events.splice(0, state.events.length - this.maxBufferSize);
        }
        // Renova o TTL a cada emit — atividade reinicia o relógio de expiração.
        state.expireAt = Date.now() + this.ttlMs;
        // Fan-out para subscribers ativos.
        state.emitter.emit('event', event);
        return event;
    }

    /**
     * Encerra o job com o tipo terminal (`done` | `cancelled` | `error`). Emite o
     * evento final (com `payload` opcional) e fecha TODOS os subscribers — o próximo
     * `iterator.next()` retorna `{ done: true }`.
     *
     * Idempotente: chamadas repetidas no mesmo jobId não duplicam o evento terminal.
     * Após o close, novos `subscribe()` recebem só o buffer + `done`.
     *
     * Se o job ainda não existir (nunca teve emit), cria o estado e emite o terminal
     * normalmente — garante que `close(jobId)` é suficiente para sinalizar fim mesmo
     * em jobs "vazios" (caminho comum quando o caller aborta antes de qualquer emit).
     */
    close(jobId: string, finalType: 'done' | 'cancelled' | 'error' = 'done', payload?: unknown): void {
        const state = this.ensureJob(jobId);
        if (state.closed) return;
        state.closed = true;
        const seq = state.nextSeq++;
        const finalPayload =
            payload !== undefined
                ? payload
                : finalType === 'done'
                ? { result: '' }
                : finalType === 'cancelled'
                ? { reason: 'cancelled' }
                : { message: 'error' };
        const event: ProgressEvent = {
            id: `${jobId}:${seq}`,
            seq,
            type: finalType,
            payload: finalPayload,
            ts: Date.now(),
        };
        state.events.push(event);
        if (state.events.length > this.maxBufferSize) {
            state.events.splice(0, state.events.length - this.maxBufferSize);
        }
        // Fan-out para subscribers ativos: o listener registra o evento (push na queue).
        state.emitter.emit('event', event);
        // Fecha todos os subscribers ativos — depois do fan-out para que o evento
        // terminal seja entregue ANTES do done. Os subscribers que não estavam
        // iterating recebem o terminal via drain no próximo subscribe.
        for (const sub of state.subscribers) {
            sub.close();
        }
    }

    /**
     * Atalho: emite `cancelled` e fecha o job. Equivalente a `close(jobId, 'cancelled')`.
     */
    cancel(jobId: string, reason: string = 'cancelled'): void {
        this.close(jobId, 'cancelled', { reason });
    }

    /** Snapshot do buffer atual (cópia — segura para iteração livre). Vazio se job não existe. */
    getBuffer(jobId: string): ProgressEvent[] {
        const state = this.jobs.get(jobId);
        return state ? state.events.slice() : [];
    }

    /** Indica se o job está registrado (teve pelo menos um emit ou close). */
    has(jobId: string): boolean {
        return this.jobs.has(jobId);
    }

    /** Indica se o job já foi fechado (done/cancelled/error). */
    isClosed(jobId: string): boolean {
        const state = this.jobs.get(jobId);
        return !!state?.closed;
    }

    /**
     * Purga TODOS os jobs expirados (TTL estourado). Devolve a quantidade purgada.
     * Não fecha jobs ativos — só remove os que não recebem emit há mais de `ttlMs`.
     *
     * Roda AUTOMATICAMENTE via timer interno (ver construtor / `autoCleanupIntervalMs`);
     * também pode ser chamado manualmente (o parâmetro `now` injetável habilita testes
     * determinísticos do TTL sem depender do relógio real).
     */
    cleanup(now: number = Date.now()): number {
        let purged = 0;
        for (const [id, state] of this.jobs) {
            if (now >= state.expireAt) {
                state.subscribers.clear();
                state.emitter.removeAllListeners();
                this.jobs.delete(id);
                purged++;
            }
        }
        return purged;
    }

    /**
     * Descarta o estado do job (fecha subscribers + remove do Map). Usado quando o
     * caller sabe que não precisa mais dos eventos (ex.: rota SSE desconectou de
     * vez). Idempotente.
     */
    dispose(jobId: string): void {
        const state = this.jobs.get(jobId);
        if (!state) return;
        for (const sub of state.subscribers) sub.abort('disposed');
        state.subscribers.clear();
        state.emitter.removeAllListeners();
        this.jobs.delete(jobId);
    }

    /** Quantidade de jobs atualmente rastreados. Útil para testes e métricas. */
    size(): number {
        return this.jobs.size;
    }

    /**
     * Para o timer interno de varredura de TTL. Idempotente. Chame ao descartar uma
     * instância custom (ex.: fim de suíte de teste) para não deixar o interval pendurado.
     * O singleton de produção NÃO precisa parar (vive até o processo morrer; o `.unref()`
     * já garante que ele não impede o encerramento).
     */
    stopAutoCleanup(): void {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
    }

    // === Helpers internos ===

    private ensureJob(jobId: string): JobState {
        let state = this.jobs.get(jobId);
        if (!state) {
            const emitter = new EventEmitter();
            emitter.setMaxListeners(this._maxListenersPerJob);
            state = {
                events: [],
                nextSeq: 1,
                expireAt: Date.now() + this.ttlMs,
                emitter,
                closed: false,
                subscribers: new Set(),
            };
            this.jobs.set(jobId, state);
        } else {
            // Atividade reinicia o TTL (mesmo em jobs fechados não importa —
            // o cleanup() varre por expireAt).
            state.expireAt = Date.now() + this.ttlMs;
        }
        return state;
    }
}

// === Helpers de módulo ===

/**
 * Parse do `Last-Event-ID` aceitando tanto o formato completo (`jobId:seq`) quanto
 * só o número de seq. Retorna 0 se inválido (falsy), o que significa "do início".
 */
function parseLastEventId(raw: string | number | undefined): number {
    if (raw === undefined || raw === null) return 0;
    if (typeof raw === 'number') return raw > 0 ? Math.floor(raw) : 0;
    const s = String(raw).trim();
    if (!s) return 0;
    const colon = s.lastIndexOf(':');
    const candidate = colon >= 0 ? s.slice(colon + 1) : s;
    const n = Number(candidate);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
}

/**
 * Cria o par controller + AsyncIterable para um subscribe(). O controller recebe
 * pushes e resolve a próxima Promise do iterator; quando fechado, devolve done.
 *
 * Implementação manual (sem async/await generator) para evitar a sobrecarga do
 * async generator + suporte nativo a AbortSignal.
 */
function createAsyncPushController(lastSeq: number): AsyncPushController & { iteratorFinally?: () => void } {
    const queue: ProgressEvent[] = [];
    let resolveNext: ((v: IteratorResult<ProgressEvent>) => void) | null = null;
    let done = false;
    let abortReason: string | null = null;

    const iterator: AsyncIterator<ProgressEvent> = {
        next(): Promise<IteratorResult<ProgressEvent>> {
            if (abortReason) {
                return Promise.reject(new Error(`subscribe aborted: ${abortReason}`));
            }
            const next = queue.shift();
            if (next) {
                return Promise.resolve({ value: next, done: false });
            }
            if (done) {
                return Promise.resolve({ value: undefined as unknown as ProgressEvent, done: true });
            }
            return new Promise((resolve) => {
                resolveNext = resolve;
            });
        },
        return(): Promise<IteratorResult<ProgressEvent>> {
            done = true;
            abortReason = abortReason || 'return';
            if (resolveNext) {
                resolveNext({ value: undefined as unknown as ProgressEvent, done: true });
                resolveNext = null;
            }
            if (ctrl.iteratorFinally) ctrl.iteratorFinally();
            return Promise.resolve({ value: undefined as unknown as ProgressEvent, done: true });
        },
    };

    const iterable: AsyncIterable<ProgressEvent> = {
        [Symbol.asyncIterator]() {
            return iterator;
        },
    };

    const ctrl: AsyncPushController & { iteratorFinally?: () => void } = {
        push(event) {
            if (done || abortReason) return;
            if (resolveNext) {
                const r = resolveNext;
                resolveNext = null;
                r({ value: event, done: false });
            } else {
                queue.push(event);
            }
        },
        close() {
            if (done) return;
            done = true;
            if (resolveNext) {
                const r = resolveNext;
                resolveNext = null;
                r({ value: undefined as unknown as ProgressEvent, done: true });
            }
            if (ctrl.iteratorFinally) ctrl.iteratorFinally();
        },
        abort(reason) {
            if (done) return;
            done = true;
            abortReason = reason;
            if (resolveNext) {
                const r = resolveNext;
                resolveNext = null;
                r({ value: undefined as unknown as ProgressEvent, done: true });
            }
            if (ctrl.iteratorFinally) ctrl.iteratorFinally();
        },
        shouldSkip(seq) {
            return seq <= lastSeq;
        },
        isDone: () => done,
        iterator,
        iterable,
        iteratorFinally: undefined,
    };

    return ctrl;
}

// === Singleton + reset para testes ===

let _defaultStream: ProgressStream | null = null;

/**
 * Singleton lazy do ProgressStream — rotas/handlers importam esta referência em vez
 * de construir uma instância (mantém um único buffer compartilhado em memória).
 *
 * Em testes, chame `__resetProgressStreamForTesting()` para garantir isolamento entre
 * suites. Em produção, o singleton vive até o processo morrer (cleanup() é eventual).
 */
export function getProgressStream(): ProgressStream {
    if (!_defaultStream) {
        _defaultStream = new ProgressStream();
    }
    return _defaultStream;
}

/**
 * Substitui o singleton (testes com config custom: TTL curto, buffer pequeno).
 * NÃO usar em produção — destrói o buffer global.
 */
export function __setProgressStreamForTesting(stream: ProgressStream): void {
    // Para o timer da instância anterior antes de trocar — senão o interval do singleton
    // antigo continua varrendo um objeto órfão (vazamento entre suites).
    if (_defaultStream && _defaultStream !== stream) _defaultStream.stopAutoCleanup();
    _defaultStream = stream;
}

/** Limpa o singleton (testes). Para o timer interno para não vazar o interval. */
export function __resetProgressStreamForTesting(): void {
    if (_defaultStream) _defaultStream.stopAutoCleanup();
    _defaultStream = null;
}
