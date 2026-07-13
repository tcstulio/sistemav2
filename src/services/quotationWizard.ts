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

/**
 * Estado de progresso persistido entre tentativas (#1416).
 *
 *  - `productIdsByRef` mapeia a `ref` do draft (única por produto no Dolibarr) ao
 *    productId criado — em caso de retry, NÃO recria.
 *  - `supplierIdsByName` mapeia o nome do fornecedor ao thirdPartyId criado (caso
 *    clássico de retry após cadastro parcial de fornecedor).
 *  - `processedOfferIds` lista as ofertas cujas linhas já foram adicionadas a uma
 *    Supplier Proposal — em retry, são puladas para não duplicar linhas.
 *
 * Quem chama deve persistir esse objeto entre tentativas e devolvê-lo como
 * `initialProgress` na próxima chamada. Vazio na 1ª tentativa.
 */
export interface GenerationProgress {
    productIdsByRef: Record<string, string>;
    supplierIdsByName: Record<string, string>;
    processedOfferIds: string[];
}

export interface GenerationResult {
    productsCreated: number;
    suppliersCreated: number;
    proposalsCreated: number;
    /**
     * Estado ao final da execução. Mesmo em caso de sucesso, devolvemos p/ que o
     * caller possa persistir e retomar sem duplicar.
     */
    progress: GenerationProgress;
}

const extractId = (created: any): string => String(created?.id ?? created);

/**
 * Erro lançado quando uma chamada de API falha no meio do processo. Carrega o
 * `progress` parcial para que o caller possa retomar sem recriar produtos /
 * fornecedores / linhas (#1416).
 */
export class QuotationPartialError extends Error {
    public readonly progress: GenerationProgress;
    constructor(message: string, progress: GenerationProgress) {
        super(message);
        this.name = 'QuotationPartialError';
        this.progress = progress;
    }
}

const emptyProgress = (): GenerationProgress => ({
    productIdsByRef: {},
    supplierIdsByName: {},
    processedOfferIds: [],
});

/**
 * Executa de fato a geracao de solicitacoes a partir das ofertas selecionadas:
 *   1. Cadastra produtos novos (SÓ para itens com oferta selecionada; idempotente
 *      por `ref` do draft).
 *   2. Garante o fornecedor (cadastra se for novo; idempotente por nome).
 *   3. Cria uma "Supplier Proposal" por fornecedor e adiciona as linhas (pula
 *      ofertas já processadas em chamada anterior).
 *
 * Em caso de falha em qualquer etapa, lança `QuotationPartialError` carregando
 * o `progress` parcial para que o caller possa retomar sem duplicar (#1088,
 * #1416). Lança também um `Error` "puro" se nenhum progresso foi feito (ex.:
 * falha logo na criação do primeiro produto com `selectedOffers` vazio, então
 * não havia nada a persistir).
 */
