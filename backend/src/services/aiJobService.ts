import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';
import { saveJob, deleteJob, loadAll } from './aiJobStorage';
import { getAiJobLivenessExpiresAt, MAX_CHAINED_CALLS } from './aiJobBudget';

const log = createLogger('AiJob');

// Job assíncrono do assistente: o POST do chat enfileira e responde na hora com um jobId
// (não segura a conexão → mata o 524 do Cloudflare em jobs longos). O agente roda em background
// até concluir ou atingir o deadline global; o cliente faz polling de GET /jobs/:id.
//
// Concorrência PARALELA (MAX=3): cada job roda dentro de AsyncLocalStorage (runWithToolContext),
// isolando o listener de tool-calls e o contexto de permissões por job. Isso permite N usuários
// conversando simultaneamente sem competir pela mesma vaga.
//
// #1012: registry persistido em storage durável (arquivo JSON). Cada update() no Map faz
// write-through atômico no disco; no boot, restore() reidrata os jobs do disco. A data de
// expiração (30min) é gravada junto (expiresAt) — mesmo após restart, jobs expirados não
// voltam como vivos (GET devolve 404 { reason: 'expired' }). Compatível com a coordenação
// serial do issue #29 (runAndWait continua usando a mesma fila MAX=3).
//
// #1810: cancelamento cooperativo — `runningControllers` (Map<jobId, AbortController>) é criado
// quando o job entra em `running` e removido em `finally`; `cancel()` aborta o controller
// (jobs rodando) ou remove da fila + marca `cancelled` (jobs enfileirados). A fn recebe o
// `AbortSignal` como 2º argumento opcional, para integração com a sub-task #0 (signal em
// postChatCompletion). Idempotente por construção (terminal/inexistente -> `{ noop: true }`).

export type AiJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface AiJob {
    id: string;
    status: AiJobStatus;
    result?: any;
    error?: string;
    createdAt: number;
    livenessExpiresAt: string;
    finishedAt?: number;
    label?: string;
    /** Expiração (epoch ms). Definido ao concluir (finishedAt + TTL). */
    expiresAt?: number;
    /** #1011: epoch ms em que o job saiu de queued -> running. */
    startedAt?: number;
    /** #1011: último sinal de vida reportado pelo agente (tool-call/progresso). */
    lastHeartbeat?: number;
    /** #1011: provider atualmente em uso pelo job (ex.: 'gemini','minimax'). */
    currentProvider?: string | null;
    /** #1011: progresso 0..100 reportado pelo agente. */
    progressPct?: number;
    /** #1810: dono do job (autorização do cancel()). */
    userId?: string;
    /** #1810: id da sessão de chat (persistência da msg `cancelled`). */
    sessionId?: string;
}

/** Resultado do lookup de um job: distingue 'expirado' de 'inexistente' (GET 404). */
export type AiJobLookup =
    | { ok: true; job: AiJob; queueAhead: number }
    | { ok: false; reason: 'expired' | 'missing' };

/**
 * #1011: status externo do endpoint de heartbeat (/ai-jobs/:id/status). 'expired' é
 * conceitual — é devolvido como 404 { reason: 'expired' } (TTL purgado), nunca no
 * corpo 200, pois um job expirado já não está "vivo" para reportar metadados.
 * #1810: 'cancelled' distingue cancelamento explícito do usuário de 'failed' (erro
 * técnico). O frontend usa isso para reidratar a UI sem confundir com erro.
 */
export type AiJobStatusExternal = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'expired';

/** #1011: metadados leves do job (sem o `result` completo) para /ai-jobs/:id/status. */
export interface AiJobStatusInfo {
    id: string;
    status: Exclude<AiJobStatusExternal, 'expired'>;
    alive: boolean;
    startedAt: string;
    lastHeartbeat: string;
    livenessExpiresAt: string;
    currentProvider: string | null;
    progressPct: number;
    queuePosition: number | null;
}

/** #1011: resultado do lookup de status: distingue 'expired' de 'missing' (GET 404). */
export type AiJobStatusLookup =
    | { ok: true; status: AiJobStatusInfo }
    | { ok: false; reason: 'expired' | 'missing' };

const jobs = new Map<string, AiJob>();
const TTL_MS = 30 * 60 * 1000; // mantém o resultado 30min p/ o cliente buscar
const MAX_CONCURRENT = 3;

let running = 0;
const queue: Array<() => void> = [];
const deadlineTimers = new Map<string, NodeJS.Timeout>();

