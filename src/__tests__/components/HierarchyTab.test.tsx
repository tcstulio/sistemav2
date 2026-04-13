import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HierarchyTab } from '../../components/HR/tabs/HierarchyTab';
import { DolibarrUser, DolibarrConfig } from '../../types';

vi.mock('../../components/HR/UserAvatar', () => ({
    UserAvatar: ({ user, size }: any) => (
        <div data-testid="user-avatar" data-size={size} data-user={user.login}>
            Avatar-{user.login}
        </div>
    )
}));

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://sistema.coolgroove.com.br/api/index.php',
    apiKey: 'test-api-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any
};

describe('HierarchyTab', () => {
    const mockOnSelectUser = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockUser = (id: string, login: string, firstname: string, lastname: string, supervisorId?: string): DolibarrUser => ({
        id,
        login,
        lastname,
        firstname,
        email: `${login}@test.com`,
        photo: undefined,
        entity: 1,
        active: 1,
        supervisor_id: supervisorId
    });

    it('renders empty state when no users', () => {
        render(<HierarchyTab users={[]} config={mockConfig} onSelectUser={mockOnSelectUser} />);
        expect(screen.getByText('Nenhum usuário encontrado para construir a hierarquia.')).toBeInTheDocument();
    });

    it('renders organograma title', () => {
        const users = [createMockUser('1', 'admin', 'Admin', 'User')];
        render(<HierarchyTab users={users} config={mockConfig} onSelectUser={mockOnSelectUser} />);
        expect(screen.getByText('Organograma da Empresa')).toBeInTheDocument();
    });

    it('renders users in the hierarchy', () => {
        const users = [
            createMockUser('1', 'admin', 'Admin', 'User'),
            createMockUser('2', 'jose', 'José', 'Silva', '1')
        ];
        render(<HierarchyTab users={users} config={mockConfig} onSelectUser={mockOnSelectUser} />);
        expect(screen.getByText('Admin User')).toBeInTheDocument();
        expect(screen.getByText('José Silva')).toBeInTheDocument();
    });

    it('calls onSelectUser when clicking a user', () => {
        const users = [createMockUser('1', 'admin', 'Admin', 'User')];
        render(<HierarchyTab users={users} config={mockConfig} onSelectUser={mockOnSelectUser} />);
        fireEvent.click(screen.getByText('Admin User'));
        expect(mockOnSelectUser).toHaveBeenCalledWith(users[0]);
    });

    it('shows warning when more than 5 root nodes', () => {
        const users = [
            createMockUser('1', 'user1', 'User', '1'),
            createMockUser('2', 'user2', 'User', '2'),
            createMockUser('3', 'user3', 'User', '3'),
            createMockUser('4', 'user4', 'User', '4'),
            createMockUser('5', 'user5', 'User', '5'),
            createMockUser('6', 'user6', 'User', '6')
        ];
        render(<HierarchyTab users={users} config={mockConfig} onSelectUser={mockOnSelectUser} />);
        expect(screen.getByText(/Exibindo 6 grupos principais/)).toBeInTheDocument();
    });

    it('renders user job or login when job is not available', () => {
        const user = createMockUser('1', 'admin', 'Admin', 'User');
        const users = [user];
        render(<HierarchyTab users={users} config={mockConfig} onSelectUser={mockOnSelectUser} />);
        expect(screen.getByText('admin')).toBeInTheDocument();
    });

    it('handles expand/collapse for users with children', () => {
        const users = [
            createMockUser('1', 'admin', 'Admin', 'User'),
            createMockUser('2', 'jose', 'José', 'Silva', '1')
        ];
        render(<HierarchyTab users={users} config={mockConfig} onSelectUser={mockOnSelectUser} />);
        const expandButton = screen.getAllByRole('button')[0];
        fireEvent.click(expandButton);
        expect(screen.queryByText('José Silva')).not.toBeInTheDocument();
    });
});