/**
 * #1371 — Fila serial por sessão com worker único.
 *
 * Fundação do controle de concorrência por sessão: cada `sessao_id` tem NO MÁXIMO UM
 * job em execução por vez; jobs adicionais entram em uma fila FIFO até o worker
 * ficar livre. Status interno do job: `queued | running | done | error | cancelled`.
 *
 *   ┌─ Sessão "s1" ──────────────────────────────────────────────┐
 *   │ [job-A: running] ──done──▶ [job-B: running] ──done──▶ idle  │
 *   │ [job-C: queued] espera sua vez                              │
 *   └────────────────────────────────────────────────────────────┘
 *
 *   ┌─ Sessão "s2" ──────────────────────────────────────────────┐
 *   │ [job-D: running] (paralelo a s1 — workers isolados)         │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Por que existe: várias integrações (chat, agentLoop, taskrunner) precisam
 * garantir que uma sessão não dispare múltiplos jobs em paralelo (risco de
 * race condition em estado compartilhado — DB, LLM, contexto). Esta fila
 * centraliza a serialização com `Map<sessao_id, Queue>` em memória, integrada
 * com o `chatStore` (status enum compatível) e com o `ProgressStream` (futuro
 * SSE via `event: 'job:start' | 'job:done' | 'job:error'`).
 *
 * API pública (issue #1371):
 *   - `enqueue(sessao_id, payload, executor?) -> jobId`
 *   - `getStatus(sessao_id, jobId) -> JobStatus | null`
 *   - `cancel(sessao_id, jobId) -> boolean`
 *   - `on(event, handler)` — herança de `EventEmitter` para SSE futuro.
 *
 * Cancelamento: o `controller` interno é um `AbortController` propagado ao
 * executor via `signal`. Execuções que respeitam o sinal (checam `signal.aborted`
 * ou escutam `signal.addEventListener('abort', ...)`) interrompem cooperativamente.
 *
 * Cleanup: sessões ociosas (sem jobs em fila nem rodando) há mais que `ttlMs` são
 * purgadas pelo `cleanupIdleSessions()` — executado automaticamente via
 * `setInterval` (default 60s, `.unref()` para não segurar o processo Node). O
 * `lastActivityAt` é atualizado em enqueue / start / finish, então mesmo sessões
 * "ativas por longos períodos" só são purgadas depois de genuinamente ociosas.
 *
 * Concorrência: implementada manualmente com `Promise` em série + `Map` —
 * nada de `Promise.all` aqui (que dispararia em paralelo). A fila guarda os
 * jobs em um array e o worker avança um por vez no `finally` do `runJob`.
 */
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';

const log = createLogger('SessionQueue');

// === Tipos públicos ===

/** Status interno de cada job. Mesmo vocabulário do `chatStore.ChatJobStatus` (#1372). */
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

/**
 * Executor de um job. Recebe o `payload` original e o `AbortSignal` para
 * cancelamento cooperativo — ex.: `await fetch(url, { signal })` ou
 * `signal.addEventListener('abort', ...)`. Não respeitar o sinal significa
 * que `cancel()` só terá efeito quando o executor devolver (sem throw).
 */
export type JobExecutor = (payload: unknown, signal: AbortSignal) => Promise<unknown>;

/** Payload do evento emitido pelo EventEmitter interno. */
export interface SessionQueueEvent {
    sessao_id: string;
    jobId: string;
    payload?: unknown;
    /** `result` quando status é 'done'; `error` quando status é 'error' ou 'cancelled'. */
    result?: unknown;
    error?: unknown;
    /** Status final — presente nos eventos terminais (`job:done` / `job:error`). */
    status?: JobStatus;
}

/** Evento `job:start` — emitido quando o job passa de `queued` para `running`. */
export interface JobStartEvent {
    sessao_id: string;
    jobId: string;
    payload?: unknown;
}

/** Snapshot imutável do job para inspeção externa (`getJob`). */
export interface JobSnapshot {
    id: string;
    sessao_id: string;
    payload: unknown;
    status: JobStatus;
    result?: unknown;
    error?: unknown;
    enqueuedAt: number;
    startedAt: number | null;
    finishedAt: number | null;
}

interface Job {
    id: string;
    sessao_id: string;
    payload: unknown;
    status: JobStatus;
    controller: AbortController;
    executor: JobExecutor;
    enqueuedAt: number;
    startedAt: number | null;
    finishedAt: number | null;
    result?: unknown;
    error?: unknown;
}

