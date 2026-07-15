import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockCfg = vi.hoisted(() => ({ getUiConfig: vi.fn(), updateUiConfig: vi.fn() }));
const mockWa = vi.hoisted(() => ({ WhatsAppService: { getAccounts: vi.fn() } }));
const mockToast = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/uiConfigService', () => mockCfg);
vi.mock('../../services/whatsappService', () => mockWa);
vi.mock('sonner', () => mockToast);

import { WhatsAppSessionConfig } from '../../components/admin/WhatsAppSessionConfig';

const acct = (id: string, status: 'connected' | 'disconnected', over: any = {}) =>
    ({ id, name: `Sessão ${id}`, phoneNumber: '5511999', status, platform: 'WAHA', ...over });

describe('WhatsAppSessionConfig (#1440)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCfg.getUiConfig.mockResolvedValue({ whatsappPrimarySessionId: '', whatsappFallbackPolicy: 'fail' });
        mockCfg.updateUiConfig.mockImplementation(async (p: any) => ({ whatsappPrimarySessionId: p.whatsappPrimarySessionId, whatsappFallbackPolicy: p.whatsappFallbackPolicy }));
        mockWa.WhatsAppService.getAccounts.mockResolvedValue([acct('v4_1747', 'connected'), acct('default', 'disconnected')]);
    });

    it('não-admin: não renderiza nada', () => {
        const { container } = render(<WhatsAppSessionConfig isAdmin={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('admin: carrega config + sessões; dropdown lista SÓ as WORKING (connected)', async () => {
        render(<WhatsAppSessionConfig isAdmin={true} />);
        await screen.findByText(/Sessão de WhatsApp institucional/);
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        const optionValues = Array.from(select.options).map(o => o.value);
        expect(optionValues).toContain('v4_1747');   // connected → listada
        expect(optionValues).not.toContain('default'); // disconnected → NÃO listada
        // as 2 políticas presentes
        expect(screen.getByText(/Falhar \(recomendado\)/)).toBeInTheDocument();
        expect(screen.getByText(/Desviar para a 1ª sessão WORKING/)).toBeInTheDocument();
    });

    it('escolher sessão WORKING + política + salvar → updateUiConfig com o payload certo', async () => {
        render(<WhatsAppSessionConfig isAdmin={true} />);
        await screen.findByText(/Sessão de WhatsApp institucional/);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'v4_1747' } });
        fireEvent.click(screen.getByRole('radio', { name: /Desviar para a 1ª sessão WORKING/ }));
        fireEvent.click(screen.getByText('Salvar sessão de envio'));
        await waitFor(() => expect(mockCfg.updateUiConfig).toHaveBeenCalledWith({
            whatsappPrimarySessionId: 'v4_1747',
            whatsappFallbackPolicy: 'first-working',
        }));
        expect(mockToast.toast.success).toHaveBeenCalled();
    });

    it('nenhuma sessão WORKING → mostra aviso e NÃO renderiza dropdown', async () => {
        mockWa.WhatsAppService.getAccounts.mockResolvedValue([acct('default', 'disconnected')]);
        render(<WhatsAppSessionConfig isAdmin={true} />);
        await screen.findByText(/Nenhuma sessão de WhatsApp está WORKING/);
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('validação: sessão configurada que NÃO está WORKING → salvar é bloqueado (toast.error, sem updateUiConfig)', async () => {
        mockCfg.getUiConfig.mockResolvedValue({ whatsappPrimarySessionId: 'down-sess', whatsappFallbackPolicy: 'fail' });
        mockWa.WhatsAppService.getAccounts.mockResolvedValue([acct('v4_1747', 'connected')]); // down-sess NÃO está working
        render(<WhatsAppSessionConfig isAdmin={true} />);
        await screen.findByText(/Sessão de WhatsApp institucional/);
        // aviso de "configurada mas down" aparece
        expect(screen.getByText(/NÃO está WORKING agora/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('Salvar sessão de envio'));
        await waitFor(() => expect(mockToast.toast.error).toHaveBeenCalled());
        expect(mockCfg.updateUiConfig).not.toHaveBeenCalled();
    });
});
