import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock all 11 hooks from hooks.ts
vi.mock('../../../hooks/dolibarr/hooks', () => ({
    usePayments: vi.fn(),
    useSupplierPayments: vi.fn(),
    useSalaryPayments: vi.fn(),
    useSocialContributionPayments: vi.fn(),
    useVATPayments: vi.fn(),
    useProposals: vi.fn(),
    useOrders: vi.fn(),
    useUsers: vi.fn(),
    useLeaveRequests: vi.fn(),
    useProjects: vi.fn(),
    useTasks: vi.fn(),
}));

vi.mock('../../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key', themeColor: 'indigo' } })),
}));

vi.mock('../../../services/aiService', () => ({
    AiService: {
        analyzeMonthlyReport: vi.fn(),
    },
}));

vi.mock('react-markdown', () => ({
    default: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock('recharts', () => {
    const stub = ({ children }: any) => (children ? <div>{children}</div> : null);
    return {
        ResponsiveContainer: stub,
        BarChart: stub,
        Bar: stub,
        XAxis: stub,
        YAxis: stub,
        CartesianGrid: stub,
        Tooltip: stub,
        PieChart: stub,
        Pie: stub,
        Cell: stub,
        Legend: stub,
    };
});

// Mock tab components so they don't require their own deep deps
vi.mock('../../../components/Reports/FinanceTab', () => ({
    FinanceTab: () => <div data-testid="finance-tab" />,
}));
vi.mock('../../../components/Reports/SalesTab', () => ({
    SalesTab: () => <div data-testid="sales-tab" />,
}));
vi.mock('../../../components/Reports/ProjectsTab', () => ({
    ProjectsTab: () => <div data-testid="projects-tab" />,
}));
vi.mock('../../../components/Reports/HRTab', () => ({
    HRTab: () => <div data-testid="hr-tab" />,
}));

import {
    usePayments,
    useSupplierPayments,
    useSalaryPayments,
    useSocialContributionPayments,
    useVATPayments,
    useProposals,
    useOrders,
    useUsers,
    useLeaveRequests,
    useProjects,
    useTasks,
} from '../../../hooks/dolibarr/hooks';

import { MonthlyReport } from '../../../pages/Reports/MonthlyReport';

const emptyHookResult = { data: [], isLoading: false, error: null };
const loadingHookResult = { data: undefined, isLoading: true, error: null };

function setupAllHooks(override: Partial<typeof emptyHookResult> = {}) {
    const result = { ...emptyHookResult, ...override };
    vi.mocked(usePayments).mockReturnValue(result as any);
    vi.mocked(useSupplierPayments).mockReturnValue(result as any);
    vi.mocked(useSalaryPayments).mockReturnValue(result as any);
    vi.mocked(useSocialContributionPayments).mockReturnValue(result as any);
    vi.mocked(useVATPayments).mockReturnValue(result as any);
    vi.mocked(useProposals).mockReturnValue(result as any);
    vi.mocked(useOrders).mockReturnValue(result as any);
    vi.mocked(useUsers).mockReturnValue(result as any);
    vi.mocked(useLeaveRequests).mockReturnValue(result as any);
    vi.mocked(useProjects).mockReturnValue(result as any);
    vi.mocked(useTasks).mockReturnValue(result as any);
}

describe('MonthlyReport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupAllHooks();
    });

    it('renders page title', () => {
        render(<MonthlyReport />);
        expect(screen.getByText('Relatório Mensal')).toBeInTheDocument();
    });

    it('shows loading indicator (Skeleton) when hooks are loading', () => {
        setupAllHooks(loadingHookResult);
        const { container } = render(<MonthlyReport />);
        // Skeletons have animate-pulse class
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('shows error banner when a hook has error', () => {
        setupAllHooks();
        // Override one hook to have an error
        vi.mocked(usePayments).mockReturnValue({ data: undefined, isLoading: false, error: new Error('test') } as any);
        render(<MonthlyReport />);
        // ErrorState renders "Ocorreu um erro" as title
        expect(screen.getByText('Ocorreu um erro')).toBeInTheDocument();
    });

    it('renders KPI cards with data when not loading', () => {
        setupAllHooks({ data: [], isLoading: false, error: null });
        render(<MonthlyReport />);
        // Should show the card titles
        expect(screen.getByText('Resultado Líquido')).toBeInTheDocument();
        expect(screen.getByText('Receita Vendas')).toBeInTheDocument();
        expect(screen.getByText('Projetos Ativos')).toBeInTheDocument();
        expect(screen.getByText('Equipe Ativa')).toBeInTheDocument();
    });

    it('shows subtitle "faturado" on Receita Vendas card', () => {
        setupAllHooks();
        render(<MonthlyReport />);
        expect(screen.getByText('faturado')).toBeInTheDocument();
    });

    it('year select includes current year', () => {
        setupAllHooks();
        render(<MonthlyReport />);
        const currentYear = new Date().getFullYear();
        const yearOptions = screen.getAllByRole('option').filter(opt => opt.textContent === String(currentYear));
        expect(yearOptions.length).toBeGreaterThan(0);
    });

    it('year select does not contain hardcoded 2024/2025/2026 only — has dynamic range', () => {
        setupAllHooks();
        render(<MonthlyReport />);
        const currentYear = new Date().getFullYear();
        // Should have option for CURRENT_YEAR - 1 (dynamic)
        const prevYearOption = screen.queryByRole('option', { name: String(currentYear - 1) });
        expect(prevYearOption).toBeInTheDocument();
    });
});
