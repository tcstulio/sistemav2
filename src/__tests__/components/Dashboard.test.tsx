import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// --- hoisted mocks ---
const mockGetDashboardArtifacts = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockSaveSalesForecast = vi.hoisted(() => vi.fn());
const mockAiService = vi.hoisted(() => ({
    generateSalesForecast: vi.fn(),
    getLatestFinancialAnalysis: vi.fn().mockResolvedValue(null),
    analyzeFinancialHealth: vi.fn(),
}));

vi.mock('../../services/aiService', () => ({ AiService: mockAiService }));
vi.mock('../../services/dashboardArtifacts', () => ({
    getDashboardArtifacts: (...args: any[]) => mockGetDashboardArtifacts(...args),
    saveSalesForecast: (...args: any[]) => mockSaveSalesForecast(...args),
}));
vi.mock('recharts', () => ({
    BarChart: ({ children }: any) => <div>{children}</div>,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    Cell: () => null,
    AreaChart: ({ children }: any) => <div>{children}</div>,
    Area: () => null,
}));
vi.mock('../../components/Finance/FinancialHealthWidget', () => ({
    FinancialHealthWidget: () => <div data-testid="financial-health-widget" />,
}));
vi.mock('../../components/Agent/AgentActivityFeed', () => ({
    AgentActivityFeed: () => <div data-testid="agent-activity-feed" />,
}));
vi.mock('../../hooks/useOrgBranding', () => ({
    useOrgBranding: vi.fn(() => null),
}));
vi.mock('../../utils/orderVisibility', () => ({
    applyOrderVisibility: vi.fn((widgets: any[]) => widgets),
    getUserPrefs: vi.fn(() => ({ order: [], hidden: [] })),
}));
vi.mock('../../utils/cashFlowBuckets', () => ({
    buildCashFlowBuckets: vi.fn(() => []),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { baseUrl: 'http://test', apiKey: 'key', currentUser: { id: '42', login: 'tester' } },
        canAccess: vi.fn(() => true),
    })),
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

const {
    useInvoices,
    useSupplierInvoices,
    useInterventions,
    useTickets,
    useProjects,
    useCustomers,
} = await import('../../hooks/dolibarr');

import Dashboard from '../../components/Dashboard';

const NOW_TS = Date.now();
const FUTURE = Math.floor((NOW_TS + 60 * 24 * 60 * 60 * 1000) / 1000); // 60 days ahead, in seconds

describe('Dashboard — KPI Pagamentos Pendentes (#598)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetDashboardArtifacts.mockResolvedValue(null);
        vi.mocked(useProjects).mockReturnValue({ data: [] } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: [] } as any);
    });

    it('conta todas as faturas statut=1, não apenas vencidas', () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                // vencida
                { id: '1', statut: '1', date: Math.floor(NOW_TS / 1000) - 60 * 86400, date_lim_reglement: Math.floor(NOW_TS / 1000) - 5 * 86400, ref: 'F001', total_ttc: 100 } as any,
                // não vencida (vence no futuro)
                { id: '2', statut: '1', date: Math.floor(NOW_TS / 1000), date_lim_reglement: FUTURE, ref: 'F002', total_ttc: 200 } as any,
                // paga — não conta
                { id: '3', statut: '2', date: Math.floor(NOW_TS / 1000), ref: 'F003', total_ttc: 300 } as any,
            ],
        } as any);
        vi.mocked(useSupplierInvoices).mockReturnValue({ data: [] } as any);

        render(<Dashboard />);

        // Deve mostrar 2 (ambas pendentes), não 1 (só a vencida)
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('Pagamentos Pendentes')).toBeInTheDocument();
    });

    it('não conta faturas pagas (statut !== 1)', () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                { id: '1', statut: '2', date: 0, ref: 'F001', total_ttc: 0 } as any,
            ],
        } as any);
        vi.mocked(useSupplierInvoices).mockReturnValue({ data: [] } as any);

        render(<Dashboard />);

        expect(screen.getByText('Pagamentos Pendentes')).toBeInTheDocument();
        // valor deve ser 0
        expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('soma faturas de cliente + fornecedor pendentes', () => {
        vi.mocked(useInvoices).mockReturnValue({
            data: [
                { id: '1', statut: '1', date_lim_reglement: FUTURE, ref: 'F001', total_ttc: 0 } as any,
            ],
        } as any);
        vi.mocked(useSupplierInvoices).mockReturnValue({
            data: [
                { id: '10', statut: '1', date_lim_reglement: FUTURE, ref: 'FA01', total_ttc: 0 } as any,
                { id: '11', statut: '1', date_lim_reglement: FUTURE, ref: 'FA02', total_ttc: 0 } as any,
            ],
        } as any);

        render(<Dashboard />);

        expect(screen.getByText('3')).toBeInTheDocument();
    });
});

