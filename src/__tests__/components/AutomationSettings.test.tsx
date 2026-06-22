import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { AutomationSettings } from '../../components/admin/AutomationSettings';
import type { DolibarrConfig } from '../../types';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));

const getConfig = vi.fn();
const updateConfig = vi.fn();

vi.mock('../../services/aiService', () => ({
    AiService: {
        getFinancialAnalysisAutomationConfig: (...args: unknown[]) => getConfig(...(args as [])),
        updateFinancialAnalysisAutomationConfig: (...args: unknown[]) => updateConfig(...(args as [unknown])),
    },
}));

const adminConfig: DolibarrConfig = {
    apiUrl: 'http://test',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    currentUser: {
        id: '1',
        login: 'admin',
        firstname: 'Admin',
        lastname: 'User',
        email: 'admin@test.com',
        admin: 1,
    } as any,
};

const nonAdminConfig: DolibarrConfig = {
    ...adminConfig,
    currentUser: { ...adminConfig.currentUser, admin: 0 } as any,
};

const renderView = (config: DolibarrConfig = adminConfig) =>
    render(
        <MemoryRouter>
            <AutomationSettings config={config} />
        </MemoryRouter>
    );

describe('AutomationSettings (#497)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('lists the "Análise Financeira IA" automation and loads its config', async () => {
        getConfig.mockResolvedValue({
            enabled: false,
            schedule: { dayOfWeek: 3, hour: 14, minute: 30 },
            lastRunAt: '2025-06-17T10:00:00.000Z',
            lastRunStatus: 'success',
        });

        renderView();

        expect(await screen.findByText('Análise Financeira IA')).toBeTruthy();
        expect(getConfig).toHaveBeenCalledTimes(1);
        // Status da última execução exibido (data local formatada contém "2025")
        expect(screen.getByText(/2025/)).toBeTruthy();
        expect(screen.getByText('Sucesso')).toBeTruthy();
    });

    it('toggles the automation on and persists { enabled: true }', async () => {
        const user = userEvent.setup();
        getConfig.mockResolvedValue({
            enabled: false,
            schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
            lastRunAt: null,
            lastRunStatus: null,
        });
        updateConfig.mockImplementation(async (patch: any) => ({
            enabled: patch.enabled === true,
            schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
            lastRunAt: null,
            lastRunStatus: null,
        }));

        renderView();
        const toggle = await screen.findByLabelText('Ativar/desativar Análise Financeira IA');

        await user.click(toggle);

        await waitFor(() => {
            expect(updateConfig).toHaveBeenCalledWith({ enabled: true });
        });
    });

    it('shows the "active" (green) badge when enabled', async () => {
        getConfig.mockResolvedValue({
            enabled: true,
            schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
            lastRunAt: null,
            lastRunStatus: null,
        });

        renderView();

        expect(await screen.findByText('Ativo')).toBeTruthy();
    });

    it('shows the "error" (red) badge when the last run failed', async () => {
        getConfig.mockResolvedValue({
            enabled: true,
            schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
            lastRunAt: '2025-06-17T10:00:00.000Z',
            lastRunStatus: 'error',
        });

        renderView();

        expect(await screen.findByText('Erro na última execução')).toBeTruthy();
        expect(screen.getByText('Erro')).toBeTruthy();
    });

    it('edits the schedule and persists it', async () => {
        const user = userEvent.setup();
        const loaded = {
            enabled: true,
            schedule: { dayOfWeek: 3, hour: 14, minute: 30 },
            lastRunAt: null,
            lastRunStatus: null,
        };
        getConfig.mockResolvedValue(loaded);
        updateConfig.mockImplementation(async (patch: any) => ({
            ...loaded,
            schedule: patch.schedule ?? loaded.schedule,
        }));

        renderView();
        // wait for load
        await screen.findByText('Análise Financeira IA');

        const select = screen.getByRole('combobox');
        await user.selectOptions(select, '0');

        const saveBtn = screen.getByText('Salvar horário');
        await user.click(saveBtn);

        await waitFor(() => {
            expect(updateConfig).toHaveBeenCalledWith({
                schedule: { dayOfWeek: 0, hour: 14, minute: 30 },
            });
        });
    });

    it('shows "Inativo" (gray) badge when disabled with no prior error', async () => {
        getConfig.mockResolvedValue({
            enabled: false,
            schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
            lastRunAt: null,
            lastRunStatus: null,
        });

        renderView();

        expect(await screen.findByText('Inativo')).toBeTruthy();
    });

    it('denies access for non-admin users', async () => {
        getConfig.mockResolvedValue({
            enabled: false,
            schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
            lastRunAt: null,
            lastRunStatus: null,
        });

        renderView(nonAdminConfig);

        expect(await screen.findByText('Acesso Restrito')).toBeTruthy();
        expect(screen.queryByText('Análise Financeira IA')).toBeNull();
        expect(getConfig).not.toHaveBeenCalled();
    });

    describe('feedback de sucesso/erro ao salvar (#677)', () => {
        const baseConfig = {
            enabled: false,
            schedule: { dayOfWeek: 1, hour: 8, minute: 0 },
            lastRunAt: null,
            lastRunStatus: null,
        };

        it('mostra toast de erro específico quando o carregamento inicial retorna null', async () => {
            getConfig.mockResolvedValue(null);

            renderView();

            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Não foi possível carregar as configurações de automação.');
            });
        });

        it('toggle: mostra toast de sucesso "Automação atualizada!" e reflete o estado na UI', async () => {
            const user = userEvent.setup();
            getConfig.mockResolvedValue({ ...baseConfig });
            updateConfig.mockResolvedValue({ ...baseConfig, enabled: true });

            renderView();
            const toggle = await screen.findByLabelText('Ativar/desativar Análise Financeira IA') as HTMLInputElement;

            await user.click(toggle);

            await waitFor(() => {
                expect(toast.success).toHaveBeenCalledWith('Automação atualizada!');
            });
            expect(updateConfig).toHaveBeenCalledWith({ enabled: true });
            expect(toggle.checked).toBe(true);
        });

        it('toggle: mostra toast de erro específico e mantém o toggle desligado quando salvar falha', async () => {
            const user = userEvent.setup();
            getConfig.mockResolvedValue({ ...baseConfig });
            updateConfig.mockResolvedValue(null);

            renderView();
            const toggle = await screen.findByLabelText('Ativar/desativar Análise Financeira IA') as HTMLInputElement;

            await user.click(toggle);

            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Falha ao salvar automação. Tente novamente.');
            });
            expect(updateConfig).toHaveBeenCalledWith({ enabled: true });
            // cfg não foi atualizado => o toggle controlado permanece no estado anterior (off).
            expect(toggle.checked).toBe(false);
            expect(toast.success).not.toHaveBeenCalled();
        });

        it('salvar horário: mostra toast de sucesso "Horário salvo com sucesso!"', async () => {
            const user = userEvent.setup();
            const loaded = {
                enabled: true,
                schedule: { dayOfWeek: 3, hour: 14, minute: 30 },
                lastRunAt: null,
                lastRunStatus: null,
            };
            getConfig.mockResolvedValue(loaded);
            updateConfig.mockImplementation(async (patch: { schedule?: typeof loaded.schedule }) => ({
                ...loaded,
                schedule: patch.schedule ?? loaded.schedule,
            }));

            renderView();
            await screen.findByText('Análise Financeira IA');

            await user.selectOptions(screen.getByRole('combobox'), '0');
            await user.click(screen.getByText('Salvar horário'));

            await waitFor(() => {
                expect(toast.success).toHaveBeenCalledWith('Horário salvo com sucesso!');
            });
        });

        it('salvar horário: mostra toast de erro específico ao falhar', async () => {
            const user = userEvent.setup();
            const loaded = {
                enabled: true,
                schedule: { dayOfWeek: 3, hour: 14, minute: 30 },
                lastRunAt: null,
                lastRunStatus: null,
            };
            getConfig.mockResolvedValue(loaded);
            updateConfig.mockResolvedValue(null);

            renderView();
            await screen.findByText('Análise Financeira IA');

            await user.selectOptions(screen.getByRole('combobox'), '0');
            await user.click(screen.getByText('Salvar horário'));

            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Falha ao salvar horário.');
            });
            expect(toast.success).not.toHaveBeenCalled();
        });

        it('não exibe toast de "erro carregar" após salvar com sucesso', async () => {
            const user = userEvent.setup();
            getConfig.mockResolvedValue({ ...baseConfig });
            updateConfig.mockResolvedValue({ ...baseConfig, enabled: true });

            renderView();
            const toggle = await screen.findByLabelText('Ativar/desativar Análise Financeira IA');

            await user.click(toggle);

            await waitFor(() => {
                expect(toast.success).toHaveBeenCalledWith('Automação atualizada!');
            });
            // Após um salvamento bem-sucedido não deve aparecer toast de erro de carga.
            expect(toast.error).not.toHaveBeenCalledWith('Não foi possível carregar as configurações de automação.');
        });
    });
});
