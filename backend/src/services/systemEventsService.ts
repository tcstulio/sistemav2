/**
 * Central de Eventos do Sistema (#519) — agregador read-only que unifica as várias fontes
 * de eventos que o sistema cria/registra num único feed normalizado (SystemEvent), com
 * visibilidade por usuário (não-admin vê só o que lhe concerne; admin vê tudo).
 *
 * NÃO duplica storage: lê os services-singleton existentes e normaliza. A fonte 'dolibarr'
 * (actioncomm) é mesclada no CLIENTE (o front já sincroniza via useSystemLogs), por isso
 * não entra neste agregador.
 */
import { adminAuditService } from './adminAuditService';
import { agentActivityService } from './agentActivityService';
import { delegationEventsService } from './delegationEventsService';
import { delegationService } from './delegationService';
import { notificationService } from './notificationService';
import { schedulerService } from './schedulerService';
import { approvalService } from './approvalService';
import { taskRunnerService } from './taskRunnerService';
import { dolibarrService } from './dolibarr';
import { createLogger } from '../utils/logger';

const log = createLogger('SystemEvents');

export type SystemEventSource = 'audit' | 'agent' | 'delegation' | 'notification' | 'scheduler' | 'approval' | 'task';

export interface SystemEvent {
    id: string;
    timestamp: string; // ISO 8601
    source: SystemEventSource;
    actor: { id: string; name: string };
    type: string;
    entityType?: string;
    entityId?: string;
    description: string;
    linkTo?: string;
    status?: string;
    severity: 'info' | 'warn' | 'error';
    metadata?: Record<string, any>;
}

export interface SystemUser {
    id: string;
    login: string;
    name: string;
    isAdmin: boolean;
}

export interface SystemEventQuery {
    user: SystemUser;
    sources?: SystemEventSource[];
    type?: string;
    actor?: string;
    search?: string;
    dateFrom?: number; // ms
    dateTo?: number; // ms
    limit?: number;
    offset?: number;
}

const ALL_SOURCES: SystemEventSource[] = ['audit', 'agent', 'delegation', 'notification', 'scheduler', 'approval', 'task'];
// Visibilidade do não-admin (PR2, #519): só o que lhe concerne e não-sensível.
//  - agent/notification: já filtrados por usuário no collector.
//  - delegation: visível se o usuário está envolvido na tarefa (responsável/interveniente) ou
//    executou a ação (campo `by`) — ver collectDelegation.
//  - audit/approval: sensíveis → admin-only.
//  - scheduler (mensagens do sistema por chatId) e task (robô opencode, sem dono): sem vínculo
//    natural com o usuário comum → admin-only por ora.
const NON_ADMIN_SOURCES: SystemEventSource[] = ['agent', 'notification', 'delegation'];
const PER_SOURCE_CAP = 500;
const PER_TASK_EVENT_CAP = 40;
// Índice tarefa→usuários envolvidos é a única parte com I/O de rede (custom_sync); micro-cache p/
// amortizar rajadas de re-fetch disparadas por socket (tempo real).
const TASK_USER_INDEX_TTL_MS = 30_000;
// Mapa userId/login→nome (listUsers). Best-effort no backend (a fonte completa vive no cliente,
// via useUsers); aqui só evita vazar ID cru/'unknown' na resposta da API. Micro-cache p/ não
// martelar o Dolibarr a cada re-fetch em tempo real.
const USER_NAME_TTL_MS = 60_000;

/** Converte ms | ISO | Date para ISO; retorna null se inválido (evento é descartado, nunca quebra o feed). */
function toIso(v: number | string | Date | undefined | null): string | null {
    if (v === undefined || v === null || v === '') return null;
    try {
        const d = typeof v === 'number' ? new Date(v) : v instanceof Date ? v : new Date(v);
        return isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
        return null;
    }
}

export function getAllowedSources(user: SystemUser): SystemEventSource[] {
    return user.isAdmin ? [...ALL_SOURCES] : [...NON_ADMIN_SOURCES];
}

function taskSeverity(type: string): 'info' | 'warn' | 'error' {
    if (/fail|error|timeout|killed/i.test(type)) return 'error';
    if (/rejected|watchdog|cleanup/i.test(type)) return 'warn';
    return 'info';
}

