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

import { DolibarrHRService, LeaveRequest } from '../../../services/dolibarr/hr';

describe('DolibarrHRService', () => {
    let service: DolibarrHRService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DolibarrHRService();
    });

    describe('listUsers', () => {
        it('returns users list', async () => {
            const users = [{ id: 1, login: 'admin' }];
            mockAxios.get.mockResolvedValue({ status: 200, data: users });
            const result = await service.listUsers();
            expect(result).toEqual(users);
        });

        it('applies search filter on firstname and lastname', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listUsers('john');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.firstname');
            expect(params.sqlfilters).toContain('t.lastname');
        });

        it('does not set sqlfilters without search', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listUsers();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listUsers();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listUsers();
            expect(result).toEqual([]);
        });
    });

    describe('findUserByLoginOrEmail', () => {
        it('returns null for empty term without calling the API', async () => {
            const result = await service.findUserByLoginOrEmail('   ');
            expect(result).toBeNull();
            expect(mockAxios.get).not.toHaveBeenCalled();
        });

        it('finds by login (exact match, case-insensitive)', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [{ id: 7, login: 'TCS', email: 'x@y.com' }] });
            const result = await service.findUserByLoginOrEmail('tcs');
            expect(result?.id).toBe(7);
            expect(mockAxios.get.mock.calls[0][1].params.sqlfilters).toContain('t.login');
        });

        it('falls back to email filter when login filter is empty', async () => {
            mockAxios.get
                .mockResolvedValueOnce({ status: 200, data: [] })
                .mockResolvedValueOnce({ status: 200, data: [{ id: 9, login: 'foo', email: 'a@b.com' }] });
            const result = await service.findUserByLoginOrEmail('a@b.com');
            expect(result?.id).toBe(9);
            expect(mockAxios.get.mock.calls[1][1].params.sqlfilters).toContain('t.email');
        });

        it('returns null when nothing matches', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            const result = await service.findUserByLoginOrEmail('ghost');
            expect(result).toBeNull();
        });

        it('returns null on API error (best-effort)', async () => {
            mockAxios.get.mockRejectedValue(new Error('boom'));
            const result = await service.findUserByLoginOrEmail('tcs');
            expect(result).toBeNull();
        });
    });

    describe('listExpenseReports', () => {
        it('returns expense reports list', async () => {
            const reports = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: reports });
            const result = await service.listExpenseReports();
            expect(result).toEqual(reports);
        });

        it('filters by approved status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listExpenseReports('approved');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe('(t.fk_statut:=:5)');
        });

        it('filters by paid status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listExpenseReports('paid');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe('(t.fk_statut:=:6)');
        });

        it('does not set sqlfilters for unknown status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listExpenseReports('unknown');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listExpenseReports();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listExpenseReports();
            expect(result).toEqual([]);
        });
    });

    describe('listLeaveRequests', () => {
        it('returns leave requests list', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [{ id: 1 }] });
            const result = await service.listLeaveRequests();
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('1');
            // type-level assertion: o retorno é LeaveRequest[] (#986)
            const _typed: LeaveRequest[] = result;
            expect(_typed).toBe(result);
        });

        it('queries the holidays endpoint (never expensereports)', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests();
            const url = mockAxios.get.mock.calls[0][0] as string;
            expect(url).toContain('/holidays');
            expect(url).not.toContain('expensereports');
        });

        it('filters by approved status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests('approved');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe("(t.statut:=:'3')");
        });

        it('filters by pending status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests('pending');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe("(t.statut:=:'2')");
        });

        it('filters by draft status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests('draft');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe("(t.statut:=:'1')");
        });

        it('filters by canceled status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests('canceled');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe("(t.statut:=:'4')");
        });

        it('filters by refused status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests('refused');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe("(t.statut:=:'5')");
        });

        it('does not set sqlfilters for unknown status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests('unknown');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('does not set sqlfilters without status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('maps raw holiday into LeaveRequest shape', async () => {
            const raw = {
                id: 42, ref: 'LV2024', fk_user: 7, date_debut: '1609459200',
                date_fin: '1609545600', fk_type: '2', statut: '3',
                description: 'Ferias', fk_validator: 9, date_create: '1609200000',
            };
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listLeaveRequests();
            expect(result[0]).toEqual({
                id: '42', ref: 'LV2024', fk_user: '7',
                date_debut: 1609459200, date_fin: 1609545600,
                halfday: undefined, type: '2', statut: '3',
                description: 'Ferias', fk_validator: '9',
                date_valid: undefined, fk_user_valid: undefined,
                date_refuse: undefined, fk_user_refuse: undefined,
                detail_refuse: undefined, detail_cancel: undefined,
                date_create: 1609200000, duration: undefined,
            });
        });

        it('does not leak ExpenseReport fields into the result', async () => {
            // Simula resposta cru do holiday trazendo campos alheios (ex: de ExpenseReport).
            const raw = {
                id: 1, ref: 'LV1', fk_user: 1, statut: '2',
                total_ttc: 99.5, fk_user_author: 5, date_paye: 123,
            };
            mockAxios.get.mockResolvedValue({ status: 200, data: [raw] });
            const result = await service.listLeaveRequests();
            expect(result[0]).not.toHaveProperty('total_ttc');
            expect(result[0]).not.toHaveProperty('fk_user_author');
            expect(result[0]).not.toHaveProperty('date_paye');
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listLeaveRequests();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listLeaveRequests();
            expect(result).toEqual([]);
        });
    });

    describe('listCandidates', () => {
        it('returns candidates list', async () => {
            const candidates = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: candidates });
            const result = await service.listCandidates();
            expect(result).toEqual(candidates);
        });

        it('applies search filter on firstname and lastname', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listCandidates('jane');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.firstname');
            expect(params.sqlfilters).toContain('t.lastname');
        });

        it('does not set sqlfilters without search', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listCandidates();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listCandidates();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listCandidates();
            expect(result).toEqual([]);
        });
    });

    describe('listJobPositions', () => {
        it('returns job positions list with onlyOpen=true', async () => {
            const positions = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: positions });
            const result = await service.listJobPositions(true);
            expect(result).toEqual(positions);
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe("(t.status:=:'1')");
        });

        it('does not set sqlfilters when onlyOpen=false', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listJobPositions(false);
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('defaults to onlyOpen=true', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listJobPositions();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe("(t.status:=:'1')");
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listJobPositions();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listJobPositions();
            expect(result).toEqual([]);
        });
    });
});
