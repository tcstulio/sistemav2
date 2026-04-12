import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAxios } = vi.hoisted(() => {
    const fn = vi.fn() as any;
    fn.get = vi.fn();
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

        it('throws when no userKey', async () => {
            await expect(service.addTimeSpent('1', {} as any)).rejects.toEqual(
                expect.objectContaining({ status: 401 })
            );
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
});
