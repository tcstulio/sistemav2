
import { SimulationState, DualSimulationResult, FinancialResult, CostItem, EventModel, GlobalConfig, CalculationResult, ExtratoItem, Partner, ClientProposalState } from './types';
import { logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/formatUtils';

const log = logger.child('SimulatorUtils');

export const money = (val: number) => {
    return formatCurrency(val || 0);
};

export const percent = (val: number) => `${val.toFixed(0)}%`;

export const generateShareableLink = (state: ClientProposalState): string => {
    try {
        const json = JSON.stringify(state);
        return btoa(encodeURIComponent(json));
    } catch (e) {
        log.error("Error generating shareable link", e);
        return "";
    }
};

export const calculateDualSimulation = (state: SimulationState): DualSimulationResult => {
    const {
        publico, ticketMedio, consumoBar, custoOpenBarPax, cmvBarPercent,
        impostosTicket, impostosBar, impostosBuffet, impostosAluguel,
        aluguelFixo, partners, extraCosts,
        temOpenBar, temBuffet, precoBuffet, custoBuffet,
        aluguelMode, aluguelPercentual = 0
    } = state;

    // Use buffet tax rate if defined, otherwise fall back to bar rate
    const effectiveBuffetTax = impostosBuffet ?? impostosBar;

    const extrato: ExtratoItem[] = [];

    // --- 1. RECEITAS BRUTAS ---
    const grossTicket = publico * ticketMedio;
    if (grossTicket > 0) extrato.push({ item: 'Bilheteria Total (Bruto)', valor: grossTicket, tipo: 'receita' });

    let grossBar = 0;
    if (!temOpenBar) {
        grossBar = publico * consumoBar;
        if (grossBar > 0) extrato.push({ item: 'Venda Bar (Bruto)', valor: grossBar, tipo: 'receita' });
    }

    const grossBuffet = temBuffet ? publico * precoBuffet : 0;
    if (grossBuffet > 0) extrato.push({ item: 'Serviço Buffet (Bruto)', valor: grossBuffet, tipo: 'receita' });

    // --- 2. DEDUÇÕES (IMPOSTOS) ---
    const taxTicketVal = grossTicket * (impostosTicket / 100);
    const taxBarVal = grossBar * (impostosBar / 100);
    const taxBuffetVal = grossBuffet * (effectiveBuffetTax / 100);

    if (taxTicketVal > 0) extrato.push({ item: `(-) Taxas Bilheteria (${impostosTicket}%)`, valor: -taxTicketVal, tipo: 'deducao' });
    if (taxBarVal > 0) extrato.push({ item: `(-) Impostos Bar (${impostosBar}%)`, valor: -taxBarVal, tipo: 'deducao' });
    if (taxBuffetVal > 0) extrato.push({ item: `(-) Impostos Buffet (${effectiveBuffetTax}%)`, valor: -taxBuffetVal, tipo: 'deducao' });

    const netTicket = grossTicket - taxTicketVal;
    const netBar = grossBar - taxBarVal;
    const netBuffet = grossBuffet - taxBuffetVal;

    // --- 3. CUSTOS VARIÁVEIS DE PRODUTO (CMV/INSUMOS) ---
    let totalBarCost = 0;
    if (temOpenBar) {
        totalBarCost = publico * custoOpenBarPax;
    } else {
        totalBarCost = grossBar * cmvBarPercent;
    }

    if (totalBarCost > 0) extrato.push({ item: '(-) Custo Bebida (CMV)', valor: -totalBarCost, tipo: 'custo' });

    let totalBuffetCost = temBuffet ? publico * custoBuffet : 0;
    if (totalBuffetCost > 0) extrato.push({ item: '(-) Insumos Buffet', valor: -totalBuffetCost, tipo: 'custo' });

    // --- 4. LOGICA DE DIVISÃO DE BILHETERIA (ENTITY ATTRIBUTION) ---

    // Total points allocated to external partners
    const totalPartnerPoints = partners.reduce((sum, p) => sum + p.splitTicket, 0);

    // The house's share comes from two places:
    // A. Their agreed split percentage (aluguelPercentual)
    // B. Anything not allocated to anyone (100 - house - partners)
    const houseTicketPoints = aluguelPercentual;
    const unallocatedPoints = Math.max(0, 100 - houseTicketPoints - totalPartnerPoints);
    const totalHouseTicketPoints = houseTicketPoints + unallocatedPoints;

    // INITIAL RESULTS FOR HOUSE
    const venueRes: FinancialResult = { label: 'Casa (Venue)', grossRevenue: 0, netRevenue: 0, costs: 0, profit: 0, roi: 0, breakEven: 0, items: [] };

    const addItem = (res: FinancialResult, label: string, value: number, type: 'revenue' | 'cost' | 'neutral') => {
        if (Math.abs(value) < 0.01) return;
        res.items.push({ label, value, type });
        if (type === 'revenue') {
            res.grossRevenue += value;
            res.netRevenue += value;
        } else if (type === 'cost') {
            res.costs += Math.abs(value);
        }
    };

    // Base Ticket Revenue for House
    const houseBaseTicketRevenue = netTicket * (totalHouseTicketPoints / 100);
    addItem(venueRes, `Bilheteria (Parte Casa ${totalHouseTicketPoints}%)`, houseBaseTicketRevenue, 'revenue');

    // ADJUSTMENT FOR MINIMUMS (RENT / HYBRID)
    // We calculate what the house *should* have received based on the Rent/Split agreement
    let targetVenueRevenue = 0;
    if (aluguelMode === 'fixo') {
        targetVenueRevenue = aluguelFixo;
    } else if (aluguelMode === 'percentual') {
        targetVenueRevenue = netTicket * (aluguelPercentual / 100);
    } else if (aluguelMode === 'hibrido') {
        targetVenueRevenue = Math.max(aluguelFixo, netTicket * (aluguelPercentual / 100));
    }

    // The actual revenue the house gets specifically from the AGREEMENT portion (aluguelPercentual share)
    const houseAgreementRevenue = netTicket * (aluguelPercentual / 100);

    // If target (Fixed or Hybrid Min) is higher than the Split share, 
    // the partners must pay the difference to the house.
    const rentAdjustment = Math.max(0, targetVenueRevenue - houseAgreementRevenue);

    if (rentAdjustment > 0) {
        const label = aluguelMode === 'hibrido' ? 'Ajuste Híbrido (Mínimo Garantido)' : 'Ajuste Aluguel Fixo';
        addItem(venueRes, label, rentAdjustment, 'revenue');
        extrato.push({ item: label, valor: 0, tipo: 'informativo' });
    }

    // --- 5. ATRIBUIÇÃO DE BAR & BUFFET PARA A CASA ---
    const totalPartnerBarSplit = partners.reduce((sum, p) => sum + p.splitBar, 0);
    const venueBarShare = Math.max(0, 100 - totalPartnerBarSplit) / 100;

    // Buffet split calculation (similar to bar)
    const totalPartnerBuffetSplit = partners.reduce((sum, p) => sum + (p.splitBuffet || 0), 0);
    const venueBuffetShare = Math.max(0, 100 - totalPartnerBuffetSplit) / 100;

    addItem(venueRes, `Venda Bar (Casa ${percent(venueBarShare * 100)})`, netBar * venueBarShare, 'revenue');
    addItem(venueRes, `Venda Buffet (Casa ${percent(venueBuffetShare * 100)})`, netBuffet * venueBuffetShare, 'revenue');

    // Taxes on venue's own rent/split revenue (if applicable)
    if (targetVenueRevenue > 0 && impostosAluguel > 0) {
        const taxRentVal = targetVenueRevenue * (impostosAluguel / 100);
        addItem(venueRes, `(-) Imposto s/ Locação (${impostosAluguel}%)`, -taxRentVal, 'cost');
    }

    // CMV for House
    addItem(venueRes, 'Custo Variável Bar (Proporcional)', -totalBarCost * venueBarShare, 'cost');
    addItem(venueRes, 'Custo Variável Buffet (Proporcional)', -totalBuffetCost * venueBuffetShare, 'cost');

    // --- 6. ATRIBUIÇÃO PARA PARCEIROS ---
    const partnersResMap: Record<string, FinancialResult> = {};

    partners.forEach(p => {
        const pRes: FinancialResult = { label: p.name, grossRevenue: 0, netRevenue: 0, costs: 0, profit: 0, roi: 0, breakEven: 0, items: [] };

        // Revenue from their point share
        const pTicketRevenue = netTicket * (p.splitTicket / 100);
        addItem(pRes, `Bilheteria (${p.splitTicket}%)`, pTicketRevenue, 'revenue');

        // Subtraction for Rent Adjustment (Proportional to their ticket share among partners)
        if (rentAdjustment > 0 && totalPartnerPoints > 0) {
            const pRentShare = p.splitTicket / totalPartnerPoints;
            addItem(pRes, `(-) Ajuste Aluguel/Mínimo`, -rentAdjustment * pRentShare, 'cost');
        }

        // Bar Share
        const pBarShare = p.splitBar / 100;
        if (pBarShare > 0) {
            addItem(pRes, `Venda Bar (${p.splitBar}%)`, netBar * pBarShare, 'revenue');
            addItem(pRes, 'Custo Variável Bar', -totalBarCost * pBarShare, 'cost');
        }

        // Buffet Share
        const pBuffetShare = (p.splitBuffet || 0) / 100;
        if (pBuffetShare > 0) {
            addItem(pRes, `Venda Buffet (${p.splitBuffet}%)`, netBuffet * pBuffetShare, 'revenue');
            addItem(pRes, 'Custo Variável Buffet', -totalBuffetCost * pBuffetShare, 'cost');
        }

        partnersResMap[p.id] = pRes;
    });

    // --- 7. CUSTOS EXTRAS ---
    extraCosts.forEach(c => {
        const owner = c.owner || c.responsavel || 'venue';
        const valAmount = c.valor !== undefined ? c.valor : (c.amount || 0);
        const mode = c.mode || c.type || 'fixed';

        let totalVal = 0;
        let note = '';

        if (mode === 'step') {
            const units = Math.max(c.minUnits || 1, Math.ceil(publico / (c.stepSize || 100)));
            totalVal = units * valAmount;
        } else if (mode === 'min_pax') {
            const calculated = valAmount * publico;
            if ((c.minTotalValue || 0) > calculated) {
                totalVal = c.minTotalValue || 0;
                note = ' (Mínimo Ativado)';
            } else {
                totalVal = calculated;
            }
        } else {
            totalVal = mode === 'fixed' ? valAmount : valAmount * publico;
        }

        if (totalVal <= 0) return;

        const itemName = (c.item || c.name || 'Custo Extra') + note;

        if (owner === 'custom' && c.customSplits) {
            Object.entries(c.customSplits).forEach(([id, percentage]) => {
                if (percentage <= 0) return;
                const costShare = totalVal * (percentage / 100);
                if (id === 'venue' || id === 'casa') addItem(venueRes, `${itemName} (${percentage}%)`, -costShare, 'cost');
                else if (partnersResMap[id]) addItem(partnersResMap[id], `${itemName} (${percentage}%)`, -costShare, 'cost');
            });
            extrato.push({ item: `${itemName} (Rateio Personalizado)`, valor: -totalVal, tipo: 'custo' });
        } else if (owner === 'venue' || owner === 'casa') {
            addItem(venueRes, itemName, -totalVal, 'cost');
            extrato.push({ item: `${itemName} (Casa)`, valor: -totalVal, tipo: 'custo' });
        } else if (owner === 'shared') {
            const venuePct = (c.shareVenue ?? 50) / 100;
            const partnerPct = 1 - venuePct;
            const partnerId = c.sharedWith;

            if (venuePct > 0) addItem(venueRes, `${itemName} (Casa ${c.shareVenue}%)`, -totalVal * venuePct, 'cost');
            if (partnerPct > 0) {
                if (partnerId && partnersResMap[partnerId]) {
                    addItem(partnersResMap[partnerId], `${itemName} (Part. ${(partnerPct * 100).toFixed(0)}%)`, -totalVal * partnerPct, 'cost');
                } else {
                    partners.forEach(p => {
                        const share = p.splitTicket / (totalPartnerPoints || 1);
                        addItem(partnersResMap[p.id], `${itemName} (Rateio Prod.)`, -totalVal * partnerPct * share, 'cost');
                    });
                }
            }
            extrato.push({ item: `${itemName} (Compartilhado)`, valor: -totalVal, tipo: 'custo' });
        } else {
            const partnerId = owner;
            if (partnersResMap[partnerId]) {
                addItem(partnersResMap[partnerId], itemName, -totalVal, 'cost');
            } else if (owner === 'partner' || owner === 'cliente') {
                partners.forEach(p => {
                    const share = p.splitTicket / (totalPartnerPoints || 1);
                    addItem(partnersResMap[p.id], `${itemName} (Rateio Prod.)`, -totalVal * share, 'cost');
                });
            } else {
                addItem(venueRes, `${itemName} (Ex-Sócio -> Casa)`, -totalVal, 'cost');
                extrato.push({ item: `${itemName} (Ex-Sócio -> Casa)`, valor: -totalVal, tipo: 'custo' });
            }
        }
    });

    // --- 8. FINALIZAÇÃO ---
    const finalize = (res: FinancialResult) => {
        res.profit = res.netRevenue - res.costs;
        res.roi = res.costs > 0 ? (res.profit / res.costs) * 100 : 0;
    };

    finalize(venueRes);
    Object.values(partnersResMap).forEach(finalize);

    const aggProdRes: FinancialResult = { label: 'Produção (Agregado)', grossRevenue: 0, netRevenue: 0, costs: 0, profit: 0, roi: 0, breakEven: 0, items: [] };
    Object.values(partnersResMap).forEach(p => {
        aggProdRes.grossRevenue += p.grossRevenue;
        aggProdRes.netRevenue += p.netRevenue;
        aggProdRes.costs += p.costs;
        aggProdRes.profit += p.profit;
        aggProdRes.items.push(...p.items);
    });

    return {
        totalGross: grossTicket + grossBar + grossBuffet,
        totalTaxes: taxTicketVal + taxBarVal + taxBuffetVal,
        venue: venueRes,
        production: aggProdRes,
        extrato,
        partnersResults: partnersResMap
    };
};

export const calculateEvent = (
    modelId: string,
    overrides: any,
    context: { sazonalidade: string, temPagamento: boolean },
    models: Record<string, EventModel>,
    globalConfig: GlobalConfig
): CalculationResult => {
    const model = models[modelId] || Object.values(models)[0];
    if (!model) return { receitaLiquida: 0, custosOperacionais: 0, lucroOperacional: 0, extrato: [] };

    const partners: Partner[] = overrides.partners || model.defaultPartners || [];

    // Map overrides/model defaults to the correct SimulationState variables
    const state: SimulationState = {
        modelName: model.label,
        publico: Number(overrides.publico || 0),
        ticketMedio: Number(overrides.ticket !== undefined ? overrides.ticket : model.ticketMedio),
        temOpenBar: model.temOpenBar,
        consumoBar: Number(overrides.bar !== undefined ? overrides.bar : model.consumoBar),

        // Critical Fix: Map Open Bar Cost vs CMV correctly
        custoOpenBarPax: model.temOpenBar ? (overrides.custoOpenBar ?? model.custoOpenBar) : 0,
        cmvBarPercent: model.temOpenBar ? 0 : (overrides.cmvBar ?? model.cmvBar),

        temBuffet: model.temBuffet,
        precoBuffet: Number(overrides.precoBuffet !== undefined ? overrides.precoBuffet : model.precoBuffet),
        custoBuffet: Number(overrides.custoBuffet !== undefined ? overrides.custoBuffet : model.custoBuffet),
        impostosTicket: Number(overrides.impostosTicket !== undefined ? overrides.impostosTicket : (model.impostosTicket || 10)),
        impostosBar: Number(overrides.impostosBar !== undefined ? overrides.impostosBar : (model.impostosBar || 16)),
        impostosAluguel: Number(overrides.impostosAluguel !== undefined ? overrides.impostosAluguel : (model.impostosAluguel || 22)),
        aluguelMode: overrides.aluguelMode || model.aluguelMode || 'fixo',
        aluguelFixo: Number(overrides.aluguel !== undefined ? overrides.aluguel : model.receitaFixa),
        partners: partners,
        extraCosts: overrides.custosExtras || model.custosFixos || []
    };

    (state as any).aluguelPercentual = overrides.aluguelPercentual !== undefined ? overrides.aluguelPercentual : model.aluguelPercentual;
    const res = calculateDualSimulation(state);

    return { receitaLiquida: res.venue.netRevenue, custosOperacionais: res.venue.costs, lucroOperacional: res.venue.profit, extrato: res.extrato };
};
