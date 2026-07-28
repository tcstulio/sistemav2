import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    generateSupplierRequests,
    ParsedItem,
    PriceOffer,
    QuotationServices,
    QuotationPartialError,
} from '../../services/quotationWizard';
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
        // #1416 — passa a devolver `progress` para que o caller possa retomar
        // sem duplicar. Mantemos o espelho dos contadores via toMatchObject.
        expect(result).toMatchObject({ productsCreated: 1, suppliersCreated: 1, proposalsCreated: 1 });
        expect(result.progress.productIdsByRef).toEqual({ 'NOTE-I7': 'prod-new' });
        expect(result.progress.supplierIdsByName).toEqual({ Kabum: 'sup-new' });
        expect(result.progress.processedOfferIds).toEqual(['o1']);
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
        // #1416 — agora só criamos produto quando há oferta selecionada.
        // Adicionamos uma oferta para que createProduct seja tentado e falhe.
        const offers: PriceOffer[] = [
            { id: 'o1', itemId: 'i1', source: 'Loja', supplierName: 'Loja', price: 10, link: '#', selected: true, isNewSupplier: false, matchedSupplier: { id: 'sx' } },
        ];

        await expect(generateSupplierRequests(config, items, offers, services)).rejects.toThrow('DOLAPIKEY invalid');
    });
});

describe('generateSupplierRequests — apenas produto para oferta selecionada (#1416)', () => {
    let services: QuotationServices;

    beforeEach(() => {
        vi.clearAllMocks();
        services = makeServices();
    });

    it('não cria produto para item isNew SEM oferta selecionada', async () => {
        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: true, productDraft: { ref: 'A', label: 'A', description: '', price: 0 } },
            { id: 'i2', rawText: 'b', productName: 'B', qty: 1, spec: '', isNew: false, matchedProduct: { id: 'p2' } },
        ];
        // só i2 tem oferta selecionada — i1 é isNew sem oferta, NÃO deve gerar produto
        const offers: PriceOffer[] = [
            { id: 'o2', itemId: 'i2', source: 'Loja', supplierName: 'Loja X', price: 10, link: '#', selected: true, isNewSupplier: false, matchedSupplier: { id: 'sx' } },
        ];

        const result = await generateSupplierRequests(config, items, offers, services);

        expect(services.createProduct).not.toHaveBeenCalled();
        expect(result.productsCreated).toBe(0);
        expect(result.progress.productIdsByRef).toEqual({});
    });

    it('cria produto SÓ para os itens com oferta selecionada (mistura)', async () => {
        // i1: novo, COM oferta selecionada → cria produto
        // i2: novo, SEM oferta selecionada → pula (sem efeito colateral no ERP)
        // i3: matched, COM oferta selecionada → reusa
        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: true, productDraft: { ref: 'A', label: 'A', description: '', price: 0 } },
            { id: 'i2', rawText: 'b', productName: 'B', qty: 1, spec: '', isNew: true, productDraft: { ref: 'B', label: 'B', description: '', price: 0 } },
            { id: 'i3', rawText: 'c', productName: 'C', qty: 1, spec: '', isNew: false, matchedProduct: { id: 'p3' } },
        ];
        services.createProduct = vi.fn().mockResolvedValueOnce({ id: 'prod-A' });

        const offers: PriceOffer[] = [
            { id: 'o1', itemId: 'i1', source: 'Loja', supplierName: 'Loja X', price: 10, link: '#', selected: true, isNewSupplier: false, matchedSupplier: { id: 'sx' } },
            { id: 'o3', itemId: 'i3', source: 'Loja', supplierName: 'Loja X', price: 20, link: '#', selected: true, isNewSupplier: false, matchedSupplier: { id: 'sx' } },
        ];

        const result = await generateSupplierRequests(config, items, offers, services);

        expect(services.createProduct).toHaveBeenCalledTimes(1);
        expect(services.createProduct).toHaveBeenCalledWith(config, expect.objectContaining({ ref: 'A' }));
        expect(result.productsCreated).toBe(1);
        // linha de i3 usa o matchedProduct existente; i2 não tem linha porque não tem oferta
        expect(services.addSupplierProposalLine).toHaveBeenCalledTimes(2);
        expect(result.progress.productIdsByRef).toEqual({ A: 'prod-A' });
    });
});

