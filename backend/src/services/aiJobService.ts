import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';
import { saveJob, deleteJob, loadAll } from './aiJobStorage';

const log = createLogger('AiJob');

// Job assíncrono do assistente: o POST do chat enfileira e responde na hora com um jobId
// (não segura a conexão → mata o 524 do Cloudflare em jobs longos). O agente roda em background
// até concluir, SEM limite de tempo; o cliente faz polling de GET /jobs/:id.
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
    finishedAt?: number;
    label?: string;
    /** Expiração (epoch ms). Definido ao concluir (finishedAt + TTL). */
    expiresAt?: number;
}

/** Resultado do lookup de um job: distingue 'expirado' de 'inexistente' (GET 404). */
export type AiJobLookup =
    | { ok: true; job: AiJob; queueAhead: number }
    | { ok: false; reason: 'expired' | 'missing' };

const jobs = new Map<string, AiJob>();
const TTL_MS = 30 * 60 * 1000; // mantém o resultado 30min p/ o cliente buscar
const MAX_CONCURRENT = 3;

let running = 0;
const queue: Array<() => void> = [];

function isExpired(j: AiJob, now: number = Date.now()): boolean {
    return j.expiresAt !== undefined && now >= j.expiresAt;
}

/** Write-through: atualiza o Map e persiste atomicamente no storage durável. */
function setJob(job: AiJob): void {
    jobs.set(job.id, job);
    saveJob(job);
}

function patchJob(id: string, changes: Partial<AiJob>): void {
    const cur = jobs.get(id);
    if (!cur) return;
    setJob({ ...cur, ...changes });
}

function cleanup() {
    const now = Date.now();
    for (const [id, j] of jobs) {
        if (isExpired(j, now)) {
            jobs.delete(id);
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
                finishedAt: raw.finishedAt,
                label: raw.label,
                expiresAt: raw.expiresAt,
            };
            if (job.status === 'queued' || job.status === 'running') {
                job.status = 'error';
                job.error = job.error || 'Job interrompido por reinício do processo.';
                job.finishedAt = job.finishedAt ?? now;
                job.expiresAt = job.expiresAt ?? now + TTL_MS;
                saveJob(job);
            }
            jobs.set(job.id, job);
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
        setJob({ id, status: 'queued', createdAt: Date.now(), label });

        const run = () => {
            running++;
            patchJob(id, { status: 'running' });
            Promise.resolve()
                .then(fn)
                .then((result) => {
                    const finishedAt = Date.now();
                    patchJob(id, { status: 'done', result, finishedAt, expiresAt: finishedAt + TTL_MS });
                })
                .catch((e: any) => {
                    const finishedAt = Date.now();
                    patchJob(id, {
                        status: 'error',
                        error: e?.message || String(e),
                        finishedAt,
                        expiresAt: finishedAt + TTL_MS,
                    });
                    log.warn(`Job ${id} falhou: ${e?.message || e}`);
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
        const job = jobs.get(id);
        if (!job) return { ok: false, reason: 'missing' };
        if (isExpired(job)) return { ok: false, reason: 'expired' };
        return { ok: true, job, queueAhead: job.status === 'queued' ? queue.length : 0 };
    },

    /** Reidrata jobs do disco (read-on-startup). Exposto p/ testes/restart manual. */
    restore() {
        restore();
    },
};

restore(); // read-on-startup: roda na primeira importação do módulo
