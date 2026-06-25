import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExpenseReportPaymentList from '../../components/Finance/ExpenseReportPaymentList';
import { formatCurrency } from '../../utils/formatUtils';

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

// ============================================================
// #825 — chaves estáveis nos relatórios de despesa vinculados
// ============================================================
describe('ExpenseReportPaymentList — chaves estáveis nos relatórios vinculados (#825)', () => {
    const twoReports = [
        { id: '10', ref: 'ND-001', fk_user_author: '42', project_id: '3', date_debut: 1700000000, date_fin: 1700086400, total_ttc: 350, statut: '5' },
        { id: '11', ref: 'ND-002', fk_user_author: '99', project_id: '3', date_debut: 1700000000, date_fin: 1700086400, total_ttc: 200, statut: '5' },
    ];
    const twoLinks = [
        { id: 'lnk-A', fk_payment: '1', fk_expensereport: '10', amount: 300 },
        { id: 'lnk-B', fk_payment: '1', fk_expensereport: '11', amount: 150 },
    ];
    const paymentNoDirect = {
        id: '1',
        ref: 'PAY-EXP-001',
        amount: 450,
        date_payment: 1700000000,
        fk_expensereport: '',
        fk_bank: '2',
        fk_user_creat: '99',
        num_paiement: 'TRF-001',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useExpenseReportPayments).mockReturnValue({
            data: [paymentNoDirect as any],
            isLoading: false,
            error: null,
        } as any);
        vi.mocked(useExpenseReports).mockReturnValue({ data: twoReports as any } as any);
        vi.mocked(useExpenseReportPaymentLinks).mockReturnValue({ data: twoLinks as any } as any);
    });

    it('cada relatório vinculado aparece com seu ref e valores corretos (sem troca, #825)', async () => {
        const user = userEvent.setup();
        render(<ExpenseReportPaymentList />);

        // Abre o detalhe do pagamento
        const card = screen.getByText('PAY-EXP-001').closest('[class]') as HTMLElement;
        await user.click(card);

        // Cada relatório em sua própria linha (chave estável = link.id)
        const refA = await screen.findByText('ND-001');
        const refB = screen.getByText('ND-002');

        const rowA = refA.closest('div.flex.items-center.justify-between') as HTMLElement;
        const rowB = refB.closest('div.flex.items-center.justify-between') as HTMLElement;

        // Linha A: relatório ND-001 (total 350) + valor do link (300)
        expect(rowA.textContent).toContain('ND-001');
        expect(rowA.textContent).toContain(formatCurrency(350));
        expect(rowA.textContent).toContain(formatCurrency(300));
        expect(rowA.textContent).not.toContain('ND-002');

        // Linha B: relatório ND-002 (total 200) + valor do link (150)
        expect(rowB.textContent).toContain('ND-002');
        expect(rowB.textContent).toContain(formatCurrency(200));
        expect(rowB.textContent).toContain(formatCurrency(150));
        expect(rowB.textContent).not.toContain('ND-001');
    });
});
