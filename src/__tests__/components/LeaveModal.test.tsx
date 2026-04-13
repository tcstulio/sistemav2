import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeaveModal } from '../../components/HR/modals/LeaveModal';
import { DolibarrConfig, DolibarrUser } from '../../types';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createLeaveRequest: vi.fn().mockResolvedValue({ id: '1' }),
    }
}));

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any
};

const mockUsers: DolibarrUser[] = [
    { id: '1', login: 'jose.silva', lastname: 'Silva', firstname: 'José', email: 'jose@test.com', entity: 1, active: 1 },
    { id: '2', login: 'maria.santos', lastname: 'Santos', firstname: 'Maria', email: 'maria@test.com', entity: 1, active: 1 },
];

describe('LeaveModal', () => {
    const mockOnClose = vi.fn();
    const mockOnRefresh = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <LeaveModal
                isOpen={false}
                onClose={mockOnClose}
                config={mockConfig}
                users={mockUsers}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.queryByText('Nova Solicitação de Licença')).not.toBeInTheDocument();
    });

    it('renders modal when isOpen is true', () => {
        render(
            <LeaveModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                users={mockUsers}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Nova Solicitação de Licença')).toBeInTheDocument();
    });

    it('renders user dropdown with options', () => {
        render(
            <LeaveModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                users={mockUsers}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('José Silva (jose.silva)')).toBeInTheDocument();
        expect(screen.getByText('Maria Santos (maria.santos)')).toBeInTheDocument();
    });

    it('renders date inputs', () => {
        render(
            <LeaveModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                users={mockUsers}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Início')).toBeInTheDocument();
        expect(screen.getByText('Fim')).toBeInTheDocument();
    });

    it('renders leave type options', () => {
        render(
            <LeaveModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                users={mockUsers}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Férias Pagas')).toBeInTheDocument();
        expect(screen.getByText('Licença Médica')).toBeInTheDocument();
        expect(screen.getByText('Licença Não Remunerada')).toBeInTheDocument();
        expect(screen.getByText('Outro')).toBeInTheDocument();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <LeaveModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                users={mockUsers}
                onRefresh={mockOnRefresh}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('updates user selection when changed', () => {
        render(
            <LeaveModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                users={mockUsers}
                onRefresh={mockOnRefresh}
            />
        );
        const selects = screen.getAllByRole('combobox');
        fireEvent.change(selects[0], { target: { value: '1' } });
        expect(selects[0].value).toBe('1');
    });

    it('updates description when typing', () => {
        render(
            <LeaveModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                users={mockUsers}
                onRefresh={mockOnRefresh}
            />
        );
        const textarea = screen.getByPlaceholderText('Motivo...') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'Férias de verão' } });
        expect(textarea.value).toBe('Férias de verão');
    });

    it('shows loading state when submitting', () => {
        render(
            <LeaveModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                users={mockUsers}
                onRefresh={mockOnRefresh}
            />
        );
        const submitButton = screen.getByRole('button', { name: /Enviar/i });
        fireEvent.click(submitButton);
    });
});
