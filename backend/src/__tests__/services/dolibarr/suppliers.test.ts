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

        it('usa apiKey do sistema quando sem userKey (fallback #347)', async () => {
            mockAxios.mockResolvedValue({ data: {} });
            await service.validateSupplierOrder('1', {} as any);
            expect(mockAxios.mock.calls[0][0].headers.DOLAPIKEY).toBe('test-api-key-1234567890');
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

        it('propaga erro (5xx/timeout/rede) — NÃO devolve [] silenciosamente (#1352)', async () => {
            mockAxios.get.mockRejectedValue(new Error('Network Error'));
            await expect(service.listSupplierInvoices()).rejects.toThrow('Network Error');
        });

        it('retorna [] em 404 — Dolibarr não encontrou nada (#1352)', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.listSupplierInvoices();
            expect(result).toEqual([]);
        });

        it('propaga erro 5xx do Dolibarr (não confunde com "não existe") (#1352)', async () => {
            // Simula o que o axios real faria com validateStatus: (s) => s === 200 || s === 404:
            // status 500 cai FORA de validateStatus → axios joga erro com response.status=500.
            const axiosErr = Object.assign(new Error('Request failed with status code 500'), {
                isAxiosError: true,
                response: { status: 500, data: { error: { message: 'DB down' } } },
            });
            mockAxios.get.mockRejectedValue(axiosErr);
            await expect(service.listSupplierInvoices()).rejects.toBeDefined();
        });

        it('aceita 404 em validateStatus (axios NÃO joga) (#1352)', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listSupplierInvoices();
            const cfg = mockAxios.get.mock.calls[0][1];
            expect(cfg.validateStatus(200)).toBe(true);
            expect(cfg.validateStatus(404)).toBe(true);
            expect(cfg.validateStatus(500)).toBe(false);
            expect(cfg.validateStatus(401)).toBe(false);
            expect(cfg.validateStatus(403)).toBe(false);
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

        it('propaga erro (5xx/timeout/rede) — NÃO devolve [] silenciosamente (#1352)', async () => {
            mockAxios.get.mockRejectedValue(new Error('Network Error'));
            await expect(service.listSupplierOrders()).rejects.toThrow('Network Error');
        });

        it('retorna [] em 404 — Dolibarr não encontrou nada (#1352)', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.listSupplierOrders();
            expect(result).toEqual([]);
        });

        it('propaga erro 5xx do Dolibarr (não confunde com "não existe") (#1352)', async () => {
            const axiosErr = Object.assign(new Error('Request failed with status code 500'), {
                isAxiosError: true,
                response: { status: 500, data: { error: { message: 'DB down' } } },
            });
            mockAxios.get.mockRejectedValue(axiosErr);
            await expect(service.listSupplierOrders()).rejects.toBeDefined();
        });

        it('aceita 404 em validateStatus (axios NÃO joga) (#1352)', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listSupplierOrders();
            const cfg = mockAxios.get.mock.calls[0][1];
            expect(cfg.validateStatus(200)).toBe(true);
            expect(cfg.validateStatus(404)).toBe(true);
            expect(cfg.validateStatus(500)).toBe(false);
            expect(cfg.validateStatus(401)).toBe(false);
            expect(cfg.validateStatus(403)).toBe(false);
        });
    });
});