/** Estado por sessão: worker atual + fila FIFO + jobs terminados + timestamp de ociosidade. */
interface SessionState {
    running: Job | null;
    queued: Job[];
    /**
     * Jobs que já chegaram a estado terminal (`done` | `error` | `cancelled`).
     * Mantidos em memória para que `getStatus` / `getJob` continuem funcionando
     * após o término. São descartados junto com a sessão quando o TTL de
     * ociosidade expira (ver `cleanupIdleSessions`) — por isso NÃO há leak.
     */
    finished: Job[];
    /** Epoch ms da última atividade (enqueue / start / finish). Base do TTL. */
    lastActivityAt: number;
    /** Lista de resolvers de `waitForIdle` — pendentes até a sessão ficar vazia. */
    idleWaiters: Array<() => void>;
}

/** Configuração opcional do `SessionQueue`. Todos os campos têm defaults. */
export interface SessionQueueConfig {
    /**
     * Executor padrão — aplicado a `enqueue(sessao_id, payload)` quando o caller
     * não passa um executor próprio. Se nem o default nem o parâmetro forem
     * fornecidos, `enqueue` lança erro (fail-fast, não inferência).
     */
    defaultExecutor?: JobExecutor;
    /** TTL em ms — sessões ociosas por mais que isso são purgadas. Default 5 min. */
    ttlMs?: number;
    /**
     * Intervalo (ms) do setInterval de varredura automática. Default 60_000.
     * `0` desliga o timer (testes determinísticos ou cleanup manual).
     */
    autoCleanupIntervalMs?: number;
    /** Gerador de ID — injetável para determinismo de teste. Default: uuidv4. */
    idFactory?: () => string;
    /** Limite de tamanho da fila por sessão — protege contra DoS. Default 1000. */
    maxQueueSize?: number;
    /** Max listeners do EventEmitter interno — default 100. */
    maxListeners?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_AUTO_CLEANUP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_MAX_LISTENERS = 100;

/**
 * Mapa `sessao_id -> SessionState`. Cada estado tem `running` (no máximo 1) e
 * `queued` (FIFO). Sessões ociosas além do TTL são removidas no cleanup.
 */
export class SessionQueue {
    private readonly sessions = new Map<string, SessionState>();
    private readonly emitter = new EventEmitter();
    private readonly ttlMs: number;
    private readonly autoCleanupIntervalMs: number;
    private readonly idFactory: () => string;
    private readonly maxQueueSize: number;
    private readonly defaultExecutor: JobExecutor | undefined;
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor(config: SessionQueueConfig = {}) {
        this.defaultExecutor = config.defaultExecutor;
        this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
        this.autoCleanupIntervalMs = config.autoCleanupIntervalMs ?? DEFAULT_AUTO_CLEANUP_INTERVAL_MS;
        this.idFactory = config.idFactory ?? (() => uuidv4());
        this.maxQueueSize = config.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
        const maxListeners = config.maxListeners ?? DEFAULT_MAX_LISTENERS;

        // Validação fail-fast: configs inválidas no boot devem estourar,
        // não degradar silenciosamente em runtime.
        if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
            throw new Error('SessionQueue: ttlMs deve ser > 0');
        }
        if (!Number.isFinite(this.autoCleanupIntervalMs) || this.autoCleanupIntervalMs < 0) {
            throw new Error('SessionQueue: autoCleanupIntervalMs deve ser >= 0');
        }
        if (!Number.isInteger(this.maxQueueSize) || this.maxQueueSize <= 0) {
            throw new Error('SessionQueue: maxQueueSize deve ser inteiro > 0');
        }
        if (!Number.isInteger(maxListeners) || maxListeners <= 0) {
            throw new Error('SessionQueue: maxListeners deve ser inteiro > 0');
        }

        this.emitter.setMaxListeners(maxListeners);

        if (this.autoCleanupIntervalMs > 0) {
            const timer = setInterval(() => {
                try {
                    this.cleanupIdleSessions();
                } catch (err) {
                    log.warn(`auto-cleanup falhou: ${(err as Error)?.message ?? err}`);
                }
            }, this.autoCleanupIntervalMs);
            // `.unref()` garante que o timer NÃO segura o event loop —
            // o processo Node encerra normalmente mesmo com o interval armado.
            if (typeof (timer as { unref?: () => void }).unref === 'function') {
                (timer as { unref: () => void }).unref();
            }
            this.cleanupTimer = timer;
        }
    }

    // === API pública ===