describe('generateSupplierRequests — idempotência por ref/nome/offer (#1416)', () => {
    let services: QuotationServices;

    beforeEach(() => {
        vi.clearAllMocks();
        services = makeServices();
    });

    it('não recria produto se a ref já está no initialProgress (retry)', async () => {
        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: true, productDraft: { ref: 'A', label: 'A', description: '', price: 0 } },
        ];
        const offers: PriceOffer[] = [
            { id: 'o1', itemId: 'i1', source: 'Loja', supplierName: 'Loja X', price: 10, link: '#', selected: true, isNewSupplier: false, matchedSupplier: { id: 'sx' } },
        ];

        const initialProgress = {
            productIdsByRef: { A: 'prod-already-exists' },
            supplierIdsByName: {},
            processedOfferIds: [],
        };

        const result = await generateSupplierRequests(config, items, offers, services, initialProgress);

        // createProduct NÃO é chamado (já temos o id em cache)
        expect(services.createProduct).not.toHaveBeenCalled();
        expect(result.productsCreated).toBe(0);
        // mas a linha aponta para o id reutilizado
        expect(services.addSupplierProposalLine).toHaveBeenCalledWith(config, 'prop-1', expect.objectContaining({
            fk_product: 'prod-already-exists',
        }));
        expect(result.progress.productIdsByRef).toEqual({ A: 'prod-already-exists' });
    });

    it('não recria fornecedor se o nome já está no initialProgress (retry)', async () => {
        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: false, matchedProduct: { id: 'p1' } },
        ];
        const offers: PriceOffer[] = [
            { id: 'o1', itemId: 'i1', source: 'Kabum', supplierName: 'Kabum', price: 100, link: '#', selected: true, isNewSupplier: true, supplierDraft: { name: 'Kabum', email: 'v@kabum.com' } },
        ];

        const initialProgress = {
            productIdsByRef: {},
            supplierIdsByName: { Kabum: 'sup-already-exists' },
            processedOfferIds: [],
        };

        const result = await generateSupplierRequests(config, items, offers, services, initialProgress);

        // createThirdParty NÃO é chamado
        expect(services.createThirdParty).not.toHaveBeenCalled();
        expect(result.suppliersCreated).toBe(0);
        // supplierProposal usa o id reutilizado
        expect(services.createSupplierProposal).toHaveBeenCalledWith(config, expect.objectContaining({ socid: 'sup-already-exists' }));
        expect(result.progress.supplierIdsByName).toEqual({ Kabum: 'sup-already-exists' });
    });

    it('não reprocessa ofertas já em processedOfferIds (retry sem duplicar linhas)', async () => {
        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: false, matchedProduct: { id: 'p1' } },
            { id: 'i2', rawText: 'b', productName: 'B', qty: 1, spec: '', isNew: false, matchedProduct: { id: 'p2' } },
        ];
        const offers: PriceOffer[] = [
            { id: 'o1', itemId: 'i1', source: 'Loja', supplierName: 'Loja X', price: 10, link: '#', selected: true, isNewSupplier: false, matchedSupplier: { id: 'sx' } },
            { id: 'o2', itemId: 'i2', source: 'Loja', supplierName: 'Loja X', price: 20, link: '#', selected: true, isNewSupplier: false, matchedSupplier: { id: 'sx' } },
        ];

        // o1 já foi processada antes (linha já existe na SupplierProposal).
        const initialProgress = {
            productIdsByRef: {},
            supplierIdsByName: { 'Loja X': 'sx' },
            processedOfferIds: ['o1'],
        };

        const result = await generateSupplierRequests(config, items, offers, services, initialProgress);

        // supplierProposal criado UMA vez (na retomada), linha adicionada SÓ para o2
        expect(services.createSupplierProposal).toHaveBeenCalledTimes(1);
        expect(services.addSupplierProposalLine).toHaveBeenCalledTimes(1);
        expect(services.addSupplierProposalLine).toHaveBeenCalledWith(config, 'prop-1', expect.objectContaining({
            qty: 1, subprice: 20, fk_product: 'p2',
        }));
        expect(result.progress.processedOfferIds).toEqual(['o1', 'o2']);
        expect(result.proposalsCreated).toBe(1);
    });
});

