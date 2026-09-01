import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';
import { saveJob, deleteJob, loadAll } from './aiJobStorage';
import { getAiJobLivenessExpiresAt, MAX_CHAINED_CALLS } from './aiJobBudget';

const log = createLogger('AiJob');

/**
 * Erro tipado de cancelamento (#1059) — propagado por `postChatCompletion` e o loop
 * do agente quando o `AbortSignal` é acionado pelo `aiJobService.cancel()`. Convenções:
 *   - `name === 'AbortError'` (alinhado com a Web Platform — `fetch`, `AbortController`).
 *   - `code === 'aborted'` (escrito como `e.code` pelo axios quando o request é cancelado).
 *   - `reason` carrega a string opcional passada para `abortController.abort(reason)`.
 *
 * O SSE consumer (`chatRoutes`) checa `err.name === 'AbortError'` para devolver o
 * evento terminal `cancelled { status, reason }` ao cliente sem cair em 500 genérico.
 */
export class AiJobAbortError extends Error {
    readonly code = 'aborted';
    readonly reason?: string;
    constructor(reason?: string) {
        super(typeof reason === 'string' && reason ? reason : 'aborted');
        this.name = 'AbortError';
        this.reason = reason;
    }
}

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
    /** #1059: dono do job (Dolibarr userId/login). Setado no enqueue; usado em cancel p/
     *  o handler rejeitar tentativas cross-user (403). Persistido para auditoria após restart.
     */
    ownerUserId?: string;
    /** #1059: login do dono (audit / mensagem 403). */
    ownerUserLogin?: string;
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

/**
 * #1059: resultado público de `aiJobService.cancel(jobId)`. Discriminado por `cancelled`
 * para o caller distinguir:
 *   - { cancelled: true, status: 'queued' }  → removido da fila serial antes de rodar
 *   - { cancelled: true, status: 'running' } → AbortSignal acionado no controller
 *   - { cancelled: false, reason: ... }     → não pôde cancelar (já terminal / inexistente / expirado)
 */
export type AiJobCancelResult =
    | { cancelled: true; status: 'queued' | 'running'; reason?: string }
    | { cancelled: false; reason: 'missing' | 'expired' | 'already_terminal' | 'not_cancellable' };

/** #1059: identidade do "dono" de um job — usada na rota para checagem de propriedade. */
export interface AiJobOwner {
    /** ID do usuário Dolibarr (string) ou login (fallback para usuários sem id resolvido). */
    userId: string;
    /** Login do usuário (audit / mensagem de erro). */
    userLogin: string;
}

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

/**
 * #1059: registry de AbortControllers para jobs em execução. Setado quando o job
 * entra em `running` (sincronizado com `patchJob({status:'running'})`) e removido
 * quando o terminal resolve (finally). `aiJobService.cancel(jobId)` aciona o controller
 * aqui — o axios + o loop do agente leem o signal e abortam em ≤2s (alinhado com
 * o critério #1575 do agentLoop).
 */
const abortControllers = new Map<string, AbortController>();

