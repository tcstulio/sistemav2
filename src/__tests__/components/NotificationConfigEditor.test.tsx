/**
 * Testes do NotificationConfigEditor (#532):
 * - Toggle ligado a taskNotificationsExternalEnabled
 * - Aviso ao habilitar canais externos
 * - Diagnóstico de usuários sem phone_mobile
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NotificationConfigEditor } from '../../components/admin/NotificationConfigEditor';

const mockGetUiConfig = vi.fn();
const mockUpdateUiConfig = vi.fn();
const mockGetUsersMissingPhone = vi.fn();

vi.mock('../../services/uiConfigService', () => ({
    getUiConfig: (...args: any[]) => mockGetUiConfig(...args),
    updateUiConfig: (...args: any[]) => mockUpdateUiConfig(...args),
    getUsersMissingPhone: (...args: any[]) => mockGetUsersMissingPhone(...args),
}));

const DEFAULT_TASK_NOTIFS = {
    assigned: { responsavel: ['in-app'], interveniente: ['in-app'], criador: ['in-app'] },
    acceptance_pending: { responsavel: ['in-app'], interveniente: ['in-app'], criador: ['in-app'] },
    acceptance_overdue: { responsavel: ['in-app'], interveniente: ['in-app'], criador: ['in-app'] },
    deadline_reminder: { responsavel: ['in-app'], interveniente: ['in-app'], criador: ['in-app'] },
    overdue: { responsavel: ['in-app'], interveniente: ['in-app'], criador: ['in-app'] },
    stalled: { responsavel: ['in-app'], interveniente: ['in-app'], criador: ['in-app'] },
    completed: { responsavel: ['in-app'], interveniente: ['in-app'], criador: ['in-app'] },
    comment: { responsavel: ['in-app'], interveniente: ['in-app'], criador: ['in-app'] },
};

const mockConfig = {
    taskNotifications: DEFAULT_TASK_NOTIFS,
    taskNotificationsExternalEnabled: false,
};

describe('NotificationConfigEditor — toggle externo (#532)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUiConfig.mockResolvedValue(mockConfig);
        mockUpdateUiConfig.mockResolvedValue({ ...mockConfig, taskNotificationsExternalEnabled: true });
        mockGetUsersMissingPhone.mockResolvedValue({ total: 3, missingCount: 1, users: [{ id: '5', login: 'joao', name: 'João Silva', email: 'joao@test.com' }] });
    });

    // Helper: aguarda o componente terminar de carregar (o Spinner não exibe texto,
    // então esperamos o checkbox aparecer — sinal de que config foi carregado).
    const waitForLoaded = () => waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy());

    it('renderiza o toggle para admin', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        expect(screen.getByRole('checkbox')).toBeTruthy();
        expect(screen.getByText(/Notificações externas/i)).toBeTruthy();
    });

    it('não renderiza nada para não-admin', () => {
        const { container } = render(<NotificationConfigEditor isAdmin={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('toggle inicia desabilitado conforme o config default', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
        expect(checkbox.checked).toBe(false);
    });

    it('exibe aviso de mensagens reais ao habilitar o toggle', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        fireEvent.click(screen.getByRole('checkbox'));
        // O aviso usa <strong> internamente — usar container.textContent ou regex no container
        await waitFor(() => {
            // O texto "Atenção:" está no <strong>; o texto completo é composto
            expect(screen.getByText(/Atenção:/i)).toBeTruthy();
            expect(document.body.textContent).toContain('mensagens');
            expect(document.body.textContent).toContain('reais');
        });
    });

    it('salvar chama updateUiConfig com taskNotificationsExternalEnabled correto', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        // Habilita o toggle
        fireEvent.click(screen.getByRole('checkbox'));
        // Clica em Salvar
        fireEvent.click(screen.getByRole('button', { name: /Salvar/i }));
        await waitFor(() => {
            expect(mockUpdateUiConfig).toHaveBeenCalledWith(
                expect.objectContaining({ taskNotificationsExternalEnabled: true })
            );
        });
    });

    it('botão Verificar carrega o diagnóstico de usuários sem telefone', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        fireEvent.click(screen.getByRole('button', { name: /Verificar/i }));
        await waitFor(() => {
            expect(mockGetUsersMissingPhone).toHaveBeenCalled();
            expect(screen.getByText(/1 de 3/)).toBeTruthy();
        });
    });

    it('diagnóstico exibe lista de usuários sem telefone ao expandir', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        fireEvent.click(screen.getByRole('button', { name: /Verificar/i }));
        await waitFor(() => expect(screen.getByText('João Silva')).toBeTruthy());
        // login e email podem aparecer múltiplos — verificar pelo nome completo que é único
        expect(screen.getAllByText(/joao/).length).toBeGreaterThan(0);
    });
});