    /**
     * Enfileira um job para a sessão. Se a sessão tem worker livre, o job entra
     * em execução IMEDIATAMENTE; senão, fica na fila FIFO até o worker vagar.
     *
     * Retorna o `jobId` (string) — o caller usa esse ID para consultar status ou
     * cancelar. O jobId é gerado por `idFactory` (default uuidv4).
     *
     * Lança erro se:
     *   - nem `defaultExecutor` nem `executor` foram fornecidos;
     *   - a fila da sessão já atingiu `maxQueueSize` (proteção contra DoS).
     */
    enqueue(sessao_id: string, payload: unknown, executor?: JobExecutor): string {
        const exec = executor ?? this.defaultExecutor;
        if (!exec) {
            throw new Error(
                'SessionQueue.enqueue: nenhum executor informado — passe um executor como parâmetro ou defina `defaultExecutor` no construtor.',
            );
        }
        if (!sessao_id || typeof sessao_id !== 'string') {
            throw new Error('SessionQueue.enqueue: sessao_id deve ser uma string não-vazia.');
        }

        const jobId = this.idFactory();
        const job: Job = {
            id: jobId,
            sessao_id,
            payload,
            status: 'queued',
            controller: new AbortController(),
            executor: exec,
            enqueuedAt: Date.now(),
            startedAt: null,
            finishedAt: null,
        };

        const state = this.ensureSession(sessao_id);
        if (state.running) {
            if (state.queued.length >= this.maxQueueSize) {
                throw new Error(
                    `SessionQueue.enqueue: fila cheia para sessão "${sessao_id}" (maxQueueSize=${this.maxQueueSize}).`,
                );
            }
            state.queued.push(job);
        } else {
            state.running = job;
            this.startJob(job);
        }
        return jobId;
    }

    /**
     * Consulta o status atual de um job. Retorna `null` se o job não existe
     * (sessão ou ID desconhecidos, OU job já purgado pelo TTL). Jobs terminados
     * (`done` | `error` | `cancelled`) permanecem consultáveis enquanto a sessão
     * existir no Map.
     */
    getStatus(sessao_id: string, jobId: string): JobStatus | null {
        const state = this.sessions.get(sessao_id);
        if (!state) return null;
        if (state.running && state.running.id === jobId) return state.running.status;
        const queued = state.queued.find((j) => j.id === jobId);
        if (queued) return queued.status;
        const finished = state.finished.find((j) => j.id === jobId);
        if (finished) return finished.status;
        return null;
    }

    /**
     * Snapshot do job (cópia rasa) — útil para dashboards e integrações que
     * precisam de `result`, `error`, timestamps. Retorna `null` se ausente.
     * Jobs terminados permanecem acessíveis enquanto a sessão existir.
     */
    getJob(sessao_id: string, jobId: string): JobSnapshot | null {
        const state = this.sessions.get(sessao_id);
        if (!state) return null;
        const job = state.running && state.running.id === jobId
            ? state.running
            : state.queued.find((j) => j.id === jobId) ?? state.finished.find((j) => j.id === jobId);
        if (!job) return null;
        return {
            id: job.id,
            sessao_id: job.sessao_id,
            payload: job.payload,
            status: job.status,
            result: job.result,
            error: job.error,
            enqueuedAt: job.enqueuedAt,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
        };
    }

    /**
     * Cancela um job. Comportamento:
     *   - Job em `running`: chama `controller.abort()` — o executor recebe o
     *     sinal e deve interromper cooperativamente. O status final virá
     *     `cancelled` (se respeitou o signal) ou `error` (se lançou outra coisa).
     *   - Job em `queued`: removido da fila IMEDIATAMENTE, status `cancelled`,
     *     emite `job:error` (evento terminal — SSE saberá pelo `status` no payload).
     *   - Sessão ou job inexistente: retorna `false` (no-op).
     *
     * Outros jobs (não especificados) NÃO são afetados — queued continuam
     * enfileirados, o running (se diferente) é intocado.
     */
    cancel(sessao_id: string, jobId: string): boolean {
        const state = this.sessions.get(sessao_id);
        if (!state) return false;

        if (state.running && state.running.id === jobId) {
            if (!state.running.controller.signal.aborted) {
                state.running.controller.abort();
            }
            // O `runJob` cuida do status final via catch no executor.
            return true;
        }

        const idx = state.queued.findIndex((j) => j.id === jobId);
        if (idx >= 0) {
            const job = state.queued[idx]!;
            state.queued.splice(idx, 1);
            job.status = 'cancelled';
            job.finishedAt = Date.now();
            state.lastActivityAt = job.finishedAt;
            state.finished.push(job);
            this.emitter.emit('job:error', {
                sessao_id,
                jobId,
                payload: job.payload,
                error: new Error('cancelled before start'),
                status: 'cancelled',
            } satisfies SessionQueueEvent);
            return true;
        }
        return false;
    }

