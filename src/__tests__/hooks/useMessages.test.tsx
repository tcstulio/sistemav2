/**
 * useMessages hook tests
 * #829: o hook deve expor `error` e NÃO disparar toast.error redundante
 *       (a UI já exibe um ErrorState visível).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../contexts/WhatsAppContext', () => ({
    useWhatsAppContext: () => ({ socket: null }),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: { WHATSAPP_API_URL: 'http://wa' } }),
}));

const { mockToast } = vi.hoisted(() => ({
    mockToast: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));
vi.mock('sonner', () => ({ toast: mockToast }));

const mockGetMessages = vi.fn();
vi.mock('../../services/whatsappService', () => ({
    WhatsAppService: {
        getMessages: (...args: unknown[]) => mockGetMessages(...args),
    },
}));

import { useMessages } from '../../hooks/whatsapp/useMessages';

describe('useMessages — #829 exposição de erro', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('expõe error e NÃO chama toast.error quando getMessages falha', async () => {
        mockGetMessages.mockRejectedValueOnce(new Error('network down'));

        const { result } = renderHook(() => useMessages('sess1', 'chat-1'));

        await waitFor(() => {
            expect(result.current.error).toBeTruthy();
        });

        expect(result.current.error?.message).toBe('network down');
        expect(result.current.loading).toBe(false);
        // #859: isError reflete o estado de erro.
        expect(result.current.isError).toBe(true);
        // #829: toast.error removido — a UI mostra ErrorState.
        expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('limpa o erro ao carregar com sucesso', async () => {
        mockGetMessages.mockResolvedValueOnce([{ id: 'm1', text: 'ok' }]);

        const { result } = renderHook(() => useMessages('sess1', 'chat-1'));

        await waitFor(() => {
            expect(result.current.messages.length).toBe(1);
        });

        expect(result.current.error).toBeNull();
        // #859: sem erro -> isError false.
        expect(result.current.isError).toBe(false);
        expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('expõe refetch que reexecuta o fetch', async () => {
        mockGetMessages.mockResolvedValueOnce([]);
        mockGetMessages.mockResolvedValueOnce([{ id: 'm2' }]);

        const { result } = renderHook(() => useMessages('sess1', 'chat-1'));

        await waitFor(() => expect(result.current.refetch).toBeDefined());

        await result.current.refetch();

        await waitFor(() => {
            expect(result.current.messages.length).toBe(1);
        });
    });

    it('#859: isError vira false após refetch bem-sucedido (recuperação)', async () => {
        mockGetMessages.mockRejectedValueOnce(new Error('falhou'));
        mockGetMessages.mockResolvedValueOnce([{ id: 'm-rec' }]);

        const { result } = renderHook(() => useMessages('sess1', 'chat-1'));

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });

        await result.current.refetch();

        await waitFor(() => {
            expect(result.current.isError).toBe(false);
        });
        expect(result.current.error).toBeNull();
        expect(result.current.messages.length).toBe(1);
    });
});
