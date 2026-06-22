import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));

const mockFetchList = vi.fn();
vi.mock('../../services/api/core', () => ({
    fetchList: (...args: any[]) => mockFetchList(...args),
    fetchPage: vi.fn(),
    request: vi.fn(),
    getHeaders: vi.fn(),
    sanitizeUrl: (url: string) => url,
}));

import { fetchSupplierInvoices, fetchSupplierInvoiceLines } from '../../services/api/commercial';

describe('Commercial API — Supplier Invoices (#559)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('fetchSupplierInvoices', () => {
        it('maps raw supplier invoices and includes date_modification', async () => {
            mockFetchList.mockResolvedValue([
                {
                    id: '42',
                    ref: 'FA-001',
                    socid: '10',
                    fk_projet: '5',
                    label: 'Servico',
                    date: '1700000000',
                    total_ttc: '1234.50',
                    paye: '0',
                    statut: '1',
                    tms: '1700000050',
                    array_options: { x: '1' },
                },
            ]);

            const result = await fetchSupplierInvoices({ apiUrl: 'http://x', apiKey: 'k' } as any);

            expect(mockFetchList).toHaveBeenCalledWith(
                expect.anything(),
                'supplierinvoices',
                '&sortfield=t.datec&sortorder=DESC'
            );
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                id: '42',
                ref: 'FA-001',
                socid: '10',
                project_id: '5',
                total_ttc: 1234.5,
                date_modification: 1700000050,
            });
        });

        it('returns undefined date_modification when tms is missing', async () => {
            mockFetchList.mockResolvedValue([{ id: '1', ref: 'FA', socid: '1', date: '0', total_ttc: '0', paye: '0', statut: '0' }]);

            const result = await fetchSupplierInvoices({ apiUrl: 'http://x', apiKey: 'k' } as any);

            expect(result[0].date_modification).toBeUndefined();
        });
    });

    describe('fetchSupplierInvoiceLines', () => {
        it('derives lines from invoices and maps fields', async () => {
            mockFetchList.mockResolvedValue([
                {
                    id: '100',
                    tms: '1700000100',
                    lines: [
                        {
                            id: 'L1',
                            desc: 'Item A',
                            qty: '2',
                            tva_tx: '10',
                            subprice: '50',
                            total_ht: '100',
                            total_ttc: '110',
                            fk_product: '7',
                            product_ref: 'P-A',
                            product_label: 'Produto A',
                        },
                        {
                            rowid: 'L2',
                            description: 'Item B',
                            qty: '1',
                            pu_ht: '20',
                            total_ht: '20',
                            total_ttc: '22',
                        },
                    ],
                },
                {
                    id: '200',
                    tms: '1700000200',
                    lines: [],
                },
            ]);

            const result = await fetchSupplierInvoiceLines({ apiUrl: 'http://x', apiKey: 'k' } as any);

            expect(mockFetchList).toHaveBeenCalledWith(expect.anything(), 'supplierinvoices');
            expect(result).toHaveLength(2);

            expect(result[0]).toMatchObject({
                id: 'L1',
                parent_id: '100',
                label: 'Item A',
                description: 'Item A',
                qty: 2,
                vat_rate: 10,
                subprice: 50,
                total_ht: 100,
                total_ttc: 110,
                product_id: '7',
                product_ref: 'P-A',
                product_label: 'Produto A',
                date_modification: 1700000100,
            });

            expect(result[1]).toMatchObject({
                id: 'L2',
                parent_id: '100',
                label: 'Item B',
                description: 'Item B',
                qty: 1,
                vat_rate: 0,
                subprice: 20,
                date_modification: 1700000100,
            });
        });

        it('returns empty array when no invoices have lines', async () => {
            mockFetchList.mockResolvedValue([{ id: '1', lines: [] }, { id: '2', lines: undefined }]);

            const result = await fetchSupplierInvoiceLines({ apiUrl: 'http://x', apiKey: 'k' } as any);

            expect(result).toEqual([]);
        });

        it('uses parent tms as date_modification', async () => {
            mockFetchList.mockResolvedValue([
                {
                    id: '9',
                    tms: '999',
                    lines: [{ id: '1', desc: 'x', qty: '1', total_ht: '0', total_ttc: '0' }],
                },
            ]);

            const result = await fetchSupplierInvoiceLines({ apiUrl: 'http://x', apiKey: 'k' } as any);

            expect(result[0].date_modification).toBe(999);
        });
    });
});
