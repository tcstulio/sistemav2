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
// #1150: a fila global foi REFORMULADA para serializar por sessionId. Hoje, sem chave de
// sessão, duas mensagens da MESMA sessão rodavam em paralelo, quebrando o contexto da
// conversa e podendo duplicar ações imediatas (validate_invoice, notify_team, send_whatsapp,
// merge_opencode_task) sem idempotência. Agora, cada sessionId tem sua própria 'tail' no
// `sessionTails` Map — o `enqueue` encadeia `tail = tail.then(() => runJob(), () => runJob())`,
// garantindo que mensagens da mesma sessão rodem em série (a 2ª só inicia após a 1ª terminar
// e persistir sua resposta). O paralelismo entre sessões distintas é preservado via um
// semáforo global separado (`acquireSlot`/`releaseSlot`) que conta jobs em voo entre TODAS
// as sessões, respeitando MAX_CONCURRENT.
//
// #1012: registry persistido em storage durável (arquivo JSON). Cada update() no Map faz
// write-through atômico no disco; no boot, restore() reidrata os jobs do disco. A data de
// expiração (30min) é gravada junto (expiresAt) — mesmo após restart, jobs expirados não
// voltam como vivos (GET devolve 404 { reason: 'expired' }). Compatível com a coordenação
// serial do issue #29 (runAndWait continua usando a mesma fila MAX=3).

export type AiJobStatus = 'queued' | 'running' | 'done' | 'error';

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
}

/** Resultado do lookup de um job: distingue 'expirado' de 'inexistente' (GET 404). */
export type AiJobLookup =
    | { ok: true; job: AiJob; queueAhead: number }
    | { ok: false; reason: 'expired' | 'missing' };

/**
 * #1011: status externo do endpoint de heartbeat (/ai-jobs/:id/status). 'expired' é
 * conceitual — é devolvido como 404 { reason: 'expired' } (TTL purgado), nunca no
 * corpo 200, pois um job expirado já não está "vivo" para reportar metadados.
 */
export type AiJobStatusExternal = 'pending' | 'running' | 'done' | 'failed' | 'expired';

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

const deadlineTimers = new Map<string, NodeJS.Timeout>();

// #1011: timestamp do último write-through por job (setJob). Base para o cálculo
// lastHeartbeat = max(lastWrite, now) no reportProgress — nunca retrocede o heartbeat.
const lastWriteAt = new Map<string, number>();

// #1150: per-session tail chain. Cada sessionId tem sua própria cauda de promises —
// encadear `run()` nessa cauda serializa os jobs dessa sessão (a 2ª msg só inicia
// após a 1ª terminar e persistir). Sessões distintas têm caudas independentes,
// permitindo paralelismo entre si (limitado pelo semáforo global abaixo).
const sessionTails = new Map<string, Promise<void>>();

// #1150: contador p/ gerar chaves únicas p/ chamadas sem sessionId. Cada enqueue sem
// sessionId vira uma "sessão" própria, sem serialização cruzada — preserva o
// comportamento pré-#1150 de concorrência direta pelo semáforo global.
let noSessionCounter = 0;

// #1150: semáforo global contando jobs em voo entre TODAS as sessões. MAX_CONCURRENT
// vagas; ao liberar, a vaga é transferida diretamente ao próximo waiter (sem
// decrement+increment, evitando race).
let inflight = 0;
const semaphoreWaiters: Array<() => void> = [];

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
        // #1150: estimativa — count de queued jobs (incluindo espera da sessão e do semáforo),
        // excluindo o próprio. > 0 sempre que houver outro job esperando.
        queuePosition: job.status === 'queued' ? Math.max(0, countQueuedJobs() - 1) : null,
    };
}

/** #1150: adquire 1 vaga do semáforo global. Resolve quando `inflight < MAX_CONCURRENT` */
function acquireSlot(): Promise<void> {
    if (inflight < MAX_CONCURRENT) {
        inflight++;
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
        semaphoreWaiters.push(() => {
            // O releaseSlot() transferiu a vaga p/ nós — contamos a partir daqui.
            inflight++;
            resolve();
        });
    });
}

/** #1150: libera 1 vaga. Se houver waiter, transfere a vaga (sem decrement); senão, decrementa. */
function releaseSlot(): void {
    const next = semaphoreWaiters.shift();
    if (next) {
        next();
    } else {
        inflight--;
    }
}

/**
 * #1150: estimativa da posição na fila global. Com a reformulação por sessionId, a ordem
 * FIFO global deixou de existir (per-session vs. semáforo); expomos este número para que
 * a API get()/getJobStatus() ainda devolva algo > 0 p/ jobs em espera. Conta todos os
 * jobs com status 'queued' (seja esperando a vez da sessão, seja esperando vaga do semáforo).
 */
function countQueuedJobs(): number {
    let n = 0;
    for (const j of jobs.values()) {
        if (j.status === 'queued') n++;
    }
    return n;
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
    if (!job || job.status === 'done' || job.status === 'error') return;
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
            deleteJob(id);
        }
    }
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

