import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { Invoice } from '../../types';

// --- Mocks das dependências externas do InvoiceList ---

vi.mock('../../hooks/dolibarr', () => ({
    useInvoices: vi.fn(),
    useCustomers: vi.fn(),
    useProjects: vi.fn(),
    useProducts: vi.fn(),
    useShipments: vi.fn(),
    useInvoiceLines: vi.fn(),
    useUsers: vi.fn(),
    usePayments: vi.fn(),
    usePaymentInvoiceLinks: vi.fn(),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'http://test', apiKey: 'key' },
        refreshData: vi.fn(),
        canDo: () => true,
    })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../hooks/useMutations', () => ({
    useInvoiceMutations: vi.fn(() => ({
        createInvoice: { mutateAsync: vi.fn() },
    })),
}));

vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: vi.fn(() => vi.fn(() => true)),
}));

vi.mock('../../hooks/useDolibarrLink', () => ({
    useDolibarrLink: vi.fn(() => ({ openLink: vi.fn() })),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        deleteInvoice: vi.fn(),
        validateInvoice: vi.fn(),
        downloadDocument: vi.fn(),
    },
}));

vi.mock('../../services/api/commercial', () => ({
    cloneInvoice: vi.fn(),
}));

vi.mock('../../utils/notifyError', () => ({
    notifyError: vi.fn(),
}));

// Sub-componentes pesados/condicionais não exercitados nestes testes de paginação.
vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));
vi.mock('../../components/common/PdfPreviewModal', () => ({
    PdfPreviewModal: () => null,
}));
vi.mock('../../components/common/RichTextEditor', () => ({
    RichTextEditor: () => null,
}));
vi.mock('../../components/Modals/CustomerPaymentModal', () => ({
    CustomerPaymentModal: () => null,
}));

import {
    useInvoices,
    useCustomers,
    useProjects,
    useProducts,
    useShipments,
    useInvoiceLines,
    useUsers,
    usePayments,
    usePaymentInvoiceLinks,
} from '../../hooks/dolibarr';

import InvoiceList from '../../components/InvoiceList';

// --- Fábrica de dados ---

function makeInvoices(n: number): Invoice[] {
    return Array.from({ length: n }, (_, k) => ({
        id: String(k + 1),
        ref: `FA${String(k + 1).padStart(4, '0')}`,
        socid: '1',
        date: k + 1, // segundos unix crescentes -> ordenação determinística
        total_ttc: 100,
        statut: '1',
        type: '0',
    } as unknown as Invoice));
}

function setupHooks(invoices: Invoice[]) {
    vi.mocked(useInvoices).mockReturnValue({ data: invoices, refetch: vi.fn(), isLoading: false, error: null } as any);
    vi.mocked(useCustomers).mockReturnValue({ data: [{ id: '1', name: 'Cliente Teste' }], isLoading: false, error: null } as any);
    vi.mocked(useProjects).mockReturnValue({ data: [], isLoading: false, error: null } as any);
    vi.mocked(useProducts).mockReturnValue({ data: [], isLoading: false, error: null } as any);
    vi.mocked(useShipments).mockReturnValue({ data: [], isLoading: false, error: null } as any);
    vi.mocked(useInvoiceLines).mockReturnValue({ data: [], isLoading: false, error: null } as any);
    vi.mocked(useUsers).mockReturnValue({ data: [], isLoading: false, error: null } as any);
    vi.mocked(usePayments).mockReturnValue({ data: [], isLoading: false, error: null } as any);
    vi.mocked(usePaymentInvoiceLinks).mockReturnValue({ data: [], isLoading: false, error: null } as any);
}

// Localiza os botões prev/next do rodapé de paginação via o texto "Pág N".
function getPaginationButtons() {
    const pageSpan = screen.getByText(/Pág \d+/);
    const footer = pageSpan.closest('div')!.parentElement!;
    const buttons = within(footer).getAllByRole('button');
    return { prev: buttons[0], next: buttons[1] };
}

describe('InvoiceList — paginação (#826)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('aplica a fatia paginada: mostra apenas `limit` faturas por página', () => {
        const invoices = makeInvoices(25); // limit padrão = 20
        setupHooks(invoices);
        render(<InvoiceList />);

        // Página 0: apenas 20 cards (limit default = 20).
        const cards = screen.getAllByRole('button', { name: /Abrir fatura FA/ });
        expect(cards).toHaveLength(20);
    });

    it('navegar para a próxima página muda as faturas exibidas', () => {
        const invoices = makeInvoices(25);
        setupHooks(invoices);
        render(<InvoiceList />);

        // Ordenação default = data desc -> FA0025 (maior data) aparece na pág 0.
        expect(screen.getByRole('button', { name: 'Abrir fatura FA0025' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Abrir fatura FA0001' })).toBeNull();

        fireEvent.click(getPaginationButtons().next);

        // Pág 1: últimos 5 (FA0005..FA0001); FA0025 não deve mais aparecer.
        expect(screen.getByRole('button', { name: 'Abrir fatura FA0001' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Abrir fatura FA0025' })).toBeNull();
        expect(screen.getAllByRole('button', { name: /Abrir fatura FA/ })).toHaveLength(5);
    });

    it('o total do ListTotalBar reflete apenas a página atual', () => {
        const invoices = makeInvoices(25); // 100 cada -> pág0=2000, pág1=500
        setupHooks(invoices);
        render(<InvoiceList />);

        expect(screen.getByTestId('list-total-value')).toHaveTextContent(/2\.000,00/);

        fireEvent.click(getPaginationButtons().next);

        expect(screen.getByTestId('list-total-value')).toHaveTextContent(/500,00/);
    });

    it('hasNext desabilita o botão "próximo" na última página', () => {
        const invoices = makeInvoices(25);
        setupHooks(invoices);
        render(<InvoiceList />);

        // 25 itens, limit 20 -> pág 0 tem próxima (25 > 20).
        expect(getPaginationButtons().next).not.toBeDisabled();

        fireEvent.click(getPaginationButtons().next);

        // Pág 1 (última): 25 > 40? não -> sem próxima.
        expect(getPaginationButtons().next).toBeDisabled();
    });

    it('voltar para a página anterior restaura a fatia correta', () => {
        const invoices = makeInvoices(25);
        setupHooks(invoices);
        render(<InvoiceList />);

        const { next, prev } = getPaginationButtons();
        fireEvent.click(next);
        fireEvent.click(prev);

        expect(screen.getAllByRole('button', { name: /Abrir fatura FA/ })).toHaveLength(20);
        expect(screen.getByTestId('list-total-value')).toHaveTextContent(/2\.000,00/);
    });
});
