import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../hooks/useConfirm';
import InvoiceList from '../../components/InvoiceList';
import { cloneInvoice } from '../../services/api/commercial';

const { toastMock } = vi.hoisted(() => ({
    toastMock: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key' } })),
}));

const mockRefetch = vi.fn();
vi.mock('../../hooks/dolibarr', () => ({
    useInvoices: vi.fn(() => ({
        data: [
            {
                id: 'inv1',
                ref: 'FA2501-0001',
                socid: 'cust1',
                date: 1700000000,
                total_ttc: 1200,
                statut: '1',
                type: '0',
                project_id: null,
                order_id: null,
            },
        ],
        isRefetching: false,
        refetch: mockRefetch,
    })),
    useCustomers: vi.fn(() => ({ data: [{ id: 'cust1', name: 'Cliente Teste' }] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useProducts: vi.fn(() => ({ data: [] })),
    useShipments: vi.fn(() => ({ data: [] })),
    useInvoiceLines: vi.fn(() => ({ data: [], refetch: mockRefetch })),
    useUsers: vi.fn(() => ({ data: [] })),
    usePayments: vi.fn(() => ({ data: [] })),
    usePaymentInvoiceLinks: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../hooks/useDolibarrLink', () => ({
    useDolibarrLink: vi.fn(() => ({ openLink: vi.fn() })),
}));

vi.mock('../../hooks/useMutations', () => ({
    useInvoiceMutations: vi.fn(() => ({
        createInvoice: { mutateAsync: vi.fn() },
    })),
}));

vi.mock('../../services/api/commercial', () => ({
    cloneInvoice: vi.fn(),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        deleteInvoice: vi.fn(),
        validateInvoice: vi.fn(),
        downloadDocument: vi.fn(),
    },
}));

vi.mock('../../utils/sanitizeHtml', () => ({
    sanitizeHtml: (html: string) => html,
}));

const mockConfig = { apiUrl: 'http://test', apiKey: 'key' };

const renderComponent = (props?: Record<string, any>) =>
    render(
        <ConfirmProvider>
            <InvoiceList {...props} />
        </ConfirmProvider>
    );

describe('InvoiceList — Duplicate button', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(window, 'confirm').mockImplementation(() => false);
    });

    it('shows toast.success and refetches when duplicate succeeds', async () => {
        vi.mocked(cloneInvoice).mockResolvedValue('new-id');
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const confirmBtn = await screen.findByText('Confirmar');
        await user.click(confirmBtn);

        await waitFor(() => {
            expect(cloneInvoice).toHaveBeenCalledWith(mockConfig, 'inv1');
            expect(toastMock.success).toHaveBeenCalledWith('Fatura duplicada com sucesso');
            expect(mockRefetch).toHaveBeenCalled();
        });
        expect(window.confirm).not.toHaveBeenCalled();
    });

    it('shows toast.error when duplicate fails', async () => {
        vi.mocked(cloneInvoice).mockRejectedValue(new Error('Network error'));
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const confirmBtn = await screen.findByText('Confirmar');
        await user.click(confirmBtn);

        await waitFor(() => {
            expect(cloneInvoice).toHaveBeenCalledWith(mockConfig, 'inv1');
            expect(toastMock.error).toHaveBeenCalledWith('Erro ao duplicar fatura');
        });
    });

    it('does NOT call cloneInvoice when user cancels confirmation', async () => {
        vi.mocked(cloneInvoice).mockResolvedValue('new-id');
        const user = userEvent.setup();
        renderComponent();

        const dupBtn = await screen.findByLabelText('Duplicar');
        await user.click(dupBtn);

        const cancelBtn = await screen.findByText('Cancelar');
        await user.click(cancelBtn);

        await waitFor(() => {
            expect(cloneInvoice).not.toHaveBeenCalled();
            expect(toastMock.success).not.toHaveBeenCalled();
        });
    });
});
