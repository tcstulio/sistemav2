// #111 — Painel Principal configurável (ordem + visibilidade).
// Fonte ÚNICA dos widgets de topo do Dashboard, na ORDEM default atual.
// O Dashboard renderiza dirigido por estes ids; o DashboardConfigEditor lista estes labels.
//
// Os widgets vivem em duas regiões estruturais do painel (preservadas p/ não quebrar o grid):
//  - 'full'    → faixa de largura total no topo (KPIs)
//  - 'main'    → coluna principal (2/3) da grade de gráficos
//  - 'sidebar' → coluna lateral (1/3) da grade
// A ordem/visibilidade é configurável dentro de cada região.

export type DashboardWidgetRegion = 'full' | 'main' | 'sidebar';

export interface DashboardWidgetDef {
    id: string;
    label: string;
    region: DashboardWidgetRegion;
}

export const DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
    // Faixa superior (largura total)
    { id: 'kpis', label: 'Indicadores (KPIs)', region: 'full' },

    // Coluna principal (gráficos / análise)
    { id: 'cashflow', label: 'Fluxo de Caixa (Receita vs Despesas)', region: 'main' },
    { id: 'cashflow-forecast', label: 'Projeção de Fluxo de Caixa (90 dias)', region: 'main' },
    { id: 'financial-health', label: 'Análise Financeira (IA)', region: 'main' },

    // Coluna lateral
    { id: 'my-pending', label: 'Minhas Pendências', region: 'sidebar' },
    { id: 'sales-forecast', label: 'Previsão de Vendas', region: 'sidebar' },
    { id: 'operational-alerts', label: 'Alertas Operacionais', region: 'sidebar' },
    { id: 'quick-actions', label: 'Ações Rápidas', region: 'sidebar' },
];
