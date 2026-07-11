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
    // então esperamos o checkbox do toggle externo aparecer — sinal de que config foi carregado).
    // #1293: o editor agora tem múltiplos checkboxes (quiet-hours); selecionamos o toggle externo por nome.
    const externalCheckbox = () => screen.getByRole('checkbox', { name: /Notificações externas/i }) as HTMLInputElement;
    const waitForLoaded = () => waitFor(() => expect(externalCheckbox()).toBeTruthy());

    it('renderiza o toggle para admin', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        expect(externalCheckbox()).toBeTruthy();
        expect(screen.getByText(/Notificações externas/i)).toBeTruthy();
    });

    it('não renderiza nada para não-admin', () => {
        const { container } = render(<NotificationConfigEditor isAdmin={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('toggle inicia desabilitado conforme o config default', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        expect(externalCheckbox().checked).toBe(false);
    });

    it('exibe aviso de mensagens reais ao habilitar o toggle', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        fireEvent.click(externalCheckbox());
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
        fireEvent.click(externalCheckbox());
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

// #1293 — seções de política de notificações (cadência, quiet-hours, alertas).
describe('NotificationConfigEditor — política de notificações (#1293)', () => {
    const DEFAULT_POLICY = {
        cobrancaCadence: { reminderDaysBefore: 1, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
        quietHours: {
            whatsapp: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
            email: { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
            'in-app': { enabled: false, startHHmm: '22:00', endHHmm: '07:00', weekdaysOnly: false },
        },
        staleHours: 24,
        invoiceDueHorizonDays: 3,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUiConfig.mockResolvedValue({ ...mockConfig, notificationPolicy: DEFAULT_POLICY });
        mockUpdateUiConfig.mockResolvedValue({ ...mockConfig, notificationPolicy: DEFAULT_POLICY });
        mockGetUsersMissingPhone.mockResolvedValue({ total: 0, missingCount: 0, users: [] });
    });

    const externalCheckbox = () => screen.getByRole('checkbox', { name: /Notificações externas/i }) as HTMLInputElement;
    const waitForLoaded = () => waitFor(() => expect(externalCheckbox()).toBeTruthy());

    it('renderiza os campos de cadência, quiet-hours e alertas com valores do UiConfig', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        // Cadência
        expect((screen.getByLabelText('Lembrete antes do prazo (dias)') as HTMLInputElement).value).toBe('1');
        expect((screen.getByLabelText('Intervalo entre recobranças (dias)') as HTMLInputElement).value).toBe('2');
        expect((screen.getByLabelText('Escalar após N cobranças') as HTMLInputElement).value).toBe('3');
        expect((screen.getByLabelText('Prazo de aceite (dias)') as HTMLInputElement).value).toBe('1');
        // Alertas
        expect((screen.getByLabelText('Ticket stale (horas)') as HTMLInputElement).value).toBe('24');
        expect((screen.getByLabelText('Fatura a vencer (dias)') as HTMLInputElement).value).toBe('3');
        // Quiet-hours toggles presentes
        expect(screen.getByRole('checkbox', { name: /Habilitar quiet-hours WhatsApp/i })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: /Habilitar quiet-hours E-mail/i })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: /Habilitar quiet-hours In-app/i })).toBeTruthy();
    });

    it('caí nos defaults visuais quando o UiConfig não traz notificationPolicy', async () => {
        mockGetUiConfig.mockResolvedValue(mockConfig); // sem notificationPolicy
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        expect((screen.getByLabelText('Ticket stale (horas)') as HTMLInputElement).value).toBe('24');
        expect((screen.getByLabelText('Fatura a vencer (dias)') as HTMLInputElement).value).toBe('3');
        expect((screen.getByLabelText('Lembrete antes do prazo (dias)') as HTMLInputElement).value).toBe('1');
    });

    it('altera cadência + alertas e envia o payload correto ao salvar', async () => {
        const updated = {
            ...mockConfig,
            notificationPolicy: {
                ...DEFAULT_POLICY,
                cobrancaCadence: { ...DEFAULT_POLICY.cobrancaCadence, reminderDaysBefore: 5 },
                staleHours: 48,
                invoiceDueHorizonDays: 7,
            },
        };
        mockUpdateUiConfig.mockResolvedValue(updated);

        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();

        fireEvent.change(screen.getByLabelText('Lembrete antes do prazo (dias)'), { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText('Ticket stale (horas)'), { target: { value: '48' } });
        fireEvent.change(screen.getByLabelText('Fatura a vencer (dias)'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: /Salvar/i }));

        await waitFor(() => {
            expect(mockUpdateUiConfig).toHaveBeenCalledTimes(1);
        });
        const payload = mockUpdateUiConfig.mock.calls[0][0];
        expect(payload.notificationPolicy).toMatchObject({
            cobrancaCadence: { reminderDaysBefore: 5, recobrancaIntervalDays: 2, escalateAfterCobrancas: 3, prazoDeAceiteDays: 1 },
            staleHours: 48,
            invoiceDueHorizonDays: 7,
        });
        // continua salvando taskNotifications + flag externo juntos
        expect(payload.taskNotifications).toBeDefined();
        expect(payload.taskNotificationsExternalEnabled).toBe(false);
    });

    it('habilita quiet-hours do WhatsApp e envia start/end/weekdaysOnly no payload', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        fireEvent.click(screen.getByRole('checkbox', { name: /Habilitar quiet-hours WhatsApp/i }));
        // campos de horário surgem ao habilitar
        fireEvent.change(screen.getByLabelText('Início quiet-hours WhatsApp'), { target: { value: '20:00' } });
        fireEvent.change(screen.getByLabelText('Fim quiet-hours WhatsApp'), { target: { value: '06:00' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /Apenas dias úteis quiet-hours WhatsApp/i }));
        fireEvent.click(screen.getByRole('button', { name: /Salvar/i }));

        await waitFor(() => expect(mockUpdateUiConfig).toHaveBeenCalledTimes(1));
        expect(mockUpdateUiConfig.mock.calls[0][0].notificationPolicy.quietHours.whatsapp)
            .toEqual({ enabled: true, startHHmm: '20:00', endHHmm: '06:00', weekdaysOnly: true });
    });

    it('impede salvar e mostra erro quando horário quiet-hours está malformado', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        fireEvent.click(screen.getByRole('checkbox', { name: /Habilitar quiet-hours E-mail/i }));
        // injeta valor inválido diretamente no input (simula browser/teclado malformado)
        fireEvent.change(screen.getByLabelText('Início quiet-hours E-mail'), { target: { value: '99:99' } });
        fireEvent.click(screen.getByRole('button', { name: /Salvar/i }));

        // NÃO chama a API enquanto há erro de validação
        await waitFor(() => expect(screen.getByText(/Horário de início inválido/i)).toBeTruthy());
        expect(mockUpdateUiConfig).not.toHaveBeenCalled();
    });

    it('mostra nota explicativa quando a janela cruza a meia-noite', async () => {
        render(<NotificationConfigEditor isAdmin={true} />);
        await waitForLoaded();
        fireEvent.click(screen.getByRole('checkbox', { name: /Habilitar quiet-hours In-app/i }));
        // defaults 22:00 -> 07:00 já cruzam meia-noite
        await waitFor(() => expect(screen.getByText(/cruza a meia-noite/i)).toBeTruthy());
    });
});
