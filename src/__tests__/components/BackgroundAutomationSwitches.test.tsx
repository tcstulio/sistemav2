import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockSvc = vi.hoisted(() => ({ getUiConfig: vi.fn(), updateUiConfig: vi.fn() }));
vi.mock('../../services/uiConfigService', () => mockSvc);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BackgroundAutomationSwitches } from '../../components/admin/BackgroundAutomationSwitches';

const SWITCHES = { schedulerEnabled: true, alertCronEnabled: true };

describe('BackgroundAutomationSwitches — kill-switch das automações de fundo (#1204)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getUiConfig.mockResolvedValue({ automationSwitches: { ...SWITCHES } });
        mockSvc.updateUiConfig.mockResolvedValue({ automationSwitches: { ...SWITCHES } });
    });

    it('não-admin: não renderiza nada', () => {
        const { container } = render(<BackgroundAutomationSwitches isAdmin={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('admin: carrega o config e mostra os dois toggles + descrições', async () => {
        render(<BackgroundAutomationSwitches isAdmin={true} />);
        expect(await screen.findByText(/Mensagens agendadas \(WhatsApp\/E-mail\)/)).toBeInTheDocument();
        expect(screen.getByText(/Alertas de fundo \(faturas\/estoque\/tickets\)/)).toBeInTheDocument();
        expect(mockSvc.getUiConfig).toHaveBeenCalled();
    });

    it('desligar scheduler + salvar → updateUiConfig com schedulerEnabled=false', async () => {
        render(<BackgroundAutomationSwitches isAdmin={true} />);
        await screen.findByText(/Mensagens agendadas/);
        const toggles = screen.getAllByRole('checkbox');
        fireEvent.click(toggles[0]); // 1º toggle = scheduler
        fireEvent.click(screen.getByText('Salvar'));
        await waitFor(() => expect(mockSvc.updateUiConfig).toHaveBeenCalledWith(expect.objectContaining({
            automationSwitches: expect.objectContaining({ schedulerEnabled: false }),
        })));
    });

    it('desligar alertCron + salvar → updateUiConfig com alertCronEnabled=false', async () => {
        render(<BackgroundAutomationSwitches isAdmin={true} />);
        await screen.findByText(/Alertas de fundo/);
        const toggles = screen.getAllByRole('checkbox');
        fireEvent.click(toggles[1]); // 2º toggle = alertCron
        fireEvent.click(screen.getByText('Salvar'));
        await waitFor(() => expect(mockSvc.updateUiConfig).toHaveBeenCalledWith(expect.objectContaining({
            automationSwitches: expect.objectContaining({ alertCronEnabled: false }),
        })));
    });

    it('descreve o efeito ao pausar o scheduler (muda o texto descritivo)', async () => {
        render(<BackgroundAutomationSwitches isAdmin={true} />);
        await screen.findByText(/Mensagens agendadas/);
        expect(screen.getByText(/Ativo — mensagens agendadas saem a cada 30s/)).toBeInTheDocument();
        const toggles = screen.getAllByRole('checkbox');
        fireEvent.click(toggles[0]); // desliga scheduler
        expect(screen.getByText(/Pausado — nenhuma mensagem agendada sai até religar/)).toBeInTheDocument();
    });
});