export const generateSupplierRequests = async (
    config: DolibarrConfig,
    parsedItems: ParsedItem[],
    selectedOffers: PriceOffer[],
    services: QuotationServices,
    initialProgress?: GenerationProgress,
): Promise<GenerationResult> => {
    const progress: GenerationProgress = {
        productIdsByRef: { ...(initialProgress?.productIdsByRef ?? {}) },
        supplierIdsByName: { ...(initialProgress?.supplierIdsByName ?? {}) },
        processedOfferIds: [...(initialProgress?.processedOfferIds ?? [])],
    };
    const processedOfferSet = new Set(progress.processedOfferIds);

    let productsCreated = 0;
    let suppliersCreated = 0;
    let proposalsCreated = 0;
    const productIdByItem: Record<string, string> = {};

    // ids dos itens que têm pelo menos uma oferta selecionada (#1416):
    // só cadastramos produtos novos para itens que de fato vão virar linhas.
    const selectedItemIds = new Set(selectedOffers.map((o) => o.itemId));

    try {
        // Pré-popula productIdByItem com produtos já matched (não precisam criar).
        for (const item of parsedItems) {
            if (item.matchedProduct?.id) {
                productIdByItem[item.id] = String(item.matchedProduct.id);
            }
        }

        // 1. Criar produtos novos SOMENTE para itens com oferta selecionada e que
        //    ainda não foram criados (idempotência por ref).
        for (const item of parsedItems) {
            if (productIdByItem[item.id]) continue; // matched
            if (!item.isNew || !item.productDraft) continue; // não precisa criar
            if (!selectedItemIds.has(item.id)) continue; // sem oferta selecionada

            const ref = item.productDraft.ref;
            const existingId = progress.productIdsByRef[ref];
            if (existingId) {
                productIdByItem[item.id] = existingId;
                continue;
            }

            const created = await services.createProduct(config, {
                ref: item.productDraft.ref,
                label: item.productDraft.label,
                description: item.productDraft.description,
                price: item.productDraft.price,
            });
            const productId = extractId(created);
            productIdByItem[item.id] = productId;
            progress.productIdsByRef[ref] = productId;
            productsCreated++;
        }

        // 2. Agrupar ofertas SELECIONADAS e AINDA NÃO PROCESSADAS por fornecedor.
        const pendingOffers = selectedOffers.filter((o) => !processedOfferSet.has(o.id));
        const offersBySupplier = pendingOffers.reduce((acc, offer) => {
            if (!acc[offer.supplierName]) acc[offer.supplierName] = [];
            acc[offer.supplierName].push(offer);
            return acc;
        }, {} as Record<string, PriceOffer[]>);

        // 3. Para cada fornecedor: garantir cadastro, criar proposta e adicionar linhas.
        for (const [, offers] of Object.entries(offersBySupplier)) {
            const supplierName = offers[0].supplierName;
            let supplierId: string | undefined =
                offers[0].matchedSupplier?.id ?? progress.supplierIdsByName[supplierName];

            if (!supplierId && offers[0].isNewSupplier && offers[0].supplierDraft) {
                const created = await services.createThirdParty(config, {
                    name: offers[0].supplierDraft.name,
                    email: offers[0].supplierDraft.email,
                    address: offers[0].supplierDraft.address,
                    fournisseur: '1',
                    client: '0',
                });
                supplierId = extractId(created);
                progress.supplierIdsByName[supplierName] = supplierId;
                suppliersCreated++;
            }

            if (!supplierId) continue;

            const createdProposal = await services.createSupplierProposal(config, {
                socid: supplierId,
                date: Math.floor(Date.now() / 1000),
            });
            const proposalId = extractId(createdProposal);

            for (const offer of offers) {
                const item = parsedItems.find((i) => i.id === offer.itemId);
                const line: Record<string, unknown> = {
                    qty: item?.qty || 1,
                    subprice: offer.price,
                    desc: `Cotação via Wizard: ${offer.source}`,
                };
                const productId = item ? productIdByItem[item.id] : undefined;
                if (productId) line.fk_product = productId;
                await services.addSupplierProposalLine(config, proposalId, line);
                progress.processedOfferIds.push(offer.id);
            }
            proposalsCreated++;
        }

        return {
            productsCreated,
            suppliersCreated,
            proposalsCreated,
            progress,
        };
    } catch (err) {
        // #1416 — failure no meio: devolve progresso parcial p/ retomada sem
        // duplicar. Se não houve progresso nenhum, usa Error "puro" (não temos
        // nada p/ retomar).
        const isPartial =
            Object.keys(progress.productIdsByRef).length > 0 ||
            Object.keys(progress.supplierIdsByName).length > 0 ||
            progress.processedOfferIds.length > 0;
        if (isPartial) {
            const message = err instanceof Error ? err.message : String(err);
            throw new QuotationPartialError(message, progress);
        }
        throw err;
    }
};

export { emptyProgress };