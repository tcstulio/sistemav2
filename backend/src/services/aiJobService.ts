import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';

const log = createLogger('AiJob');

// Job assíncrono do assistente: o POST do chat enfileira e responde na hora com um jobId
// (não segura a conexão → mata o 524 do Cloudflare em jobs longos). O agente roda em background
// até concluir, SEM limite de tempo; o cliente faz polling de GET /jobs/:id.
//
// Concorrência SERIAL (MAX=1) de propósito: o listener de tool-calls do aiService é GLOBAL,
// então rodar dois jobs ao mesmo tempo embaralharia o log de atividade. Serial preserva a
// correção; o POST responde imediatamente ("queued"/"running"), então nenhuma sessão congela.
// Paralelismo real = follow-up (listener por-job via AsyncLocalStorage).

export type AiJobStatus = 'queued' | 'running' | 'done' | 'error';

interface AiJob {
    id: string;
    status: AiJobStatus;
    result?: any;
    error?: string;
    createdAt: number;
    finishedAt?: number;
    label?: string;
}

const jobs = new Map<string, AiJob>();
const TTL_MS = 30 * 60 * 1000; // mantém o resultado 30min p/ o cliente buscar
const MAX_CONCURRENT = 1;

let running = 0;
const queue: Array<() => void> = [];

function cleanup() {
    const now = Date.now();
    for (const [id, j] of jobs) {
        if (j.finishedAt && now - j.finishedAt > TTL_MS) jobs.delete(id);
    }
}

function pump() {
    if (running >= MAX_CONCURRENT) return;
    const next = queue.shift();
    if (next) next();
}

export const aiJobService = {
    /** Enfileira um job; retorna o jobId imediatamente. `fn` roda em background. */
    enqueue(fn: () => Promise<any>, label?: string): string {
        cleanup();
        const id = randomUUID();
        jobs.set(id, { id, status: 'queued', createdAt: Date.now(), label });

        const run = () => {
            running++;
            const job = jobs.get(id);
            if (job) job.status = 'running';
            Promise.resolve()
                .then(fn)
                .then((result) => { const j = jobs.get(id); if (j) { j.result = result; j.status = 'done'; } })
                .catch((e: any) => {
                    const j = jobs.get(id);
                    if (j) { j.error = e?.message || String(e); j.status = 'error'; }
                    log.warn(`Job ${id} falhou: ${e?.message || e}`);
                })
                .finally(() => { const j = jobs.get(id); if (j) j.finishedAt = Date.now(); running--; pump(); });
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

    /** Estado atual do job (inclui posição aproximada na fila). */
    get(id: string): (AiJob & { queueAhead: number }) | undefined {
        const job = jobs.get(id);
        if (!job) return undefined;
        return { ...job, queueAhead: job.status === 'queued' ? queue.length : 0 };
    },
};
