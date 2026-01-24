
export type Responsibility = 'venue' | 'partner' | 'casa' | 'cliente' | 'shared' | 'custom' | string; // string allows specific partner IDs
export type CostItemMode = 'fixed' | 'per_pax' | 'step' | 'min_pax';

export interface CostItem {
    id: string | number;
    item?: string;
    name?: string; // alias
    valor?: number;
    amount?: number; // alias
    categoria?: string;
    owner?: string;
    responsavel?: string; // alias for backward compatibility
    sharedWith?: string; // partner ID
    shareVenue?: number; // % that venue pays (0-100)
    customSplits?: Record<string, number>; // Key: 'venue' or partnerId, Value: % (0-100)
    mode?: CostItemMode;
    type?: 'fixed' | 'variable'; // alias
    stepSize?: number;
    minUnits?: number;
    minTotalValue?: number; // Minimum guaranteed value (floor) for min_pax mode
}

export interface ExtratoItem {
    item: string;
    valor: number;
    tipo: 'receita' | 'custo' | 'deducao' | 'informativo';
}

export interface BarMixItem {
    label: string;
    share: number;
    custo: number;
    venda: number;
}

export type BarMix = Record<string, BarMixItem>;

export interface ConsumptionProfile {
    leve: number;
    moderado: number;
    pesado: number;
}

export interface BuffetSimulationData {
    estilo: 'coquetel' | 'finger' | 'jantar' | 'full';
    nivel: 'economico' | 'padrao' | 'premium';
    custoInsumoBase: number;
    garcons: { qtd: number; custo: number; ratio: number };
    cozinha: { qtd: number; custo: number; ratio: number };
    margemAlvo: number;
}

export interface Partner {
    id: string;
    name: string;
    splitTicket: number; // % that goes to this partner
    splitBar: number; // % that goes to this partner
    splitBuffet?: number; // % that goes to this partner for buffet revenue
}

// Expanded State for the Wizard
export interface SimulationState {
    modelName: string;
    eventDate?: string;
    publico: number;
    ticketMedio: number;
    temOpenBar: boolean;
    consumoBar: number;
    // Separated variables to prevent data corruption when switching modes
    custoOpenBarPax: number; // R$ per person cost (Open Bar Mode)
    cmvBarPercent: number;   // % Cost of Goods Sold (Sold Bar Mode)

    barDetails?: {
        mix: BarMix;
        duracao: number;
        perfil: string;
    };
    temBuffet: boolean;
    precoBuffet: number;
    custoBuffet: number;
    buffetDetails?: BuffetSimulationData;
    impostosTicket: number;
    impostosBar: number;
    impostosBuffet?: number; // Separate tax rate for buffet services
    impostosAluguel: number;
    aluguelFixo: number;
    aluguelMode?: 'fixo' | 'percentual' | 'hibrido';
    aluguelPercentual?: number;
    partners: Partner[];
    extraCosts: CostItem[];
}

export interface EventModel {
    label: string;
    cor: string;
    temOpenBar: boolean;
    consumoBar: number;
    custoOpenBar: number;
    cmvBar: number;
    ticketMedio: number;
    temBuffet: boolean;
    precoBuffet: number;
    custoBuffet: number;
    padraoSplitBuffet: number;
    receitaFixa: number;
    aluguelMode: 'fixo' | 'percentual' | 'hibrido';
    aluguelPercentual: number;
    padraoSplitBar: number;
    padraoSplitPorta: number;
    gestao: 'proprio' | 'terceiro';
    defaultPartners: Partner[];
    custosFixos: CostItem[];
    custoVarPessoa: number;

    // Optional / inferred
    strategyProfile?: 'volume' | 'standard' | 'premium' | 'aggressive';
    aluguelLimitePublico?: number;
    aluguelExcedenteMode?: 'per_pax' | 'fixed';
    aluguelValorExcedente?: number;
    barMix?: BarMix;
    eventType?: 'private' | 'commercial';
    impostosTicket?: number;
    impostosBar?: number;
    impostosAluguel?: number;
}

export interface FinancialResultItem {
    label: string;
    value: number;
    type: 'revenue' | 'cost' | 'neutral';
}

export interface FinancialResult {
    label: string;
    grossRevenue: number;
    netRevenue: number;
    costs: number;
    profit: number;
    roi: number;
    breakEven: number;
    items: FinancialResultItem[];
}

export interface DualSimulationResult {
    totalGross: number;
    totalTaxes: number;
    venue: FinancialResult;
    production: FinancialResult;
    extrato: ExtratoItem[];
    partnersResults: Record<string, FinancialResult>;
}

export interface CalculationResult {
    receitaLiquida: number;
    custosOperacionais: number;
    lucroOperacional: number;
    extrato: ExtratoItem[];
}

export interface GlobalConfig {
    custoFixoMensal: number;
}

export type ModelsMap = Record<string, EventModel>;

export interface RealizedData {
    publico: number;
    receitaBilheteria: number;
    receitaBar: number;
    receitaBuffet: number;
    receitaExtra: number;
    custoTotal: number;
    lucroReal: number;
    obs: string;
}

export interface EventDayData {
    type: string; // key of ModelsMap
    overrides: {
        publico?: number;
        aluguel?: number;
        aluguelPercentual?: number;
        aluguelLimitePublico?: number;
        aluguelExcedenteMode?: 'per_pax' | 'fixed';
        aluguelValorExcedente?: number;
        ticket?: number;
        bar?: number; // consumoBar ou custoOpenBar
        custoOpenBar?: number;
        splitBar?: number;
        splitPorta?: number;
        precoBuffet?: number;
        custoBuffet?: number;
        splitBuffet?: number;
        garantiaMinima?: number;
        listaCustosCustom?: CostItem[];
        // ... possibly others
    };
    realized?: RealizedData;
}

export interface MonthData {
    dias: (EventDayData | null)[];
    sazonalidade: string;
    temPagamento: boolean;
}

export interface Competitor {
    id: string;
    name: string;
    type: 'venue' | 'producer';
    strengths: string;
    weaknesses: string;
    model: EventModel;
}

export interface CompetitorOffer {
    id: string;
    competitorId: string;
    label: string;
    publico: number;
    totalPrice: number;
    includesBuffet: boolean;
    includesOpenBar: boolean;
    description: string;
}

export interface ProposalOption {
    id: string;
    label: string;
    description: string;
    basePrice: number;
    variablePerPax: number;
    features: string[];
    color: string;
    isRecommended: boolean;
}

export interface ClientProposalState {
    clientName: string;
    eventName: string;
    date: string;
    publicoInicial: number;
    options: ProposalOption[];
    benchmarks?: {
        name: string;
        estimatedTotal: number;
        publicoBase: number;
        notes: string;
    }[];
}

export interface Deal {
    id: string;
    clientName: string;
    eventName: string;
    value: number;
    status: 'lead' | 'proposal' | 'negotiation' | 'won' | 'lost';
    date: string;
    probability: number;
    modelId: string;
}

export interface RoadmapItem {
    id: string;
    title: string;
    description: string;
    category: 'core' | 'finance' | 'visual' | 'ai';
    status: 'planned' | 'in_progress' | 'done';
    priority: 'high' | 'medium' | 'low';
    votes: number;
}
