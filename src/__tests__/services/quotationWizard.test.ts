import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSupplierRequests, ParsedItem, PriceOffer, QuotationServices } from '../../services/quotationWizard';
import { DolibarrConfig } from '../../types';

const config = { apiUrl: 'http://test/api', apiKey: 'key' } as DolibarrConfig;

const makeServices = () => ({
    createProduct: vi.fn().mockResolvedValue({ id: 'prod-new' }),
    createThirdParty: vi.fn().mockResolvedValue({ id: 'sup-new' }),
    createSupplierProposal: vi.fn().mockResolvedValue({ id: 'prop-1' }),
    addSupplierProposalLine: vi.fn().mockResolvedValue(undefined),
});

describe('generateSupplierRequests — real generation (#1088)', () => {
    let services: QuotationServices;

    beforeEach(() => {
        vi.clearAllMocks();
        services = makeServices();
    });

    it('creates new products, suppliers, proposals and lines (real effect)', async () => {
        const items: ParsedItem[] = [
            {
                id: 'item-1', rawText: '2x Notebook', productName: 'Notebook', qty: 2, spec: 'i7',
                isNew: true, productDraft: { ref: 'NOTE-I7', label: 'Notebook', description: 'i7', price: 0 },
            },
        ];
        const offers: PriceOffer[] = [
            {
                id: 'o1', itemId: 'item-1', source: 'Kabum', supplierName: 'Kabum', price: 4500, link: '#',
                selected: true, isNewSupplier: true, supplierDraft: { name: 'Kabum', email: 'v@kabum.com' },
            },
        ];

        const result = await generateSupplierRequests(config, items, offers, services);

        expect(services.createProduct).toHaveBeenCalledWith(config, expect.objectContaining({ ref: 'NOTE-I7', label: 'Notebook' }));
        expect(services.createThirdParty).toHaveBeenCalledWith(config, expect.objectContaining({ name: 'Kabum', fournisseur: '1', client: '0' }));
        expect(services.createSupplierProposal).toHaveBeenCalledWith(config, expect.objectContaining({ socid: 'sup-new' }));
        // line carries qty, subprice and the newly created product id
        expect(services.addSupplierProposalLine).toHaveBeenCalledWith(config, 'prop-1', expect.objectContaining({
            qty: 2, subprice: 4500, fk_product: 'prod-new',
        }));
        expect(result).toEqual({ productsCreated: 1, suppliersCreated: 1, proposalsCreated: 1 });
    });

    it('reuses existing matched product/supplier without re-creating them', async () => {
        const items: ParsedItem[] = [
            { id: 'item-1', rawText: '1x Mouse', productName: 'Mouse', qty: 1, spec: '', isNew: false, matchedProduct: { id: 'prod-exists' } },
        ];
        const offers: PriceOffer[] = [
            {
                id: 'o1', itemId: 'item-1', source: 'Amazon', supplierName: 'Amazon', price: 100, link: '#',
                selected: true, isNewSupplier: false, matchedSupplier: { id: 'sup-exists' },
            },
        ];

        const result = await generateSupplierRequests(config, items, offers, services);

        expect(services.createProduct).not.toHaveBeenCalled();
        expect(services.createThirdParty).not.toHaveBeenCalled();
        expect(services.createSupplierProposal).toHaveBeenCalledWith(config, expect.objectContaining({ socid: 'sup-exists' }));
        expect(services.addSupplierProposalLine).toHaveBeenCalledWith(config, 'prop-1', expect.objectContaining({
            fk_product: 'prod-exists', qty: 1, subprice: 100,
        }));
        expect(result.proposalsCreated).toBe(1);
        expect(result.productsCreated).toBe(0);
        expect(result.suppliersCreated).toBe(0);
    });

    it('groups multiple offers of the same supplier into a single proposal', async () => {
        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: false, matchedProduct: { id: 'p1' } },
            { id: 'i2', rawText: 'b', productName: 'B', qty: 3, spec: '', isNew: false, matchedProduct: { id: 'p2' } },
        ];
        const offers: PriceOffer[] = [
            { id: 'o1', itemId: 'i1', source: 'Loja', supplierName: 'Loja X', price: 10, link: '#', selected: true, isNewSupplier: false, matchedSupplier: { id: 'sx' } },
            { id: 'o2', itemId: 'i2', source: 'Loja', supplierName: 'Loja X', price: 20, link: '#', selected: true, isNewSupplier: false, matchedSupplier: { id: 'sx' } },
        ];

        const result = await generateSupplierRequests(config, items, offers, services);

        expect(services.createSupplierProposal).toHaveBeenCalledTimes(1);
        expect(services.addSupplierProposalLine).toHaveBeenCalledTimes(2);
        expect(result.proposalsCreated).toBe(1);
    });

    it('creates no proposals when there are no selected offers', async () => {
        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: false, matchedProduct: { id: 'p1' } },
        ];
        const offers: PriceOffer[] = [];

        const result = await generateSupplierRequests(config, items, offers, services);

        expect(services.createSupplierProposal).not.toHaveBeenCalled();
        expect(result.proposalsCreated).toBe(0);
    });

    it('throws when a backend call fails (so the UI shows an error, never a false success)', async () => {
        services.createProduct = vi.fn().mockRejectedValue(new Error('DOLAPIKEY invalid'));

        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: true, productDraft: { ref: 'A', label: 'A', description: '', price: 0 } },
        ];
        const offers: PriceOffer[] = [];

        await expect(generateSupplierRequests(config, items, offers, services)).rejects.toThrow('DOLAPIKEY invalid');
    });
});
