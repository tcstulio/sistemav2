import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SupplierInvoiceList from '../../components/SupplierInvoiceList';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { DolibarrService } from '../../services/dolibarrService';
import { useSupplierInvoices, useSuppliers } from '../../hooks/dolibarr';
import type { SupplierInvoice } from '../../types';
import { formatCurrency } from '../../utils/formatUtils';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        validateSupplierInvoice: vi.fn().mockResolvedValue({}),
        setSupplierInvoiceToDraft: vi.fn().mockResolvedValue({}),
        deleteSupplierInvoice: vi.fn().mockResolvedValue({}),
        fetchDocuments: vi.fn().mockResolvedValue([]),
        uploadDocument: vi.fn().mockResolvedValue({}),
        deleteDocument: vi.fn().mockResolvedValue({}),
        downloadDocument: vi.fn().mockResolvedValue({}),
        createSupplierInvoice: vi.fn().mockResolvedValue({}),
        updateSupplierInvoice: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'http://test', apiKey: 'key', themeColor: 'indigo', darkMode: false },
        refreshData: vi.fn(),
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useSupplierInvoices: vi.fn(() => ({ data: [], refetch: vi.fn() })),
    useSuppliers: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useSupplierInvoiceLines: vi.fn(() => ({ data: [] })),
    useUsers: vi.fn(() => ({ data: [] })),
    useSupplierPayments: vi.fn(() => ({ data: [] })),
    useSupplierPaymentInvoiceLinks: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/useDolibarrLink', () => ({
    useDolibarrLink: vi.fn(() => ({ openLink: vi.fn() })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('./../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => null,
}));

vi.mock('./../../components/Finance/ReceiptWizard', () => ({
    ReceiptWizard: () => null,
}));

vi.mock('./../../components/common/RichTextEditor', () => ({
    RichTextEditor: () => null,
}));

vi.mock('./../../components/Modals/SupplierPaymentModal', () => ({
    SupplierPaymentModal: () => null,
}));

const mockDraftInvoice: SupplierInvoice = {
    id: 'inv1',
    ref: 'FA-DRAFT-001',
    socid: 'sup1',
    type: '0',
    date: Math.floor(new Date('2024-06-01').getTime() / 1000),
    total_ttc: 1500,
    paye: '0',
    statut: '0',
};

const mockUnpaidInvoice: SupplierInvoice = {
    id: 'inv2',
    ref: 'FA-UNPAID-001',
    socid: 'sup1',
    type: '0',
    date: Math.floor(new Date('2024-06-02').getTime() / 1000),
    total_ttc: 2500,
    paye: '0',
    statut: '1',
};

const mockPaidInvoice: SupplierInvoice = {
    id: 'inv3',
    ref: 'FA-PAID-001',
    socid: 'sup1',
    type: '0',
    date: Math.floor(new Date('2024-06-03').getTime() / 1000),
    total_ttc: 800,
    paye: '1',
    statut: '2',
};

const renderWithProvider = (invoices: SupplierInvoice[] = []) => {
    vi.mocked(useSupplierInvoices).mockReturnValue({ data: invoices, refetch: vi.fn() } as any);
    vi.mocked(useSuppliers).mockReturnValue({
        data: [{ id: 'sup1', name: 'Fornecedor Alpha' }],
    } as any);

    return render(
        <ConfirmProvider>
            <SupplierInvoiceList />
        </ConfirmProvider>
    );
};

