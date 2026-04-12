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

import { DolibarrManufacturingService } from '../../../services/dolibarr/manufacturing';

describe('DolibarrManufacturingService', () => {
    let service: DolibarrManufacturingService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DolibarrManufacturingService();
    });

    describe('listBOMs', () => {
        it('returns BOMs list', async () => {
            const boms = [{ id: 1, ref: 'BOM001' }];
            mockAxios.get.mockResolvedValue({ status: 200, data: boms });
            const result = await service.listBOMs();
            expect(result).toEqual(boms);
        });

        it('applies search filter', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listBOMs('BOM');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.ref');
        });

        it('does not set sqlfilters without search', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listBOMs();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listBOMs();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listBOMs();
            expect(result).toEqual([]);
        });
    });

    describe('listManufacturingOrders', () => {
        it('returns manufacturing orders list', async () => {
            const orders = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: orders });
            const result = await service.listManufacturingOrders();
            expect(result).toEqual(orders);
        });

        it('filters by draft status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listManufacturingOrders('draft');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe('(t.status:=:0)');
        });

        it('filters by validated status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listManufacturingOrders('validated');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe('(t.status:=:1)');
        });

        it('filters by inprogress status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listManufacturingOrders('inprogress');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe('(t.status:=:2)');
        });

        it('does not set sqlfilters for unknown status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listManufacturingOrders('unknown');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: {} });
            const result = await service.listManufacturingOrders();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listManufacturingOrders();
            expect(result).toEqual([]);
        });
    });
});
