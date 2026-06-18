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

import { DolibarrHRService } from '../../../services/dolibarr/hr';

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
            const leaves = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: leaves });
            const result = await service.listLeaveRequests();
            expect(result).toEqual(leaves);
        });

        it('filters by approved status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests('approved');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe("(t.status:=:'3')");
        });

        it('filters by pending status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests('pending');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe("(t.status:=:'2')");
        });

        it('does not set sqlfilters without status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listLeaveRequests();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
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
