import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TeamTab } from '../../components/HR/tabs/TeamTab';
import { DolibarrUser, DolibarrConfig } from '../../types';

vi.mock('../../components/HR/UserAvatar', () => ({
    UserAvatar: ({ user, size }: any) => (
        <div data-testid="user-avatar" data-size={size} data-user={user.login}>
            Avatar-{user.login}
        </div>
    )
}));

vi.mock('../../utils/theme', () => ({
    getThemeClasses: vi.fn(() => ({
        activeCard: 'border-indigo-500 bg-indigo-50',
        inactiveCard: 'border-slate-200 bg-white'
    }))
}));

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://sistema.coolgroove.com.br/api/index.php',
    apiKey: 'test-api-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any
};

describe('TeamTab', () => {
    const mockOnToggleUser = vi.fn();
    const mockOnSelectUser = vi.fn();
    const mockSetDisplayLimit = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockUser = (id: string, login: string, firstname: string, lastname: string, job?: string): DolibarrUser => ({
        id,
        login,
        lastname,
        firstname,
        job,
        email: `${login}@test.com`,
        photo: undefined,
        entity: 1,
        active: 1
    });

    it('renders empty state when no users', () => {
        render(
            <TeamTab
                users={[]}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                selectedUserIds={[]}
                onToggleUser={mockOnToggleUser}
                onSelectUser={mockOnSelectUser}
                config={mockConfig}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText('Nenhum membro da equipe encontrado.')).toBeInTheDocument();
    });

    it('renders users in the team', () => {
        const users = [
            createMockUser('1', 'admin', 'Admin', 'User', 'Manager'),
            createMockUser('2', 'jose', 'José', 'Silva', 'Developer')
        ];
        render(
            <TeamTab
                users={users}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                selectedUserIds={[]}
                onToggleUser={mockOnToggleUser}
                onSelectUser={mockOnSelectUser}
                config={mockConfig}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText('Admin User')).toBeInTheDocument();
        expect(screen.getByText('José Silva')).toBeInTheDocument();
    });

    it('filters users by search term', () => {
        const users = [
            createMockUser('1', 'admin', 'Admin', 'User'),
            createMockUser('2', 'jose', 'José', 'Silva')
        ];
        render(
            <TeamTab
                users={users}
                searchTerm="jose"
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                selectedUserIds={[]}
                onToggleUser={mockOnToggleUser}
                onSelectUser={mockOnSelectUser}
                config={mockConfig}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText('José Silva')).toBeInTheDocument();
        expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
    });

    it('filters users by job', () => {
        const users = [
            createMockUser('1', 'admin', 'Admin', 'User', 'Manager'),
            createMockUser('2', 'jose', 'José', 'Silva', 'Developer')
        ];
        render(
            <TeamTab
                users={users}
                searchTerm="developer"
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                selectedUserIds={[]}
                onToggleUser={mockOnToggleUser}
                onSelectUser={mockOnSelectUser}
                config={mockConfig}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText('José Silva')).toBeInTheDocument();
    });

    it('calls onSelectUser when clicking a user', () => {
        const users = [createMockUser('1', 'admin', 'Admin', 'User')];
        render(
            <TeamTab
                users={users}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                selectedUserIds={[]}
                onToggleUser={mockOnToggleUser}
                onSelectUser={mockOnSelectUser}
                config={mockConfig}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        fireEvent.click(screen.getByText('Admin User'));
        expect(mockOnSelectUser).toHaveBeenCalledWith(users[0]);
    });

    it('shows load more button when there are more users', () => {
        const users = Array.from({ length: 60 }, (_, i) =>
            createMockUser(String(i + 1), `user${i + 1}`, `User`, String(i + 1))
        );
        render(
            <TeamTab
                users={users}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                selectedUserIds={[]}
                onToggleUser={mockOnToggleUser}
                onSelectUser={mockOnSelectUser}
                config={mockConfig}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText(/Carregar Mais/)).toBeInTheDocument();
    });
});