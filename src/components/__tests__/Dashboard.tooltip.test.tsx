import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import Dashboard from '../Dashboard';

interface TooltipEntry {
    name?: string;
    dataKey?: string;
    value?: number;
    color?: string;
}
interface TooltipProps {
    active?: boolean;
    payload?: TooltipEntry[];
    label?: string;
}

// Estado compartilhado (hoisted) que controla o payload injetado no CustomTooltip real.
const tooltipState = vi.hoisted(() => ({
    payload: [] as TooltipEntry[],
    label: 'Período',
    active: true,
    rendered: false,
}));

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        config: { currentUser: { id: '1', admin: 1 } },
        canAccess: () => true,
        previewTarget: null,
        setPreviewTarget: () => {},
        orgScreenPerms: null,
        userGroupIds: [],
    }),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useInvoices: () => ({ data: [] }),
    useSupplierInvoices: () => ({ data: [] }),
    useTasks: () => ({ data: [] }),
    useProducts: () => ({ data: [] }),
    useBankAccounts: () => ({ data: [] }),
    useBankLines: () => ({ data: [] }),
    useInterventions: () => ({ data: [] }),
    useTickets: () => ({ data: [] }),
    useProjects: () => ({ data: [] }),
    useCustomers: () => ({ data: [] }),
}));

vi.mock('../../hooks/useOrgBranding', () => ({ useOrgBranding: () => null }));

vi.mock('../../services/dashboardArtifacts', () => ({
    getDashboardArtifacts: vi.fn().mockResolvedValue(null),
    saveSalesForecast: vi.fn(),
}));

vi.mock('../../services/aiService', () => ({
    AiService: { generateSalesForecast: vi.fn() },
}));

vi.mock('../Finance/FinancialHealthWidget', () => ({
    FinancialHealthWidget: () => null,
}));

vi.mock('../Agent/AgentActivityFeed', () => ({
    AgentActivityFeed: () => null,
}));

vi.mock('../../utils/orderVisibility', async () => {
    const actual = await vi.importActual<typeof import('../../utils/orderVisibility')>('../../utils/orderVisibility');
    return actual;
});

// Mock do recharts: o Tooltip monta o CustomTooltip REAL (closure interna do Dashboard)
// injetando um payload controlado, para validar cor/valor por série após reordenar (#844).
vi.mock('recharts', () => ({
    AreaChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
    BarChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
    Area: () => null,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Cell: () => null,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Tooltip: ({ content }: { content?: ReactElement }) => {
        if (!content || tooltipState.rendered) return null;
        tooltipState.rendered = true;
        const C = content.type as ComponentType<TooltipProps>;
        return (
            <C active={tooltipState.active} payload={tooltipState.payload} label={tooltipState.label} />
        );
    },
}));

// Mesmo formatter usado pelo Dashboard (Intl pt-BR currency usa NBSP — não comparar com string literal).
const fmt = (v: number) =>
    new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(v);

function renderDashboard() {
    return render(<Dashboard />);
}

function getTooltipRows(container: HTMLElement): string[] {
    const tooltip = container.querySelector('div.bg-slate-800.text-white');
    if (!tooltip) return [];
    return Array.from(tooltip.querySelectorAll('p.flex.items-center.gap-2')).map((p) => p.textContent || '');
}

function getSwatchColors(container: HTMLElement): string[] {
    const tooltip = container.querySelector('div.bg-slate-800.text-white');
    if (!tooltip) return [];
    return Array.from(tooltip.querySelectorAll('span.rounded-full')).map(
        (s) => (s as HTMLElement).style.backgroundColor
    );
}

describe('Dashboard — CustomTooltip com chaves estáveis (#844)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tooltipState.rendered = false;
        tooltipState.payload = [];
    });

    it('mostra nome, valor e cor por série na ordem do payload', () => {
        tooltipState.payload = [
            { name: 'Receitas', dataKey: 'receitas', value: 1234.5, color: 'rgb(34, 197, 94)' },
            { name: 'Despesas', dataKey: 'despesas', value: 500, color: 'rgb(239, 68, 68)' },
        ];

        const { container } = renderDashboard();

        const rows = getTooltipRows(container);
        expect(rows.length).toBe(2);
        expect(rows[0]).toContain('Receitas');
        expect(rows[0]).toContain(fmt(1234.5));
        expect(rows[1]).toContain('Despesas');
        expect(rows[1]).toContain(fmt(500));

        // uma cor (swatch) por série, distintas entre si
        const colors = getSwatchColors(container);
        expect(colors.length).toBe(2);
        expect(new Set(colors).size).toBe(2);
    });

    it('mantém cor/valor corretos por série após reordenar os dados', () => {
        tooltipState.payload = [
            { name: 'Despesas', dataKey: 'despesas', value: 500, color: 'rgb(239, 68, 68)' },
            { name: 'Receitas', dataKey: 'receitas', value: 1234.5, color: 'rgb(34, 197, 94)' },
        ];

        const { container } = renderDashboard();

        const rows = getTooltipRows(container);
        // a ordem renderizada segue o payload (data-driven), não um índice fixo
        expect(rows[0]).toContain('Despesas');
        expect(rows[0]).toContain(fmt(500));
        expect(rows[1]).toContain('Receitas');
        expect(rows[1]).toContain(fmt(1234.5));
    });
});