describe('Dashboard — Minhas Pendências: projeto/cliente nas Intervenções e Tickets (#599)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetDashboardArtifacts.mockResolvedValue(null);
        vi.mocked(useInvoices).mockReturnValue({ data: [] } as any);
        vi.mocked(useSupplierInvoices).mockReturnValue({ data: [] } as any);
    });

    it('exibe nome do projeto e cliente para uma Intervenção atribuída', async () => {
        vi.mocked(useProjects).mockReturnValue({
            data: [{ id: '10', ref: 'PROJ-10', title: 'Projeto Alpha' }],
        } as any);
        vi.mocked(useCustomers).mockReturnValue({
            data: [{ id: '20', name: 'Cliente Beta' }],
        } as any);
        vi.mocked(useInterventions).mockReturnValue({
            data: [
                { id: '1', ref: 'INT-001', fk_user_author: '42', statut: '1', project_id: '10', socid: '20', date: NOW_TS / 1000, description: 'Manutenção' } as any,
            ],
        } as any);
        vi.mocked(useTickets).mockReturnValue({ data: [] } as any);

        render(<Dashboard />);

        expect(await screen.findByText('Projeto Alpha')).toBeInTheDocument();
        expect(screen.getByText('Cliente Beta')).toBeInTheDocument();
    });

    it('exibe nome do projeto e cliente para um Ticket atribuído', async () => {
        vi.mocked(useProjects).mockReturnValue({
            data: [{ id: '30', ref: 'PROJ-30', title: 'Projeto Gamma' }],
        } as any);
        vi.mocked(useCustomers).mockReturnValue({
            data: [{ id: '40', name: 'Cliente Delta' }],
        } as any);
        vi.mocked(useInterventions).mockReturnValue({ data: [] } as any);
        vi.mocked(useTickets).mockReturnValue({
            data: [
                { id: '5', ref: 'TKT-005', fk_user_assign: '42', statut: '1', project_id: '30', socid: '40', datec: NOW_TS / 1000, subject: 'Bug crítico' } as any,
            ],
        } as any);

        render(<Dashboard />);

        expect(await screen.findByText('Projeto Gamma')).toBeInTheDocument();
        expect(screen.getByText('Cliente Delta')).toBeInTheDocument();
    });

    it('exibe "Sem projeto" e "Sem cliente" quando ausentes na Intervenção', async () => {
        vi.mocked(useProjects).mockReturnValue({ data: [] } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: [] } as any);
        vi.mocked(useInterventions).mockReturnValue({
            data: [
                { id: '2', ref: 'INT-002', fk_user_author: '42', statut: '1', date: NOW_TS / 1000, description: 'Sem vínculo' } as any,
            ],
        } as any);
        vi.mocked(useTickets).mockReturnValue({ data: [] } as any);

        render(<Dashboard />);

        const semProjeto = await screen.findAllByText('Sem projeto');
        expect(semProjeto.length).toBeGreaterThan(0);
        const semCliente = screen.getAllByText('Sem cliente');
        expect(semCliente.length).toBeGreaterThan(0);
    });

    it('exibe "Sem projeto" e "Sem cliente" quando ausentes no Ticket', async () => {
        vi.mocked(useProjects).mockReturnValue({ data: [] } as any);
        vi.mocked(useCustomers).mockReturnValue({ data: [] } as any);
        vi.mocked(useInterventions).mockReturnValue({ data: [] } as any);
        vi.mocked(useTickets).mockReturnValue({
            data: [
                { id: '6', ref: 'TKT-006', fk_user_assign: '42', statut: '1', datec: NOW_TS / 1000, subject: 'Sem vínculo' } as any,
            ],
        } as any);

        render(<Dashboard />);

        const semProjeto = await screen.findAllByText('Sem projeto');
        expect(semProjeto.length).toBeGreaterThan(0);
        const semCliente = screen.getAllByText('Sem cliente');
        expect(semCliente.length).toBeGreaterThan(0);
    });
});
