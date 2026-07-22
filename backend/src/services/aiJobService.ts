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

let running = 0;
const queue: Array<() => void> = [];
const deadlineTimers = new Map<string, NodeJS.Timeout>();

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
    /** Enfileira um job; retorna o jobId imediatamente. `fn` roda em background. */
    enqueue(fn: () => Promise<any>, label?: string): string {
        cleanup();
        const id = randomUUID();
        const createdAt = Date.now();
        const livenessExpiresAt = getAiJobLivenessExpiresAt(createdAt);
        const job: AiJob = { id, status: 'queued', createdAt, livenessExpiresAt, label };
        setJob(job);
        scheduleDeadline(job);
        log.info('Job de IA criado', {
            jobId: id,
            startedAt: new Date(createdAt).toISOString(),
            livenessExpiresAt,
            maxChainedCalls: MAX_CHAINED_CALLS,
            totalBudgetMs: Date.parse(livenessExpiresAt) - createdAt,
        });

        const run = () => {
            const current = jobs.get(id);
            if (!current || current.status === 'error' || current.status === 'done') {
                pump();
                return;
            }
            running++;
            const startedAt = Date.now();
            patchJob(id, { status: 'running', startedAt, lastHeartbeat: startedAt });
            Promise.resolve()
                .then(fn)
                .then((result) => {
                    const currentJob = jobs.get(id);
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
                    log.warn(`Job ${id} falhou: ${error}`);
                })
                .finally(() => { running--; cleanup(); pump(); });
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
};

restore(); // read-on-startup: roda na primeira importação do módulo
