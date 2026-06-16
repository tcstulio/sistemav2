import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../../components/Layout/Sidebar';
import { ConfirmProvider } from '../../hooks/useConfirm';

const mockSetConfig = vi.fn();
const mockNavigate = vi.fn();

const mockConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: { id: '1', login: 'admin', admin: 1 } as any,
};

vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/dashboard' }),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({
        config: mockConfig,
        setConfig: mockSetConfig,
        canAccess: () => true,
    }),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useModules: () => ({ data: [] }),
}));

vi.mock('../../hooks/useOrgBranding', () => ({
    useOrgBranding: () => null,
}));

vi.mock('virtual:app-version', () => ({
    APP_VERSION: '1.0.0',
    GIT_HASH: 'abc1234',
}));

const renderSidebar = (props?: Partial<{ isOpen: boolean; setIsOpen: (o: boolean) => void }>) => {
    const setIsOpen = props?.setIsOpen ?? vi.fn();
    return render(
        <ConfirmProvider>
            <Sidebar
                isOpen={props?.isOpen ?? true}
                setIsOpen={setIsOpen}
            />
        </ConfirmProvider>
    );
};

describe('Sidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders logout button', () => {
        renderSidebar();
        expect(screen.getByText('Desconectar')).toBeTruthy();
    });

    it('shows in-app confirm dialog (not native) when clicking logout', async () => {
        const user = userEvent.setup();
        renderSidebar();

        await user.click(screen.getByText('Desconectar'));

        await waitFor(() => {
            expect(screen.getByText('Deseja desconectar do ERP?')).toBeTruthy();
        });
    });

    it('calls setConfig(null) and navigates to / when user confirms', async () => {
        const user = userEvent.setup();
        renderSidebar();

        await user.click(screen.getByText('Desconectar'));

        await waitFor(() => {
            expect(screen.getByText('Confirmar')).toBeTruthy();
        });
        await user.click(screen.getByText('Confirmar'));

        await waitFor(() => {
            expect(mockSetConfig).toHaveBeenCalledWith(null);
            expect(mockNavigate).toHaveBeenCalledWith('/');
        });
    });

    it('does NOT logout when user cancels', async () => {
        const user = userEvent.setup();
        renderSidebar();

        await user.click(screen.getByText('Desconectar'));

        await waitFor(() => {
            expect(screen.getByText('Cancelar')).toBeTruthy();
        });
        await user.click(screen.getByText('Cancelar'));

        await waitFor(() => {
            expect(mockSetConfig).not.toHaveBeenCalled();
            expect(mockNavigate).not.toHaveBeenCalled();
        });
    });

});
