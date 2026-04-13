import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserModal } from '../../components/HR/modals/UserModal';
import { DolibarrConfig, DolibarrUser } from '../../types';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createUser: vi.fn().mockResolvedValue({ id: '1' }),
        updateUser: vi.fn().mockResolvedValue({ id: '1' }),
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

const mockUserToEdit: DolibarrUser = {
    id: '1',
    login: 'jose.silva',
    lastname: 'Silva',
    firstname: 'José',
    email: 'jose@test.com',
    job: 'Developer',
    entity: 1,
    active: 1
};

describe('UserModal', () => {
    const mockOnClose = vi.fn();
    const mockOnRefresh = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <UserModal
                isOpen={false}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.queryByText('Novo Usuário')).not.toBeInTheDocument();
    });

    it('renders "Novo Usuário" when creating new user', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Novo Usuário')).toBeInTheDocument();
    });

    it('renders "Editar Usuário" when editing existing user', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                userToEdit={mockUserToEdit}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Editar Usuário')).toBeInTheDocument();
    });

    it('renders form inputs', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByPlaceholderText('Login')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Nome')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Sobrenome')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Cargo')).toBeInTheDocument();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('updates login when typing', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        const input = screen.getByPlaceholderText('Login') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'novo.login' } });
        expect(input.value).toBe('novo.login');
    });

    it('updates firstname when typing', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        const input = screen.getByPlaceholderText('Nome') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'João' } });
        expect(input.value).toBe('João');
    });

    it('updates email when typing', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        const input = screen.getByPlaceholderText('Email') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'joao@test.com' } });
        expect(input.value).toBe('joao@test.com');
    });

    it('renders supervisor dropdown with users', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                users={mockUsers}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Selecione um supervisor...')).toBeInTheDocument();
        expect(screen.getByText('Maria Santos (maria.santos)')).toBeInTheDocument();
    });

    it('shows "Salvar" button text', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Salvar')).toBeInTheDocument();
    });

    it('shows loading text when isSubmittingUser is true', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        const salvarButton = screen.getByRole('button', { name: /Salvar/i });
        fireEvent.click(salvarButton);
    });
});
