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

import { DolibarrSuppliersService } from '../../../services/dolibarr/suppliers';

describe('DolibarrSuppliersService', () => {
    let service: DolibarrSuppliersService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DolibarrSuppliersService();
    });

    describe('validateSupplierOrder', () => {
        it('calls requestWithAuth with POST', async () => {
            mockAxios.mockResolvedValue({ data: { success: true } });
            const result = await service.validateSupplierOrder('1', {} as any, 'user-key');
            expect(result).toEqual({ success: true });
        });

        it('throws when no userKey', async () => {
            await expect(service.validateSupplierOrder('1', {} as any)).rejects.toEqual(
                expect.objectContaining({ status: 401 })
            );
        });
    });

    describe('listSupplierInvoices', () => {
        it('returns supplier invoices list', async () => {
            const invoices = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: invoices });
            const result = await service.listSupplierInvoices();
            expect(result).toEqual(invoices);
        });

        it('filters by unpaid status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listSupplierInvoices('unpaid');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe('(t.fk_statut:=:1)');
        });

        it('filters by paid status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listSupplierInvoices('paid');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe('(t.fk_statut:=:2)');
        });

        it('does not set sqlfilters for unknown status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listSupplierInvoices('unknown');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listSupplierInvoices();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listSupplierInvoices();
            expect(result).toEqual([]);
        });
    });

    describe('listSupplierOrders', () => {
        it('returns supplier orders list', async () => {
            const orders = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: orders });
            const result = await service.listSupplierOrders();
            expect(result).toEqual(orders);
        });

        it('filters by draft status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listSupplierOrders('draft');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe('(t.fk_statut:=:0)');
        });

        it('filters by validated status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listSupplierOrders('validated');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBe('(t.fk_statut:=:1)');
        });

        it('does not set sqlfilters for unknown status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listSupplierOrders('unknown');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: {} });
            const result = await service.listSupplierOrders();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listSupplierOrders();
            expect(result).toEqual([]);
        });
    });
});
