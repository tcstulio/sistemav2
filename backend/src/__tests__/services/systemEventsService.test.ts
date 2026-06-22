import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
    audit: { list: vi.fn() },
    agent: { getActivities: vi.fn() },
    deleg: { listAll: vi.fn() },
    notif: { getForUser: vi.fn(), getAll: vi.fn() },
    sched: { getHistory: vi.fn() },
    appr: { getActionHistory: vi.fn() },
    task: { getAllTasks: vi.fn() },
    doli: { getAllTaskContacts: vi.fn(), listUsers: vi.fn() },
    delegSvc: { get: vi.fn() },
}));

vi.mock('../../services/adminAuditService', () => ({ adminAuditService: m.audit }));
vi.mock('../../services/agentActivityService', () => ({ agentActivityService: m.agent }));
vi.mock('../../services/delegationEventsService', () => ({ delegationEventsService: m.deleg }));
vi.mock('../../services/delegationService', () => ({ delegationService: m.delegSvc }));
vi.mock('../../services/notificationService', () => ({ notificationService: m.notif }));
vi.mock('../../services/schedulerService', () => ({ schedulerService: m.sched }));
vi.mock('../../services/approvalService', () => ({ approvalService: m.appr }));
vi.mock('../../services/taskRunnerService', () => ({ taskRunnerService: m.task }));
vi.mock('../../services/dolibarr', () => ({ dolibarrService: m.doli }));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

import { systemEventsService, getAllowedSources } from '../../services/systemEventsService';

const T = (iso: string) => new Date(iso).getTime();
const ADMIN = { id: '1', login: 'admin', name: 'Admin', isAdmin: true };
const USER = { id: '7', login: 'u7', name: 'User 7', isAdmin: false };

