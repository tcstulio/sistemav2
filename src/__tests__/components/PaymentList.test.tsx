import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import PaymentList from '../../components/PaymentList';
import { useDolibarr } from '../../context/DolibarrContext';
import { usePayments } from '../../hooks/dolibarr';
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
