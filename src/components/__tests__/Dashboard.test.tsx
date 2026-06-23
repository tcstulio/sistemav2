import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Dashboard from '../Dashboard';

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
    useInvoices: vi.fn(() => ({ data: [] })),
    useSupplierInvoices: vi.fn(() => ({ data: [] })),
    useTasks: vi.fn(() => ({ data: [] })),
    useProducts: vi.fn(() => ({ data: [] })),
    useBankAccounts: vi.fn(() => ({ data: [] })),
    useBankLines: vi.fn(() => ({ data: [] })),
    useInterventions: vi.fn(() => ({ data: [] })),
    useTickets: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useCustomers: vi.fn(() => ({ data: [] })),
}));

const { useTasks: mockUseTasks, useProjects: mockUseProjects } = await import('../../hooks/dolibarr');

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
describe('Dashboard — Minhas Pendências: projeto em tarefas (#539)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exibe o nome do projeto para uma tarefa via project_title', async () => {
        vi.mocked(mockUseTasks).mockReturnValue({
            data: [
                { id: '1', ref: 'T-001', fk_user_assign: '1', progress: 50, label: 'Tarefa Alpha', project_id: '10', project_title: 'Projeto Alpha' } as any,
            ],
        } as any);
        vi.mocked(mockUseProjects).mockReturnValue({ data: [{ id: '10', ref: 'PRJ-10', title: 'Projeto Alpha' }] } as any);

        render(<Dashboard />);

        expect(await screen.findByText('Projeto Alpha')).toBeInTheDocument();
    });

    it('exibe "Sem projeto" quando tarefa sem project_id', async () => {
        vi.mocked(mockUseTasks).mockReturnValue({
            data: [
                { id: '2', ref: 'T-002', fk_user_assign: '1', progress: 0, label: 'Sem Vínculo' } as any,
            ],
        } as any);
        vi.mocked(mockUseProjects).mockReturnValue({ data: [] } as any);

        render(<Dashboard />);

        const semProjeto = await screen.findAllByText('Sem projeto');
        expect(semProjeto.length).toBeGreaterThan(0);
    });
});