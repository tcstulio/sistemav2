/**
 * InterSettingsTab — testes de componente (issue #988)
 *
 * Garante que o formulário Inter salva credenciais via API real (sem alert()),
 * mascara campos sensíveis, valida obrigatórios, mostra toasts sonner, tem
 * loading state e recarrega o status ao montar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ── hoisted mocks ────────────────────────────────────────────────────────────

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

const bankingService = vi.hoisted(() => ({
    saveBankingCredentials: vi.fn(),
    getBankingCredentialsStatus: vi.fn(),
}));

const interHook = vi.hoisted(() => ({
    status: null,
    statusLoading: false,
    testConnection: vi.fn(),
    testConnectionLoading: false,
    uploadCertificates: vi.fn(),
    uploadCertificatesLoading: false,
    saldo: undefined,
}));

vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('../../services/bankingConfigService', () => ({
    saveBankingCredentials: (bank: string, body: unknown) => bankingService.saveBankingCredentials(bank, body),
    getBankingCredentialsStatus: (bank: string) => bankingService.getBankingCredentialsStatus(bank),
}));

vi.mock('../../hooks/useInterBank', () => ({
    useInterBank: () => ({
        status: interHook.status,
        statusLoading: interHook.statusLoading,
        testConnection: interHook.testConnection,
        testConnectionLoading: interHook.testConnectionLoading,
        uploadCertificates: interHook.uploadCertificates,
        uploadCertificatesLoading: interHook.uploadCertificatesLoading,
        saldo: interHook.saldo,
    }),
}));

// ── import depois dos mocks ──────────────────────────────────────────────────

import { InterSettingsTab } from '../../components/Banking/InterSettingsTab';

function renderWithProvider(ui: ReactNode) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('InterSettingsTab — salvamento real de credenciais (#988)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        bankingService.getBankingCredentialsStatus.mockResolvedValue({
            hasClientSecret: false,
            environment: 'sandbox',
        });
        bankingService.saveBankingCredentials.mockResolvedValue({
            configured: true,
            hasClientId: true,
            hasClientSecret: true,
            environment: 'sandbox',
        });
    });

    it('recarrega o status das credenciais ao montar (sem expor o secret)', async () => {
        renderWithProvider(<InterSettingsTab />);
        await waitFor(() => {
            expect(bankingService.getBankingCredentialsStatus).toHaveBeenCalledWith('inter');
        });
    });

    it('mascara o Client Secret (type=password)', () => {
        renderWithProvider(<InterSettingsTab />);
        const secret = screen.getByPlaceholderText('Seu Client Secret');
        expect(secret).toHaveAttribute('type', 'password');
    });

    it('valida campos obrigatórios: bloqueia o save vazio e NÃO chama a API', async () => {
        const user = userEvent.setup();
        renderWithProvider(<InterSettingsTab />);
        await user.click(screen.getByRole('button', { name: /Salvar Credenciais/i }));

        expect(toastMock.error).toHaveBeenCalled();
        expect(bankingService.saveBankingCredentials).not.toHaveBeenCalled();
    });

    it('salva credenciais via API real (clientId, clientSecret, environment) e exibe toast de sucesso', async () => {
        const user = userEvent.setup();
        renderWithProvider(<InterSettingsTab />);

        await user.type(screen.getByPlaceholderText('Seu Client ID do Banco Inter'), 'inter-cid');
        await user.type(screen.getByPlaceholderText('Seu Client Secret'), 'inter-secret');
        await user.click(screen.getByRole('button', { name: /Salvar Credenciais/i }));

        await waitFor(() => {
            expect(bankingService.saveBankingCredentials).toHaveBeenCalledWith(
                'inter',
                expect.objectContaining({
                    clientId: 'inter-cid',
                    clientSecret: 'inter-secret',
                    environment: 'sandbox',
                }),
            );
        });
        expect(toastMock.success).toHaveBeenCalled();

        // Após salvar, o secret é mascarado/limpo e o placeholder indica "configurado".
        const secretAfter = screen.getByPlaceholderText(/configurado/) as HTMLInputElement;
        expect(secretAfter.value).toBe('');
        expect(secretAfter).toHaveAttribute('type', 'password');
    });

    it('salva a conta junto com as credenciais (client_id, client_secret, conta)', async () => {
        const user = userEvent.setup();
        renderWithProvider(<InterSettingsTab />);

        await user.type(screen.getByPlaceholderText('Seu Client ID do Banco Inter'), 'inter-cid');
        await user.type(screen.getByPlaceholderText('Seu Client Secret'), 'inter-secret');
        await user.type(screen.getByPlaceholderText('Número da conta (sem dígito)'), '1234567');
        await user.click(screen.getByRole('button', { name: /Salvar Credenciais/i }));

        await waitFor(() => {
            expect(bankingService.saveBankingCredentials).toHaveBeenCalledWith(
                'inter',
                expect.objectContaining({
                    clientId: 'inter-cid',
                    clientSecret: 'inter-secret',
                    contaCorrente: '1234567',
                    environment: 'sandbox',
                }),
            );
        });
        expect(toastMock.success).toHaveBeenCalled();
    });

    it('exibe toast de erro (e nenhum success) quando a API rejeita', async () => {
        bankingService.saveBankingCredentials.mockRejectedValue({ message: 'falha de rede' });
        const user = userEvent.setup();
        renderWithProvider(<InterSettingsTab />);

        await user.type(screen.getByPlaceholderText('Seu Client ID do Banco Inter'), 'cid');
        await user.click(screen.getByRole('button', { name: /Salvar Credenciais/i }));

        await waitFor(() => {
            expect(toastMock.error).toHaveBeenCalled();
        });
        expect(toastMock.success).not.toHaveBeenCalled();
    });

    it('mostra loading state (botão desabilitado) durante o save', async () => {
        let resolveSave!: (v: unknown) => void;
        bankingService.saveBankingCredentials.mockReturnValue(
            new Promise((r) => { resolveSave = r; }),
        );
        const user = userEvent.setup();
        renderWithProvider(<InterSettingsTab />);

        await user.type(screen.getByPlaceholderText('Seu Client ID do Banco Inter'), 'cid');
        const saveBtn = screen.getByRole('button', { name: /Salvar Credenciais/i });
        await user.click(saveBtn);

        await waitFor(() => expect(saveBtn).toBeDisabled());

        resolveSave({ configured: true, hasClientId: true, hasClientSecret: true, environment: 'sandbox' });

        await waitFor(() => expect(saveBtn).not.toBeDisabled());
    });

    it('não contém nenhuma instrução de editar .env', () => {
        const { container } = renderWithProvider(<InterSettingsTab />);
        expect(container.textContent?.toLowerCase()).not.toContain('.env');
    });
});
