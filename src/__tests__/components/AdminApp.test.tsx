import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminApp from '../../components/AdminApp';
import { ConfirmProvider } from '../../hooks/useConfirm';
import { toast } from 'sonner';

vi.mock('sonner', async () => {
    const actual = await vi.importActual<typeof import('sonner')>('sonner');
    return {
        ...actual,
        toast: {
            success: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
        },
    };
});

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: null }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

const renderWithProvider = () =>
    render(
        <ConfirmProvider>
            <AdminApp />
        </ConfirmProvider>
    );

describe('AdminApp — in-app confirm/toast (refactor #335)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    it('renders login screen when not authenticated', () => {
        renderWithProvider();
        expect(screen.getByText('Área Restrita')).toBeTruthy();
        expect(screen.getByPlaceholderText('Digite a chave de admin...')).toBeTruthy();
    });

    it('authenticates and shows the admin console', async () => {
        const user = userEvent.setup();
        mockFetch.mockResolvedValue({
            status: 200,
            json: async () => ({ uptime: 600, system: { platform: 'linux' }, services: { waha: 'WORKING' } }),
        });

        renderWithProvider();

        const input = screen.getByPlaceholderText('Digite a chave de admin...');
        await user.type(input, 'secret-key');
        await user.click(screen.getByText('Entrar no Console'));

        await waitFor(() => {
            expect(screen.getByText('Admin Console')).toBeTruthy();
        });
    });

    it('shows in-app confirm dialog on Reiniciar Sessão WAHA', async () => {
        const user = userEvent.setup();
        mockFetch.mockResolvedValue({
            status: 200,
            json: async () => ({ uptime: 600, system: { platform: 'linux' }, services: { waha: 'WORKING' } }),
        });

        renderWithProvider();

        await user.type(screen.getByPlaceholderText('Digite a chave de admin...'), 'secret-key');
        await user.click(screen.getByText('Entrar no Console'));

        await screen.findByText('Reiniciar Sessão WAHA');
        await user.click(screen.getByText('Reiniciar Sessão WAHA'));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeTruthy();
        expect(
            within(dialog).getByText('Isso tentará reiniciar a conexão do WhatsApp. Confirmar?')
        ).toBeTruthy();
    });

    it('sends restart command and shows success toast when confirmed', async () => {
        const user = userEvent.setup();

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/api/admin/status')) {
                return Promise.resolve({
                    status: 200,
                    json: async () => ({ uptime: 600, system: { platform: 'linux' }, services: { waha: 'WORKING' } }),
                });
            }
            if (url.includes('/api/admin/restart')) {
                return Promise.resolve({ status: 200, json: async () => ({}) });
            }
            return Promise.resolve({ status: 200, json: async () => ({}) });
        });

        renderWithProvider();

        await user.type(screen.getByPlaceholderText('Digite a chave de admin...'), 'secret-key');
        await user.click(screen.getByText('Entrar no Console'));

        await screen.findByText('Reiniciar Sessão WAHA');
        await user.click(screen.getByText('Reiniciar Sessão WAHA'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/admin/restart',
                expect.objectContaining({ method: 'POST' })
            );
        });

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Comando enviado.');
        });
    });

    it('does NOT send restart command when confirm is cancelled', async () => {
        const user = userEvent.setup();

        mockFetch.mockResolvedValue({
            status: 200,
            json: async () => ({ uptime: 600, system: { platform: 'linux' }, services: { waha: 'WORKING' } }),
        });

        renderWithProvider();

        await user.type(screen.getByPlaceholderText('Digite a chave de admin...'), 'secret-key');
        await user.click(screen.getByText('Entrar no Console'));

        await screen.findByText('Reiniciar Sessão WAHA');
        await user.click(screen.getByText('Reiniciar Sessão WAHA'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(mockFetch).not.toHaveBeenCalledWith(
                '/api/admin/restart',
                expect.anything()
            );
        });
    });

    it('shows error toast on 403 response', async () => {
        const user = userEvent.setup();

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/api/admin/status')) {
                return Promise.resolve({
                    status: 200,
                    json: async () => ({ uptime: 600, system: { platform: 'linux' }, services: { waha: 'WORKING' } }),
                });
            }
            if (url.includes('/api/admin/restart')) {
                return Promise.resolve({ status: 403, json: async () => ({}) });
            }
            return Promise.resolve({ status: 200, json: async () => ({}) });
        });

        renderWithProvider();

        await user.type(screen.getByPlaceholderText('Digite a chave de admin...'), 'secret-key');
        await user.click(screen.getByText('Entrar no Console'));

        await screen.findByText('Reiniciar Sessão WAHA');
        await user.click(screen.getByText('Reiniciar Sessão WAHA'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Acesso Negado: Chave Inválida');
        });
    });

    it('shows notifyError toast when fetch throws', async () => {
        const user = userEvent.setup();

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/api/admin/status')) {
                return Promise.resolve({
                    status: 200,
                    json: async () => ({ uptime: 600, system: { platform: 'linux' }, services: { waha: 'WORKING' } }),
                });
            }
            if (url.includes('/api/admin/restart')) {
                return Promise.reject(new Error('Network failure'));
            }
            return Promise.resolve({ status: 200, json: async () => ({}) });
        });

        renderWithProvider();

        await user.type(screen.getByPlaceholderText('Digite a chave de admin...'), 'secret-key');
        await user.click(screen.getByText('Entrar no Console'));

        await screen.findByText('Reiniciar Sessão WAHA');
        await user.click(screen.getByText('Reiniciar Sessão WAHA'));

        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith(
                'Reiniciar WAHA falhou.',
                expect.objectContaining({ id: 'err:Reiniciar WAHA' })
            );
        });
    });
});
