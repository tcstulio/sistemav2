import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SavedSimulationsModal from '../../pages/Simulator/components/modals/SavedSimulationsModal';
import { SimulationSnapshot } from '../../pages/Simulator/components/modals/SavedSimulationsModal';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

const STORAGE_KEY = 'eventscale_snapshots_v1';

const makeSnapshot = (overrides: Partial<SimulationSnapshot> = {}): SimulationSnapshot => ({
    id: '1000',
    name: 'Cenário Teste',
    date: 1700000000000,
    data: { foo: 'bar' },
    summary: { revenue: 10000, profit: 500, modelLabel: 'Modelo A' },
    ...overrides,
});

const defaultProps = {
    currentData: { foo: 'bar' },
    currentSummary: { revenue: 10000, profit: 500, modelLabel: 'Modelo A' },
    activeSnapshotId: null,
    isAdmin: true,
    userName: 'tester',
    onClose: vi.fn(),
    onLoad: vi.fn(),
};

const renderWithProvider = (ui: React.ReactElement) =>
    render(<ConfirmProvider>{ui}</ConfirmProvider>);

describe('SavedSimulationsModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('renders the modal header', () => {
        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);
        expect(screen.getByText('Biblioteca de Cenários')).toBeInTheDocument();
    });

    it('shows empty state when no snapshots exist', () => {
        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);
        expect(screen.getByText('Sua biblioteca está vazia.')).toBeInTheDocument();
    });

    it('loads and displays snapshots from localStorage', () => {
        const snap = makeSnapshot();
        localStorage.setItem(STORAGE_KEY, JSON.stringify([snap]));

        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        expect(screen.getByText('Cenário Teste')).toBeInTheDocument();
        expect(screen.getByText('Meus Cenários (1)')).toBeInTheDocument();
    });

    it('switches to the save view when clicking the save tab', async () => {
        const user = userEvent.setup();
        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await user.click(screen.getByText('Salvar Simulação'));

        expect(screen.getByText('Resumo para Salvar')).toBeInTheDocument();
    });

    it('shows confirm dialog when deleting and deletes on confirm', async () => {
        const user = userEvent.setup();
        const snap = makeSnapshot();
        localStorage.setItem(STORAGE_KEY, JSON.stringify([snap]));

        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        const deleteBtn = screen.getByTitle('Excluir Permanentemente');
        await user.click(deleteBtn);

        const dialog = await screen.findByRole('dialog');
        expect(dialog.textContent).toContain('Tem certeza que deseja excluir este cenário permanentemente?');

        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(screen.queryByText('Cenário Teste')).not.toBeInTheDocument();
        });
    });

    it('does NOT delete when user cancels confirmation', async () => {
        const user = userEvent.setup();
        const snap = makeSnapshot();
        localStorage.setItem(STORAGE_KEY, JSON.stringify([snap]));

        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        const deleteBtn = screen.getByTitle('Excluir Permanentemente');
        await user.click(deleteBtn);

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        expect(screen.getByText('Cenário Teste')).toBeInTheDocument();
    });

    it('shows toast error via notifyError when save fails (storage quota)', async () => {
        const user = userEvent.setup();
        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        await user.click(screen.getByText('Salvar Simulação'));
        await user.click(screen.getByText('Salvar na Biblioteca'));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith(
                'Salvar simulação falhou.',
                expect.objectContaining({ id: 'err:Salvar simulação' })
            );
        });

        setItemSpy.mockRestore();
    });

    it('saves a new snapshot when storage succeeds', async () => {
        const user = userEvent.setup();
        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await user.click(screen.getByText('Salvar Simulação'));

        const input = screen.getByPlaceholderText('Ex: Cenário Otimista +30% público');
        await user.type(input, 'Meu Novo Cenário');

        await user.click(screen.getByText('Salvar na Biblioteca'));

        await waitFor(() => {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            expect(stored).toHaveLength(1);
            expect(stored[0].name).toBe('Meu Novo Cenário');
        });
    });

    it('shows toast.success when saving a new snapshot', async () => {
        const user = userEvent.setup();
        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await user.click(screen.getByText('Salvar Simulação'));
        await user.click(screen.getByText('Salvar na Biblioteca'));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Simulação salva com sucesso!');
        });
    });

    it('shows toast.success when updating an existing snapshot', async () => {
        const user = userEvent.setup();
        const snap = makeSnapshot();
        localStorage.setItem(STORAGE_KEY, JSON.stringify([snap]));

        renderWithProvider(
            <SavedSimulationsModal {...defaultProps} activeSnapshotId={snap.id} />
        );

        await user.click(screen.getByText('Atualizar / Salvar Novo'));
        await user.click(screen.getByText(`Atualizar "${snap.name}"`));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Simulação atualizada com sucesso!');
        });
    });

    it('calls onLoad and onClose when clicking a snapshot to load', async () => {
        const user = userEvent.setup();
        const snap = makeSnapshot();
        localStorage.setItem(STORAGE_KEY, JSON.stringify([snap]));

        const onLoad = vi.fn();
        const onClose = vi.fn();
        renderWithProvider(
            <SavedSimulationsModal {...defaultProps} onLoad={onLoad} onClose={onClose} />
        );

        await user.click(screen.getByText('Cenário Teste'));

        expect(onLoad).toHaveBeenCalledWith(snap.data, snap.id);
        expect(onClose).toHaveBeenCalled();
    });
});
