import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockSvc = vi.hoisted(() => ({ getUiConfig: vi.fn(), updateUiConfig: vi.fn() }));
vi.mock('../../services/uiConfigService', () => mockSvc);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SecurityFeatureSwitches } from '../../components/admin/SecurityFeatureSwitches';

const SWITCHES = { dryRunMode: false, financialCommands: false, crmContextInjection: true };

describe('SecurityFeatureSwitches — kill-switches perigosos (#1129)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getUiConfig.mockResolvedValue({ featureSwitches: { ...SWITCHES } });
        mockSvc.updateUiConfig.mockResolvedValue({ featureSwitches: { ...SWITCHES } });
    });

    it('não-admin: não renderiza nada', () => {
        const { container } = render(<SecurityFeatureSwitches isAdmin={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('admin: carrega o config e mostra os três toggles', async () => {
        render(<SecurityFeatureSwitches isAdmin={true} />);
        expect(await screen.findByText(/Dry-run \(bloquear envio real de mensagens\)/)).toBeInTheDocument();
        expect(screen.getByText(/Comandos financeiros \(\/pagar, \/pix\)/)).toBeInTheDocument();
        expect(screen.getByText(/Injeção de contexto CRM no LLM \(privacidade\)/)).toBeInTheDocument();
        expect(mockSvc.getUiConfig).toHaveBeenCalled();
    });

    it('ligar DRY_RUN + salvar → updateUiConfig com dryRunMode=true', async () => {
        render(<SecurityFeatureSwitches isAdmin={true} />);
        await screen.findByText(/Dry-run/);
        const toggles = screen.getAllByRole('checkbox');
        fireEvent.click(toggles[0]); // 1º toggle = dryRun
        fireEvent.click(screen.getByText('Salvar'));
        await waitFor(() => expect(mockSvc.updateUiConfig).toHaveBeenCalledWith(expect.objectContaining({
            featureSwitches: expect.objectContaining({ dryRunMode: true }),
        })));
    });

    it('ligar FINANCIAL_COMMANDS + salvar → updateUiConfig com financialCommands=true', async () => {
        render(<SecurityFeatureSwitches isAdmin={true} />);
        await screen.findByText(/Comandos financeiros/);
        const toggles = screen.getAllByRole('checkbox');
        fireEvent.click(toggles[1]); // 2º toggle = financial
        fireEvent.click(screen.getByText('Salvar'));
        await waitFor(() => expect(mockSvc.updateUiConfig).toHaveBeenCalledWith(expect.objectContaining({
            featureSwitches: expect.objectContaining({ financialCommands: true }),
        })));
    });

    it('desligar CRM_CONTEXT + salvar → updateUiConfig com crmContextInjection=false', async () => {
        render(<SecurityFeatureSwitches isAdmin={true} />);
        await screen.findByText(/Injeção de contexto CRM/);
        const toggles = screen.getAllByRole('checkbox');
        fireEvent.click(toggles[2]); // 3º toggle = crm (começa ligado → desliga)
        fireEvent.click(screen.getByText('Salvar'));
        await waitFor(() => expect(mockSvc.updateUiConfig).toHaveBeenCalledWith(expect.objectContaining({
            featureSwitches: expect.objectContaining({ crmContextInjection: false }),
        })));
    });

    it('descreve o efeito ao pausar os comandos financeiros (muda o texto descritivo)', async () => {
        mockSvc.getUiConfig.mockResolvedValue({ featureSwitches: { dryRunMode: false, financialCommands: true, crmContextInjection: true } });
        render(<SecurityFeatureSwitches isAdmin={true} />);
        await screen.findByText(/Comandos financeiros/);
        expect(screen.getByText(/Ativo — \/pagar e \/pix aceitos pelo bot/)).toBeInTheDocument();
        const toggles = screen.getAllByRole('checkbox');
        fireEvent.click(toggles[1]); // desliga financial
        expect(screen.getByText(/Pausado — \/pagar e \/pix recusados pelo bot/)).toBeInTheDocument();
    });
});
