import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Settings from '../../components/Settings';
import { ConfirmProvider } from '../../hooks/useConfirm';
import type { DolibarrConfig } from '../../types';

const mockLogout = vi.fn();
const mockSetConfig = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockNotifyError = vi.fn();

vi.mock('sonner', () => ({
    toast: {
        success: (...args: any[]) => mockToastSuccess(...args),
        error: (...args: any[]) => mockToastError(...args),
        info: vi.fn(),
    },
}));

vi.mock('../../utils/notifyError', () => ({
    notifyError: (...args: any[]) => mockNotifyError(...args),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ logout: mockLogout, setConfig: mockSetConfig }),
}));

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: { updateUser: vi.fn() },
}));

vi.mock('../../services/uiConfigService', () => ({
    getUiConfig: vi.fn(() => Promise.resolve(null)),
    updateUiConfig: vi.fn(() => Promise.resolve({ companyName: '', logoText: '' })),
}));

vi.mock('../../services/dbService', () => ({
    dbService: {
        getAll: vi.fn(() => Promise.resolve([])),
        saveAll: vi.fn(() => Promise.resolve()),
    },
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

    it('never invokes native window.alert or window.confirm during interactions', async () => {
        const alertSpy = vi.spyOn(window, 'alert');
        const confirmSpy = vi.spyOn(window, 'confirm');
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(screen.getByText('Sair'));
        await screen.findByRole('dialog');
        await user.click(screen.getByText('Cancelar'));

        await user.click(screen.getByText('Forçar Ressincronização de Tarefas'));
        await screen.findByRole('dialog');
        await user.click(screen.getByText('Cancelar'));

        expect(alertSpy).not.toHaveBeenCalled();
        expect(confirmSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
        confirmSpy.mockRestore();
    });

    it('shows toast.success after confirming resync', async () => {
        const reloadSpy = vi.fn();
        Object.defineProperty(window, 'location', {
            value: { reload: reloadSpy },
            writable: true,
        });
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(screen.getByText('Forçar Ressincronização de Tarefas'));
        await screen.findByRole('dialog');
        await user.click(screen.getByText('Confirmar'));

        await waitFor(() => {
            expect(mockToastSuccess).toHaveBeenCalledWith(
                'Tarefas limpas. O sistema irá sincronizar novamente em instantes.'
            );
        });
    });

    it('shows toast.success after saving profile edits', async () => {
        const { DolibarrService } = await import('../../services/dolibarrService');
        vi.mocked(DolibarrService.updateUser).mockResolvedValueOnce({} as any);

        const user = userEvent.setup();
        renderWithProvider();

        await user.click(screen.getByText('Editar Dados'));

        const emailInput = await screen.findByPlaceholderText('seu@email.com');
        await user.clear(emailInput);
        await user.type(emailInput, 'new@test.com');

        await user.click(screen.getByText('Salvar'));

        await waitFor(() => {
            expect(mockToastSuccess).toHaveBeenCalledWith('Perfil atualizado com sucesso!');
        });
    });

    it('calls notifyError (not toast.error/alert) when profile save throws', async () => {
        const { DolibarrService } = await import('../../services/dolibarrService');
        vi.mocked(DolibarrService.updateUser).mockRejectedValueOnce(new Error('fail'));

        const user = userEvent.setup();
        renderWithProvider();

        await user.click(screen.getByText('Editar Dados'));
        const emailInput = await screen.findByPlaceholderText('seu@email.com');
        await user.type(emailInput, 'x@y.com');
        await user.click(screen.getByText('Salvar'));

        await waitFor(() => {
            expect(mockNotifyError).toHaveBeenCalledWith('Atualizar perfil', expect.any(Error));
        });
    });
});
