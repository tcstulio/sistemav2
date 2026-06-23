import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingPayments } from '../../components/PendingPayments';

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'http://test', apiKey: 'key' },
    })),
}));

const mockInvoices = [
    {
        id: '10',
        ref: 'FA-001',
        socid: '5',
        project_id: '3',
        total_ttc: 1500,
        statut: '1',
        date: 1700000000,
        date_lim_reglement: 1700086400, // slightly in the future relative to test
        paye: '0',
        date_modification: 1700000000,
    },
];

const mockSupplierInvoices = [
    {
        id: '20',
        ref: 'FF-001',
        socid: '7',
        project_id: undefined,
        total_ttc: 800,
        statut: '1',
        date: 1700000000,
        date_lim_reglement: 1700086400,
        paye: '0',
        date_modification: 1700000000,
    },
];

const mockCustomers = [{ id: '5', name: 'ACME Ltda', status: '1', client: '1', fournisseur: '0' }];
const mockSuppliers = [{ id: '7', name: 'Fornecedor ABC', status: '1', client: '0', fournisseur: '1' }];
const mockProjects = [{ id: '3', ref: 'PROJ-001', title: 'Projeto Alpha', socid: '5', statut: '1', progress: 50 }];

vi.mock('../../hooks/dolibarr', () => ({
    useInvoices: vi.fn(() => ({ data: mockInvoices, isLoading: false, error: null })),
    useSupplierInvoices: vi.fn(() => ({ data: mockSupplierInvoices, isLoading: false, error: null })),
    useCustomers: vi.fn(() => ({ data: mockCustomers })),
    useSuppliers: vi.fn(() => ({ data: mockSuppliers })),
    useProjects: vi.fn(() => ({ data: mockProjects })),
}));

// ------------------------------------------------------------------
// Import mocked hooks after mock setup
// ------------------------------------------------------------------
import { useInvoices, useSupplierInvoices } from '../../hooks/dolibarr';

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('PendingPayments', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useInvoices).mockReturnValue({ data: mockInvoices, isLoading: false, error: null } as any);
        vi.mocked(useSupplierInvoices).mockReturnValue({ data: mockSupplierInvoices, isLoading: false, error: null } as any);
    });

    it('renderiza a lista de receivables (A Receber) com itens', () => {
        render(<PendingPayments />);
        // Item rendered in both desktop grid and mobile card — at least one match expected
        expect(screen.getAllByText('FA-001').length).toBeGreaterThan(0);
    });

    it('resolve e exibe o nome do cliente em vez de "-"', () => {
        render(<PendingPayments />);
        // Should show "ACME Ltda" from useCustomers lookup, not "-"
        expect(screen.getAllByText('ACME Ltda').length).toBeGreaterThan(0);
        // "-" should not appear as the client name for items that have a resolved name
        expect(screen.queryByText('-')).not.toBeInTheDocument();
    });

    it('abre o painel de detalhes ao clicar em um item', async () => {
        const user = userEvent.setup();
        render(<PendingPayments />);

        // Click the desktop-row div (hidden md:grid) — it is the clickable parent
        const desktopRow = screen.getAllByText('FA-001')[0].closest('[class*="grid"]');
        expect(desktopRow).toBeTruthy();
        // Walk up to the clickable outer div (rounded-lg border)
        const clickableRow = desktopRow!.closest('[class*="rounded-lg"]');
        expect(clickableRow).toBeTruthy();
        await user.click(clickableRow!);

        // Detail panel should now be visible — FA-001 appears in list + detail header
        expect(screen.getAllByText('FA-001').length).toBeGreaterThan(1);
        // The "Cliente" section should be visible in the detail
        expect(screen.getAllByText('Cliente').length).toBeGreaterThan(0);
        expect(screen.getAllByText('ACME Ltda').length).toBeGreaterThan(0);
    });

    it('exibe o nome do projeto no painel de detalhes quando project_id está presente', async () => {
        const user = userEvent.setup();
        render(<PendingPayments />);

        const desktopRow = screen.getAllByText('FA-001')[0].closest('[class*="grid"]');
        const clickableRow = desktopRow!.closest('[class*="rounded-lg"]');
        await user.click(clickableRow!);

        expect(screen.getByText('Projeto Alpha')).toBeInTheDocument();
    });

    it('mostra estado de loading quando isLoading é true', () => {
        vi.mocked(useInvoices).mockReturnValue({ data: [], isLoading: true, error: null } as any);
        render(<PendingPayments />);
        expect(screen.getByText('Carregando...')).toBeInTheDocument();
    });

    it('mostra estado de erro quando error está presente', () => {
        vi.mocked(useInvoices).mockReturnValue({ data: [], isLoading: false, error: new Error('fail') } as any);
        render(<PendingPayments />);
        expect(screen.getByText(/Erro ao carregar dados/)).toBeInTheDocument();
    });

    it('mostra estado vazio quando não há itens pendentes', () => {
        vi.mocked(useInvoices).mockReturnValue({ data: [], isLoading: false, error: null } as any);
        render(<PendingPayments />);
        expect(screen.getByText('Nenhum pagamento pendente encontrado.')).toBeInTheDocument();
    });

    it('resolve e exibe o nome do fornecedor na aba A Pagar', async () => {
        const user = userEvent.setup();
        render(<PendingPayments />);

        // Switch to payables tab
        const payablesCard = screen.getByText('Total a Pagar').closest('[class*="rounded-xl"]');
        await user.click(payablesCard!);

        // Item rendered in both desktop grid and mobile card
        expect(screen.getAllByText('FF-001').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Fornecedor ABC').length).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------
    // Layout / responsividade (#620)
    // -------------------------------------------------------------------

    it('cabeçalho de colunas usa classe "hidden" para colapsar no mobile', () => {
        const { container } = render(<PendingPayments />);
        // O header de colunas deve ter "hidden" para não aparecer em telas estreitas
        const colHeader = container.querySelector('.hidden.md\\:grid');
        expect(colHeader).toBeTruthy();
        // E deve conter "Referência"
        expect(colHeader?.textContent).toContain('Referência');
    });

    it('não usa offset fixo h-[calc(100%-240px)] no container da lista', () => {
        const { container } = render(<PendingPayments />);
        const html = container.innerHTML;
        expect(html).not.toContain('calc(100%-240px)');
        expect(html).not.toContain('h-[calc(100%');
    });

    it('usa PageLayout/PageHeader: título "Pagamentos Pendentes" presente no cabeçalho padrão', () => {
        render(<PendingPayments />);
        // PageHeader renderiza a heading h1
        const heading = screen.getByRole('heading', { name: /Pagamentos Pendentes/i });
        expect(heading).toBeInTheDocument();
    });

    it('alterna entre abas filtrando itens corretamente', async () => {
        const user = userEvent.setup();
        render(<PendingPayments />);

        // Aba A Receber por padrão — FA-001 visível, FF-001 não
        expect(screen.getAllByText('FA-001').length).toBeGreaterThan(0);
        expect(screen.queryByText('FF-001')).not.toBeInTheDocument();

        // Alterna para A Pagar
        const payablesCard = screen.getByText('Total a Pagar').closest('[class*="rounded-xl"]');
        await user.click(payablesCard!);

        expect(screen.getAllByText('FF-001').length).toBeGreaterThan(0);
        expect(screen.queryByText('FA-001')).not.toBeInTheDocument();
    });
});