// #1810: mapa de AbortControllers para jobs em execução. Criado no entry point do worker
// (não no enqueue), removido em `finally`. `cancel()` aborta o controller quando o job
// está rodando. Apenas jobs `running` vivem aqui — queued é tratado pelo `cancelledBeforeRun`.
const runningControllers = new Map<string, AbortController>();
// #1810: ids de jobs enfileirados marcados para cancelamento ANTES de entrarem em execução.
// Quando o worker puxar esse id da fila, ele marca `cancelled` e NÃO chama a fn. Separar
// essa flag da `runningControllers` evita race entre `cancel()` e `pump()`.
const cancelledBeforeRun = new Set<string>();

type PersistFn = (jobId: string, sessionId: string, userId: string) => void;
// #1810: persisters por job — `cancel()` precisa disparar a persistência de forma
// SÍNCRONA (não espera o axios abortar), mas o callback foi passado inline ao
// `enqueue` e não está acessível fora do closure do `run()`. Guardamos uma referência
// aqui para o `cancel()` poder chamá-lo. Removido no `finally` do worker.
const runningPersisters = new Map<string, PersistFn>();

// #1011: timestamp do último write-through por job (setJob). Base para o cálculo
// lastHeartbeat = max(lastWrite, now) no reportProgress — nunca retrocede o heartbeat.
const lastWriteAt = new Map<string, number>();

function isExpired(j: AiJob, now: number = Date.now()): boolean {
    return j.expiresAt !== undefined && now >= j.expiresAt;
}

function isPastLiveness(j: AiJob, now: number = Date.now()): boolean {
    return (j.status === 'queued' || j.status === 'running') && now >= Date.parse(j.livenessExpiresAt);
}

/** #1011: mapeia o status interno p/ o vocabulário externo do endpoint de heartbeat. */
function mapStatusExternal(s: AiJobStatus): Exclude<AiJobStatusExternal, 'expired'> {
    switch (s) {
        case 'queued': return 'pending';
        case 'running': return 'running';
        case 'done': return 'done';
        case 'error': return 'failed';
        case 'cancelled': return 'cancelled';
    }
}

/** #1011: clamp de progresso 0..100 (inteiro). Valor inválido/não-finito vira 0. */
function clampPct(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}

/** #1011: monta os metadados leves (sem `result`) a partir do job em memória. */
function toStatusInfo(job: AiJob): AiJobStatusInfo {
    const started = job.startedAt ?? job.createdAt;
    const heartbeat = job.lastHeartbeat ?? started;
    return {
        id: job.id,
        status: mapStatusExternal(job.status),
        alive: true,
        startedAt: new Date(started).toISOString(),
        lastHeartbeat: new Date(heartbeat).toISOString(),
        livenessExpiresAt: job.livenessExpiresAt,
        currentProvider: job.currentProvider ?? null,
        progressPct: typeof job.progressPct === 'number' ? clampPct(job.progressPct) : 0,
        queuePosition: job.status === 'queued' ? queue.length : null,
    };
}

/** Write-through: atualiza o Map e persiste atomicamente no storage durável. */
function setJob(job: AiJob): void {
    jobs.set(job.id, job);
    saveJob(job);
    lastWriteAt.set(job.id, Date.now());
}

function patchJob(id: string, changes: Partial<AiJob>): void {
    const cur = jobs.get(id);
    if (!cur) return;
    setJob({ ...cur, ...changes });
}

