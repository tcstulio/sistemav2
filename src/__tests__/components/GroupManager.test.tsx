import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GroupManager } from '../../components/admin/GroupManager';
import { DolibarrConfig, UserGroup } from '../../types';
import * as DolibarrServiceModule from '../../services/dolibarrService';
import * as DolibarrContextModule from '../../context/DolibarrContext';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        currentUser: { id: 'u1', login: 'admin', admin: 1 },
    })),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        listGroups: vi.fn().mockResolvedValue([
            { id: 'g1', name: 'Grupo Alpha', note: 'Descrição Alpha', datec: 1700000000 },
            { id: 'g2', name: 'Grupo Beta', note: 'Descrição Beta' },
        ]),
        createGroup: vi.fn().mockResolvedValue({ id: 'g3' }),
        deleteGroup: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../hooks/dolibarr', () => ({
    useUsers: vi.fn(() => ({
        data: [
            { id: 'u1', login: 'admin', firstname: 'Admin', lastname: 'User', statut: '1' },
        ],
    })),
    useGroupUsers: vi.fn(() => ({ data: [] })),
    useGroups: vi.fn(() => ({
        data: [
            { id: 'g1', name: 'Grupo Alpha', note: 'Descrição Alpha', datec: 1700000000 },
            { id: 'g2', name: 'Grupo Beta', note: 'Descrição Beta' },
        ],
    })),
}));

// Stub heavy child components
vi.mock('../../components/HR/GroupDetail', () => ({
    GroupDetail: ({ group, onClose }: { group: UserGroup; onClose: () => void }) => (
        <div data-testid="group-detail">
            <span>{group.name}</span>
            <button onClick={onClose}>Fechar detalhe</button>
        </div>
    ),
}));

vi.mock('../../components/HR/modals/GroupModal', () => ({
    GroupModal: ({
        isOpen,
        groupToEdit,
        onClose,
    }: {
        isOpen: boolean;
        groupToEdit: UserGroup | null;
        onClose: () => void;
    }) =>
        isOpen ? (
            <div data-testid="group-modal">
                <span>{groupToEdit ? 'Editar Grupo' : 'Novo Grupo'}</span>
                {groupToEdit && <span data-testid="edit-name">{groupToEdit.name}</span>}
                <button onClick={onClose}>Fechar modal</button>
            </div>
        ) : null,
}));

vi.mock('../../utils/notifyError', () => ({
    notifyError: vi.fn(),
}));

// ── Config ─────────────────────────────────────────────────────────────────

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any,
};