describe('systemEventsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // micro-cache do índice de tarefa→usuários e de nomes persistem entre testes; zera p/ isolar.
        (systemEventsService as any).taskUserIndexCache = null;
        (systemEventsService as any).userNameCache = null;
        // listUsers vazio por padrão → resolução de nome cai em '#id'/'Sistema' (fallback legível).
        m.doli.listUsers.mockReturnValue([]);
        m.audit.list.mockReturnValue([{ id: 'a1', ts: T('2026-06-18T10:00:00Z'), adminId: '1', adminLogin: 'admin', action: 'user.update', target: '9', summary: 'mudou perm' }]);
        // agent: respeita options.userId (admin: undefined → todos; user: filtra)
        m.agent.getActivities.mockImplementation((opts: any) => {
            const all = [
                { id: 'g1', userId: '7', userName: 'User 7', tool: 'list_user_tasks', action: 'read', description: 'listou tarefas', result: 'success', durationMs: 12, createdAt: T('2026-06-18T11:00:00Z') },
                { id: 'g2', userId: '9', userName: 'Outro', tool: 'create_invoice', action: 'create', description: 'criou fatura', result: 'error', durationMs: 50, createdAt: T('2026-06-18T09:00:00Z') },
            ];
            return opts?.userId ? all.filter(a => a.userId === opts.userId) : all;
        });
        // delegação: evento do user 7 (by), um de tarefa alheia (by 9, task 99) e um onde o
        // user 7 é o DESTINATÁRIO (to=7, autor=Sistema) — task 60.
        m.deleg.listAll.mockReturnValue([
            { taskId: '50', type: 'cobranca', at: '2026-06-18T08:00:00Z', by: '7', note: 'prazo' },
            { taskId: '99', type: 'escalated', at: '2026-06-18T08:30:00Z', by: '9', note: 'outra tarefa' },
            { taskId: '60', type: 'cobranca', at: '2026-06-18T08:15:00Z', to: '7', note: 'cobrança ao 7' },
        ]);
        // índice de papéis: user 7 é contato (responsável) da task 50; task 99 é de outros.
        m.doli.getAllTaskContacts.mockResolvedValue([{ id: 'c1', task_id: '50', user_id: '7', type_id: '45' }]);
        // notificações: getForUser (não-admin) vê só a sua; getAll (admin) vê de todos.
        m.notif.getForUser.mockReturnValue([{ id: 'n1', event: 'task.assigned', title: 'Tarefa atribuída', recipient: '7', senderId: '1', senderName: 'Admin', read: false, createdAt: T('2026-06-18T12:00:00Z'), priority: 'high', linkTo: 'tasks/50' }]);
        m.notif.getAll.mockReturnValue([
            { id: 'n1', event: 'task.assigned', title: 'Tarefa atribuída', recipient: '7', senderId: '1', senderName: 'Admin', read: false, createdAt: T('2026-06-18T12:00:00Z'), priority: 'high', linkTo: 'tasks/50' },
            { id: 'n2', event: 'task.overdue', title: 'Atrasada (de outro)', recipient: '9', senderId: '1', senderName: 'Admin', read: false, createdAt: T('2026-06-18T12:30:00Z'), priority: 'high', linkTo: 'tasks/77' },
        ]);
        m.sched.getHistory.mockReturnValue([{ id: 's1', channel: 'whatsapp', message: 'lembrete', scheduledAt: T('2026-06-18T07:00:00Z'), status: 'sent', type: 'reminder', chatId: 'c1', sessionId: 'x' }]);
        m.appr.getActionHistory.mockResolvedValue([{ id: 'p1', type: 'pagar_boleto', description: 'pagar boleto', status: 'executed', riskLevel: 'high', requestedBy: 'u2', requestedAt: new Date('2026-06-18T06:00:00Z') }]);
        m.task.getAllTasks.mockReturnValue([{ issueNumber: 42, events: [{ ts: '2026-06-18T13:00:00Z', type: 'task_failed', message: 'falhou' }, { ts: 'data-ruim', type: 'task_started', message: 'x' }] }]);
        m.delegSvc.get.mockReturnValue(undefined);
    });

    it('getAllowedSources: admin vê 7 fontes; não-admin vê 3 (agent, delegation, notification)', () => {
        expect(getAllowedSources(ADMIN)).toHaveLength(7);
        expect(getAllowedSources(USER).sort()).toEqual(['agent', 'delegation', 'notification']);
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

    it('não-admin: só vê agent (próprio), notification e delegation; nada de audit/approval/scheduler/task', async () => {
        const r = await systemEventsService.query({ user: USER });
        const sources = new Set(r.events.map(e => e.source));
        expect(sources).toEqual(new Set(['agent', 'notification', 'delegation']));
        // agent filtrado por userId=7 (não traz o g2 de outro usuário)
        expect(m.agent.getActivities).toHaveBeenCalledWith(expect.objectContaining({ userId: '7' }));
        expect(r.events.find(e => e.source === 'agent')?.actor.id).toBe('7');
    });

    it('delegação (não-admin): só das tarefas em que está envolvido — por `by`, por `to` ou por papel', async () => {
        const r = await systemEventsService.query({ user: USER, sources: ['delegation'] });
        const ids = r.events.map(e => e.entityId);
        expect(ids).toContain('50');   // by === user.id (e também é contato)
        expect(ids).toContain('60');   // to === user.id (é o destinatário) (#526)
        expect(ids).not.toContain('99'); // tarefa alheia → oculta
    });

    it('delegação: expõe o destinatário (to) em metadata p/ o front resolver o nome (#526)', async () => {
        const r = await systemEventsService.query({ user: ADMIN, sources: ['delegation'] });
        expect(r.events.find(e => e.entityId === '60')?.metadata?.to).toBe('7');
    });

    it('delegação: inclui o objetivo da delegação no metadata p/ o card', async () => {
        m.delegSvc.get.mockImplementation((id: string) => (id === '60' ? { objetivo: 'Contar bebidas' } : undefined));
        const r = await systemEventsService.query({ user: ADMIN, sources: ['delegation'] });
        expect(r.events.find(e => e.entityId === '60')?.metadata?.objetivo).toBe('Contar bebidas');
        expect(r.events.find(e => e.entityId === '99')?.metadata?.objetivo).toBeUndefined();
    });

    it('delegação (admin): vê todas as delegações, sem filtro', async () => {
        const r = await systemEventsService.query({ user: ADMIN, sources: ['delegation'] });
        expect(r.events.map(e => e.entityId).sort()).toEqual(['50', '60', '99']);
    });

    it('notification: admin usa getAll (vê de todos); não-admin usa getForUser (só as suas)', async () => {
        await systemEventsService.query({ user: ADMIN, sources: ['notification'] });
        expect(m.notif.getAll).toHaveBeenCalled();
        expect(m.notif.getForUser).not.toHaveBeenCalled();

        vi.clearAllMocks();
        m.notif.getForUser.mockReturnValue([]);
        await systemEventsService.query({ user: USER, sources: ['notification'] });
        expect(m.notif.getForUser).toHaveBeenCalledWith('7', expect.anything());
        expect(m.notif.getAll).not.toHaveBeenCalled();
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

    describe('normalização de ator (#544): nunca "unknown" nem ID cru', () => {
        it('delegação: com `by` resolvido via listUsers, actor.name é o nome (não o ID cru)', async () => {
            m.doli.listUsers.mockReturnValue([{ id: '7', login: 'u7', firstname: 'User', lastname: '7' }]);
            const r = await systemEventsService.query({ user: ADMIN, sources: ['delegation'] });
            const ev50 = r.events.find(e => e.entityId === '50');
            expect(ev50?.actor.name).toBe('User 7');
            expect(ev50?.actor.name).not.toBe('7');
        });

        it('delegação: com `by` NÃO resolvido, actor.name é "#id" (legível, nunca o cru nem "unknown")', async () => {
            // listUsers vazio (default) → by='7' não resolvido
            const r = await systemEventsService.query({ user: ADMIN, sources: ['delegation'] });
            const ev50 = r.events.find(e => e.entityId === '50');
            expect(ev50?.actor.name).toBe('#7');
            expect(ev50?.actor.name).not.toBe('7');
        });

        it('delegação: sem `by`, actor.name === "Sistema"', async () => {
            m.deleg.listAll.mockReturnValue([{ taskId: '70', type: 'reminder', at: '2026-06-18T08:00:00Z' }]);
            const r = await systemEventsService.query({ user: ADMIN, sources: ['delegation'] });
            expect(r.events[0]?.actor.name).toBe('Sistema');
        });

        it('notificação: sem senderId/senderName, actor.name === "Sistema"', async () => {
            m.notif.getAll.mockReturnValue([{ id: 'n9', event: 'custom', title: 'Sem remetente', read: false, createdAt: T('2026-06-18T12:00:00Z'), priority: 'low' }]);
            const r = await systemEventsService.query({ user: ADMIN, sources: ['notification'] });
            expect(r.events[0]?.actor.name).toBe('Sistema');
        });

        it('notificação: com senderId (sem senderName) resolve o nome via listUsers', async () => {
            m.doli.listUsers.mockReturnValue([{ id: '1', login: 'admin', firstname: 'Adm', lastname: 'Root' }]);
            m.notif.getAll.mockReturnValue([{ id: 'n9', event: 'custom', title: 'X', senderId: '1', read: false, createdAt: T('2026-06-18T12:00:00Z'), priority: 'low' }]);
            const r = await systemEventsService.query({ user: ADMIN, sources: ['notification'] });
            expect(r.events[0]?.actor.name).toBe('Adm Root');
        });

        it('agente: userName "unknown" vira "Agente" (nunca "unknown")', async () => {
            m.agent.getActivities.mockReturnValue([{ id: 'g9', userId: '', userName: 'unknown', tool: 't', action: 'a', description: 'd', result: 'success', durationMs: 1, createdAt: T('2026-06-18T11:00:00Z') }]);
            const r = await systemEventsService.query({ user: ADMIN, sources: ['agent'] });
            expect(r.events[0]?.actor.name).toBe('Agente');
        });

        it('agente: userName vazio vira "Agente"', async () => {
            m.agent.getActivities.mockReturnValue([{ id: 'g9', userId: '1', userName: '', tool: 't', action: 'a', description: 'd', result: 'success', durationMs: 1, createdAt: T('2026-06-18T11:00:00Z') }]);
            const r = await systemEventsService.query({ user: ADMIN, sources: ['agent'] });
            expect(r.events[0]?.actor.name).toBe('Agente');
        });

        it('aprovação: requestedBy "unknown" vira "Sistema"', async () => {
            m.appr.getActionHistory.mockResolvedValue([{ id: 'p9', type: 'enviar_pix', description: 'pix', status: 'executed', riskLevel: 'high', requestedBy: 'unknown', requestedAt: new Date('2026-06-18T06:00:00Z') }]);
            const r = await systemEventsService.query({ user: ADMIN, sources: ['approval'] });
            expect(r.events[0]?.actor.name).toBe('Sistema');
        });

        it('aprovação: requestedBy numérico é resolvido via listUsers (não o ID cru)', async () => {
            m.doli.listUsers.mockReturnValue([{ id: '2', login: 'fin', firstname: 'Financeiro', lastname: 'Silva' }]);
            m.appr.getActionHistory.mockResolvedValue([{ id: 'p9', type: 'enviar_pix', description: 'pix', status: 'executed', riskLevel: 'high', requestedBy: '2', requestedAt: new Date('2026-06-18T06:00:00Z') }]);
            const r = await systemEventsService.query({ user: ADMIN, sources: ['approval'] });
            expect(r.events[0]?.actor.name).toBe('Financeiro Silva');
        });

        it('auditoria: sem adminLogin, actor.name === "Sistema" (não o ID cru)', async () => {
            m.audit.list.mockReturnValue([{ id: 'a9', ts: T('2026-06-18T10:00:00Z'), adminId: '99', adminLogin: '', action: 'x', summary: 's' }]);
            const r = await systemEventsService.query({ user: ADMIN, sources: ['audit'] });
            expect(r.events[0]?.actor.name).toBe('Sistema');
        });

        it('fontes automáticas mantêm rótulos estáveis (nunca "unknown")', async () => {
            const r = await systemEventsService.query({ user: ADMIN, sources: ['scheduler', 'task'] });
            const sched = r.events.find(e => e.source === 'scheduler');
            const task = r.events.find(e => e.source === 'task');
            expect(sched?.actor.name).toBe('Agendador');
            expect(task?.actor.name).toBe('TaskRunner');
        });

        it('em todas as fontes, nenhum evento expõe "unknown" como actor.name', async () => {
            const r = await systemEventsService.query({ user: ADMIN });
            expect(r.events.every(e => e.actor.name !== 'unknown')).toBe(true);
        });
    });
});