    /**
     * Devolve uma Promise que resolve quando o job atinge estado terminal
     * (`done` | `error` | `cancelled`). Se o job não existe, resolve IMEDIATAMENTE
     * com `null` — não bloqueia para sempre (útil para callers que perdem a
     * referência por cleanup TTL).
     */
    waitForJob(sessao_id: string, jobId: string): Promise<JobStatus | null> {
        const state = this.sessions.get(sessao_id);
        if (!state) return Promise.resolve(null);
        const job = state.running && state.running.id === jobId
            ? state.running
            : state.queued.find((j) => j.id === jobId) ?? state.finished.find((j) => j.id === jobId);
        if (!job) return Promise.resolve(null);
        if (this.isTerminal(job.status)) return Promise.resolve(job.status);
        return new Promise((resolve) => {
            const handler = (event: SessionQueueEvent) => {
                if (event.jobId !== jobId) return;
                this.emitter.off('job:done', handler);
                this.emitter.off('job:error', handler);
                resolve(event.status ?? null);
            };
            this.emitter.on('job:done', handler);
            this.emitter.on('job:error', handler);
        });
    }

    /**
     * Devolve uma Promise que resolve quando a sessão não tem jobs rodando
     * nem enfileirados (terminados em `finished` não bloqueiam — eles já
     * resolveram). Idempotente.
     */
    waitForIdle(sessao_id: string): Promise<void> {
        const state = this.sessions.get(sessao_id);
        if (!state || (!state.running && state.queued.length === 0)) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            state.idleWaiters.push(resolve);
        });
    }

    /**
     * Inscreve em evento do emitter interno. Eventos emitidos:
     *   - `job:start` — job iniciou (passou de `queued` para `running`).
     *   - `job:done`  — job terminou com sucesso (status: 'done').
     *   - `job:error` — job falhou OU foi cancelado (status: 'error' | 'cancelled').
     */
    on(event: 'job:start' | 'job:done' | 'job:error', handler: (e: JobStartEvent | SessionQueueEvent) => void): this {
        this.emitter.on(event, handler);
        return this;
    }

    off(event: string, handler: (...args: unknown[]) => void): this {
        this.emitter.off(event, handler as (...args: unknown[]) => void);
        return this;
    }

    /**
     * Purga sessões ociosas (sem job rodando E sem jobs enfileirados) há mais
     * que `ttlMs`. Jobs terminados (`finished`) NÃO contam como ocupação — uma
     * sessão que só tem finished é considerada ociosa e é purgada (junto com
     * seus snapshots) ao expirar o TTL, evitando memory leak (#1371 critério 5).
     * Devolve a quantidade purgada. O parâmetro `now` é injetável para testes
     * determinísticos do TTL (não dependem do relógio real).
     *
     * Roda automaticamente via timer interno (ver `autoCleanupIntervalMs`); também
     * pode ser chamado manualmente para testes ou métricas.
     */
    cleanupIdleSessions(now: number = Date.now()): number {
        let purged = 0;
        for (const [sessaoId, state] of this.sessions) {
            if (state.running) continue;
            if (state.queued.length > 0) continue;
            if (now - state.lastActivityAt >= this.ttlMs) {
                this.sessions.delete(sessaoId);
                purged++;
            }
        }
        return purged;
    }

    /**
     * Remove os jobs terminados da sessão (libera o snapshot em memória). Útil
     * para limpar slots de auditoria que o consumer já processou antes do TTL.
     * Não reseta o relógio de ociosidade — a sessão continua elegível para purga
     * pelo TTL normalmente. Retorna a quantidade removida. No-op para sessão
     * inexistente.
     */
    clearFinished(sessao_id: string): number {
        const state = this.sessions.get(sessao_id);
        if (!state) return 0;
        const removed = state.finished.length;
        state.finished.length = 0;
        return removed;
    }

    /**
     * Para o timer de auto-cleanup. Idempotente. Chame ao descartar a instância
     * (ex.: fim de suíte de teste) para não deixar o interval pendurado.
     */
    stopAutoCleanup(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /** Quantidade de sessões atualmente rastreadas. Útil para testes e métricas. */
    size(): number {
        return this.sessions.size;
    }

    /** Inspeciona o estado de uma sessão (debug/métrica). */
    describeSession(sessao_id: string): {
        running: boolean;
        queued: number;
        finished: number;
        lastActivityAt: number;
    } | null {
        const state = this.sessions.get(sessao_id);
        if (!state) return null;
        return {
            running: !!state.running,
            queued: state.queued.length,
            finished: state.finished.length,
            lastActivityAt: state.lastActivityAt,
        };
    }

    /**
     * Descarta TODO o estado: cancela jobs em andamento (abortando o sinal),
     * limpa filas, sessões, listeners do EventEmitter. Idempotente. Uso
     * principal: `resetSessionQueue()` em testes determinísticos.
     */
    reset(): void {
        this.stopAutoCleanup();
        for (const [, state] of this.sessions) {
            if (state.running && !state.running.controller.signal.aborted) {
                state.running.controller.abort();
            }
            for (const queuedJob of state.queued) {
                queuedJob.status = 'cancelled';
                queuedJob.finishedAt = Date.now();
            }
            state.queued.length = 0;
            state.finished.length = 0;
            for (const resolve of state.idleWaiters) resolve();
            state.idleWaiters.length = 0;
        }
        this.sessions.clear();
        this.emitter.removeAllListeners();
    }

    // === Helpers internos ===

    private ensureSession(sessao_id: string): SessionState {
        let state = this.sessions.get(sessao_id);
        if (!state) {
            state = {
                running: null,
                queued: [],
                finished: [],
                lastActivityAt: Date.now(),
                idleWaiters: [],
            };
            this.sessions.set(sessao_id, state);
        }
        state.lastActivityAt = Date.now();
        return state;
    }

    private startJob(job: Job): void {
        job.status = 'running';
        job.startedAt = Date.now();
        const state = this.sessions.get(job.sessao_id);
        if (state) state.lastActivityAt = job.startedAt;

        this.emitter.emit('job:start', {
            sessao_id: job.sessao_id,
            jobId: job.id,
            payload: job.payload,
        } satisfies JobStartEvent);

        // Dispara o runner, mas NÃO await — o advance acontece no `finally`.
        this.runJob(job).catch((err) => {
            log.error(`Falha inesperada no runner do job [${job.id}]: ${(err as Error)?.message ?? err}`);
        });
    }

    private async runJob(job: Job): Promise<void> {
        try {
            const result = await job.executor(job.payload, job.controller.signal);
            // Se foi abortado, trata como cancelado mesmo que o executor devolva.
            if (job.controller.signal.aborted) {
                job.status = 'cancelled';
                job.error = new Error('cancelled');
            } else {
                job.status = 'done';
                job.result = result;
            }
        } catch (err) {
            if (job.controller.signal.aborted) {
                job.status = 'cancelled';
                job.error = err;
            } else {
                job.status = 'error';
                job.error = err;
            }
        } finally {
            job.finishedAt = Date.now();
            const state = this.sessions.get(job.sessao_id);
            if (state) {
                state.lastActivityAt = job.finishedAt;
                state.finished.push(job);
            }
            this.emitTerminal(job);
            this.advanceQueue(job.sessao_id);
        }
    }

    private emitTerminal(job: Job): void {
        if (job.status === 'done') {
            this.emitter.emit('job:done', {
                sessao_id: job.sessao_id,
                jobId: job.id,
                payload: job.payload,
                result: job.result,
                status: 'done',
            } satisfies SessionQueueEvent);
        } else {
            this.emitter.emit('job:error', {
                sessao_id: job.sessao_id,
                jobId: job.id,
                payload: job.payload,
                error: job.error,
                status: job.status,
            } satisfies SessionQueueEvent);
        }
    }

    private advanceQueue(sessao_id: string): void {
        const state = this.sessions.get(sessao_id);
        if (!state) return;
        state.running = null;
        const next = state.queued.shift();
        if (next) {
            state.running = next;
            this.startJob(next);
        } else {
            // Sessão ociosa: notifica waiters e atualiza timestamp.
            state.lastActivityAt = Date.now();
            const waiters = state.idleWaiters.splice(0);
            for (const resolve of waiters) resolve();
        }
    }

    private isTerminal(status: JobStatus): boolean {
        return status === 'done' || status === 'error' || status === 'cancelled';
    }
}

// === Singleton de processo ===

let singleton: SessionQueue | null = null;

/** Acessa o singleton de `SessionQueue`, criando-o na primeira chamada. */
export function getSessionQueue(): SessionQueue {
    if (!singleton) singleton = new SessionQueue();
    return singleton;
}

/**
 * Reseta o singleton. Equivalente a `getSessionQueue().reset()` + drop da
 * referência. Uso principal: testes determinísticos.
 */
export function resetSessionQueue(): void {
    if (singleton) singleton.reset();
    singleton = null;
}