export const aiJobService = {
    /**
     * Enfileira um job; retorna o jobId imediatamente. `fn` roda em background.
     *
     * #1150: 3º parâmetro opcional `sessionId` — quando fornecido, jobs do mesmo
     * sessionId são serializados (msg2 só inicia após msg1 terminar e persistir).
     * Sem sessionId, o job entra direto no pool global do semáforo (MAX_CONCURRENT)
     * sem encadear em nenhuma sessão específica — preserva o comportamento dos
     * callers atuais que não passam sessionId.
     */
    enqueue(fn: () => Promise<any>, label?: string, sessionId?: string): string {
        cleanup();
        const id = randomUUID();
        const createdAt = Date.now();
        const livenessExpiresAt = getAiJobLivenessExpiresAt(createdAt);
        const job: AiJob = { id, status: 'queued', createdAt, livenessExpiresAt, label };
        setJob(job);
        scheduleDeadline(job);
        log.info('Job de IA criado', {
            jobId: id,
            sessionId: sessionId ?? null,
            startedAt: new Date(createdAt).toISOString(),
            livenessExpiresAt,
            maxChainedCalls: MAX_CHAINED_CALLS,
            totalBudgetMs: Date.parse(livenessExpiresAt) - createdAt,
        });

        // #1150: chave de sessão p/ encadear na tail. Sem sessionId → chave única
        // (sem serialização cruzada entre chamadas anônimas).
        const sessionKey = sessionId ?? `__no_session_${++noSessionCounter}`;

        // O trabalho real do job: adquire vaga do semáforo, transiciona p/ running,
        // executa fn(), trata resultado/erro, libera vaga.
        const run = async (): Promise<void> => {
            await acquireSlot();
            try {
                const current = jobs.get(id);
                if (!current || current.status === 'error' || current.status === 'done') {
                    return;
                }
                const startedAt = Date.now();
                patchJob(id, { status: 'running', startedAt, lastHeartbeat: startedAt });
                log.info('Job de IA iniciando execução', {
                    jobId: id,
                    sessionId: sessionId ?? null,
                    label,
                    queuePosition: countQueuedJobs(),
                });
                try {
                    const result = await fn();
                    const currentJob = jobs.get(id);
                    if (!currentJob || currentJob.status === 'error' || Date.now() >= Date.parse(currentJob.livenessExpiresAt)) {
                        if (currentJob?.status !== 'error') markDeadlineExceeded(id);
                        return;
                    }
                    const finishedAt = Date.now();
                    clearDeadline(id);
                    patchJob(id, { status: 'done', result, finishedAt, expiresAt: finishedAt + TTL_MS });
                    log.info('Job de IA concluído', {
                        jobId: id,
                        sessionId: sessionId ?? null,
                        label,
                        durationMs: finishedAt - startedAt,
                    });
                } catch (e: any) {
                    const currentJob = jobs.get(id);
                    if (!currentJob || currentJob.status === 'error') return;
                    const finishedAt = Date.now();
                    clearDeadline(id);
                    const error = e?.code === 'deadline_exceeded' || e?.message === 'deadline_exceeded'
                        ? 'deadline_exceeded'
                        : (e?.message || String(e));
                    patchJob(id, {
                        status: 'error',
                        error,
                        finishedAt,
                        expiresAt: finishedAt + TTL_MS,
                    });
                    log.warn(`Job ${id} falhou: ${error}`, { sessionId: sessionId ?? null, label });
                }
            } finally {
                releaseSlot();
                cleanup();
            }
        };

        // #1150: encadeia na tail da sessão. O 2º argumento do `then` garante que uma
        // rejeição do job anterior NÃO quebra a corrente — o próximo job ainda roda.
        const prevTail = sessionTails.get(sessionKey) ?? Promise.resolve();
        const newTail = prevTail.then(() => run(), () => run());
        sessionTails.set(sessionKey, newTail);

        // GC da tail: quando a corrente terminar e ninguém mais encadeou nesta sessão,
        // removemos a entrada p/ o Map não crescer indefinidamente em processos longos.
        // O `.catch(() => {})` engole rejeição hipotética do finally (defesa em profundidade).
        newTail.finally(() => {
            if (sessionTails.get(sessionKey) === newTail) {
                sessionTails.delete(sessionKey);
            }
        }).catch(() => { /* chain já é resolvida pelo 2º arg do then acima */ });

        return id;
    },

    /**
     * Enfileira e AGUARDA o resultado (mesma fila serial). Para chamadores internos
     * que precisam do valor (ex.: Judge do TaskRunner) sem colidir com jobs de chat —
     * o listener de tool-calls do aiService é global, então toda chamada LLM de longa
     * duração deve passar por aqui.
     *
     * #1150: aceita sessionId opcional p/ serializar com o chat quando aplicável.
     */
    runAndWait<T>(fn: () => Promise<T>, label?: string, sessionId?: string): Promise<T> {
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
            }, label, sessionId);
        });
    },

    /** Estado atual do job (inclui posição aproximada na fila) ou motivo da ausência. */
    get(id: string): AiJobLookup {
        const existing = jobs.get(id);
        if (existing && isPastLiveness(existing)) markDeadlineExceeded(id);
        const job = jobs.get(id);
        if (!job) return { ok: false, reason: 'missing' };
        if (isExpired(job)) return { ok: false, reason: 'expired' };
        // #1150: estimativa — count de queued jobs (incluindo espera da sessão e do semáforo),
        // excluindo o próprio job. Garante > 0 sempre que houver outro job esperando.
        const queueAhead = job.status === 'queued' ? Math.max(0, countQueuedJobs() - 1) : 0;
        return { ok: true, job, queueAhead };
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
};

restore(); // read-on-startup: roda na primeira importação do módulo