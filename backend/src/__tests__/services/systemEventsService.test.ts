import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
    audit: { list: vi.fn() },
    agent: { getActivities: vi.fn() },
    deleg: { listAll: vi.fn() },
    notif: { getForUser: vi.fn() },
    sched: { getHistory: vi.fn() },
    appr: { getActionHistory: vi.fn() },
    task: { getAllTasks: vi.fn() },
}));

vi.mock('../../services/adminAuditService', () => ({ adminAuditService: m.audit }));
vi.mock('../../services/agentActivityService', () => ({ agentActivityService: m.agent }));
vi.mock('../../services/delegationEventsService', () => ({ delegationEventsService: m.deleg }));
vi.mock('../../services/notificationService', () => ({ notificationService: m.notif }));
vi.mock('../../services/schedulerService', () => ({ schedulerService: m.sched }));
vi.mock('../../services/approvalService', () => ({ approvalService: m.appr }));
vi.mock('../../services/taskRunnerService', () => ({ taskRunnerService: m.task }));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import { systemEventsService, getAllowedSources } from '../../services/systemEventsService';

const T = (iso: string) => new Date(iso).getTime();
const ADMIN = { id: '1', login: 'admin', name: 'Admin', isAdmin: true };
const USER = { id: '7', login: 'u7', name: 'User 7', isAdmin: false };

describe('systemEventsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.audit.list.mockReturnValue([{ id: 'a1', ts: T('2026-06-18T10:00:00Z'), adminId: '1', adminLogin: 'admin', action: 'user.update', target: '9', summary: 'mudou perm' }]);
        // agent: respeita options.userId (admin: undefined → todos; user: filtra)
        m.agent.getActivities.mockImplementation((opts: any) => {
            const all = [
                { id: 'g1', userId: '7', userName: 'User 7', tool: 'list_user_tasks', action: 'read', description: 'listou tarefas', result: 'success', durationMs: 12, createdAt: T('2026-06-18T11:00:00Z') },
                { id: 'g2', userId: '9', userName: 'Outro', tool: 'create_invoice', action: 'create', description: 'criou fatura', result: 'error', durationMs: 50, createdAt: T('2026-06-18T09:00:00Z') },
            ];
            return opts?.userId ? all.filter(a => a.userId === opts.userId) : all;
        });
        m.deleg.listAll.mockReturnValue([{ taskId: '50', type: 'cobranca', at: '2026-06-18T08:00:00Z', by: '7', note: 'prazo' }]);
        m.notif.getForUser.mockReturnValue([{ id: 'n1', event: 'task.assigned', title: 'Tarefa atribuída', recipient: '7', senderId: '1', senderName: 'Admin', read: false, createdAt: T('2026-06-18T12:00:00Z'), priority: 'high', linkTo: 'tasks/50' }]);
        m.sched.getHistory.mockReturnValue([{ id: 's1', channel: 'whatsapp', message: 'lembrete', scheduledAt: T('2026-06-18T07:00:00Z'), status: 'sent', type: 'reminder', chatId: 'c1', sessionId: 'x' }]);
        m.appr.getActionHistory.mockResolvedValue([{ id: 'p1', type: 'pagar_boleto', description: 'pagar boleto', status: 'executed', riskLevel: 'high', requestedBy: 'u2', requestedAt: new Date('2026-06-18T06:00:00Z') }]);
        m.task.getAllTasks.mockReturnValue([{ issueNumber: 42, events: [{ ts: '2026-06-18T13:00:00Z', type: 'task_failed', message: 'falhou' }, { ts: 'data-ruim', type: 'task_started', message: 'x' }] }]);
    });

    it('getAllowedSources: admin vê 7 fontes, não-admin vê 2 (agent, notification)', () => {
        expect(getAllowedSources(ADMIN)).toHaveLength(7);
        expect(getAllowedSources(USER).sort()).toEqual(['agent', 'notification']);
    });

    it('admin: agrega todas as fontes, ordenado desc por timestamp', async () => {
        const r = await systemEventsService.query({ user: ADMIN });
        const sources = new Set(r.events.map(e => e.source));
        expect(sources).toContain('audit');
        expect(sources).toContain('approval');
        expect(sources).toContain('task');
        // ordenação desc: o primeiro deve ser o mais novo (task 13:00)
        expect(r.events[0].source).toBe('task');
        // o evento de task com data inválida foi descartado (só 1 task event)
        expect(r.events.filter(e => e.source === 'task')).toHaveLength(1);
    });

    it('não-admin: só vê agent (próprio) e notification; nada de audit/approval/etc', async () => {
        const r = await systemEventsService.query({ user: USER });
        const sources = new Set(r.events.map(e => e.source));
        expect(sources).toEqual(new Set(['agent', 'notification']));
        // agent filtrado por userId=7 (não traz o g2 de outro usuário)
        expect(m.agent.getActivities).toHaveBeenCalledWith(expect.objectContaining({ userId: '7' }));
        expect(r.events.find(e => e.source === 'agent')?.actor.id).toBe('7');
    });

    it('filtro por source restringe ao subconjunto pedido', async () => {
        const r = await systemEventsService.query({ user: ADMIN, sources: ['agent'] });
        expect(new Set(r.events.map(e => e.source))).toEqual(new Set(['agent']));
    });

    it('não-admin não consegue pedir fonte sensível (filtra fora)', async () => {
        const r = await systemEventsService.query({ user: USER, sources: ['audit', 'approval'] });
        expect(r.events).toHaveLength(0); // pediu só sensíveis → nada
    });

    it('filtro de busca e de tipo', async () => {
        const byType = await systemEventsService.query({ user: ADMIN, type: 'cobranca' });
        expect(byType.events.every(e => e.type === 'cobranca')).toBe(true);
        const bySearch = await systemEventsService.query({ user: ADMIN, search: 'boleto' });
        expect(bySearch.events.some(e => e.source === 'approval')).toBe(true);
        expect(bySearch.events.every(e => /boleto/i.test(e.description))).toBe(true);
    });

    it('paginação: total reflete tudo, events é a página', async () => {
        const r = await systemEventsService.query({ user: ADMIN, limit: 2, offset: 0 });
        expect(r.events).toHaveLength(2);
        expect(r.total).toBeGreaterThan(2);
    });

    it('severidade: task_failed vira error', async () => {
        const r = await systemEventsService.query({ user: ADMIN, sources: ['task'] });
        expect(r.events[0].severity).toBe('error');
    });
});