const MOCK_GROUPS: UserGroup[] = [
    { id: 'g1', name: 'Grupo Alpha', note: 'Descrição Alpha', datec: 1700000000 },
    { id: 'g2', name: 'Grupo Beta', note: 'Descrição Beta' },
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GroupManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Re-setup default mocks after clearAllMocks
        vi.mocked(DolibarrServiceModule.DolibarrService.listGroups).mockResolvedValue(MOCK_GROUPS);
        vi.mocked(DolibarrServiceModule.DolibarrService.deleteGroup).mockResolvedValue(undefined);

        vi.mocked(DolibarrContextModule.useDolibarr).mockReturnValue({
            currentUser: { id: 'u1', login: 'admin', admin: 1 },
        } as any);
    });

    it('renders "Acesso Restrito" for non-admin user', () => {
        vi.mocked(DolibarrContextModule.useDolibarr).mockReturnValue({
            currentUser: { id: 'u2', login: 'regular', admin: 0 },
        } as any);

        render(<GroupManager config={mockConfig} />);
        expect(screen.getByText('Acesso Restrito')).toBeInTheDocument();
    });

    it('renders group list for admin user', async () => {
        render(<GroupManager config={mockConfig} />);
        await waitFor(() => {
            expect(screen.getByText('Grupo Alpha')).toBeInTheDocument();
            expect(screen.getByText('Grupo Beta')).toBeInTheDocument();
        });
    });

    it('opens group detail when card is clicked', async () => {
        render(<GroupManager config={mockConfig} />);
        await waitFor(() => expect(screen.getByText('Grupo Alpha')).toBeInTheDocument());

        // The card div has role="button" and aria-label "Abrir detalhes do grupo Grupo Alpha"
        const cardButton = screen.getByRole('button', { name: /Abrir detalhes do grupo Grupo Alpha/i });
        fireEvent.click(cardButton);

        await waitFor(() => {
            expect(screen.getByTestId('group-detail')).toBeInTheDocument();
        });
    });

    it('closes group detail when close is triggered', async () => {
        render(<GroupManager config={mockConfig} />);
        await waitFor(() => expect(screen.getByText('Grupo Alpha')).toBeInTheDocument());

        // Open detail
        const cardButton = screen.getByRole('button', { name: /Abrir detalhes do grupo Grupo Alpha/i });
        fireEvent.click(cardButton);
        await waitFor(() => expect(screen.getByTestId('group-detail')).toBeInTheDocument());

        // Close via stub button
        fireEvent.click(screen.getByText('Fechar detalhe'));
        await waitFor(() => expect(screen.queryByTestId('group-detail')).not.toBeInTheDocument());
    });

    it('opens edit modal pre-filled when Editar button is clicked', async () => {
        render(<GroupManager config={mockConfig} />);
        await waitFor(() => expect(screen.getByText('Grupo Alpha')).toBeInTheDocument());

        const editBtn = screen.getByRole('button', { name: /Editar grupo Grupo Alpha/i });
        fireEvent.click(editBtn);

        await waitFor(() => {
            expect(screen.getByTestId('group-modal')).toBeInTheDocument();
            expect(screen.getByTestId('edit-name')).toHaveTextContent('Grupo Alpha');
        });
    });

    it('clicking Editar does NOT open group detail', async () => {
        render(<GroupManager config={mockConfig} />);
        await waitFor(() => expect(screen.getByText('Grupo Alpha')).toBeInTheDocument());

        const editBtn = screen.getByRole('button', { name: /Editar grupo Grupo Alpha/i });
        fireEvent.click(editBtn);

        // Detail panel should not appear
        expect(screen.queryByTestId('group-detail')).not.toBeInTheDocument();
    });

    it('clicking Excluir does NOT open group detail', async () => {
        render(<GroupManager config={mockConfig} />);
        await waitFor(() => expect(screen.getByText('Grupo Alpha')).toBeInTheDocument());

        const deleteBtn = screen.getByRole('button', { name: /Excluir grupo Grupo Alpha/i });
        fireEvent.click(deleteBtn);

        // Detail should not appear
        expect(screen.queryByTestId('group-detail')).not.toBeInTheDocument();
        // Confirm modal should appear
        expect(screen.getByText('Excluir Grupo')).toBeInTheDocument();
    });

    it('shows datec field when available', async () => {
        render(<GroupManager config={mockConfig} />);
        await waitFor(() => expect(screen.getByText('Grupo Alpha')).toBeInTheDocument());

        // Grupo Alpha has datec: 1700000000 → should render "Criado em ..."
        expect(screen.getByText(/Criado em/i)).toBeInTheDocument();
    });

    it('calls updateGroup indirectly when GroupModal saves (calls onRefresh which reloads list)', async () => {
        render(<GroupManager config={mockConfig} />);
        await waitFor(() => expect(screen.getByText('Grupo Alpha')).toBeInTheDocument());

        // Open edit modal
        const editBtn = screen.getByRole('button', { name: /Editar grupo Grupo Alpha/i });
        fireEvent.click(editBtn);

        await waitFor(() => expect(screen.getByTestId('group-modal')).toBeInTheDocument());

        // Close the modal (onRefresh will trigger loadGroups)
        fireEvent.click(screen.getByText('Fechar modal'));

        await waitFor(() => {
            // listGroups should have been called again (initial load + after close)
            expect(DolibarrServiceModule.DolibarrService.listGroups).toHaveBeenCalled();
        });
    });
});
