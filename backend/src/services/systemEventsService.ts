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

class SystemEventsService {
    private async collectAudit(): Promise<SystemEvent[]> {
        return adminAuditService.list({ limit: PER_SOURCE_CAP }).flatMap((e) => {
            const ts = toIso(e.ts);
            if (!ts) return [];
            return [{
                id: `audit_${e.id}`, timestamp: ts, source: 'audit' as const,
                actor: { id: e.adminId, name: e.adminLogin || e.adminId },
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
                    actor: { id: a.userId, name: a.userName || a.userId },
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

    private async collectDelegation(user: SystemUser): Promise<SystemEvent[]> {
        let rows = delegationEventsService.listAll(PER_SOURCE_CAP);
        if (!user.isAdmin) {
            const index = await this.getTaskUserIndex();
            // visível se o usuário agiu (by), é o destinatário (to), ou está envolvido na tarefa.
            rows = rows.filter((e) => e.by === user.id || e.to === user.id || index.get(String(e.taskId))?.has(user.id));
        }
        return rows.flatMap((e, i) => {
            const ts = toIso(e.at);
            if (!ts) return [];
            return [{
                id: `deleg_${e.taskId}_${e.at}_${i}`, timestamp: ts, source: 'delegation' as const,
                actor: { id: e.by || 'system', name: e.by ? e.by : 'Sistema' },
                type: e.type, entityType: 'task', entityId: e.taskId,
                description: e.note ? `${e.type} — ${e.note}` : e.type,
                linkTo: `tasks/${e.taskId}`, severity: 'info' as const,
                // `to` = destinatário (userId); o front resolve o nome p/ exibir "→ Fulano". (#526)
                metadata: e.to ? { to: e.to } : undefined,
            }];
        });
    }

    private async collectNotification(user: SystemUser): Promise<SystemEvent[]> {
        // PR2 (#519): admin vê TODAS (getAll); não-admin só as visíveis a ele (getForUser).
        const list = user.isAdmin
            ? notificationService.getAll(PER_SOURCE_CAP)
            : notificationService.getForUser(user.id, PER_SOURCE_CAP);
        return list.flatMap((n) => {
            const ts = toIso(n.createdAt);
            if (!ts) return [];
            return [{
                id: `notif_${n.id}`, timestamp: ts, source: 'notification' as const,
                actor: { id: n.senderId || 'system', name: n.senderName || 'Sistema' },
                type: n.event, entityType: n.entityType, entityId: n.entityId,
                description: n.title, linkTo: n.linkTo, status: n.read ? 'read' : 'unread',
                severity: (n.priority === 'high' ? 'warn' : 'info') as 'info' | 'warn',
            }];
        });
    }

    private async collectScheduler(): Promise<SystemEvent[]> {
        return schedulerService.getHistory({ limit: PER_SOURCE_CAP }).flatMap((m) => {
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
    }

    private async collectApproval(): Promise<SystemEvent[]> {
        const history = await approvalService.getActionHistory({ limit: PER_SOURCE_CAP });
        return history.flatMap((a) => {
            const ts = toIso(a.requestedAt as any);
            if (!ts) return [];
            return [{
                id: `appr_${a.id}`, timestamp: ts, source: 'approval' as const,
                actor: { id: a.requestedBy, name: a.requestedBy },
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
