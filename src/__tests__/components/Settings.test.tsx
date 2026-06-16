import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Settings from '../../components/Settings';
import { ConfirmProvider } from '../../hooks/useConfirm';
import type { DolibarrConfig } from '../../types';

const mockLogout = vi.fn();
const mockSetConfig = vi.fn();

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ logout: mockLogout, setConfig: mockSetConfig }),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: { updateUser: vi.fn() },
}));

vi.mock('../../services/uiConfigService', () => ({
    getUiConfig: vi.fn(() => Promise.resolve(null)),
    updateUiConfig: vi.fn(),
}));

vi.mock('../../hooks/useOrgBranding', () => ({
    setOrgBranding: vi.fn(),
}));

vi.mock('../../components/admin/MenuConfigEditor', () => ({
    MenuConfigEditor: () => <div data-testid="menu-config-editor" />,
}));
vi.mock('../../components/admin/DashboardConfigEditor', () => ({
    DashboardConfigEditor: () => <div data-testid="dashboard-config-editor" />,
}));
vi.mock('../../components/admin/ScreenPermissionsEditor', () => ({
    ScreenPermissionsEditor: () => <div data-testid="screen-permissions-editor" />,
}));
vi.mock('../../components/admin/NotificationConfigEditor', () => ({
    NotificationConfigEditor: () => <div data-testid="notification-config-editor" />,
}));
vi.mock('../../components/admin/TaskAutomationEditor', () => ({
    TaskAutomationEditor: () => <div data-testid="task-automation-editor" />,
}));

const baseConfig: DolibarrConfig = {
    apiUrl: 'http://test',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    currentUser: {
        id: '1',
        login: 'testuser',
        firstname: 'Test',
        lastname: 'User',
        email: 'test@test.com',
        admin: 0,
    } as any,
};

const renderWithProvider = (config: DolibarrConfig = baseConfig) =>
    render(
        <MemoryRouter>
            <ConfirmProvider>
                <Settings config={config} />
            </ConfirmProvider>
        </MemoryRouter>
    );

describe('Settings — in-app confirm/alert (refactor #335)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows in-app confirm dialog on Sair and calls logout when confirmed', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        const sairBtn = screen.getByText('Sair');
        await user.click(sairBtn);

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeTruthy();
        expect(screen.getByText('Tem certeza que deseja sair?')).toBeTruthy();

        await user.click(screen.getByText('Confirmar'));

        await waitFor(() => {
            expect(mockLogout).toHaveBeenCalledTimes(1);
        });
    });

    it('does NOT call logout when Sair is cancelled', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(screen.getByText('Sair'));

        await screen.findByRole('dialog');
        await user.click(screen.getByText('Cancelar'));

        await waitFor(() => {
            expect(mockLogout).not.toHaveBeenCalled();
        });
    });

    it('shows in-app confirm dialog on Forçar Ressincronização', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(screen.getByText('Forçar Ressincronização de Tarefas'));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeTruthy();
        expect(
            screen.getByText('Isso irá apagar todas as tarefas locais e baixar novamente. Continuar?')
        ).toBeTruthy();
    });

    it('does NOT call logout when user cancels resync', async () => {
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(screen.getByText('Forçar Ressincronização de Tarefas'));
        await screen.findByRole('dialog');
        await user.click(screen.getByText('Cancelar'));

        expect(mockLogout).not.toHaveBeenCalled();
    });
});