describe('SupplierInvoiceList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the page header', () => {
        renderWithProvider();
        expect(screen.getByText('Faturas de Fornecedor')).toBeTruthy();
    });

    it('renders empty state when no invoices', () => {
        renderWithProvider();
        expect(screen.getByText('Nenhuma fatura encontrada')).toBeTruthy();
    });

    it('renders invoice refs in the list', () => {
        renderWithProvider([mockDraftInvoice, mockUnpaidInvoice, mockPaidInvoice]);
        expect(screen.getByText('FA-DRAFT-001')).toBeTruthy();
        expect(screen.getByText('FA-UNPAID-001')).toBeTruthy();
        expect(screen.getByText('FA-PAID-001')).toBeTruthy();
    });

    it('shows supplier name for invoices', () => {
        renderWithProvider([mockDraftInvoice]);
        expect(screen.getByText('Fornecedor Alpha')).toBeTruthy();
    });

    it('shows Validar button when a draft invoice is selected', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));

        await waitFor(() => {
            expect(screen.getByText('Validar')).toBeTruthy();
        });
    });

    it('opens in-app confirm dialog (not native confirm) when clicking Validar', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));

        await waitFor(() => {
            expect(screen.getByText('Validar')).toBeTruthy();
        });

        await user.click(screen.getByText('Validar'));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Confirma a validação desta fatura?')).toBeTruthy();
    });

    it('validates invoice when user confirms the dialog', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));

        await waitFor(() => {
            expect(screen.getByText('Validar')).toBeTruthy();
        });

        await user.click(screen.getByText('Validar'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(DolibarrService.validateSupplierInvoice).toHaveBeenCalledWith(
                expect.anything(),
                'inv1'
            );
        });
    });

    it('does NOT validate invoice when user cancels the dialog', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));

        await waitFor(() => {
            expect(screen.getByText('Validar')).toBeTruthy();
        });

        await user.click(screen.getByText('Validar'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(DolibarrService.validateSupplierInvoice).not.toHaveBeenCalled();
        });
    });

    it('shows Reabrir button for paid invoices and opens confirm dialog', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockPaidInvoice]);

        await user.click(screen.getByText('FA-PAID-001'));

        await waitFor(() => {
            expect(screen.getByText('Reabrir')).toBeTruthy();
        });

        await user.click(screen.getByText('Reabrir'));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Reabrir fatura de fornecedor (voltar para rascunho)?')).toBeTruthy();
    });

    it('does not use native window.confirm', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm');
        const alertSpy = vi.spyOn(window, 'alert');
        const user = userEvent.setup();

        renderWithProvider([mockDraftInvoice]);

        await user.click(screen.getByText('FA-DRAFT-001'));

        await waitFor(() => {
            expect(screen.getByText('Validar')).toBeTruthy();
        });

        await user.click(screen.getByText('Validar'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(DolibarrService.validateSupplierInvoice).toHaveBeenCalled();
        });

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();

        confirmSpy.mockRestore();
        alertSpy.mockRestore();
    });
});

describe('SupplierInvoiceList — Total bar (#486)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the total bar with the sum of all visible invoices as BRL', () => {
        renderWithProvider([mockDraftInvoice, mockUnpaidInvoice, mockPaidInvoice]);

        const totalBar = screen.getByTestId('list-total-bar');
        expect(totalBar).toBeTruthy();

        const totalValue = screen.getByTestId('list-total-value');
        // 1500 + 2500 + 800 = 4800
        expect(totalValue.textContent).toBe(formatCurrency(4800));
    });

    it('shows R$ 0,00 when there are no invoices', () => {
        renderWithProvider([]);

        const totalValue = screen.getByTestId('list-total-value');
        expect(totalValue.textContent).toBe(formatCurrency(0));
    });

    it('updates the total when filtering by status tab', async () => {
        const user = userEvent.setup();
        renderWithProvider([mockDraftInvoice, mockUnpaidInvoice, mockPaidInvoice]);

        // Initially shows sum of all (1500 + 2500 + 800 = 4800)
        expect(screen.getByTestId('list-total-value').textContent).toBe(formatCurrency(4800));

        // Filter to "Pagas" (statut = '2')
        await user.click(screen.getByText('Pagas'));

        await waitFor(() => {
            expect(screen.getByTestId('list-total-value').textContent).toBe(formatCurrency(800));
        });
    });
});
