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

import { DolibarrCommercialService } from '../../../services/dolibarr/commercial';

describe('DolibarrCommercialService', () => {
    let service: DolibarrCommercialService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DolibarrCommercialService();
    });

    describe('createInvoice', () => {
        it('calls requestWithAuth with POST', async () => {
            mockAxios.mockResolvedValue({ data: 1 });
            const result = await service.createInvoice({ socid: 1 } as any, 'user-key');
            expect(result).toBe(1);
        });

        it('usa apiKey do sistema quando sem userKey (fallback #347)', async () => {
            mockAxios.mockResolvedValue({ data: 1 });
            await service.createInvoice({ socid: 1 } as any);
            expect(mockAxios.mock.calls[0][0].headers.DOLAPIKEY).toBe('test-api-key-1234567890');
        });
    });

    describe('closeProposal', () => {
        it('calls requestWithAuth with POST', async () => {
            mockAxios.mockResolvedValue({ data: { success: true } });
            const result = await service.closeProposal('1', { status: 'signed' } as any, 'user-key');
            expect(result).toEqual({ success: true });
        });

        it('usa apiKey do sistema quando sem userKey (fallback #347)', async () => {
            mockAxios.mockResolvedValue({ data: { success: true } });
            await service.closeProposal('1', {} as any);
            expect(mockAxios.mock.calls[0][0].headers.DOLAPIKEY).toBe('test-api-key-1234567890');
        });
    });

    // #1358: o /validate do Dolibarr exige notrigger:int no body — sem ele, HTTP 400.
    describe('validate* — envia notrigger no body (#1358)', () => {
        for (const [method, id] of [['validateInvoice', '50'], ['validateOrder', '11'], ['validateProposal', '303']] as const) {
            it(`${method} POSTa { notrigger: 0 } (senão o Dolibarr rejeita)`, async () => {
                mockAxios.mockResolvedValue({ data: { id } });
                await (service as any)[method](id, 'user-key');
                const cfg = mockAxios.mock.calls[0][0];
                expect(cfg.method).toBe('POST');
                expect(cfg.url).toContain('/validate');
                expect(cfg.data).toEqual({ notrigger: 0 });
                expect(cfg.headers.DOLAPIKEY).toBe('user-key');
            });
        }
        it('valida com a apiKey do sistema quando sem userKey (autoria via HITL cai no fallback)', async () => {
            mockAxios.mockResolvedValue({ data: { id: '303' } });
            await service.validateProposal('303');
            expect(mockAxios.mock.calls[0][0].headers.DOLAPIKEY).toBe('test-api-key-1234567890');
        });
    });

    describe('getInvoice', () => {
        it('returns invoice data when found', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: { id: 1, ref: 'INV001' } });
            const result = await service.getInvoice('1');
            expect(result).toEqual({ id: 1, ref: 'INV001' });
        });

        it('returns null when not found (404)', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.getInvoice('999');
            expect(result).toBeNull();
        });

        it('returns null on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('network error'));
            const result = await service.getInvoice('1');
            expect(result).toBeNull();
        });
    });

    describe('getOrder', () => {
        it('returns order data when found', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: { id: 1, ref: 'ORD001' } });
            const result = await service.getOrder('1');
            expect(result).toEqual({ id: 1, ref: 'ORD001' });
        });

        it('returns null when not found', async () => {
            mockAxios.get.mockResolvedValue({ status: 404, data: null });
            const result = await service.getOrder('999');
            expect(result).toBeNull();
        });

        it('returns null on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.getOrder('1');
            expect(result).toBeNull();
        });
    });

    describe('listInvoices', () => {
        it('returns invoices list', async () => {
            const invoices = [{ id: 1 }, { id: 2 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: invoices });
            const result = await service.listInvoices();
            expect(result).toEqual(invoices);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: 'not array' });
            const result = await service.listInvoices();
            expect(result).toEqual([]);
        });

        it('filters by unpaid status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listInvoices({ status: 'unpaid' });
            expect(mockAxios.get).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    params: expect.objectContaining({
                        sqlfilters: '(t.paye:=:0) and (t.fk_statut:>:0)',
                    }),
                })
            );
        });

        it('filters by paid status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listInvoices({ status: 'paid' });
            expect(mockAxios.get).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    params: expect.objectContaining({
                        sqlfilters: '(t.paye:=:1)',
                    }),
                })
            );
        });

        it('filters by draft status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listInvoices({ status: 'draft' });
            expect(mockAxios.get).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    params: expect.objectContaining({
                        sqlfilters: '(t.fk_statut:=:0)',
                    }),
                })
            );
        });

        it('filtra por texto (ref/ref_client) — #1340: sem isto o search retornava dump global', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listInvoices({ search: 'PROV303' });
            const passed = (mockAxios.get as any).mock.calls[0][1].params.sqlfilters as string;
            expect(passed).toContain('t.ref');
            expect(passed).toContain('t.ref_client');
            expect(passed).toContain('PROV303');
        });

        it('combina status + busca de texto com AND', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listInvoices({ status: 'unpaid', search: 'X' });
            const passed = (mockAxios.get as any).mock.calls[0][1].params.sqlfilters as string;
            expect(passed).toContain('t.paye:=:0');
            expect(passed).toContain('t.ref');
            expect(passed).toContain(' and ');
        });

        it('SEM busca nem status → sqlfilters undefined (não injeta filtro fantasma)', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listInvoices({});
            expect((mockAxios.get as any).mock.calls[0][1].params.sqlfilters).toBeUndefined();
        });

        it('uses custom limit', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listInvoices({ limit: 20 });
            expect(mockAxios.get).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    params: expect.objectContaining({ limit: 20 }),
                })
            );
        });

        it('uses default limit of 5', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listInvoices();
            expect(mockAxios.get).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    params: expect.objectContaining({ limit: 5 }),
                })
            );
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listInvoices();
            expect(result).toEqual([]);
        });
    });

    describe('listOrders', () => {
        it('returns orders list', async () => {
            const orders = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: orders });
            const result = await service.listOrders();
            expect(result).toEqual(orders);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: null });
            const result = await service.listOrders();
            expect(result).toEqual([]);
        });

        it('filters by draft status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listOrders({ status: 'draft' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('(t.fk_statut:=:0)');
        });

        it('filters by validated status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listOrders({ status: 'validated' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('(t.fk_statut:=:1)');
        });

        it('filters by processed status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listOrders({ status: 'processed' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('(t.fk_statut:>=:2)');
        });

        it('applies search filter', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listOrders({ search: 'ORD' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.ref');
            expect(params.sqlfilters).toContain('t.ref_client');
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listOrders();
            expect(result).toEqual([]);
        });
    });

    describe('listProposals', () => {
        it('returns proposals list', async () => {
            const proposals = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: proposals });
            const result = await service.listProposals();
            expect(result).toEqual(proposals);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: {} });
            const result = await service.listProposals();
            expect(result).toEqual([]);
        });

        it('filters by draft status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listProposals({ status: 'draft' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('(t.fk_statut:=:0)');
        });

        it('filters by open status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listProposals({ status: 'open' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('(t.fk_statut:=:1)');
        });

        it('filters by signed status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listProposals({ status: 'signed' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('(t.fk_statut:=:2)');
        });

        it('applies search filter with status filter combined', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listProposals({ status: 'draft', search: 'test' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('and');
            expect(params.sqlfilters).toContain('t.ref');
        });

        it('applies search filter without status', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listProposals({ search: 'test' });
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.ref');
            expect(params.sqlfilters).not.toContain('undefined');
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listProposals();
            expect(result).toEqual([]);
        });
    });

    describe('listContracts', () => {
        it('returns contracts list', async () => {
            const contracts = [{ id: 1 }];
            mockAxios.get.mockResolvedValue({ status: 200, data: contracts });
            const result = await service.listContracts();
            expect(result).toEqual(contracts);
        });

        it('returns empty array when response is not array', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: 'bad' });
            const result = await service.listContracts();
            expect(result).toEqual([]);
        });

        it('applies search filter', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listContracts('CTR');
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toContain('t.ref');
        });

        it('does not set sqlfilters without search', async () => {
            mockAxios.get.mockResolvedValue({ status: 200, data: [] });
            await service.listContracts();
            const params = mockAxios.get.mock.calls[0][1].params;
            expect(params.sqlfilters).toBeUndefined();
        });

        it('returns empty array on error', async () => {
            mockAxios.get.mockRejectedValue(new Error('fail'));
            const result = await service.listContracts();
            expect(result).toEqual([]);
        });
    });
});
