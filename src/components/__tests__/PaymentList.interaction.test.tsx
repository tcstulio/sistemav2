import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaymentList from '../PaymentList';
import { useDolibarr } from '../../context/DolibarrContext';
import { usePayments, useInvoices, usePaymentInvoiceLinks, useBankAccounts, useUsers, useCustomers, useProjects } from '../../hooks/dolibarr';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// AutoSizer usa ResizeObserver como construtor; o mock global usa arrow function.
// Substituímos por uma versão que renderiza filhos com dimensões fixas.
vi.mock('react-virtualized-auto-sizer', () => ({
    default: ({ children }: { children: (size: { height: number; width: number }) => React.ReactNode }) =>
        children({ height: 600, width: 400 }),
}));

const baseConfig = { apiUrl: 'http://test', apiKey: 'key' };

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: baseConfig, isLoading: false, error: null })),
}));

// Pagamento com cliente e projeto derivados via fatura vinculada
const mockPaymentWithContext = {
    id: 1,
    ref: 'PAY-001',
    date_payment: new Date('2024-01-15').toISOString(),
    amount: 1500,
    mode_id: 2,
};

// Pagamento sem nenhum vínculo
const mockPaymentNoContext = {
    id: 2,
    ref: 'PAY-002',
    date_payment: new Date('2024-01-16').toISOString(),
    amount: 200,
    mode_id: 2,
};

const mockInvoice = {
    id: '10',
    ref: 'FA-001',
    socid: '5',
    project_id: '3',
    total_ttc: 1500,
    paye: '1' as const,
    statut: '2' as const,
    date: 1700000000,
};

const mockLink = {
    id: 'L1',
    fk_paiement: '1',
    fk_facture: '10',
    amount: 1500,
};

const mockCustomer = { id: '5', name: 'João Silva', status: '1' as const, client: '1', fournisseur: '0' };
const mockProject = { id: '3', ref: 'PROJ-001', title: 'Festa da Ana', socid: '5', statut: '1' as const, progress: 50 };

vi.mock('../../hooks/dolibarr', () => ({
    usePayments: vi.fn(() => ({
        data: [mockPaymentWithContext, mockPaymentNoContext],
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
    })),
    useInvoices: vi.fn(() => ({ data: [mockInvoice] })),
    usePaymentInvoiceLinks: vi.fn(() => ({ data: [mockLink] })),
    useBankAccounts: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
    useCustomers: vi.fn(() => ({ data: [mockCustomer] })),
    useProjects: vi.fn(() => ({ data: [mockProject] })),
}));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDolibarr).mockReturnValue({ config: baseConfig, isLoading: false, error: null } as any);
    vi.mocked(usePayments).mockReturnValue({
        data: [mockPaymentWithContext, mockPaymentNoContext],
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
    } as any);
    vi.mocked(useInvoices).mockReturnValue({ data: [mockInvoice] } as any);
    vi.mocked(usePaymentInvoiceLinks).mockReturnValue({ data: [mockLink] } as any);
    vi.mocked(useBankAccounts).mockReturnValue({ data: [] } as any);
    vi.mocked(useUsers).mockReturnValue({ data: [] } as any);
    vi.mocked(useCustomers).mockReturnValue({ data: [mockCustomer] } as any);
    vi.mocked(useProjects).mockReturnValue({ data: [mockProject] } as any);
});

describe('PaymentList — cliente/evento (#649/#650)', () => {
    it('exibe o nome do cliente no card quando derivado via fatura', () => {
        render(<PaymentList />);
        // PAY-001 está vinculado à FA-001 cujo socid=5 → João Silva
        expect(screen.getAllByText('João Silva').length).toBeGreaterThan(0);
    });

    it('exibe o título do evento/projeto no card quando derivado via fatura', () => {
        render(<PaymentList />);
        // FA-001 tem project_id=3 → Festa da Ana
        expect(screen.getAllByText('Festa da Ana').length).toBeGreaterThan(0);
    });

    it('exibe "Cliente não informado" quando pagamento não tem cliente', () => {
        render(<PaymentList />);
        // PAY-002 não tem fatura vinculada → sem cliente
        expect(screen.getAllByText('Cliente não informado').length).toBeGreaterThan(0);
    });

    it('exibe "Sem evento" quando pagamento não tem projeto', () => {
        render(<PaymentList />);
        expect(screen.getAllByText('Sem evento').length).toBeGreaterThan(0);
    });

    it('clicar no card abre o painel de detalhe com nome do cliente', async () => {
        const user = userEvent.setup();
        render(<PaymentList />);

        const card = screen.getByText('PAY-001');
        await user.click(card);

        // O painel de detalhe deve mostrar o nome do cliente (pode aparecer 2x: card + detalhe)
        expect(screen.getAllByText('João Silva').length).toBeGreaterThan(0);
    });

    it('o detalhe mostra "Cliente não informado" para PAY-002', async () => {
        const user = userEvent.setup();
        render(<PaymentList />);

        const card = screen.getByText('PAY-002');
        await user.click(card);

        expect(screen.getAllByText('Cliente não informado').length).toBeGreaterThan(0);
    });

    it('busca por nome de cliente filtra a lista', async () => {
        const user = userEvent.setup();
        render(<PaymentList />);

        const searchInput = screen.getByPlaceholderText('Buscar pagamento...');
        await user.type(searchInput, 'João Silva');

        // PAY-001 deve aparecer (tem João Silva); PAY-002 deve sumir
        expect(screen.getAllByText('João Silva').length).toBeGreaterThan(0);
        expect(screen.queryByText('PAY-002')).toBeNull();
    });

    it('busca por título de evento filtra a lista', async () => {
        const user = userEvent.setup();
        render(<PaymentList />);

        const searchInput = screen.getByPlaceholderText('Buscar pagamento...');
        await user.type(searchInput, 'Festa da Ana');

        expect(screen.getAllByText('Festa da Ana').length).toBeGreaterThan(0);
        expect(screen.queryByText('PAY-002')).toBeNull();
    });

    it('clique numa fatura vinculada no detalhe chama onNavigate com invoices', async () => {
        const onNavigate = vi.fn();
        const user = userEvent.setup();
        render(<PaymentList onNavigate={onNavigate} />);

        // Abre o detalhe de PAY-001
        await user.click(screen.getByText('PAY-001'));

        // Clica na fatura FA-001
        const invoiceLink = screen.getByText('FA-001');
        await user.click(invoiceLink);

        expect(onNavigate).toHaveBeenCalledWith('invoices', '10');
    });
});
