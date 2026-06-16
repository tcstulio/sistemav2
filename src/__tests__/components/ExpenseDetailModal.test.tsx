import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpenseDetailModal } from '../../components/HR/modals/ExpenseDetailModal';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { DolibarrService } from '../../services/dolibarrService';
import { ExpenseReport, DolibarrConfig } from '../../types';
import { toast } from 'sonner';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        fetchDocuments: vi.fn().mockResolvedValue([]),
        uploadDocument: vi.fn(),
        downloadDocument: vi.fn(),
        approveExpenseReport: vi.fn(),
        markExpenseReportAsPaid: vi.fn(),
    },
}));

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any,
};

const baseExpense: ExpenseReport = {
    id: '100',
    ref: 'ER-001',
    fk_user_author: '1',
    date_debut: 1700000000,
    date_fin: 1700100000,
    total_ttc: 150.0,
    statut: '0',
};

const renderWithProvider = (props: any) =>
    render(
        <ConfirmProvider>
            <ExpenseDetailModal {...props} />
        </ConfirmProvider>
    );

describe('ExpenseDetailModal', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when expense is null', () => {
        renderWithProvider({
            expense: null,
            onClose: mockOnClose,
            config: mockConfig,
            users: [],
        });
        expect(screen.queryByText('ER-001')).not.toBeInTheDocument();
    });

    it('renders modal header with expense ref', () => {
        renderWithProvider({
            expense: baseExpense,
            onClose: mockOnClose,
            config: mockConfig,
            users: [],
        });
        expect(screen.getByText('ER-001')).toBeInTheDocument();
    });

    it('shows Submeter button for draft expense (statut 0)', () => {
        renderWithProvider({
            expense: baseExpense,
            onClose: mockOnClose,
            config: mockConfig,
            users: [],
        });
        expect(screen.getByText('Submeter')).toBeInTheDocument();
    });

    it('shows Pagar button for submitted expense (statut 1)', () => {
        renderWithProvider({
            expense: { ...baseExpense, statut: '1' },
            onClose: mockOnClose,
            config: mockConfig,
            users: [],
        });
        expect(screen.getByText('Pagar')).toBeInTheDocument();
    });

    it('submits expense report after confirming', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.approveExpenseReport).mockResolvedValue({} as any);

        renderWithProvider({
            expense: baseExpense,
            onClose: mockOnClose,
            config: mockConfig,
            users: [],
        });

        await user.click(screen.getByText('Submeter'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(DolibarrService.approveExpenseReport).toHaveBeenCalledWith(mockConfig, '100');
        });
        await waitFor(() => {
            expect(mockOnClose).toHaveBeenCalled();
        });
    });

    it('does NOT submit when user cancels confirmation', async () => {
        const user = userEvent.setup();

        renderWithProvider({
            expense: baseExpense,
            onClose: mockOnClose,
            config: mockConfig,
            users: [],
        });

        await user.click(screen.getByText('Submeter'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(DolibarrService.approveExpenseReport).not.toHaveBeenCalled();
        });
        expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('shows toast error when submit fails', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.approveExpenseReport).mockRejectedValue(new Error('Network error'));

        renderWithProvider({
            expense: baseExpense,
            onClose: mockOnClose,
            config: mockConfig,
            users: [],
        });

        await user.click(screen.getByText('Submeter'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith(
                'Validar despesa falhou.',
                expect.objectContaining({ id: 'err:Validar despesa' })
            );
        });
        expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('marks expense as paid after confirming', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.markExpenseReportAsPaid).mockResolvedValue({} as any);

        renderWithProvider({
            expense: { ...baseExpense, statut: '1' },
            onClose: mockOnClose,
            config: mockConfig,
            users: [],
        });

        await user.click(screen.getByText('Pagar'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(DolibarrService.markExpenseReportAsPaid).toHaveBeenCalledWith(mockConfig, '100');
        });
        await waitFor(() => {
            expect(mockOnClose).toHaveBeenCalled();
        });
    });

    it('does NOT mark as paid when user cancels confirmation', async () => {
        const user = userEvent.setup();

        renderWithProvider({
            expense: { ...baseExpense, statut: '1' },
            onClose: mockOnClose,
            config: mockConfig,
            users: [],
        });

        await user.click(screen.getByText('Pagar'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(DolibarrService.markExpenseReportAsPaid).not.toHaveBeenCalled();
        });
    });

    it('shows toast error when mark as paid fails', async () => {
        const user = userEvent.setup();
        vi.mocked(DolibarrService.markExpenseReportAsPaid).mockRejectedValue(new Error('Server error'));

        renderWithProvider({
            expense: { ...baseExpense, statut: '1' },
            onClose: mockOnClose,
            config: mockConfig,
            users: [],
        });

        await user.click(screen.getByText('Pagar'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith(
                'Marcar despesa como paga falhou.',
                expect.objectContaining({ id: 'err:Marcar despesa como paga' })
            );
        });
    });
});
