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

// Auth via cookie httpOnly (#33): a chave não vive mais no sessionStorage.
// admin-check diz se a sessão existe; admin-login seta o cookie no backend.
let checkAuthenticated = false;
let restartHandler: (url: string) => Promise<any>;

const okJson = (body: any) => Promise.resolve({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
    vi.clearAllMocks();
    checkAuthenticated = false;
    restartHandler = () => okJson({});
    mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/auth/admin-check')) return okJson({ authenticated: checkAuthenticated });
        if (url.includes('/api/auth/admin-login')) return okJson({ success: true });
        if (url.includes('/api/auth/admin-logout')) return okJson({ success: true });
        if (url.includes('/api/admin/status')) return okJson({ uptime: 600, system: { platform: 'linux' }, services: { waha: 'WORKING' } });
        if (url.includes('/api/admin/restart')) return restartHandler(url);
        return okJson({});
    });
});

const renderWithProvider = () =>
    render(
        <ConfirmProvider>
            <AdminApp />
        </ConfirmProvider>
    );

const login = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByPlaceholderText('Digite a chave de admin...'), 'secret-key');
    await user.click(screen.getByText('Entrar no Console'));
    await screen.findByText('Admin Console');
};

describe('AdminApp — auth via cookie httpOnly (#33) + confirm/toast (#335)', () => {
    it('renders login screen when not authenticated', async () => {
        renderWithProvider();
        expect(await screen.findByText('Área Restrita')).toBeTruthy();
        expect(screen.getByPlaceholderText('Digite a chave de admin...')).toBeTruthy();
    });

    it('does not store the admin key in sessionStorage on login', async () => {
        const user = userEvent.setup();
        renderWithProvider();
        await login(user);
        expect(sessionStorage.getItem('doli_admin_key')).toBeNull();
        // o login chama o endpoint de cookie, não escreve storage
        expect(mockFetch).toHaveBeenCalledWith(
            '/api/auth/admin-login',
            expect.objectContaining({ method: 'POST', credentials: 'include' })
        );
    });

    it('starts authenticated when the cookie session is valid (admin-check)', async () => {
        checkAuthenticated = true;
        renderWithProvider();
        expect(await screen.findByText('Admin Console')).toBeTruthy();
    });

    it('shows an error when admin-login is rejected', async () => {
        const user = userEvent.setup();
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/api/auth/admin-check')) return okJson({ authenticated: false });
            if (url.includes('/api/auth/admin-login')) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
            return okJson({});
        });
        renderWithProvider();
        await user.type(screen.getByPlaceholderText('Digite a chave de admin...'), 'wrong-key');
        await user.click(screen.getByText('Entrar no Console'));
        expect(await screen.findByText(/Chave incorreta/)).toBeTruthy();
    });

    it('authenticates and shows the admin console', async () => {
        const user = userEvent.setup();
        renderWithProvider();
        await login(user);
        expect(screen.getByText('Admin Console')).toBeTruthy();
    });

    it('admin requests use credentials:include (cookie), not an x-admin-key header', async () => {
        const user = userEvent.setup();
        renderWithProvider();
        await login(user);
        await waitFor(() => {
            const statusCall = mockFetch.mock.calls.find((c: any[]) => String(c[0]).includes('/api/admin/status'));
            expect(statusCall).toBeTruthy();
            expect(statusCall![1]).toMatchObject({ credentials: 'include' });
            expect(statusCall![1]?.headers?.['x-admin-key']).toBeUndefined();
        });
    });

    it('shows in-app confirm dialog on Reiniciar Sessão WAHA', async () => {
        const user = userEvent.setup();
        renderWithProvider();
        await login(user);

        await user.click(await screen.findByText('Reiniciar Sessão WAHA'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Isso tentará reiniciar a conexão do WhatsApp. Confirmar?')).toBeTruthy();
    });

    it('sends restart command and shows success toast when confirmed', async () => {
        const user = userEvent.setup();
        renderWithProvider();
        await login(user);

        await user.click(await screen.findByText('Reiniciar Sessão WAHA'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/admin/restart',
                expect.objectContaining({ method: 'POST', credentials: 'include' })
            );
        });
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Comando enviado.'));
    });

    it('does NOT send restart command when confirm is cancelled', async () => {
        const user = userEvent.setup();
        renderWithProvider();
        await login(user);

        await user.click(await screen.findByText('Reiniciar Sessão WAHA'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Cancelar'));

        await waitFor(() => {
            expect(mockFetch).not.toHaveBeenCalledWith('/api/admin/restart', expect.anything());
        });
    });

    it('shows error toast on 403 response', async () => {
        const user = userEvent.setup();
        restartHandler = () => Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
        renderWithProvider();
        await login(user);

        await user.click(await screen.findByText('Reiniciar Sessão WAHA'));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByText('Confirmar'));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Acesso Negado: Chave Inválida'));
    });

    it('shows notifyError toast when fetch throws', async () => {
        const user = userEvent.setup();
        restartHandler = () => Promise.reject(new Error('Network failure'));
        renderWithProvider();
        await login(user);

        await user.click(await screen.findByText('Reiniciar Sessão WAHA'));
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
