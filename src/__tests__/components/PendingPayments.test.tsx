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
        expect(screen.getByText('FA-001')).toBeInTheDocument();
    });

    it('resolve e exibe o nome do cliente em vez de "-"', () => {
        render(<PendingPayments />);
        // Should show "ACME Ltda" from useCustomers lookup, not "-"
        expect(screen.getByText('ACME Ltda')).toBeInTheDocument();
        // "-" should not appear for items that have a resolved name
        const rows = screen.queryAllByText('-');
        // The single invoice item should NOT display "-" as its client name
        expect(screen.queryByText('-')).not.toBeInTheDocument();
    });

    it('abre o painel de detalhes ao clicar em um item', async () => {
        const user = userEvent.setup();
        render(<PendingPayments />);

        const row = screen.getByText('FA-001').closest('[class*="grid"]');
        expect(row).toBeTruthy();
        await user.click(row!);

        // Detail panel should now be visible
        expect(screen.getAllByText('FA-001').length).toBeGreaterThan(1);
        // The "Cliente" section should be visible in the detail (multiple matches expected - list header + detail panel)
        expect(screen.getAllByText('Cliente').length).toBeGreaterThan(1);
        expect(screen.getAllByText('ACME Ltda').length).toBeGreaterThan(0);
    });

    it('exibe o nome do projeto no painel de detalhes quando project_id está presente', async () => {
        const user = userEvent.setup();
        render(<PendingPayments />);

        const row = screen.getByText('FA-001').closest('[class*="grid"]');
        await user.click(row!);

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

        expect(screen.getByText('FF-001')).toBeInTheDocument();
        expect(screen.getByText('Fornecedor ABC')).toBeInTheDocument();
    });
});
