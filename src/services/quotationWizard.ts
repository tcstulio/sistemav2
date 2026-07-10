import { DolibarrConfig, ThirdParty } from '../types';

/**
 * Item de compra interpretado pelo Assistente de Cotação Inteligente.
 * `matchedProduct` vem preenchido quando o item ja existe no Dolibarr.
 */
export interface ParsedItem {
    id: string;
    rawText: string;
    productName: string;
    qty: number;
    spec: string;
    matchedProduct?: any;
    isNew: boolean;
    productDraft?: {
        ref: string;
        label: string;
        description: string;
        price: number;
    };
}

/**
 * Oferta de preco encontrada para um item, vinculada (ou nao) a um fornecedor.
 */
export interface PriceOffer {
    id: string;
    itemId: string;
    source: string;
    supplierName: string;
    price: number;
    link: string;
    selected: boolean;
    matchedSupplier?: any;
    isNewSupplier: boolean;
    supplierDraft?: {
        name: string;
        email?: string;
        address?: string;
    };
}

/**
 * Dependencias de API injetadas para facilitar testes (DI). Em producao recebem
 * as funcoes reais de commercial/inventory.
 */
export interface QuotationServices {
    createProduct: (config: DolibarrConfig, data: Record<string, unknown>) => Promise<any>;
    createThirdParty: (config: DolibarrConfig, data: Partial<ThirdParty>) => Promise<any>;
    createSupplierProposal: (config: DolibarrConfig, data: Record<string, unknown>) => Promise<any>;
    addSupplierProposalLine: (config: DolibarrConfig, proposalId: string, data: Record<string, unknown>) => Promise<any>;
}

export interface GenerationResult {
    productsCreated: number;
    suppliersCreated: number;
    proposalsCreated: number;
}

const extractId = (created: any): string => String(created?.id ?? created);

/**
 * Executa de fato a geracao de solicitacoes a partir das ofertas selecionadas:
 *   1. Cadastra produtos novos no Dolibarr.
 *   2. Garante o fornecedor (cadastra se for novo).
 *   3. Cria uma "Supplier Proposal" por fornecedor e adiciona as linhas.
 *
 * Lanca em caso de falha de qualquer chamada — quem chama (UI) deve tratar e
 * NUNCA emitir toast de "sucesso" sem efeito real (#1088).
 */
export const generateSupplierRequests = async (
    config: DolibarrConfig,
    parsedItems: ParsedItem[],
    selectedOffers: PriceOffer[],
    services: QuotationServices,
): Promise<GenerationResult> => {
    let productsCreated = 0;
    let suppliersCreated = 0;
    let proposalsCreated = 0;

    // itemId -> productId (existente ou recem-criado), para vincular as linhas.
    const productIdByItem: Record<string, string> = {};

    // 1. Criar produtos novos e resolver os IDs.
    for (const item of parsedItems) {
        let productId: string | undefined = item.matchedProduct?.id;
        if (item.isNew && item.productDraft && !productId) {
            const created = await services.createProduct(config, {
                ref: item.productDraft.ref,
                label: item.productDraft.label,
                description: item.productDraft.description,
                price: item.productDraft.price,
            });
            productId = extractId(created);
            productsCreated++;
        }
        if (productId) productIdByItem[item.id] = productId;
    }

    // 2. Agrupar ofertas selecionadas por fornecedor.
    const offersBySupplier = selectedOffers.reduce((acc, offer) => {
        if (!acc[offer.supplierName]) acc[offer.supplierName] = [];
        acc[offer.supplierName].push(offer);
        return acc;
    }, {} as Record<string, PriceOffer[]>);

    // 3. Para cada fornecedor: garantir cadastro, criar proposta e adicionar linhas.
    for (const [, offers] of Object.entries(offersBySupplier)) {
        let supplierId: string | undefined = offers[0].matchedSupplier?.id;

        if (!supplierId && offers[0].isNewSupplier && offers[0].supplierDraft) {
            const created = await services.createThirdParty(config, {
                name: offers[0].supplierDraft.name,
                email: offers[0].supplierDraft.email,
                address: offers[0].supplierDraft.address,
                fournisseur: '1',
                client: '0',
            });
            supplierId = extractId(created);
            suppliersCreated++;
        }

        if (!supplierId) continue;

        const createdProposal = await services.createSupplierProposal(config, {
            socid: supplierId,
            date: Math.floor(Date.now() / 1000),
        });
        const proposalId = extractId(createdProposal);

        for (const offer of offers) {
            const item = parsedItems.find(i => i.id === offer.itemId);
            const line: Record<string, unknown> = {
                qty: item?.qty || 1,
                subprice: offer.price,
                desc: `Cotação via Wizard: ${offer.source}`,
            };
            const productId = item ? productIdByItem[item.id] : undefined;
            if (productId) line.fk_product = productId;
            await services.addSupplierProposalLine(config, proposalId, line);
        }
        proposalsCreated++;
    }

    return { productsCreated, suppliersCreated, proposalsCreated };
};
