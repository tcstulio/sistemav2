import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Settings from '../../components/Settings';
import { ConfirmProvider } from '../../hooks/useConfirm';
import type { DolibarrConfig, DolibarrUser } from '../../types';
import { DolibarrService } from '../../services/dolibarrService';

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
vi.mock('../../components/admin/BackgroundAutomationSwitches', () => ({
    BackgroundAutomationSwitches: () => <div data-testid="background-automation-switches" />,
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
        job: 'Desenvolvedor',
        office_phone: '+55 11 3000-0000',
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

describe('Settings — Rules of Hooks (#595)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const wrap = (cfg: DolibarrConfig | null) => (
        <MemoryRouter>
            <ConfirmProvider>
                <Settings config={cfg} />
            </ConfirmProvider>
        </MemoryRouter>
    );

    const isHooksOrderError = (s: string) =>
        /Rendered (fewer|more) hooks than|change in the order of Hooks/i.test(s);

    it('exibe "Configuração não disponível" quando config é null, sem lançar', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(wrap(null));

        expect(screen.getByText('Configuração não disponível')).toBeTruthy();

        const hooksError = errorSpy.mock.calls.find((c) => isHooksOrderError(String(c[0])));
        expect(hooksError).toBeUndefined();

        errorSpy.mockRestore();
    });

    it('não lança erro de hooks ao alternar config entre válido e null (rerender)', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { rerender } = render(wrap(baseConfig));

        // Render normal com config válido
        expect(screen.getByText('Salvar Preferências')).toBeTruthy();

        // Re-render na MESMA árvore com config null — antes quebrava a tela (#595)
        rerender(wrap(null));
        expect(screen.getByText('Configuração não disponível')).toBeTruthy();

        // Volta para config válido
        rerender(wrap(baseConfig));
        expect(screen.getByText('Salvar Preferências')).toBeTruthy();

        const hooksError = errorSpy.mock.calls.find((c) => isHooksOrderError(String(c[0])));
        expect(hooksError).toBeUndefined();

        errorSpy.mockRestore();
    });
});

describe('Settings — editar perfil com nome/sobrenome (#596)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (DolibarrService.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({});
    });

    it('abre modal com Nome e Sobrenome pré-preenchidos do currentUser', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter>
                <ConfirmProvider>
                    <Settings config={baseConfig} />
                </ConfirmProvider>
            </MemoryRouter>
        );

        await user.click(screen.getByText('Editar Dados'));

        const firstnameInput = screen.getByDisplayValue('Test');
        const lastnameInput = screen.getByDisplayValue('User');
        expect(firstnameInput).toBeTruthy();
        expect(lastnameInput).toBeTruthy();
    });

    it('abre modal com Cargo e Telefone fixo pré-preenchidos', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter>
                <ConfirmProvider>
                    <Settings config={baseConfig} />
                </ConfirmProvider>
            </MemoryRouter>
        );

        await user.click(screen.getByText('Editar Dados'));

        expect(screen.getByDisplayValue('Desenvolvedor')).toBeTruthy();
        expect(screen.getByDisplayValue('+55 11 3000-0000')).toBeTruthy();
    });

    it('edita Nome, salva e chama updateUser com { firstname } e reflete no cabeçalho', async () => {
        const user = userEvent.setup();
        const onSave = vi.fn();
        render(
            <MemoryRouter>
                <ConfirmProvider>
                    <Settings config={baseConfig} onSave={onSave} />
                </ConfirmProvider>
            </MemoryRouter>
        );

        await user.click(screen.getByText('Editar Dados'));

        const firstnameInput = screen.getByDisplayValue('Test');
        await user.clear(firstnameInput);
        await user.type(firstnameInput, 'Novo');

        await user.click(screen.getByText('Salvar'));

        await waitFor(() => {
            expect(DolibarrService.updateUser as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
                expect.anything(),
                '1',
                expect.objectContaining({ firstname: 'Novo' })
            );
        });

        await waitFor(() => {
            expect(screen.getByText('Novo User')).toBeTruthy();
        });
    });
});

describe('Settings — sanitiza note_public no Meu Perfil (#1081)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderWithNote = (note_public: string) => {
        const config: DolibarrConfig = {
            ...baseConfig,
            currentUser: { ...baseConfig.currentUser, note_public } as DolibarrUser,
        };
        return render(
            <MemoryRouter>
                <ConfirmProvider>
                    <Settings config={config} />
                </ConfirmProvider>
            </MemoryRouter>
        );
    };

    it('remove <script> e handlers on* do note_public (XSS armazenado)', () => {
        const { container } = renderWithNote(
            '<img src=x onerror="alert(1)"><script>alert(2)</script>'
        );

        const notasBlock = Array.from(container.querySelectorAll('div')).find((d) =>
            d.textContent?.includes('Notas Públicas')
        )?.parentElement;

        const html = container.innerHTML.toLowerCase();
        expect(html).not.toContain('<script');
        expect(html).not.toContain('onerror');
        expect(notasBlock).toBeTruthy();
    });

    it('preserva HTML de formatação legítimo do note_public (sem regressão)', () => {
        const { container } = renderWithNote('<b>Importante</b> e <i>ok</i>');

        expect(container.innerHTML).toContain('<b>Importante</b>');
        expect(container.innerHTML).toContain('<i>ok</i>');
    });
});