// ---------------------------------------------------------------------------
// Worker execution tracking (#1224)
// ---------------------------------------------------------------------------
/**
 * DECISÃO DE DESIGN (#1224) — reaproveitar a fonte `scheduler` em vez de criar
 * uma fonte nova `worker`.
 *
 * Motivo (critério: "qual delas a UI da Central já renderiza sem ajustes"): a UI
 * (SystemEventsView → SOURCE_META em `src/utils/systemEventUtils.ts` e o tipo
 * `SystemEventSource` em `src/services/systemEventsService.ts`) JÁ renderiza a
 * fonte `scheduler` — chip, ícone (CalendarClock), cor e filtro — sem nenhuma
 * alteração. A fonte `worker` NÃO existe na UI (não está no tipo union nem no
 * SOURCE_META), então exigi-ria mudar: SystemEventSource (backend+frontend),
 * ALL_SOURCES/NON_ADMIN_SOURCES, SOURCE_META e o array de chips — 3+ arquivos.
 *
 * Conclusão: as execuções de worker (robôs/CLIs como opencode/claude-cli) são
 * mescladas no collector `collectScheduler`, normalizadas como SystemEvent com
 * source='scheduler', label do worker em `type` (`worker_<source>`) e metadados
 * enriquecidos. Visibilidade e cap seguem os da fonte scheduler (admin-only por
 * ora). Por isso NÃO há ajuste em `src/` — a UI já cobre a fonte escolhida.
 */
export type WorkerExecutionStatus = 'running' | 'success' | 'error' | 'timeout';

export interface WorkerExecutionRecord {
    id: string;
    source: string;                 // label lógico do worker (ex.: 'opencode', 'claude-cli')
    status: WorkerExecutionStatus;
    summary?: string;
    error?: string;
    startedAt: string;              // ISO — gerado internamente
    endedAt?: string;               // ISO quando o ciclo termina (status !== 'running')
    durationMs?: number;
}

/** Cap do ring-buffer de worker executions (~100, FIFO). Evita crescimento ilimitado em memória. */
export const WORKER_RING_BUFFER_CAP = 100;

/**
 * Ring-buffer FIFO (cap WORKER_RING_BUFFER_CAP) para execuções de worker.
 * Ao saturar, descarta as entradas mais antigas — garantindo teto de memória.
 * É read-only para o aggregator: o collector `collectScheduler` só lê via list().
 */
class WorkerExecutionRingBuffer {
    private buf: WorkerExecutionRecord[] = [];
    private seq = 0;

    /** Insere preservando o cap: ao exceder, descarta as mais antigas (FIFO). */
    push(rec: Omit<WorkerExecutionRecord, 'id'>): WorkerExecutionRecord {
        const full: WorkerExecutionRecord = { ...rec, id: `worker_${++this.seq}` };
        this.buf.push(full);
        if (this.buf.length > WORKER_RING_BUFFER_CAP) {
            this.buf.splice(0, this.buf.length - WORKER_RING_BUFFER_CAP);
        }
        return full;
    }

    /** Snapshot das `limit` entradas mais recentes (cópia defensiva, read-only). */
    list(limit?: number): WorkerExecutionRecord[] {
        return typeof limit === 'number' && limit >= 0 ? this.buf.slice(-limit) : [...this.buf];
    }

    size(): number {
        return this.buf.length;
    }

    /** Zera o buffer (uso principal: isolar testes / reset). */
    clear(): void {
        this.buf = [];
    }
}

export const workerExecutions = new WorkerExecutionRingBuffer();

function workerSeverity(status: WorkerExecutionStatus): 'info' | 'warn' | 'error' {
    if (status === 'error') return 'error';
    if (status === 'timeout') return 'warn';
    return 'info';
}

/**
 * Registra MANUALMENTE uma execução de worker no ring-buffer. `source` é o label
 * lógico do worker (ex.: 'opencode'); o timestamp é gerado internamente (ISO).
 * Retorna o registro criado (com id atribuído).
 */
export function recordWorkerExecution(
    source: string,
    status: WorkerExecutionStatus,
    summary?: string,
    error?: string,
): WorkerExecutionRecord {
    const iso = new Date().toISOString();
    return workerExecutions.push({
        source,
        status,
        summary,
        error: status === 'error' || status === 'timeout' ? error : undefined,
        startedAt: iso,
        endedAt: status === 'running' ? undefined : iso,
    });
}

/**
 * Wrapper que rastreia AUTOMATICAMENTE o ciclo de vida de `fn`: captura o início
 * (startedAt), executa, e ao fim registra sucesso ou erro (endedAt) com a duração
 * — num único registro no ring-buffer. Timestamps gerados internamente. Re-rejeita
 * o erro original (não engole exceções).
 */
