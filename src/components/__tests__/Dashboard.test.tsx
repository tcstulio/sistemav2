import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Dashboard from '../Dashboard';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        config: { currentUser: { id: '1' } },
        canAccess: () => true,
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

vi.mock('../../hooks/useOrgBranding', () => ({
    useOrgBranding: () => null,
}));

vi.mock('../../services/dashboardArtifacts', () => ({
    getDashboardArtifacts: vi.fn().mockResolvedValue(null),
    saveSalesForecast: vi.fn(),
}));

vi.mock('../../services/aiService', () => ({
    AiService: { generateSalesForecast: vi.fn() },
}));

vi.mock('../Finance/FinancialHealthWidget', () => ({
    FinancialHealthWidget: () => <div>Análise Financeira IA</div>,
}));

vi.mock('../Agent/AgentActivityFeed', () => ({
    AgentActivityFeed: () => <div>Atividade do Marciano</div>,
}));

vi.mock('../../utils/orderVisibility', async () => {
    const actual = await vi.importActual<typeof import('../../utils/orderVisibility')>('../../utils/orderVisibility');
    return actual;
});

// Mock recharts entirely to avoid ResizeObserver constructor issues in jsdom
vi.mock('recharts', () => ({
    AreaChart: ({ children }: any) => <svg>{children}</svg>,
    BarChart: ({ children }: any) => <svg>{children}</svg>,
    Area: () => null,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    Cell: () => null,
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('Dashboard — widgets removidos', () => {
    it('não renderiza o widget "Ações Rápidas"', () => {
        render(<Dashboard />);
        expect(screen.queryByText('Ações Rápidas')).toBeNull();
    });

    it('não renderiza o widget "Evolução do Projeto"', () => {
        render(<Dashboard />);
        expect(screen.queryByText('Evolução do Projeto')).toBeNull();
        expect(screen.queryByText('Evolução do Projeto (Issues)')).toBeNull();
    });
});

describe('Dashboard — widgets remanescentes da sidebar', () => {
    it('renderiza o widget "Atividade do Marciano"', () => {
        render(<Dashboard />);
        expect(screen.getByText('Atividade do Marciano')).toBeTruthy();
    });
});
