import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExpenseReportPaymentList from '../../components/Finance/ExpenseReportPaymentList';

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'http://test', apiKey: 'key' },
    })),
}));

const mockPayments = [
    {
        id: '1',
        ref: 'PAY-EXP-001',
        amount: 350,
        date_payment: 1700000000,
        fk_expensereport: '10',
        fk_bank: '2',
        fk_user_creat: '99',
        num_paiement: 'TRF-001',
    },
];

const mockReports = [
    {
        id: '10',
        ref: 'ND-001',
        fk_user_author: '42',
        project_id: '3',
        date_debut: 1700000000,
        date_fin: 1700086400,
        total_ttc: 350,
        statut: '5',
    },
];

const mockProjects = [
    { id: '3', ref: 'PROJ-001', title: 'Projeto Alpha', socid: '5', statut: '1', progress: 50 },
];

const mockUsers = [
    { id: '42', login: 'joao.silva', firstname: 'João', lastname: 'Silva' },
    { id: '99', login: 'admin', firstname: 'Admin', lastname: 'User' },
];

vi.mock('../../hooks/dolibarr', () => ({
    useExpenseReportPayments: vi.fn(() => ({
        data: mockPayments,
        isLoading: false,
        error: null,
    })),
    useExpenseReports: vi.fn(() => ({ data: mockReports })),
    useExpenseReportPaymentLinks: vi.fn(() => ({ data: [] })),
    useBankAccounts: vi.fn(() => ({ data: [{ id: '2', label: 'Conta Principal', bank: 'Banco do Brasil', number: '12345-6' }] })),
    useUsers: vi.fn(() => ({ data: mockUsers })),
    useExpenseReportLines: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: mockProjects })),
}));

vi.mock('../../hooks/useListControls', () => ({
    useListControls: vi.fn((data: any[], cfg: any) => ({
        result: data,
        search: '',
        setSearch: vi.fn(),
        sortKey: 'date',
        sortDir: 'desc' as const,
        toggleSortDir: vi.fn(),
        setSortKey: vi.fn(),
        filterValues: {},
        setFilter: vi.fn(),
        clear: vi.fn(),
        config: cfg,
    })),
}));

vi.mock('../../hooks/useMutations', () => ({
    useCustomerMutations: vi.fn(() => ({})),
}));

vi.mock('react-virtualized-auto-sizer', () => ({
    default: ({ children }: { children: (size: { height: number; width: number }) => React.ReactNode }) =>
        children({ height: 600, width: 800 }),
}));

vi.mock('react-window', () => ({
    FixedSizeList: ({
        children,
        itemCount,
    }: {
        children: (props: { index: number; style: React.CSSProperties }) => React.ReactNode;
        itemCount: number;
    }) => (
        <div data-testid="vw-list">
            {Array.from({ length: itemCount }, (_, index) => children({ index, style: {} }))}
        </div>
    ),
}));

// Mock the ExpenseDetailModal to keep tests simple
vi.mock('../../components/HR/modals/ExpenseDetailModal', () => ({
    ExpenseDetailModal: ({ onClose }: { onClose: () => void }) => (
        <div data-testid="expense-detail-modal">
            <button onClick={onClose}>Fechar</button>
        </div>
    ),
}));

