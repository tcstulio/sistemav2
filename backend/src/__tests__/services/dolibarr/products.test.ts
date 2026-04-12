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

import { DolibarrProductsService } from '../../../services/dolibarr/products';

describe('DolibarrProductsService', () => {
    let service: DolibarrProductsService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DolibarrProductsService();
    });

    describe('listProducts', () => {
        it('returns products list', async () => {
            const products = [{ id: 1, ref: 'P001' }];
            mockAxios.get.mockResolvedValue({ status: 200, data: products });
            const result = await service.listProducts();
            expect(result).toEqual(products);
        });

        it('applies search filter on ref and label', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listProducts('widget');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.ref');
            expect(params.sqlfilters).toContain('t.label');
        });

        it('does not set sqlfilters without search', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listProducts();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listProducts();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listProducts();
            expect(result).toEqual([]);
        });
    });

    describe('listWarehouses', () => {
        it('returns warehouses list', async () => {
            const warehouses = [{ id: 1, label: 'Main' }];
            mockAxios.get.mockResolvedValue({ status: 200, data: warehouses });
            const result = await service.listWarehouses();
            expect(result).toEqual(warehouses);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: {} });
            const result = await service.listWarehouses();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listWarehouses();
            expect(result).toEqual([]);
        });
    });

    describe('listStockMovements', () => {
        it('returns stock movements list', async () => {
            const movements = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: movements });
            const result = await service.listStockMovements();
            expect(result).toEqual(movements);
        });

        it('filters by productId', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listStockMovements('42');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.fk_product');
            expect(params.sqlfilters).toContain('42');
        });

        it('does not set sqlfilters without productId', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listStockMovements();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: 'bad' });
            const result = await service.listStockMovements();
            expect(result).toEqual([]);
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listStockMovements();
            expect(result).toEqual([]);
        });
    });
});