export async function withExecutionTracking<T>(
    source: string,
    fn: () => Promise<T>,
    summary?: string,
): Promise<T> {
    const startMs = Date.now();
    const startedAt = new Date(startMs).toISOString();
    try {
        const result = await fn();
        workerExecutions.push({
            source,
            status: 'success',
            summary,
            startedAt,
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - startMs,
        });
        return result;
    } catch (e: any) {
        workerExecutions.push({
            source,
            status: 'error',
            summary,
            error: e?.message || String(e),
            startedAt,
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - startMs,
        });
        throw e;
    }
}

class SystemEventsService {
    private async collectAudit(): Promise<SystemEvent[]> {
        return adminAuditService.list({ limit: PER_SOURCE_CAP }).flatMap((e) => {
            const ts = toIso(e.ts);
            if (!ts) return [];
            return [{
                id: `audit_${e.id}`, timestamp: ts, source: 'audit' as const,
                actor: { id: e.adminId, name: e.adminLogin || 'Sistema' },
                type: e.action, entityId: e.target,
                description: e.summary || e.action, severity: 'info' as const,
                metadata: e.changes ? { changes: e.changes } : undefined,
            }];
        });
    }

    private async collectAgent(user: SystemUser): Promise<SystemEvent[]> {
        return agentActivityService
            .getActivities({ limit: PER_SOURCE_CAP, userId: user.isAdmin ? undefined : user.id })
            .flatMap((a) => {
                const ts = toIso(a.createdAt);
                if (!ts) return [];
                return [{
                    id: `agent_${a.id}`, timestamp: ts, source: 'agent' as const,
                    actor: { id: a.userId, name: (a.userName && a.userName !== 'unknown') ? a.userName : 'Agente' },
                    type: a.tool, entityType: a.entityType, entityId: a.entityId,
                    description: a.description, status: a.result,
                    severity: (a.result === 'error' ? 'error' : 'info') as 'info' | 'error',
                    metadata: { action: a.action, durationMs: a.durationMs },
                }];
            });
    }

    private taskUserIndexCache: { at: number; index: Map<string, Set<string>> } | null = null;

    /**
     * Mapa taskId → conjunto de userIds envolvidos (responsável/interveniente), via um único
     * getAllTaskContacts() (custom_sync). Micro-cache TTL p/ não martelar a rede em rajada de
     * re-fetch (tempo real). O criador da tarefa não tem getter de lista barato aqui; na prática
     * ele é coberto pelo `by` do evento de origem (requested/template_set).
     *
     * O cache é user-agnóstico (taskId→userIds); o filtro por usuário é aplicado por requisição.
     * Trade-off consciente: ao remover um contato de uma tarefa, ele ainda enxerga os eventos de
     * delegação dela por até TASK_USER_INDEX_TTL_MS (apenas metadados de linha do tempo). Se isso
     * virar problema, baixar o TTL ou invalidar o cache na alteração de contatos.
     */
    private async getTaskUserIndex(): Promise<Map<string, Set<string>>> {
        const now = Date.now();
        if (this.taskUserIndexCache && now - this.taskUserIndexCache.at < TASK_USER_INDEX_TTL_MS) {
            return this.taskUserIndexCache.index;
        }
        const index = new Map<string, Set<string>>();
        try {
            const contacts = await dolibarrService.getAllTaskContacts();
            for (const c of contacts || []) {
                if (!c?.task_id || !c?.user_id) continue;
                const key = String(c.task_id);
                if (!index.has(key)) index.set(key, new Set());
                index.get(key)!.add(String(c.user_id));
            }
        } catch (e: any) {
            log.warn(`getTaskUserIndex falhou: ${e?.message || e}`);
        }
        this.taskUserIndexCache = { at: now, index };
        return index;
    }

    private userNameCache: { at: number; index: Map<string, string> } | null = null;

