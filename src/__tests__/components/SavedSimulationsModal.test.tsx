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

// Mock simulatorApi — use vi.hoisted so variables are available during factory hoisting
const mockSimulatorApi = vi.hoisted(() => ({
    list: vi.fn<() => Promise<SimulationSnapshot[]>>(async () => []),
    create: vi.fn<(s: SimulationSnapshot) => Promise<SimulationSnapshot>>(async (s) => s),
    update: vi.fn<(id: string, updates: any) => Promise<SimulationSnapshot>>(async (id, updates) => ({ id, name: 'Updated', date: 2000, data: {}, summary: { revenue: 0, profit: 0, modelLabel: 'A' }, ...updates })),
    delete: vi.fn<(id: string) => Promise<void>>(async (_id) => undefined),
}));

vi.mock('../../services/simulatorApi', () => ({
    simulatorApi: mockSimulatorApi,
}));

// Mock config so API_BASE_URL is predictable
vi.mock('../../config', () => ({
    config: { API_BASE_URL: 'http://localhost:3004' },
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
        // Default: list returns empty
        mockSimulatorApi.list.mockResolvedValue([]);
    });

    it('renders the modal header', async () => {
        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);
        expect(screen.getByText('Biblioteca de Cenários')).toBeInTheDocument();
    });

    it('shows loading state initially', () => {
        // list never resolves during this check
        mockSimulatorApi.list.mockReturnValue(new Promise(() => { }));
        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);
        expect(screen.getByText('Carregando cenários...')).toBeInTheDocument();
    });

    it('shows empty state when no snapshots exist', async () => {
        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);
        await waitFor(() => {
            expect(screen.getByText('Sua biblioteca está vazia.')).toBeInTheDocument();
        });
    });

    it('loads and displays snapshots from backend', async () => {
        const snap = makeSnapshot();
        mockSimulatorApi.list.mockResolvedValue([snap]);

        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await waitFor(() => {
            expect(screen.getByText('Cenário Teste')).toBeInTheDocument();
        });
        expect(screen.getByText('Meus Cenários (1)')).toBeInTheDocument();
    });

    it('switches to the save view when clicking the save tab', async () => {
        const user = userEvent.setup();
        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await user.click(screen.getByText('Salvar Simulação'));

        expect(screen.getByText('Resumo para Salvar')).toBeInTheDocument();
    });

    it('saves a new snapshot via backend and updates list', async () => {
        const user = userEvent.setup();
        const newSnap = makeSnapshot({ id: '9999', name: 'Meu Novo Cenário' });
        mockSimulatorApi.create.mockResolvedValue(newSnap);

        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await user.click(screen.getByText('Salvar Simulação'));

        const input = screen.getByPlaceholderText('Ex: Cenário Otimista +30% público');
        await user.type(input, 'Meu Novo Cenário');

        await user.click(screen.getByText('Salvar na Biblioteca'));

        await waitFor(() => {
            expect(mockSimulatorApi.create).toHaveBeenCalled();
            expect(toast.success).toHaveBeenCalledWith('Simulação salva com sucesso!');
        });
    });

    it('shows toast.success when saving a new snapshot', async () => {
        const user = userEvent.setup();
        const newSnap = makeSnapshot({ id: '9999' });
        mockSimulatorApi.create.mockResolvedValue(newSnap);

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
        mockSimulatorApi.list.mockResolvedValue([snap]);
        mockSimulatorApi.update.mockResolvedValue({ ...snap, date: Date.now() });

        renderWithProvider(
            <SavedSimulationsModal {...defaultProps} activeSnapshotId={snap.id} />
        );

        // Wait for list to load
        await waitFor(() => expect(screen.getByText('Cenário Teste')).toBeInTheDocument());

        await user.click(screen.getByText('Atualizar / Salvar Novo'));
        await user.click(screen.getByText(`Atualizar "${snap.name}"`));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Simulação atualizada com sucesso!');
        });
    });

    it('shows toast error via notifyError when save fails (backend unavailable)', async () => {
        const user = userEvent.setup();
        mockSimulatorApi.create.mockRejectedValue(new Error('Network Error'));

        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await user.click(screen.getByText('Salvar Simulação'));
        await user.click(screen.getByText('Salvar na Biblioteca'));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith(
                'Salvar simulação falhou.',
                expect.objectContaining({ id: 'err:Salvar simulação' })
            );
        });
    });

    it('shows confirm dialog when deleting and deletes on confirm', async () => {
        const user = userEvent.setup();
        const snap = makeSnapshot();
        mockSimulatorApi.list.mockResolvedValue([snap]);
        mockSimulatorApi.delete.mockResolvedValue(undefined);

        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await waitFor(() => expect(screen.getByText('Cenário Teste')).toBeInTheDocument());

        const deleteBtn = screen.getByTitle('Excluir Permanentemente');
        await user.click(deleteBtn);

        const dialog = await screen.findByRole('dialog');
        expect(dialog.textContent).toContain('Tem certeza que deseja excluir este cenário permanentemente?');

        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(mockSimulatorApi.delete).toHaveBeenCalledWith(snap.id);
            expect(screen.queryByText('Cenário Teste')).not.toBeInTheDocument();
        });
    });

    it('does NOT delete when user cancels confirmation', async () => {
        const user = userEvent.setup();
        const snap = makeSnapshot();
        mockSimulatorApi.list.mockResolvedValue([snap]);

        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await waitFor(() => expect(screen.getByText('Cenário Teste')).toBeInTheDocument());

        const deleteBtn = screen.getByTitle('Excluir Permanentemente');
        await user.click(deleteBtn);

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        expect(mockSimulatorApi.delete).not.toHaveBeenCalled();
        expect(screen.getByText('Cenário Teste')).toBeInTheDocument();
    });

    it('calls onLoad and onClose when clicking a snapshot to load', async () => {
        const user = userEvent.setup();
        const snap = makeSnapshot();
        mockSimulatorApi.list.mockResolvedValue([snap]);

        const onLoad = vi.fn();
        const onClose = vi.fn();
        renderWithProvider(
            <SavedSimulationsModal {...defaultProps} onLoad={onLoad} onClose={onClose} />
        );

        await waitFor(() => expect(screen.getByText('Cenário Teste')).toBeInTheDocument());

        await user.click(screen.getByText('Cenário Teste'));

        expect(onLoad).toHaveBeenCalledWith(snap.data, snap.id);
        expect(onClose).toHaveBeenCalled();
    });

    it('migrates localStorage snapshots to backend on first load', async () => {
        const legacySnap = makeSnapshot({ id: '777', name: 'Legacy Snap' });
        localStorage.setItem(STORAGE_KEY, JSON.stringify([legacySnap]));
        mockSimulatorApi.list.mockResolvedValue([]); // backend empty
        mockSimulatorApi.create.mockResolvedValue(legacySnap);

        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await waitFor(() => {
            expect(mockSimulatorApi.create).toHaveBeenCalledWith(legacySnap);
        });
    });

    it('falls back to localStorage when backend is unavailable', async () => {
        const localSnap = makeSnapshot({ id: '888', name: 'Local Fallback' });
        localStorage.setItem(STORAGE_KEY, JSON.stringify([localSnap]));
        mockSimulatorApi.list.mockRejectedValue(new Error('backend down'));

        renderWithProvider(<SavedSimulationsModal {...defaultProps} />);

        await waitFor(() => {
            expect(screen.getByText('Local Fallback')).toBeInTheDocument();
        });
    });
});
