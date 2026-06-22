import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAxios } = vi.hoisted(() => {
    const fn = vi.fn() as any;
    fn.get = vi.fn();
    fn.put = vi.fn();
    fn.isAxiosError = vi.fn();
    return { mockAxios: fn };
});

vi.mock('axios', () => ({
    default: mockAxios,
}));

vi.mock('https', () => ({
    default: { Agent: vi.fn() },
}));

vi.mock('fs', () => ({
    default: { existsSync: vi.fn(), readFileSync: vi.fn() },
}));

vi.mock('../../../config/env', () => ({
    config: {
        dolibarrUrl: 'https://test.dolibarr.com/api/index.php/',
        dolibarrKey: 'test-api-key-1234567890',
        dolibarrBypassCookie: 'test_cookie=1',
    },
}));

import { DolibarrOperationsService } from '../../../services/dolibarr/operations';

describe('DolibarrOperationsService', () => {
    let service: DolibarrOperationsService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DolibarrOperationsService();
    });

    describe('addTimeSpent', () => {
        it('calls requestWithAuth with POST', async () => {
            mockAxios.mockResolvedValue({ data: { success: true } });
            const result = await service.addTimeSpent('1', { duration: 3600 } as any, 'user-key');
            expect(result).toEqual({ success: true });
        });

        it('usa apiKey do sistema quando sem userKey (fallback #347)', async () => {
            mockAxios.mockResolvedValue({ data: {} });
            await service.addTimeSpent('1', {} as any);
            expect(mockAxios.mock.calls[0][0].headers.DOLAPIKEY).toBe('test-api-key-1234567890');
        });
    });

    describe('delegation state (#293)', () => {
        it('setTaskDelegationState grava o estado em base64 (sobrevive ao alphanohtml do Dolibarr)', async () => {
            mockAxios.put.mockResolvedValue({ data: {} });
            const json = JSON.stringify({ taskId: '50', aceite: { status: 'accepted', by: '16' } });
            const ok = await service.setTaskDelegationState('50', json);
            expect(ok).toBe(true);
            const [url, body] = mockAxios.put.mock.calls[0];
            expect(url).toContain('tasks/50');
            const sent = body.array_options.options_delegation_state;
            expect(sent).not.toContain('"'); // sem aspas → não é destruído pela sanitização
            expect(Buffer.from(sent, 'base64').toString('utf8')).toBe(json); // round-trip exato
        });

        it('setTaskDelegationState retorna false se o PUT falha (extrafield ausente) — graceful', async () => {
            mockAxios.put.mockRejectedValue(new Error('400'));
            expect(await service.setTaskDelegationState('50', '{}')).toBe(false);
        });

        it('listDelegationStates decodifica o base64 e devolve o JSON cru', async () => {
            const json = JSON.stringify({ taskId: '77', criterio: 'x' });
            const b64 = Buffer.from(json, 'utf8').toString('base64');
            mockAxios.get.mockResolvedValue({ status: 200, data: { data: [{ task_id: '77', delegation_state: b64 }] }, headers: {} });
            const out = await service.listDelegationStates();
            expect(out).toEqual([{ taskId: '77', state: json }]);
        });

        it('listDelegationStates é best-effort: [] quando o script não está deployado', async () => {
            mockAxios.get.mockRejectedValue(new Error('404'));
            expect(await service.listDelegationStates()).toEqual([]);
        });
    });

    describe('getTicket', () => {
        it('returns ticket data when found', async () => {
            const ticket = { id: 1, subject: 'Help' };
            mockAxios.get.mockResolvedValue({ status: 200, data: ticket });
            const result = await service.getTicket('1');
            expect(result).toEqual(ticket);
        });

        it('returns null when not found', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.getTicket('999');
            expect(result).toBeNull();
        });

        it('returns null on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.getTicket('1');
            expect(result).toBeNull();
        });
    });

    describe('listProjects', () => {
        it('returns projects list', async () => {
            const projects = [{ id: 1, title: 'Proj A' }];
            mockAxios.get.mockResolvedValue({ status: 200, data: projects });
            const result = await service.listProjects();
            expect(result).toEqual(projects);
        });

        it('applies search filter on title and ref', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listProjects('proj');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.title');
            expect(params.sqlfilters).toContain('t.ref');
        });

        it('does not set sqlfilters without search', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listProjects();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listProjects();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listProjects();
            expect(result).toEqual([]);
        });
    });

    describe('listTasks', () => {
        it('returns tasks list', async () => {
            const tasks = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: tasks });
            const result = await service.listTasks();
            expect(result).toEqual(tasks);
        });

        it('filters by projectId', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listTasks('5');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.fk_projet');
        });

        it('does not set sqlfilters without projectId', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listTasks();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: {} });
            const result = await service.listTasks();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listTasks();
            expect(result).toEqual([]);
        });
    });

    describe('listTickets', () => {
        it('returns tickets list', async () => {
            const tickets = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: tickets });
            const result = await service.listTickets();
            expect(result).toEqual(tickets);
        });

        it('applies search filter on track_id, subject, message', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listTickets({ search: 'bug' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.track_id');
            expect(params.sqlfilters).toContain('t.subject');
            expect(params.sqlfilters).toContain('t.message');
        });

        it('uses custom limit', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listTickets({ limit: 20 });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.limit).toBe(20);
        });

        it('uses default limit of 5', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listTickets();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.limit).toBe(5);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listTickets();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listTickets();
            expect(result).toEqual([]);
        });
    });

    describe('listShipments', () => {
        it('returns shipments list', async () => {
            const shipments = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: shipments });
            const result = await service.listShipments();
            expect(result).toEqual(shipments);
        });

        it('applies search filter', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listShipments('SHP');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.ref');
        });

        it('does not set sqlfilters without search', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listShipments();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listShipments();
            expect(result).toEqual([]);
        });
    });

    describe('listEvents', () => {
        it('returns events list', async () => {
            const events = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: events });
            const result = await service.listEvents();
            expect(result).toEqual(events);
        });

        it('uses custom limit', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listEvents(25);
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.limit).toBe(25);
        });

        it('uses default limit of 10', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listEvents();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.limit).toBe(10);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listEvents();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listEvents();
            expect(result).toEqual([]);
        });
    });

    describe('listInterventions', () => {
        it('returns interventions list', async () => {
            const interventions = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: interventions });
            const result = await service.listInterventions();
            expect(result).toEqual(interventions);
        });

        it('applies search filter', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listInterventions('INT');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.ref');
        });

        it('does not set sqlfilters without search', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listInterventions();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: 'bad' });
            const result = await service.listInterventions();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listInterventions();
            expect(result).toEqual([]);
        });
    });

    describe('listUserTasks (#116 / auditoria)', () => {
        // A API REST do Dolibarr NÃO expõe /users/{id}/tasks. A correção usa o custom_sync.php:
        // type=tasks (fk_user_assign = projet_task.fk_user_valid) + type=task_contacts
        // (atribuições via element_contact). Resposta: { data: [...], pagination: {...} }.
        const tasks = [
            { id: 1, ref: 'T1', label: 'Tarefa A', progress: 10, fk_user_assign: '7' },
            { id: 2, ref: 'T2', label: 'Tarefa B', progress: 50, fk_user_assign: '9' },
            { id: 3, ref: 'T3', label: 'Tarefa C', progress: 0, fk_user_assign: '7' },
        ];
        // Atribuições por contato: tarefa 2 também é do usuário 7; tarefa 1 também é do usuário 9.
        const taskContacts = [
            { id: 10, task_id: 2, user_id: '7' },
            { id: 11, task_id: 1, user_id: '9' },
        ];
        const mockSync = () =>
            mockAxios.get.mockImplementation((_url: string, opts: any) => {
                const type = opts?.params?.type;
                const data = type === 'tasks' ? tasks : type === 'task_contacts' ? taskContacts : [];
                return Promise.resolve({ status: 200, data: { data, pagination: {} } });
            });

        it('não chama o endpoint inexistente users/{id}/tasks (usa custom_sync.php)', async () => {
            mockSync();
            await service.listUserTasks('7');
            const urls = mockAxios.get.mock.calls.map((c) => c[0] as string);
            expect(urls.every((u) => !/users\/\d+\/tasks/.test(u))).toBe(true);
            expect(urls.some((u) => u.includes('custom_sync.php'))).toBe(true);
        });

        it('consulta custom_sync nas fontes tasks e task_contacts', async () => {
            mockSync();
            await service.listUserTasks('7');
            const types = mockAxios.get.mock.calls.map((c) => c[1]?.params?.type);
            expect(types).toContain('tasks');
            expect(types).toContain('task_contacts');
        });

        it('inclui tarefas por responsável (fk_user_assign) E por atribuição de contato', async () => {
            mockSync();
            const result = await service.listUserTasks('7');
            // T1, T3 (fk_user_assign=7) + T2 (atribuída ao 7 via task_contacts)
            expect(result.map((t: any) => t.ref).sort()).toEqual(['T1', 'T2', 'T3']);
        });

        it('não inclui tarefas de outro usuário', async () => {
            mockSync();
            const result = await service.listUserTasks('9');
            // T2 (fk_user_assign=9) + T1 (atribuída ao 9 via task_contacts)
            expect(result.map((t: any) => t.ref).sort()).toEqual(['T1', 'T2']);
        });

        it('retorna [] em caso de erro', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            expect(await service.listUserTasks('7')).toEqual([]);
        });
    });

    describe('updateIntervention (#656)', () => {
        // A REST padrão do Dolibarr NÃO expõe PUT /interventions/{id}. A gravação
        // roda via custom_sync.php (action=update_intervention). O service PROPAGA
        // erro ({message,status}) quando falha — para o handler responder com status
        // HTTP apropriado (diferente dos outros writes best-effort que só retornam false).
        it('retorna { success: true } quando o custom_sync confirma sucesso', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: { success: true } });
            const result = await service.updateIntervention('42', { socid: '1', description: 'Editado' });
            expect(result).toEqual({ success: true });

            // grava via custom_sync.php (NÃO via REST PUT inexistente)
            const [url, opts] = mockAxios.get.mock.calls[0] as [string, any];
            expect(url).toContain('custom_sync.php');
            expect(opts.params.action).toBe('update_intervention');
            expect(opts.params.intervention_id).toBe('42');
            expect(opts.params.socid).toBe('1');
            expect(opts.params.description).toBe('Editado');
        });

        it('propaga erro com status do Dolibarr quando o custom_sync rejeita', async () => {
            mockAxios.get.mockResolvedValue({ status: 500, data: { error: 'DB down' } });
            await expect(service.updateIntervention('42', { socid: '1' })).rejects.toMatchObject({
                status: 500,
                message: 'DB down',
            });
        });

        it('responde 502 quando o custom_sync não confirma sucesso (script ausente)', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: { success: false } });
            await expect(service.updateIntervention('42', { socid: '1' })).rejects.toMatchObject({
                status: 502,
            });
        });

        it('propaga erro de rede (axios reject) como status 502/500', async () => {
            mockAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));
            // proxyCustomSync captura o reject e devolve {status:500} → service vira throw
            await expect(service.updateIntervention('42', { socid: '1' })).rejects.toMatchObject({
                status: expect.any(Number),
            });
        });
    });
});
