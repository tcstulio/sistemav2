import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaymentList from '../../components/PaymentList';
import { useDolibarr } from '../../context/DolibarrContext';
import { usePayments, useCustomers, useProjects } from '../../hooks/dolibarr';
import { formatCurrency } from '../../utils/formatUtils';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const baseConfig = { apiUrl: 'http://test', apiKey: 'key' };

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: baseConfig, isLoading: false, error: null })),
}));

const payments = [
    { id: 1, ref: 'PAY-001', date_payment: '2024-01-15', amount: 1500, mode_id: 2 },
    { id: 2, ref: 'PAY-002', date_payment: '2024-01-16', amount: 456.78, mode_id: 4 },
];

vi.mock('../../hooks/dolibarr', () => ({
    usePayments: vi.fn(() => ({
        data: payments,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
    })),
    useInvoices: vi.fn(() => ({ data: [] })),
    usePaymentInvoiceLinks: vi.fn(() => ({ data: [] })),
    useBankAccounts: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
    useCustomers: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
}));

// AutoSizer mockado: reporta altura real para que o react-window renderize as linhas.
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

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDolibarr).mockReturnValue({ config: baseConfig, isLoading: false, error: null } as any);
});

describe('PaymentList — Currency standardization (#639/#643)', () => {
    it('renders the header total in BRL via formatCurrency (R$, 2 decimals, no $ prefix)', () => {
        const { container } = render(<PaymentList />);

        const expectedTotal = formatCurrency(1500 + 456.78);
        // Intl (pt-BR) usa espaço não-quebrável entre "R$" e o valor — por isso
        // comparamos via textContent (mesmo formatter) em vez de getByText.
        expect(container.textContent).toContain(expectedTotal);

        // Contém prefixo BRL "R$"
        expect(container.textContent).toContain('R$');
        // Não contém "$" isolado (USD) antes de dígito — padrão do bug "$1234"
        expect(container.textContent).not.toMatch(/\$\d/);
        // Formato com exatamente 2 casas decimais (",XX")
        expect(expectedTotal).toMatch(/,\d{2}$/);
    });

    it('renders each payment amount in BRL via formatCurrency (no $ prefix)', () => {
        const { container } = render(<PaymentList />);

        // Cada linha renderiza "+{formatCurrency(amount)}".
        expect(container.textContent).toContain(`+${formatCurrency(1500)}`);
        expect(container.textContent).toContain(`+${formatCurrency(456.78)}`);

        // Garante que não há "$" isolado em contexto de moeda.
        expect(container.textContent).not.toMatch(/\$\d/);
    });

    it('renders R$ 0,00 total when there are no payments', () => {
        vi.mocked(usePayments).mockReturnValue({
            data: [],
            isLoading: false,
            isFetching: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
        } as any);

        const { container } = render(<PaymentList />);

        expect(container.textContent).toContain(formatCurrency(0));
    });
});

// ---------------------------------------------------------------------------
// Suite: loading / error states (#556)
// ---------------------------------------------------------------------------
describe('PaymentList — loading e erro (#556)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useDolibarr).mockReturnValue({ config: baseConfig, isLoading: false, error: null } as any);
    });

    it('exibe indicador de carregamento quando paymentsLoading=true e sem dados', () => {
        vi.mocked(usePayments).mockReturnValue({
            data: undefined,
            isLoading: true,
            isFetching: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
        } as any);

        const { container } = render(<PaymentList />);
        expect(container.textContent).toMatch(/Carregando/i);
    });

    it('exibe estado de carregamento quando config não está disponível', () => {
        vi.mocked(useDolibarr).mockReturnValue({ config: undefined, isLoading: true, error: null } as any);
        vi.mocked(usePayments).mockReturnValue({
            data: undefined,
            isLoading: false,
            isFetching: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
        } as any);

        const { container } = render(<PaymentList />);
        expect(container.textContent).toMatch(/Carregando/i);
    });

    it('exibe estado de erro quando isError=true', () => {
        vi.mocked(usePayments).mockReturnValue({
            data: undefined,
            isLoading: false,
            isFetching: false,
            isError: true,
            error: new Error('Falha na sincronização'),
            refetch: vi.fn(),
        } as any);

        const { container } = render(<PaymentList />);
        expect(container.textContent).toContain('Falha na sincronização');
    });
});

// ---------------------------------------------------------------------------
// Suite: exibição de cliente/evento e clique (#556)
// ---------------------------------------------------------------------------
describe('PaymentList — cliente, evento e clique (#556)', () => {
    const paymentsWithContext = [
        { id: 1, ref: 'PAY-001', date_payment: '2024-01-15', amount: 1500, mode_id: 2, fk_soc: 10, project_id: 5 },
    ];
    const customersMock = [{ id: '10', name: 'Cliente Pagante', client: '1', status: '1', fournisseur: '0' }];
    const projectsMock = [{ id: '5', title: 'Evento de Teste', ref: 'PROJ-005' }];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useDolibarr).mockReturnValue({ config: baseConfig, isLoading: false, error: null } as any);
        vi.mocked(usePayments).mockReturnValue({
            data: paymentsWithContext,
            isLoading: false,
            isFetching: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
        } as any);
    });

    it('exibe o nome do cliente no card do pagamento', () => {
        vi.mocked(useCustomers).mockReturnValue({ data: customersMock } as any);
        vi.mocked(useProjects).mockReturnValue({ data: projectsMock } as any);
        render(<PaymentList />);
        expect(screen.getByText('Cliente Pagante')).toBeInTheDocument();
    });

    it('exibe o título do evento/projeto no card do pagamento', () => {
        vi.mocked(useCustomers).mockReturnValue({ data: customersMock } as any);
        vi.mocked(useProjects).mockReturnValue({ data: projectsMock } as any);
        render(<PaymentList />);
        expect(screen.getByText('Evento de Teste')).toBeInTheDocument();
    });

    it('clicar em um pagamento abre o painel de detalhe', async () => {
        const user = userEvent.setup();
        vi.mocked(useCustomers).mockReturnValue({ data: customersMock } as any);
        vi.mocked(useProjects).mockReturnValue({ data: projectsMock } as any);
        render(<PaymentList />);

        const paymentRef = screen.getByText('PAY-001');
        await user.click(paymentRef);

        // O detalhe exibe "Cliente e Evento" no cabeçalho do card
        expect(screen.getByText('Cliente e Evento')).toBeInTheDocument();
    });
});