/** Snapshot imutável do status atual (p/ decisões de cancel). Evita acoplamento com .get(). */
function getJobSnapshot(id: string): AiJob | undefined {
    return jobs.get(id);
}

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
            // #1059: reidratar metadados de ownership quando persistidos por uma versão
            // mais nova do serviço. Versões antigas não gravam esses campos — ficam undefined.
            job.ownerUserId = raw.ownerUserId;
            job.ownerUserLogin = raw.ownerUserLogin;
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
    enqueue(fn: () => Promise<any>, label?: string, owner?: AiJobOwner): string {
        cleanup();
        const id = randomUUID();
        const createdAt = Date.now();
        const livenessExpiresAt = getAiJobLivenessExpiresAt(createdAt);
        const job: AiJob = {
            id,
            status: 'queued',
            createdAt,
            livenessExpiresAt,
            label,
            ownerUserId: owner?.userId,
            ownerUserLogin: owner?.userLogin,
        };
        setJob(job);
        scheduleDeadline(job);
        log.info('Job de IA criado', {
            jobId: id,
            startedAt: new Date(createdAt).toISOString(),
            livenessExpiresAt,
            maxChainedCalls: MAX_CHAINED_CALLS,
            totalBudgetMs: Date.parse(livenessExpiresAt) - createdAt,
        });

        // #1059: cada job recebe UM AbortController. Vive entre `running` -> terminal.
        // Cancelamentos acionados aqui propagam o `signal` adiante (axios + loop do worker).
        const controller = new AbortController();
        const { signal } = controller;

        const run = () => {
            const current = jobs.get(id);
            if (!current || current.status === 'error' || current.status === 'done') {
                // #1059: cancel pré-execução (chegou antes do job pegar a vaga). O controller
                // já foi criado — descarta sem nunca publicar no registry `abortControllers`,
                // porque o job NUNCA chegou a ficar `running`.
                pump();
                return;
            }
            // #1059: se o signal já estiver abortado (cancel pré-start), termina como cancelled.
            if (signal.aborted) {
                const finishedAt = Date.now();
                clearDeadline(id);
                patchJob(id, {
                    status: 'error',
                    error: 'cancelled',
                    finishedAt,
                    expiresAt: finishedAt + TTL_MS,
                });
                log.info(`Job ${id} cancelado antes de iniciar (signal já aborted)`);
                pump();
                return;
            }
            running++;
            const startedAt = Date.now();
            abortControllers.set(id, controller);
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
                    // #1059: AbortError do axios (e.code==='aborted' OU e.name==='AbortError')
                    // é mapeado para 'cancelled' — distinto de erro genérico para o cliente
                    // atualizar a UI sem alarme vermelho. O signal.reason vira parte da string.
                    const isAbort = e?.name === 'AbortError' || e?.code === 'aborted' ||
                        (e instanceof AiJobAbortError);
                    const error = !isAbort && (e?.code === 'deadline_exceeded' || e?.message === 'deadline_exceeded')
                        ? 'deadline_exceeded'
                        : isAbort
                            ? `cancelled${e?.reason ? `:${e.reason}` : ''}`
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
                    abortControllers.delete(id);
                    queueRunByJob.delete(id);
                    running--;
                    cleanup();
                    pump();
                });
        };

        if (running < MAX_CONCURRENT) run(); else {
            queue.push(run);
            // #1059: índice reverso para `cancel(queued)` achar e remover este run
            // sem precisar percorrer a fila inteira. Removido no `.finally()`.
            queueRunByJob.set(id, run);
        }
        return id;
    },

    /**
     * Enfileira e AGUARDA o resultado (mesma fila serial). Para chamadores internos
     * que precisam do valor (ex.: Judge do TaskRunner) sem colidir com jobs de chat —
     * o listener de tool-calls do aiService é global, então toda chamada LLM de longa
     * duração deve passar por aqui.
     */
    runAndWait<T>(fn: () => Promise<T>, label?: string, owner?: AiJobOwner): Promise<T> {
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
            }, label, owner);
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
     * #1059: cancela um job do assistente, propagando um AbortSignal até a chamada HTTP
     * da OpenAI/GLM/MiniMax. Critério de aceite:
     *   - status='queued' → remove da fila serial (`#960`) e marca como error='cancelled'.
     *     Sem nunca rodar — libera a vaga para o próximo job pegar.
     *   - status='running' → aciona `abortController.abort(reason)` (axios + retry loop
     *     detectam o signal em ≤2s). A rejeição é mapeada para 'cancelled' pelo `.catch()`
     *     de `enqueue`, então o `GET /jobs/:id` final devolve `status:'error', error:'cancelled'`.
     *   - status='done' | 'error' (já terminal) → no-op + `{cancelled:false, reason:'already_terminal'}`.
     *   - id desconhecido / expirado (TTL purgado) → `{cancelled:false, reason:'missing'|'expired'}`.
     *
     * Idempotente: chamadas repetidas no mesmo id não mudam o estado. `abortController.abort()`
     * em um signal já abortado é silencioso (no-op pela spec).
     *
     * Quem pode chamar: o DONO do job (ownerUserId/ownerUserLogin) OU admin. Cross-user
     * cancel vira `{cancelled:false, reason:'not_cancellable'}` — o handler HTTP traduz
     * em 403.
     */
    cancel(jobId: string, opts: { reason?: string; actor?: AiJobOwner } = {}): AiJobCancelResult {
        const job = getJobSnapshot(jobId);
        if (!job) {
            return { cancelled: false, reason: 'missing' };
        }
        if (isExpired(job)) {
            return { cancelled: false, reason: 'expired' };
        }
        // #1059: checagem de propriedade. Admin (caller desconhecido OU owner vazio) é
        // tolerado; chamado NÃO-admin precisa casar com ownerUserId ou ownerUserLogin.
        // Job SEM owner registrado (enqueued por uma rota legada) só pode ser cancelado
        // pelo admin — fail-closed contra takeover.
        const actor = opts.actor;
        const actorIsAdmin = !actor; // sem actor (chamada interna) => admin implícito
        if (!actorIsAdmin) {
            const hasOwnerId = !!job.ownerUserId;
            const hasOwnerLogin = !!job.ownerUserLogin;
            if (!hasOwnerId && !hasOwnerLogin) {
                // Job sem dono registrado: fail-closed para não-admin. Quem enfileirou
                // sem owner é uma rota legada — só admin cancela até migrar todas as
                // entradas (enqueue de chat/forecast já passam owner).
                log.warn(`Cancel de job sem owner registrado (${jobId}) por não-admin (actor=${actor.userLogin || actor.userId}) — negado.`);
                return { cancelled: false, reason: 'not_cancellable' };
            }
            const matchesId = hasOwnerId && !!actor.userId && actor.userId === job.ownerUserId;
            const matchesLogin = hasOwnerLogin && !!actor.userLogin && actor.userLogin === job.ownerUserLogin;
            if (!matchesId && !matchesLogin) {
                log.warn(`Tentativa de cross-user cancel do job ${jobId}: actor=${actor.userLogin} owner=${job.ownerUserLogin}`);
                return { cancelled: false, reason: 'not_cancellable' };
            }
        }
        if (job.status === 'queued') {
            // Remove da fila serial. O efeito é: o `run` correspondente nunca é invocado
            // porque já consumimos o slot do array. Como o `run` é um closure sem efeito
            // colateral até `running++`, podemos simplesmente marcar o job como terminal
            // (o `run` checa `status === 'done'|'error'` no topo e bail).
            // Aqui NÃO há controller criado (só na transição para running), então basta
            // marcar como error/cancelled.
            const finishedAt = Date.now();
            clearDeadline(jobId);
            patchJob(jobId, {
                status: 'error',
                error: `cancelled${opts.reason ? `:${opts.reason}` : ''}`,
                finishedAt,
                expiresAt: finishedAt + TTL_MS,
            });
            log.info(`Job ${jobId} removido da fila serial (status=cancelled)`);
            // IMPORTANTE: o `run` correspondente a este job está em `queue[]` — quando
            // for shift()-eado, ele checa `status==='error'/'done'` e bail. O próximo
            // job em fila já pode pegar a vaga (pump() é chamado pelo `.finally()`).
            // Para liberar a vaga IMEDIATAMENTE (sem esperar o shift), filtramos o array:
            removeFromQueue(jobId);
            pump();
            return { cancelled: true, status: 'queued', reason: opts.reason };
        }
        if (job.status === 'running') {
            const controller = abortControllers.get(jobId);
            if (!controller) {
                // Defesa em profundidade: race entre `mark running` e `cancel`. Controller
                // deve existir — se não, o job está entre transições e o cancel é "tardio".
                return { cancelled: false, reason: 'not_cancellable' };
            }
            try {
                controller.abort(opts.reason);
            } catch {
                // `abort()` é idempotente — qualquer exceção é ignorada (defesa).
            }
            log.info(`Job ${jobId} abortado (signal acionado, reason=${opts.reason || 'n/a'})`);
            // #1059: marca o job como terminal DIRETAMENTE aqui. O `fn` que o enqueue está
            // rodando pode ser signal-cooperativo (lança AbortError → .catch cuida) OU não
            // (ex.: `() => new Promise(() => {})` num teste). Em ambos os casos o usuário
            // precisa ver o job como cancelled IMEDIATAMENTE no `GET /jobs/:id` — não
            // esperar a Promise raiz rejeitar (que pode nunca acontecer). O `.catch` do
            // enqueue é NO-OP aqui porque `status === 'error'` já foi setado.
            const finishedAt = Date.now();
            clearDeadline(jobId);
            patchJob(jobId, {
                status: 'error',
                error: `cancelled${opts.reason ? `:${opts.reason}` : ''}`,
                finishedAt,
                expiresAt: finishedAt + TTL_MS,
            });
            return { cancelled: true, status: 'running', reason: opts.reason };
        }
        // done | error | (defesa: status desconhecido)
        return { cancelled: false, reason: 'already_terminal' };
    },

    /**
     * #1059: devolve o `AbortSignal` ATIVO do job (setado quando o job entra em running
     * e removido no `.finally()` do enqueue). Consumidores (ex.: `postChatCompletion`)
     * aceitam `options.signal` E/OU consultam aqui — esta função é o atalho que amarra
     * o signal ao jobId sem precisar expor o controller.
     *
     * Retorna `undefined` se o job não existe, está expirado, ou já não está running
     * (controller descartado). O caller trata `undefined` como "sem signal".
     */
    getSignal(jobId: string): AbortSignal | undefined {
        const job = getJobSnapshot(jobId);
        if (!job || isExpired(job)) return undefined;
        if (job.status !== 'running') return undefined;
        return abortControllers.get(jobId)?.signal;
    },

    /**
     * #1059: devolve o `AiJobOwner` registrado no enqueue, ou undefined se ausente.
     * Usado pela rota de cancel para mensagens 403 com nome do dono.
     */
    getOwner(jobId: string): AiJobOwner | undefined {
        const job = getJobSnapshot(jobId);
        if (!job || (!job.ownerUserId && !job.ownerUserLogin)) return undefined;
        return {
            userId: job.ownerUserId || '',
            userLogin: job.ownerUserLogin || '',
        };
    },
};

/**
 * #1059: varre a fila serial removendo o `run` correspondente a `jobId`. Necessário
 * porque `queue: Array<() => void>` é um array genérico sem identidade por job —
 * usamos um marker (símbolo `JOB_ID_MARKER`) injetado em cada `run` via closure
 * auxiliar. Aqui comparamos o id registrado em `jobs` para achar o índice.
 *
 * Implementação simples: como cada `run` é criado pelo `enqueue`, ganhamos um hook:
 * o `run` é registrado em `queueRunByJob` ANTES de entrar na fila. Aqui apenas
 * removemos a entrada e o `run` correspondente.
 */
const queueRunByJob = new Map<string, () => void>();

function removeFromQueue(jobId: string): void {
    const run = queueRunByJob.get(jobId);
    if (!run) return;
    const idx = queue.indexOf(run);
    if (idx >= 0) queue.splice(idx, 1);
    queueRunByJob.delete(jobId);
}

restore(); // read-on-startup: roda na primeira importação do módulo
