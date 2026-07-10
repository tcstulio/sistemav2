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

import {
    systemEventsService,
    getAllowedSources,
    recordWorkerExecution,
    withExecutionTracking,
    workerExecutions,
    WORKER_RING_BUFFER_CAP,
} from '../../services/systemEventsService';

const T = (iso: string) => new Date(iso).getTime();
const ADMIN = { id: '1', login: 'admin', name: 'Admin', isAdmin: true };
const USER = { id: '7', login: 'u7', name: 'User 7', isAdmin: false };

describe('systemEventsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // micro-cache do índice de tarefa→usuários e de nomes persistem entre testes; zera p/ isolar.
        (systemEventsService as any).taskUserIndexCache = null;
        (systemEventsService as any).userNameCache = null;
        // ring-buffer de worker é singleton de módulo; zera p/ isolar cada teste (#1224).
        workerExecutions.clear();
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

    describe('worker execution tracking (#1224)', () => {
        it('recordWorkerExecution: insere e fica recuperável via list()', () => {
            const rec = recordWorkerExecution('opencode', 'success', 'concluído');
            expect(rec.id).toMatch(/^worker_\d+$/);
            expect(rec.source).toBe('opencode');
            expect(rec.status).toBe('success');
            expect(rec.summary).toBe('concluído');
            const all = workerExecutions.list();
            expect(all).toHaveLength(1);
            expect(all[0]).toEqual(rec);
        });

        it('timestamp é gerado internamente (ISO), respeitando o "agora"', () => {
            const before = Date.now();
            const rec = recordWorkerExecution('claude-cli', 'running');
            const after = Date.now();
            const ts = Date.parse(rec.startedAt);
            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
            expect(rec.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
        });

        it('status running não preenche endedAt; status terminal preenche endedAt', () => {
            const running = recordWorkerExecution('x', 'running');
            expect(running.endedAt).toBeUndefined();
            const done = recordWorkerExecution('x', 'success');
            expect(done.endedAt).toBeDefined();
            const err = recordWorkerExecution('x', 'error', 'boom', 'detalhe');
            expect(err.endedAt).toBeDefined();
            expect(err.error).toBe('detalhe');
            const to = recordWorkerExecution('x', 'timeout', 'lento', 'deadline');
            expect(to.error).toBe('deadline');
        });

        it('ring-buffer respeita o cap por overflow (FIFO descarta as mais antigas)', () => {
            const N = WORKER_RING_BUFFER_CAP + 25; // excede em 25
            for (let i = 0; i < N; i++) {
                recordWorkerExecution('src', 'success', `job-${i}`);
            }
            expect(workerExecutions.size()).toBe(WORKER_RING_BUFFER_CAP);
            const all = workerExecutions.list();
            // as mais antigas (job-0..job-(N-cap-1)) foram descartadas; restam job-(N-cap)..job-(N-1)
            expect(all).toHaveLength(WORKER_RING_BUFFER_CAP);
            expect(all[0].summary).toBe(`job-${N - WORKER_RING_BUFFER_CAP}`);
            expect(all[all.length - 1].summary).toBe(`job-${N - 1}`);
        });

        it('recuperação: após overflow, list() devolve as mais recentes íntegras (sem corromper)', () => {
            for (let i = 0; i < WORKER_RING_BUFFER_CAP + 5; i++) {
                recordWorkerExecution('r', 'success');
            }
            const all = workerExecutions.list();
            expect(all).toHaveLength(WORKER_RING_BUFFER_CAP);
            // ids únicos e sequenciais (nenhum duplicado/corrompido pelo overflow)
            const ids = new Set(all.map(r => r.id));
            expect(ids.size).toBe(WORKER_RING_BUFFER_CAP);
            // ordenação respeita a inserção (FIFO)
            for (let i = 1; i < all.length; i++) {
                expect(all[i].id > all[i - 1].id).toBe(true);
            }
        });

        it('list(limit) retorna só as `limit` mais recentes', () => {
            for (let i = 0; i < 10; i++) recordWorkerExecution('s', 'success', `j${i}`);
            const last3 = workerExecutions.list(3);
            expect(last3).toHaveLength(3);
            expect(last3[0].summary).toBe('j7');
            expect(last3[2].summary).toBe('j9');
        });

        it('clear zera o buffer', () => {
            recordWorkerExecution('s', 'success');
            expect(workerExecutions.size()).toBe(1);
            workerExecutions.clear();
            expect(workerExecutions.size()).toBe(0);
            expect(workerExecutions.list()).toEqual([]);
        });

        it('withExecutionTracking: registra sucesso ao concluir sem erro', async () => {
            const val = await withExecutionTracking('opencode', async () => 42, 'calc');
            expect(val).toBe(42);
            const all = workerExecutions.list();
            expect(all).toHaveLength(1);
            expect(all[0].status).toBe('success');
            expect(all[0].source).toBe('opencode');
            expect(all[0].summary).toBe('calc');
            expect(all[0].endedAt).toBeDefined();
            expect(all[0].durationMs).toBeGreaterThanOrEqual(0);
            expect(all[0].error).toBeUndefined();
        });

        it('withExecutionTracking: registra erro e re-rejeita (não engole a exceção)', async () => {
            const fn = async () => { throw new Error('kaboom'); };
            await expect(withExecutionTracking('claude-cli', fn, 'falhou')).rejects.toThrow('kaboom');
            const all = workerExecutions.list();
            expect(all).toHaveLength(1);
            expect(all[0].status).toBe('error');
            expect(all[0].error).toBe('kaboom');
            expect(all[0].endedAt).toBeDefined();
        });

        it('aggregator: execuções de worker aparecem sob a fonte scheduler (mescladas, #1224)', async () => {
            recordWorkerExecution('opencode', 'success', 'build ok');
            recordWorkerExecution('claude-cli', 'error', 'build fail', 'exit 1');
            const r = await systemEventsService.query({ user: ADMIN, sources: ['scheduler'] });
            const workers = r.events.filter(e => e.type.startsWith('worker_'));
            expect(workers).toHaveLength(2);
            // decisão #1224: source reaproveitada = scheduler (não 'worker')
            expect(workers.every(e => e.source === 'scheduler')).toBe(true);
            const err = workers.find(e => e.type === 'worker_claude-cli')!;
            expect(err.severity).toBe('error');
            expect(err.metadata?.error).toBe('exit 1');
            expect(err.metadata?.workerSource).toBe('claude-cli');
            expect(err.description).toContain('exit 1');
            const ok = workers.find(e => e.type === 'worker_opencode')!;
            expect(ok.description).toContain('build ok');
            expect(ok.actor.name).toBe('Worker');
            expect(ok.severity).toBe('info');
        });

        it('aggregator: o feed scheduler original permanece junto com os workers', async () => {
            // scheduler mock (beforeEach) retorna 1 evento s1
            recordWorkerExecution('opencode', 'success', 'x');
            const r = await systemEventsService.query({ user: ADMIN, sources: ['scheduler'] });
            expect(r.events.find(e => e.id === 'sched_s1')).toBeDefined();
            expect(r.events.find(e => e.id.startsWith('worker_'))).toBeDefined();
        });

        it('aggregator: sem worker executions, o feed scheduler é idêntico ao de antes', async () => {
            const r = await systemEventsService.query({ user: ADMIN, sources: ['scheduler'] });
            expect(r.events).toHaveLength(1);
            expect(r.events[0].actor.name).toBe('Agendador');
        });
    });
});