// ------------------------------------------------------------------
// Import mocked hooks after mock setup
// ------------------------------------------------------------------
import { useExpenseReportPayments, useExpenseReports, useExpenseReportPaymentLinks } from '../../hooks/dolibarr';

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('ExpenseReportPaymentList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useExpenseReportPayments).mockReturnValue({
            data: mockPayments,
            isLoading: false,
            error: null,
        } as any);
    });

    it('renderiza a lista de pagamentos de despesas', () => {
        render(<ExpenseReportPaymentList />);
        expect(screen.getByText('PAY-EXP-001')).toBeInTheDocument();
    });

    it('os itens são clicáveis e abrem o painel de detalhes', async () => {
        const user = userEvent.setup();
        render(<ExpenseReportPaymentList />);

        const paymentCard = screen.getByText('PAY-EXP-001').closest('[class]');
        expect(paymentCard).toBeTruthy();
        await user.click(paymentCard!);

        // Detail panel shows the ref in the header
        expect(screen.getAllByText('PAY-EXP-001').length).toBeGreaterThan(1);
    });

    it('exibe o projeto vinculado ao relatório de despesa no detalhe', async () => {
        const user = userEvent.setup();
        render(<ExpenseReportPaymentList />);

        const paymentCard = screen.getByText('PAY-EXP-001').closest('[class]');
        await user.click(paymentCard!);

        expect(screen.getByText('Projeto Alpha')).toBeInTheDocument();
    });

    it('exibe o funcionário vinculado ao relatório de despesa no detalhe', async () => {
        const user = userEvent.setup();
        render(<ExpenseReportPaymentList />);

        const paymentCard = screen.getByText('PAY-EXP-001').closest('[class]');
        await user.click(paymentCard!);

        // João Silva is the author of the expense report
        expect(screen.getByText('João Silva')).toBeInTheDocument();
    });

    it('mostra estado de loading quando isLoading é true', () => {
        vi.mocked(useExpenseReportPayments).mockReturnValue({
            data: [],
            isLoading: true,
            error: null,
        } as any);
        render(<ExpenseReportPaymentList />);
        expect(screen.getByText('Carregando pagamentos...')).toBeInTheDocument();
    });

    it('mostra estado de erro quando error está presente', () => {
        vi.mocked(useExpenseReportPayments).mockReturnValue({
            data: [],
            isLoading: false,
            error: new Error('fail'),
        } as any);
        render(<ExpenseReportPaymentList />);
        expect(screen.getByText(/Erro ao carregar pagamentos/)).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// #825 — Chaves estáveis nos relatórios vinculados (key=link.id)
// Cada relatório vinculado no detalhe do pagamento usa key={link.id}. Chaves
// estáveis/únicas garantem que cada linha exibe o seu próprio ref e valor de
// vínculo, sem troca entre linhas ao reordenar/filtrar.
// ---------------------------------------------------------------------------
describe('ExpenseReportPaymentList — #825: chaves estáveis nos relatórios vinculados', () => {
    const linksMock = [
        { id: 'L1', fk_payment: '1', fk_expensereport: '10', amount: 200 },
        { id: 'L2', fk_payment: '1', fk_expensereport: '20', amount: 150 },
    ];
    const reportsMock = [
        { id: '10', ref: 'ND-001', fk_user_author: '42', project_id: '', date_debut: 0, date_fin: 0, total_ttc: 350, statut: '5' },
        { id: '20', ref: 'ND-002', fk_user_author: '42', project_id: '', date_debut: 0, date_fin: 0, total_ttc: 500, statut: '5' },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useExpenseReportPayments).mockReturnValue({
            data: mockPayments,
            isLoading: false,
            error: null,
        } as any);
        vi.mocked(useExpenseReports).mockReturnValue({ data: reportsMock } as any);
        vi.mocked(useExpenseReportPaymentLinks).mockReturnValue({ data: linksMock } as any);
    });

    it('renderiza cada relatório vinculado com seu próprio valor (sem troca entre linhas)', async () => {
        const user = userEvent.setup();
        render(<ExpenseReportPaymentList />);

        const paymentCard = screen.getByText('PAY-EXP-001').closest('[class]')!;
        await user.click(paymentCard);

        // Dois relatórios distintos, cada um na sua linha (key=link.id)
        const row1 = await screen.findByText('ND-001');
        const row1Container = row1.closest('div.flex.justify-between') as HTMLElement;
        const row2 = screen.getByText('ND-002').closest('div.flex.justify-between') as HTMLElement;

        // O valor do vínculo (link.amount) aparece na linha correta, sem troca.
        expect(within(row1Container).getByText('R$ 200,00')).toBeInTheDocument();
        expect(within(row2).getByText('R$ 150,00')).toBeInTheDocument();
        expect(within(row1Container).queryByText('R$ 150,00')).not.toBeInTheDocument();
        expect(within(row2).queryByText('R$ 200,00')).not.toBeInTheDocument();
    });
});
