import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SupplierPaymentList from '../../components/SupplierPaymentList';
import { useDolibarr } from '../../context/DolibarrContext';
import { useSupplierPayments } from '../../hooks/dolibarr';

// --- Mock sonner ---
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// --- Mock DolibarrContext (config resolvido) ---
const baseConfig = { baseUrl: 'http://test', apiKey: 'key' };
vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: baseConfig })),
}));

// --- Fixture de pagamentos ---
const mockPayments = [
    { id: 1, ref: 'SUP-PAY-001', date_payment: '2024-01-01', amount: 1500, mode_id: 2, soc_name: 'Fornecedor ABC' },
    { id: 2, ref: 'SUP-PAY-002', date_payment: '2024-01-02', amount: 500, mode_id: 4, soc_name: 'Fornecedor XYZ' },
];

// --- Mock dolibarr hooks ---
vi.mock('../../hooks/dolibarr', () => ({
    useSupplierPayments: vi.fn(() => ({
        data: mockPayments,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
    })),
    useSupplierInvoices: vi.fn(() => ({ data: [] })),
    useSupplierPaymentInvoiceLinks: vi.fn(() => ({ data: [] })),
    useBankAccounts: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
}));

// Altura que o AutoSizer (mockado) vai reportar. Mutada por teste para simular os
// cenários de "altura resolvida" e "altura zero" (issue #651).
const { autosizer } = vi.hoisted(() => ({ autosizer: { height: 600 } }));

vi.mock('react-virtualized-auto-sizer', () => ({
    default: ({ children }: { children: (size: { height: number; width: number }) => React.ReactNode }) =>
        children({ height: autosizer.height, width: 800 }),
}));

vi.mock('react-window', () => ({
    FixedSizeList: ({
        children,
        itemCount,
        height,
    }: {
        children: (props: { index: number; style: React.CSSProperties }) => React.ReactNode;
        itemCount: number;
        height: number;
    }) => (
        <div data-testid="vw-list" data-height={String(height)}>
            {Array.from({ length: itemCount }, (_, index) =>
                children({ index, style: {} })
            )}
        </div>
    ),
}));

const renderComponent = (props?: Record<string, unknown>) =>
    render(
        <MemoryRouter>
            <SupplierPaymentList {...props} />
        </MemoryRouter>
    );

beforeEach(() => {
    vi.clearAllMocks();
    autosizer.height = 600;
    vi.mocked(useDolibarr).mockReturnValue({ config: baseConfig } as any);
    vi.mocked(useSupplierPayments).mockReturnValue({
        data: mockPayments,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
    } as any);
});

// ---------------------------------------------------------------------------
// Suite 1: Estrutura básica da página
// ---------------------------------------------------------------------------
describe('SupplierPaymentList — estrutura básica', () => {
    it('renderiza o cabeçalho "Pagamentos de Fornecedores"', () => {
        renderComponent();
        expect(screen.getByText('Pagamentos de Fornecedores')).toBeInTheDocument();
    });

    it('renderiza o empty state quando não há pagamentos', () => {
        vi.mocked(useSupplierPayments).mockReturnValue({
            data: [],
            isLoading: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
        } as any);

        renderComponent();
        expect(screen.getByText('Nenhum pagamento encontrado')).toBeInTheDocument();
    });

    it('renderiza as referências dos pagamentos quando há dados', () => {
        renderComponent();
        expect(screen.getByText('SUP-PAY-001')).toBeInTheDocument();
        expect(screen.getByText('SUP-PAY-002')).toBeInTheDocument();
    });

    it('exibe o nome do fornecedor no card da lista', () => {
        renderComponent();
        expect(screen.getByText('Fornecedor ABC')).toBeInTheDocument();
        expect(screen.getByText('Fornecedor XYZ')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// Suite 2: Interação — clique abre detalhe
// ---------------------------------------------------------------------------
describe('SupplierPaymentList — clique abre detalhe', () => {
    it('clicar em um pagamento abre o painel de detalhe com "Faturas Vinculadas"', async () => {
        const user = userEvent.setup();
        renderComponent();

        // Clicar no card do primeiro pagamento
        const paymentRef = screen.getByText('SUP-PAY-001');
        await user.click(paymentRef);

        // Após clicar, o painel de detalhe deve mostrar "Faturas Vinculadas"
        expect(screen.getByText('Faturas Vinculadas')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// Suite 3: Virtualização — fallback de altura (#651)
// ---------------------------------------------------------------------------
describe('SupplierPaymentList — virtualization fallback (#651)', () => {
    it('renderiza linhas mesmo quando AutoSizer reporta height = 0', () => {
        // Cenário-problema: AutoSizer não mede a altura (cadeia flex sem altura
        // resolvida) e reporta 0. A lista deve usar o fallback MIN_LIST_HEIGHT.
        autosizer.height = 0;

        renderComponent();

        // A altura passada para a lista virtualizada não pode ser 0 (fallback aplicado).
        const list = screen.getByTestId('vw-list');
        const resolvedHeight = Number(list.getAttribute('data-height'));
        expect(resolvedHeight).toBeGreaterThan(0);

        // As linhas continuam visíveis/clicáveis mesmo com AutoSizer retornando 0.
        expect(screen.getByText('SUP-PAY-001')).toBeInTheDocument();
        expect(screen.getByText('SUP-PAY-002')).toBeInTheDocument();
    });

    it('passa a altura real quando AutoSizer mede corretamente', () => {
        autosizer.height = 600;

        renderComponent();

        const list = screen.getByTestId('vw-list');
        expect(list.getAttribute('data-height')).toBe('600');
    });
});

// ---------------------------------------------------------------------------
// Suite 4: Estados de carregamento e erro
// ---------------------------------------------------------------------------
describe('SupplierPaymentList — estados de loading/erro', () => {
    it('exibe spinner de carregamento quando isLoading=true e sem dados', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useSupplierPayments).mockReturnValue({
            data: undefined,
            isLoading: true,
            isError: false,
            error: null,
            refetch: vi.fn(),
        } as any);

        renderComponent();

        expect(screen.getByText(/Carregando pagamentos de fornecedor/i)).toBeInTheDocument();
    });

    it('exibe estado de erro quando isError=true', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useSupplierPayments).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: true,
            error: new Error('Falha de sincronização'),
            refetch: vi.fn(),
        } as any);

        renderComponent();

        expect(screen.getByText(/Falha de sincronização/i)).toBeInTheDocument();
    });

    it('exibe tela de carregamento quando config não está disponível', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useDolibarr).mockReturnValue({ config: undefined } as any);

        renderComponent();

        expect(screen.getByText(/Carregando/i)).toBeInTheDocument();
    });
});