describe('generateSupplierRequests — falha parcial (#1416)', () => {
    let services: QuotationServices;

    beforeEach(() => {
        vi.clearAllMocks();
        services = makeServices();
    });

    it('cria produto, depois falha no fornecedor → QuotationPartialError com progress do produto', async () => {
        // produto criado com sucesso, fornecedor falha
        services.createProduct = vi.fn().mockResolvedValueOnce({ id: 'prod-A' });
        services.createThirdParty = vi.fn().mockRejectedValueOnce(new Error('supplier fail'));

        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: true, productDraft: { ref: 'A', label: 'A', description: '', price: 0 } },
        ];
        const offers: PriceOffer[] = [
            { id: 'o1', itemId: 'i1', source: 'Loja', supplierName: 'Loja', price: 10, link: '#', selected: true, isNewSupplier: true, supplierDraft: { name: 'Loja', email: '' } },
        ];

        let captured: unknown = null;
        try {
            await generateSupplierRequests(config, items, offers, services);
        } catch (e) {
            captured = e;
        }

        expect(captured).toBeInstanceOf(QuotationPartialError);
        const err = captured as QuotationPartialError;
        expect(err.message).toBe('supplier fail');
        // progresso parcial inclui o produto criado ANTES da falha
        expect(err.progress.productIdsByRef).toEqual({ A: 'prod-A' });
        // mas NÃO recaiu em fornecedor nem proposta
        expect(err.progress.supplierIdsByName).toEqual({});
        expect(err.progress.processedOfferIds).toEqual([]);
    });

    it('retomada com progress parcial NÃO recria produto já existente e segue de onde parou', async () => {
        // cenário: 1ª chamada criou o produto, falhou no fornecedor.
        // 2ª chamada é feita COM o progress parcial — o produto não é recriado,
        // fornecedor é criado, proposta e linhas geradas.

        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: true, productDraft: { ref: 'A', label: 'A', description: '', price: 0 } },
        ];
        const offers: PriceOffer[] = [
            { id: 'o1', itemId: 'i1', source: 'Loja', supplierName: 'Loja', price: 10, link: '#', selected: true, isNewSupplier: true, supplierDraft: { name: 'Loja', email: '' } },
        ];

        // 1ª tentativa: createProduct OK, createThirdParty falha
        services.createProduct = vi.fn().mockResolvedValueOnce({ id: 'prod-A' });
        services.createThirdParty = vi.fn().mockRejectedValueOnce(new Error('supplier fail'));

        let firstError: QuotationPartialError | null = null;
        try {
            await generateSupplierRequests(config, items, offers, services);
        } catch (e) {
            if (e instanceof QuotationPartialError) firstError = e;
        }
        expect(firstError).not.toBeNull();
        const partial = firstError!.progress;
        // contadores de mock após a 1ª tentativa
        expect(services.createProduct).toHaveBeenCalledTimes(1);
        expect(services.createThirdParty).toHaveBeenCalledTimes(1);

        // 2ª tentativa: mocks limpos (resetam p/ id novo), passa o progress parcial
        vi.clearAllMocks();
        services.createProduct = vi.fn().mockResolvedValue({ id: 'prod-A-novo' });
        services.createThirdParty = vi.fn().mockResolvedValueOnce({ id: 'sup-Loja' });
        services.createSupplierProposal = vi.fn().mockResolvedValueOnce({ id: 'prop-retry' });
        services.addSupplierProposalLine = vi.fn().mockResolvedValueOnce(undefined);

        const result = await generateSupplierRequests(config, items, offers, services, partial);

        // produto NÃO foi recriado (estava no progress)
        expect(services.createProduct).not.toHaveBeenCalled();
        // fornecedor criado (não estava no progress)
        expect(services.createThirdParty).toHaveBeenCalledTimes(1);
        // proposta e linha criadas
        expect(services.createSupplierProposal).toHaveBeenCalledTimes(1);
        expect(services.addSupplierProposalLine).toHaveBeenCalledTimes(1);
        // contadores do RESULTADO: nenhum produto/supplier "novo" — foram todos herdados
        expect(result.productsCreated).toBe(0);
        expect(result.suppliersCreated).toBe(1);
        expect(result.proposalsCreated).toBe(1);
        // linha aponta pro id reaproveitado
        expect(services.addSupplierProposalLine).toHaveBeenCalledWith(config, 'prop-retry', expect.objectContaining({
            fk_product: 'prod-A',
        }));
        // progresso final carrega ambos
        expect(result.progress.productIdsByRef).toEqual({ A: 'prod-A' });
        expect(result.progress.supplierIdsByName).toEqual({ Loja: 'sup-Loja' });
        expect(result.progress.processedOfferIds).toEqual(['o1']);
    });

    it('falha SEM progresso anterior lança Error puro (sem QuotationPartialError)', async () => {
        // 1ª chamada "verdadeira": nenhum produto/supplier/linha criado ainda
        // → falha logo no createProduct, sem nada persistido.
        services.createProduct = vi.fn().mockRejectedValueOnce(new Error('immediate fail'));

        const items: ParsedItem[] = [
            { id: 'i1', rawText: 'a', productName: 'A', qty: 1, spec: '', isNew: true, productDraft: { ref: 'A', label: 'A', description: '', price: 0 } },
        ];
        const offers: PriceOffer[] = [
            { id: 'o1', itemId: 'i1', source: 'Loja', supplierName: 'Loja', price: 10, link: '#', selected: true, isNewSupplier: false, matchedSupplier: { id: 'sx' } },
        ];

        let captured: unknown = null;
        try {
            await generateSupplierRequests(config, items, offers, services);
        } catch (e) {
            captured = e;
        }

        // Não é QuotationPartialError (sem progresso), mas ainda carrega a msg original
        expect(captured).not.toBeInstanceOf(QuotationPartialError);
        expect((captured as Error).message).toBe('immediate fail');
    });
});