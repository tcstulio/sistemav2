import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../components/Layout/Header';

const mockLogout = vi.fn();
const mockNavigate = vi.fn();
const mockSetPreviewTarget = vi.fn();

let mockCurrentUser: any = null;

vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        config: { apiUrl: 'https://api.example.com', apiKey: 'k', themeColor: 'indigo', darkMode: false },
        notifications: [],
        isSyncing: false,
        currentUser: mockCurrentUser,
        logout: mockLogout,
        previewTarget: null,
        setPreviewTarget: mockSetPreviewTarget,
    }),
}));

vi.mock('../../components/HR/UserAvatar', () => ({
    UserAvatar: () => <div data-testid="user-avatar" />,
}));

vi.mock('../../components/NotificationBell', () => ({
    NotificationBell: (props: any) => <button data-testid="notif-bell" onClick={props.onClick} />,
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        fetchUsers: vi.fn().mockResolvedValue([]),
        listGroups: vi.fn().mockResolvedValue([]),
        getUserGroups: vi.fn().mockResolvedValue([]),
        getUserById: vi.fn().mockResolvedValue(null),
        getGroupRights: vi.fn().mockResolvedValue(undefined),
    },
}));

const openUserMenu = () => {
    const avatar = screen.getByTestId('user-avatar');
    const btn = avatar.closest('button') as HTMLElement;
    fireEvent.click(btn);
};

describe('Header', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCurrentUser = null;
    });

    it('#1003: exibe o celular (phone_mobile) do usuário logado no dropdown', () => {
        mockCurrentUser = {
            id: '17',
            login: 'tulio.silva',
            firstname: 'Tulio',
            lastname: 'Silva',
            email: 'tulio@example.com',
            phone_mobile: '+55 11 99999-0000',
            statut: '1',
            admin: 0,
        };

        render(
            <Header
                setIsSidebarOpen={vi.fn()}
                setIsNotificationPanelOpen={vi.fn()}
                setIsSearchOpen={vi.fn()}
            />
        );

        openUserMenu();

        expect(screen.getByText('+55 11 99999-0000')).toBeTruthy();
    });

    it('#1003: usa user_mobile como fallback quando phone_mobile está ausente', () => {
        mockCurrentUser = {
            id: '17',
            login: 'tulio.silva',
            firstname: 'Tulio',
            lastname: 'Silva',
            user_mobile: '+55 11 98888-0000',
            statut: '1',
            admin: 0,
        };

        render(
            <Header
                setIsSidebarOpen={vi.fn()}
                setIsNotificationPanelOpen={vi.fn()}
                setIsSearchOpen={vi.fn()}
            />
        );

        openUserMenu();

        expect(screen.getByText('+55 11 98888-0000')).toBeTruthy();
    });

    it('#1003: não renderiza a linha de celular quando o usuário não tem celular', () => {
        mockCurrentUser = {
            id: '1',
            login: 'semcel',
            firstname: 'Sem',
            lastname: 'Cel',
            email: 'semcel@example.com',
            statut: '1',
            admin: 0,
        };

        render(
            <Header
                setIsSidebarOpen={vi.fn()}
                setIsNotificationPanelOpen={vi.fn()}
                setIsSearchOpen={vi.fn()}
            />
        );

        openUserMenu();

        // O email aparece, mas nenhuma linha de celular.
        expect(screen.getByText('semcel@example.com')).toBeTruthy();
        const phoneSvg = document.querySelector('svg.lucide-phone');
        expect(phoneSvg).toBeNull();
    });
});