    /**
     * Mapa userId E login → nome legível, via um único listUsers(). Micro-cache TTL p/ não
     * martelar o Dolibarr em rajadas de re-fetch. Best-effort: o listUsers é limitado, então a
     * resolução autoritativa de TODOS os usuários fica no cliente (useUsers → userMap); o backend
     * usa isto apenas para não vazar um ID numérico cru ou 'unknown' como actor.name.
     */
    private async getUserNameIndex(): Promise<Map<string, string>> {
        const now = Date.now();
        if (this.userNameCache && now - this.userNameCache.at < USER_NAME_TTL_MS) {
            return this.userNameCache.index;
        }
        const index = new Map<string, string>();
        try {
            const users = await dolibarrService.listUsers();
            for (const u of users || []) {
                const name = `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.login || '';
                if (!name) continue;
                if (u.id) index.set(String(u.id), name);
                if (u.login) index.set(String(u.login), name);
            }
        } catch (e: any) {
            log.warn(`getUserNameIndex falhou: ${e?.message || e}`);
        }
        this.userNameCache = { at: now, index };
        return index;
    }

    /**
     * Resolve um id/login para o nome legível. Retorna '' quando o valor é vazio/'unknown'
     * (quem chama aplica o rótulo de sistema apropriado). Quando há um autor mas o nome não está
     * no índice, devolve uma referência rotulada '#<id>' (legível, não é o ID cru) que o cliente
     * ainda resolve via userMap. Valores não-numéricos (logins/nomes já gravados) passam direto.
     */
    private lookupName(index: Map<string, string>, idOrName?: string | null): string {
        const v = idOrName ? String(idOrName).trim() : '';
        if (!v || v === 'unknown') return '';
        if (index.has(v)) return index.get(v)!;
        return /^\d+$/.test(v) ? `#${v}` : v;
    }

    private async collectDelegation(user: SystemUser): Promise<SystemEvent[]> {
        let rows = delegationEventsService.listAll(PER_SOURCE_CAP);
        if (!user.isAdmin) {
            const index = await this.getTaskUserIndex();
            // visível se o usuário agiu (by), é o destinatário (to), ou está envolvido na tarefa.
            rows = rows.filter((e) => e.by === user.id || e.to === user.id || index.get(String(e.taskId))?.has(user.id));
        }
        const names = await this.getUserNameIndex();
        const out: SystemEvent[] = [];
        rows.forEach((e, i) => {
            const ts = toIso(e.at);
            if (!ts) return;
            // Enriquecimento: destinatário (to) + objetivo da delegação (do store local), p/ o
            // card mostrar "Sistema → Fulano (Responsável) · <objetivo>". (#526 + card)
            const objetivo = delegationService.get(String(e.taskId))?.objetivo;
            const meta: Record<string, any> = {};
            if (e.to) meta.to = e.to;
            if (objetivo) meta.objetivo = objetivo;
            out.push({
                id: `deleg_${e.taskId}_${e.at}_${i}`, timestamp: ts, source: 'delegation' as const,
                actor: { id: e.by || 'system', name: e.by ? (this.lookupName(names, e.by) || 'Sistema') : 'Sistema' },
                type: e.type, entityType: 'task', entityId: e.taskId,
                description: e.note ? `${e.type} — ${e.note}` : e.type,
                linkTo: `tasks/${e.taskId}`, severity: 'info' as const,
                metadata: Object.keys(meta).length ? meta : undefined,
            });
        });
        return out;
    }

    private async collectNotification(user: SystemUser): Promise<SystemEvent[]> {
        // PR2 (#519): admin vê TODAS (getAll); não-admin só as visíveis a ele (getForUser).
        const list = user.isAdmin
            ? notificationService.getAll(PER_SOURCE_CAP)
            : notificationService.getForUser(user.id, PER_SOURCE_CAP);
        const names = await this.getUserNameIndex();
        const out: SystemEvent[] = [];
        list.forEach((n) => {
            const ts = toIso(n.createdAt);
            if (!ts) return;
            const senderLabel = n.senderName
                ? (n.senderName !== 'unknown' ? n.senderName : this.lookupName(names, n.senderId) || 'Sistema')
                : (n.senderId ? this.lookupName(names, n.senderId) || 'Sistema' : 'Sistema');
            out.push({
                id: `notif_${n.id}`, timestamp: ts, source: 'notification' as const,
                actor: { id: n.senderId || 'system', name: senderLabel },
                type: n.event, entityType: n.entityType, entityId: n.entityId,
                description: n.title, linkTo: n.linkTo, status: n.read ? 'read' : 'unread',
                severity: (n.priority === 'high' ? 'warn' : 'info') as 'info' | 'warn',
            });
        });
        return out;
    }

    private async collectScheduler(): Promise<SystemEvent[]> {
        const schedEvents = schedulerService.getHistory({ limit: PER_SOURCE_CAP }).flatMap((m) => {
            const ts = toIso(m.scheduledAt || m.createdAt);
            if (!ts) return [];
            return [{
                id: `sched_${m.id}`, timestamp: ts, source: 'scheduler' as const,
                actor: { id: 'scheduler', name: 'Agendador' },
                type: m.type, description: `[${m.channel}] ${(m.message || '').slice(0, 120)}`,
                status: m.status, severity: (m.status === 'failed' ? 'error' : 'info') as 'info' | 'error',
                metadata: { chatId: m.chatId, sessionId: m.sessionId },
            }];
        });
        // Worker executions reaproveitam a fonte 'scheduler' (ver JSDoc no topo do módulo, #1224).
        const workerEvents: SystemEvent[] = workerExecutions.list(PER_SOURCE_CAP).map((w) => {
            const ts = w.endedAt || w.startedAt;
            return {
                id: w.id,
                timestamp: ts,
                source: 'scheduler' as const,
                actor: { id: 'worker', name: 'Worker' },
                type: `worker_${w.source}`,
                description: w.error
                    ? `${w.summary || w.source} — ERRO: ${w.error}`
                    : (w.summary || `Execução ${w.source} (${w.status})`),
                status: w.status,
                severity: workerSeverity(w.status),
                metadata: {
                    workerSource: w.source,
                    startedAt: w.startedAt,
                    endedAt: w.endedAt,
                    durationMs: w.durationMs,
                    ...(w.error ? { error: w.error } : {}),
                },
            };
        });
        return [...schedEvents, ...workerEvents];
    }

    private async collectApproval(): Promise<SystemEvent[]> {
        const history = await approvalService.getActionHistory({ limit: PER_SOURCE_CAP });
        const names = await this.getUserNameIndex();
        return history.flatMap((a) => {
            const ts = toIso(a.requestedAt as any);
            if (!ts) return [];
            return [{
                id: `appr_${a.id}`, timestamp: ts, source: 'approval' as const,
                actor: { id: a.requestedBy, name: this.lookupName(names, a.requestedBy) || 'Sistema' },
                type: a.type, description: a.description, status: a.status,
                severity: (a.riskLevel === 'high' ? 'warn' : 'info') as 'info' | 'warn',
                metadata: { banco: a.banco, riskLevel: a.riskLevel },
            }];
        });
    }

    private async collectTask(): Promise<SystemEvent[]> {
        const out: SystemEvent[] = [];
        for (const task of taskRunnerService.getAllTasks()) {
            const events = (task.events || []).slice(-PER_TASK_EVENT_CAP);
            events.forEach((ev, i) => {
                const ts = toIso(ev.ts);
                if (!ts) return;
                out.push({
                    id: `task_${task.issueNumber}_${ev.ts}_${i}`, timestamp: ts, source: 'task',
                    actor: { id: 'taskrunner', name: 'TaskRunner' },
                    type: ev.type, entityType: 'task', entityId: String(task.issueNumber),
                    description: ev.message, linkTo: `tasks/${task.issueNumber}`,
                    severity: taskSeverity(ev.type),
                });
            });
        }
        return out;
    }

    private async collect(source: SystemEventSource, user: SystemUser): Promise<SystemEvent[]> {
        try {
            switch (source) {
                case 'audit': return await this.collectAudit();
                case 'agent': return await this.collectAgent(user);
                case 'delegation': return await this.collectDelegation(user);
                case 'notification': return await this.collectNotification(user);
                case 'scheduler': return await this.collectScheduler();
                case 'approval': return await this.collectApproval();
                case 'task': return await this.collectTask();
                default: return [];
            }
        } catch (e: any) {
            log.warn(`collect(${source}) falhou: ${e?.message || e}`);
            return [];
        }
    }

    async query(q: SystemEventQuery): Promise<{ events: SystemEvent[]; total: number; sources: SystemEventSource[] }> {
        const allowed = getAllowedSources(q.user);
        const requested = q.sources?.length ? q.sources.filter((s) => allowed.includes(s)) : allowed;

        const collected = await Promise.all(requested.map((s) => this.collect(s, q.user)));
        let events = collected.flat();

        if (q.type) events = events.filter((e) => e.type === q.type);
        if (q.actor) events = events.filter((e) => e.actor.id === q.actor || e.actor.name === q.actor);
        if (q.dateFrom) events = events.filter((e) => Date.parse(e.timestamp) >= q.dateFrom!);
        if (q.dateTo) events = events.filter((e) => Date.parse(e.timestamp) <= q.dateTo!);
        if (q.search) {
            const s = q.search.toLowerCase();
            events = events.filter((e) =>
                `${e.description} ${e.type} ${e.actor.name} ${e.entityType || ''}`.toLowerCase().includes(s)
            );
        }

        events.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

        const total = events.length;
        const offset = Math.max(0, q.offset || 0);
        const limit = Math.min(200, Math.max(1, q.limit || 50));
        return { events: events.slice(offset, offset + limit), total, sources: allowed };
    }
}

export const systemEventsService = new SystemEventsService();
