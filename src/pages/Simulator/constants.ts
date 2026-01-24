
import { BarMix, BuffetSimulationData, CostItem, EventModel } from './types';

export const STORAGE_KEY_DRAFT = 'coolgroove_simulator_draft';

export const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export const DEFAULT_BAR_MIX: BarMix = {
    cerveja: { label: 'Cerveja', share: 40, custo: 4, venda: 12 },
    drinks: { label: 'Drinks/Vodka', share: 30, custo: 8, venda: 25 },
    naoAlcoolicos: { label: 'Água/Refri', share: 20, custo: 2, venda: 8 },
    shots: { label: 'Shots', share: 10, custo: 5, venda: 20 }
};

export const DEFAULT_BUFFET_SIM: BuffetSimulationData = {
    estilo: 'coquetel',
    nivel: 'padrao',
    custoInsumoBase: 35,
    garcons: { qtd: 0, custo: 180, ratio: 20 },
    cozinha: { qtd: 0, custo: 250, ratio: 50 },
    margemAlvo: 100
};

export const PREDICTION_FACTORS = {
    weather: {
        sunny: { label: 'Ensolarado', factor: 1.1 },
        cloudy: { label: 'Nublado', factor: 1.0 },
        rain: { label: 'Chuvoso', factor: 0.8 },
        storm: { label: 'Tempestade', factor: 0.6 }
    },
    dateType: {
        normal: { label: 'Normal', factor: 1.0 },
        holiday: { label: 'Feriado', factor: 1.2 },
        preHoliday: { label: 'Véspera', factor: 1.15 },
        postHoliday: { label: 'Pós-Feriado', factor: 0.85 }
    },
    competition: {
        none: { label: 'Nenhuma', factor: 1.1 },
        low: { label: 'Baixa', factor: 1.0 },
        high: { label: 'Alta', factor: 0.85 },
        direct: { label: 'Concorrente Direto', factor: 0.7 }
    },
    marketing: {
        low: { label: 'Baixo', factor: 0.9 },
        moderate: { label: 'Moderado', factor: 1.0 },
        high: { label: 'Alto', factor: 1.15 },
        viral: { label: 'Viral', factor: 1.3 }
    },
    hype: {
        low: { label: 'Baixo', factor: 0.9 },
        normal: { label: 'Normal', factor: 1.0 },
        high: { label: 'Alto', factor: 1.2 }
    }
};

export const DEFAULT_MODELS: Record<string, EventModel> = {
    locacao: {
        label: 'Locação Padrão',
        cor: 'indigo',
        temOpenBar: false,
        consumoBar: 60,
        custoOpenBar: 0,
        cmvBar: 0.3,
        ticketMedio: 0,
        temBuffet: false,
        precoBuffet: 0,
        custoBuffet: 0,
        padraoSplitBuffet: 0,
        receitaFixa: 5000,
        aluguelMode: 'fixo',
        aluguelPercentual: 0,
        // Added missing required properties for locacao
        padraoSplitBar: 100,
        padraoSplitPorta: 0,
        gestao: 'terceiro',
        defaultPartners: [
            { id: 'p1', name: 'Produtor', splitTicket: 100, splitBar: 0 }
        ],
        custosFixos: [],
        custoVarPessoa: 0
    },
    proprio: {
        label: 'Produção Própria',
        cor: 'emerald',
        temOpenBar: false,
        consumoBar: 60,
        custoOpenBar: 0,
        cmvBar: 0.3,
        ticketMedio: 50,
        temBuffet: false,
        precoBuffet: 0,
        custoBuffet: 0,
        padraoSplitBuffet: 0,
        receitaFixa: 0,
        aluguelMode: 'fixo',
        aluguelPercentual: 0,
        // Added missing required properties for proprio
        padraoSplitBar: 100,
        padraoSplitPorta: 100,
        gestao: 'proprio',
        defaultPartners: [], // Empty means House keeps 100%
        custosFixos: [],
        custoVarPessoa: 0
    }
};

export const DEFAULT_COSTS: CostItem[] = [
    {
        id: 'c1',
        name: 'Line-up / Artístico',
        amount: 5000,
        type: 'fixed',
        owner: 'partner',
        // Compatible fields
        item: 'Line-up / Artístico',
        valor: 5000,
        mode: 'fixed',
        responsavel: 'cliente',
        categoria: 'Artístico'
    },
    {
        id: 'c2',
        name: 'Segurança / Staff',
        amount: 1500,
        type: 'fixed',
        owner: 'venue',
        // Compatible fields
        item: 'Segurança / Staff',
        valor: 1500,
        mode: 'fixed',
        responsavel: 'casa',
        categoria: 'Staff'
    },
    {
        id: 'c3',
        name: 'Marketing / Ads',
        amount: 1000,
        type: 'fixed',
        owner: 'partner',
        // Compatible fields
        item: 'Marketing / Ads',
        valor: 1000,
        mode: 'fixed',
        responsavel: 'cliente',
        categoria: 'Marketing'
    },
    {
        id: 'c4',
        name: 'Limpeza',
        amount: 400,
        type: 'fixed',
        owner: 'venue',
        // Compatible fields
        item: 'Limpeza',
        valor: 400,
        mode: 'fixed',
        responsavel: 'casa',
        categoria: 'Operacional'
    },
];