function markDeadlineExceeded(id: string): void {
    const job = jobs.get(id);
    if (!job || job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return;
    clearDeadline(id);
    const finishedAt = Date.now();
    patchJob(id, {
        status: 'error',
        error: 'deadline_exceeded',
        finishedAt,
        expiresAt: finishedAt + TTL_MS,
    });
    log.warn('Job excedeu o deadline global', { jobId: id, livenessExpiresAt: job.livenessExpiresAt, maxChainedCalls: MAX_CHAINED_CALLS });
}

function scheduleDeadline(job: AiJob): void {
    const delay = Math.max(1, Date.parse(job.livenessExpiresAt) - Date.now());
    const timer = setTimeout(() => {
        deadlineTimers.delete(job.id);
        markDeadlineExceeded(job.id);
    }, delay);
    timer.unref?.();
    deadlineTimers.set(job.id, timer);
}

function clearDeadline(id: string): void {
    const timer = deadlineTimers.get(id);
    if (timer) {
        clearTimeout(timer);
        deadlineTimers.delete(id);
    }
}

function cleanup() {
    const now = Date.now();
    for (const [id, j] of jobs) {
        if (isExpired(j, now)) {
            clearDeadline(id);
            jobs.delete(id);
            lastWriteAt.delete(id);
            // #1810: limpa entradas dos mapas de cancelamento dos jobs expirados.
            runningControllers.delete(id);
            runningPersisters.delete(id);
            cancelledBeforeRun.delete(id);
            deleteJob(id);
        }
    }
}

function pump() {
    if (running >= MAX_CONCURRENT) return;
    const next = queue.shift();
    if (next) next();
}

/**
 * Read-on-startup: reidrata os jobs persistidos para a memória. Jobs não-terminais
 * (queued/running) não podem ser retomados (a fn não é serializável) → marcados como erro
 * para o cliente não ficar em polling infinito. Jobs expirados permanecem no Map marcados
 * como expirados (GET devolve { reason: 'expired' }) até o cleanup() purgá-los (lazy).
 */
function restore(): void {
    try {
        const loaded = loadAll();
        const now = Date.now();
        for (const raw of loaded) {
            const job: AiJob = {
                id: raw.id,
                status: (raw.status as AiJobStatus) || 'error',
                result: raw.result,
                error: raw.error,
                createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
                livenessExpiresAt: raw.livenessExpiresAt || getAiJobLivenessExpiresAt(typeof raw.createdAt === 'number' ? raw.createdAt : now),
                finishedAt: raw.finishedAt,
                label: raw.label,
                expiresAt: raw.expiresAt,
                startedAt: raw.startedAt,
                lastHeartbeat: raw.lastHeartbeat,
                currentProvider: raw.currentProvider,
                progressPct: raw.progressPct,
            };
            if (job.status === 'queued' || job.status === 'running') {
                job.status = 'error';
                job.error = job.error || 'Job interrompido por reinício do processo.';
                job.finishedAt = job.finishedAt ?? now;
                job.expiresAt = job.expiresAt ?? now + TTL_MS;
                saveJob(job);
            }
            // #1810: jobs cancelados em sessão são TERMINAIS e voltam como 'cancelled'
            // (o usuário escolheu parar — não é um erro técnico do restart). Restaura
            // telsmpo e expiração para o cliente rehidratar corretamente.
            if (job.status === 'cancelled') {
                job.finishedAt = job.finishedAt ?? now;
                job.expiresAt = job.expiresAt ?? now + TTL_MS;
                saveJob(job);
            }
            jobs.set(job.id, job);
            // #1011: lastWrite base para reportProgress em jobs restaurados (terminais
            // não emitem progresso, mas mantemos o ts consistente caso o estado mude).
            lastWriteAt.set(job.id, job.lastHeartbeat ?? job.finishedAt ?? job.createdAt ?? now);
        }
        const alive = [...jobs.values()].filter((j) => !isExpired(j)).length;
        log.info(`Reidratados ${jobs.size} jobs do disco (${alive} vivos).`);
    } catch (e) {
        log.error('Falha ao reidratar jobs do disco', e);
    }
}

/** #1810: tipo da função de trabalho. Opcionalmente recebe o `AbortSignal` para
 * integrar com o `axios({ signal })` / `fetch(signal)` (sub-task #0). Mantém retrocompat
 * com a assinatura anterior zero-arg: a checagem `arguments.length` decide se invocamos
 * com ou sem o signal — sem quebrar callers externos (TaskRunner, Judge, etc.).
 */
export type AiJobWorker = (() => Promise<any>) | ((signal: AbortSignal) => Promise<any>);

/** #1810: opções estendidas do enqueue. `userId` autoriza o `cancel()`; `sessionId` +
 * `persistSessionMessage` permitem persistir a msg `cancelled` na sessão para o frontend
 * rehidratar após refresh (a persistência fica na camada de rota — o serviço só chama
 * o callback, mantendo aiJobService sem dependência direta do chatSessionService).
 */
export interface EnqueueOptions {
    label?: string;
    userId?: string;
    sessionId?: string;
    persistSessionMessage?: (jobId: string, sessionId: string, userId: string) => void;
}

/** #1810: resultado discriminatório de `cancel()`. Uma única chave não-null: o caller
 * sabe exatamente o que aconteceu (e.g. UI mostra "cancelando…" só em `aborted`).
 */
export type CancelResult =
    | { removed: true; jobId: string }
    | { aborted: true; jobId: string }
    | { noop: true; jobId: string; reason: 'missing' | 'terminal' };

export const aiJobService = {
    /** Enfileira um job; retorna o jobId imediatamente. `fn` roda em background. */
    enqueue(fn: AiJobWorker, labelOrOptions?: string | EnqueueOptions): string {
        const opts: EnqueueOptions = typeof labelOrOptions === 'string'
            ? { label: labelOrOptions }
            : (labelOrOptions || {});
        cleanup();
        const id = randomUUID();
        const createdAt = Date.now();
        const livenessExpiresAt = getAiJobLivenessExpiresAt(createdAt);
        const job: AiJob = {
            id,
            status: 'queued',
            createdAt,
            livenessExpiresAt,
            label: opts.label,
            userId: opts.userId,
            sessionId: opts.sessionId,
        };
        setJob(job);
        scheduleDeadline(job);
        // #1810: registra o persister ANTES do run() ser despachado. Assim `cancel()`
        // sobre job enfileirado (status='queued' no Map) consegue invocar a
        // persistência síncrona sem depender do worker ter rodado.
        if (opts.persistSessionMessage && opts.sessionId && opts.userId) {
            runningPersisters.set(id, opts.persistSessionMessage);
        }
        log.info('Job de IA criado', {
            jobId: id,
            startedAt: new Date(createdAt).toISOString(),
            livenessExpiresAt,
            maxChainedCalls: MAX_CHAINED_CALLS,
            totalBudgetMs: Date.parse(livenessExpiresAt) - createdAt,
        });

        const run = () => {
            const current = jobs.get(id);
            if (!current) {
                pump();
                return;
            }
            // #1810: cancelamento solicitado antes do job entrar em execução. Marcamos
            // como 'cancelled' e NÃO chamamos a fn (zero chamadas ao LLM). O callback de
            // persistência é invocado aqui para o frontend rehidratar a sessão.
            if (cancelledBeforeRun.has(id)) {
                cancelledBeforeRun.delete(id);
                const finishedAt = Date.now();
                clearDeadline(id);
                patchJob(id, { status: 'cancelled', finishedAt, expiresAt: finishedAt + TTL_MS });
                if (opts.sessionId && opts.userId && opts.persistSessionMessage) {
                    try { opts.persistSessionMessage(id, opts.sessionId, opts.userId); } catch (e: any) {
                        log.warn(`Falha ao persistir msg cancelled (queue) para ${id}: ${e?.message || e}`);
                    }
                }
                runningPersisters.delete(id);
                log.info(`Job ${id} cancelado antes de iniciar (fila)`);
                pump();
                return;
            }
            if (current.status === 'error' || current.status === 'done' || current.status === 'cancelled') {
                runningPersisters.delete(id);
                pump();
                return;
            }
            running++;
            const startedAt = Date.now();
            patchJob(id, { status: 'running', startedAt, lastHeartbeat: startedAt });
            // #1810: cria o AbortController e armazena no mapa. `cancel()` chama abort()
            // quando o job está rodando; o `finally` abaixo remove do mapa (sempre).
            const controller = new AbortController();
            runningControllers.set(id, controller);
            const persistCancelled = () => {
                if (opts.sessionId && opts.userId && opts.persistSessionMessage) {
                    try { opts.persistSessionMessage(id, opts.sessionId, opts.userId); } catch (e: any) {
                        log.warn(`Falha ao persistir msg cancelled (running) para ${id}: ${e?.message || e}`);
                    }
                }
            };
            // Chama a fn com o signal quando a assinatura aceita; cai pra zero-arg
            // quando o caller (TaskRunner/Judge) ainda usa a forma antiga — não quebra
            // compatibilidade enquanto a sub-task #0 (#1809) não é mergeada.
            const invoke = (): Promise<any> => {
                if (fn.length >= 1) return Promise.resolve().then(() => (fn as (s: AbortSignal) => Promise<any>)(controller.signal));
                return Promise.resolve().then(() => (fn as () => Promise<any>)());
            };
            Promise.resolve()
                .then(invoke)
                .then((result) => {
                    const currentJob = jobs.get(id);
                    // #1810: se o job foi marcado 'cancelled' durante a execução (ex.: o
                    // promise resolveu APOS o abort mas antes do throw), o resultado é
                    // descartado — a UI vai ler status='cancelled' no polling.
                    if (currentJob?.status === 'cancelled') return;
                    if (!currentJob || currentJob.status === 'error' || Date.now() >= Date.parse(currentJob.livenessExpiresAt)) {
                        if (currentJob?.status !== 'error') markDeadlineExceeded(id);
                        return;
                    }
                    const finishedAt = Date.now();
                    clearDeadline(id);
                    patchJob(id, { status: 'done', result, finishedAt, expiresAt: finishedAt + TTL_MS });
                })
                .catch((e: any) => {
                    const currentJob = jobs.get(id);
                    // #1810: abort do cancel() chega aqui como DOMException 'AbortError'
                    // (message = 'user_cancelled' setado por controller.abort(reason)).
                    // Se o job JÁ foi marcado 'cancelled' pelo cancel(), não sobrescreve
                    // com 'error' — preserva o vocabulário externo.
                    if (currentJob?.status === 'cancelled') return;
                    if (!currentJob || currentJob.status === 'error') return;
                    const isAbort = e?.name === 'AbortError' || controller.signal.aborted;
                    const finishedAt = Date.now();
                    clearDeadline(id);
                    if (isAbort && controller.signal.reason === 'user_cancelled') {
                        patchJob(id, {
                            status: 'cancelled',
                            finishedAt,
                            expiresAt: finishedAt + TTL_MS,
                        });
                        persistCancelled();
                        log.info(`Job ${id} cancelado em execução (signal aborted)`);
                        return;
                    }
                    const error = e?.code === 'deadline_exceeded' || e?.message === 'deadline_exceeded'
                        ? 'deadline_exceeded'
                        : (e?.message || String(e));
                    patchJob(id, {
                        status: 'error',
                        error,
                        finishedAt,
                        expiresAt: finishedAt + TTL_MS,
                    });
                    log.warn(`Job ${id} falhou: ${error}`);
                })
                .finally(() => {
                    // #1810: cleanup do controller no finally (sucesso/erro/cancelamento)
                    // — garante que runningControllers não vaza entries de jobs terminais.
                    runningControllers.delete(id);
                    runningPersisters.delete(id);
                    running--;
                    cleanup();
                    pump();
                });
        };

        if (running < MAX_CONCURRENT) run(); else queue.push(run);
        return id;
    },

    /**
     * Enfileira e AGUARDA o resultado (mesma fila serial). Para chamadores internos
     * que precisam do valor (ex.: Judge do TaskRunner) sem colidir com jobs de chat —
     * o listener de tool-calls do aiService é global, então toda chamada LLM de longa
     * duração deve passar por aqui.
     */
    runAndWait<T>(fn: () => Promise<T>, label?: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.enqueue(async () => {
                try {
                    const result = await fn();
                    resolve(result);
                    return result;
                } catch (e) {
                    reject(e);
                    throw e;
                }
            }, label);
        });
    },

    /** Estado atual do job (inclui posição aproximada na fila) ou motivo da ausência. */
    get(id: string): AiJobLookup {
        const existing = jobs.get(id);
        if (existing && isPastLiveness(existing)) markDeadlineExceeded(id);
        const job = jobs.get(id);
        if (!job) return { ok: false, reason: 'missing' };
        if (isExpired(job)) return { ok: false, reason: 'expired' };
        return { ok: true, job, queueAhead: job.status === 'queued' ? queue.length : 0 };
    },

    /**
     * #1011: metadados leves do job para o endpoint de heartbeat (/ai-jobs/:id/status).
     * Não toca em disco nem devolve o `result` completo — apenas o suficiente para o
     * cliente detectar que o job continua vivo durante tempestades de 429.
     */
    getJobStatus(id: string): AiJobStatusLookup {
        const existing = jobs.get(id);
        if (existing && isPastLiveness(existing)) markDeadlineExceeded(id);
        const job = jobs.get(id);
        if (!job) return { ok: false, reason: 'missing' };
        if (isExpired(job)) return { ok: false, reason: 'expired' };
        return { ok: true, status: toStatusInfo(job) };
    },

    getLivenessExpiresAt(id: string): string | undefined {
        return jobs.get(id)?.livenessExpiresAt;
    },

    /**
     * #1011: sinal de progresso do agente (chamado a cada tool-call/step do job).
     * Atualiza lastHeartbeat = max(lastWrite, now) — o heartbeat nunca retrocede,
     * mesmo que um write concorrente tenha gravado um ts levemente à frente (clock
     * skew). Write-through em disco (consistência p/ restart). Retorna false se o job
     * não existe (ou já expirou) para o chamador parar de reportar.
     */
    reportProgress(
        id: string,
        opts: { currentProvider?: string | null; progressPct?: number } = {},
    ): boolean {
        const job = jobs.get(id);
        if (!job || isExpired(job)) return false;
        const now = Date.now();
        const lastWrite = lastWriteAt.get(id) ?? job.lastHeartbeat ?? job.startedAt ?? job.createdAt ?? now;
        const lastHeartbeat = Math.max(lastWrite, now);
        patchJob(id, {
            lastHeartbeat,
            ...(opts.currentProvider !== undefined ? { currentProvider: opts.currentProvider ?? null } : {}),
            ...(opts.progressPct !== undefined ? { progressPct: clampPct(opts.progressPct) } : {}),
        });
        return true;
    },

    /** Reidrata jobs do disco (read-on-startup). Exposto p/ testes/restart manual. */
    restore() {
        restore();
    },

    /**
     * #1810: cancelamento cooperativo de job.
     *
     * Três casos (exatamente um retorna truthy na resposta):
     *  1. Job enfileirado (status='queued'): marca `cancelled` AGORA, adiciona o id
     *     ao `cancelledBeforeRun` para que o worker NÃO chame a fn quando o `pump()`
     *     despachar. Retorna `{ removed: true }`. Zero chamadas ao LLM.
     *  2. Job rodando (status='running', em `runningControllers`): chama
     *     `controller.abort('user_cancelled')` — o axios/fetch em curso lança
     *     DOMException 'AbortError'; o `.catch` no worker traduz para
     *     status='cancelled' e dispara o `persistSessionMessage`. O status em memória
     *     é atualizado AQUI para a UI ter resposta síncrona. Retorna `{ aborted: true }`.
     *  3. Job inexistente OU terminal (done/error/cancelled): noop idempotente.
     *
     * Autorização: se o `userId` não bater com o dono do job (`job.userId`), lança
     * `Error('forbidden')` (rota mapeia para 403).
     */
    cancel(jobId: string, userId: string): CancelResult {
        const job = jobs.get(jobId);
        if (!job) return { noop: true, jobId, reason: 'missing' };

        if (job.userId !== undefined && job.userId !== userId) {
            const err = new Error('forbidden') as Error & { code?: string };
            err.code = 'CANCEL_FORBIDDEN';
            throw err;
        }

        if (job.status === 'queued') {
            cancelledBeforeRun.add(jobId);
            const finishedAt = Date.now();
            clearDeadline(jobId);
            patchJob(jobId, { status: 'cancelled', finishedAt, expiresAt: finishedAt + TTL_MS });
            const persist = runningPersisters.get(jobId);
            if (persist && job.sessionId && job.userId) {
                try { persist(jobId, job.sessionId, job.userId); } catch (e: any) {
                    log.warn(`Falha ao persistir msg cancelled (queue) para ${jobId}: ${e?.message || e}`);
                }
                runningPersisters.delete(jobId);
            }
            log.info(`Job ${jobId} cancelado na fila`);
            return { removed: true, jobId };
        }

        if (job.status === 'running') {
            const controller = runningControllers.get(jobId);
            if (controller) controller.abort('user_cancelled');
            const finishedAt = Date.now();
            clearDeadline(jobId);
            patchJob(jobId, { status: 'cancelled', finishedAt, expiresAt: finishedAt + TTL_MS });
            // Persistência síncrona aqui (não esperamos o axios abortar): o frontend
            // vai rehidratar com a msg `cancelled` mesmo que a fn nunca chame o signal.
            const persist = runningPersisters.get(jobId);
            if (persist && job.sessionId && job.userId) {
                try { persist(jobId, job.sessionId, job.userId); } catch (e: any) {
                    log.warn(`Falha ao persistir msg cancelled (running) para ${jobId}: ${e?.message || e}`);
                }
                runningPersisters.delete(jobId);
            }
            return { aborted: true, jobId };
        }

        return { noop: true, jobId, reason: 'terminal' };
    },

    /** #1810: expor o signal atual p/ testes/integrações. Undefined se o job não está rodando. */
    getAbortSignal(jobId: string): AbortSignal | undefined {
        return runningControllers.get(jobId)?.signal;
    },

    /** #1810: limpa controllers/flags órfãos. Exposto para testes que reciclam o módulo. */
    _resetForTest() {
        runningControllers.clear();
        cancelledBeforeRun.clear();
        runningPersisters.clear();
    },
};

restore(); // read-on-startup: roda na primeira importação do módulo
