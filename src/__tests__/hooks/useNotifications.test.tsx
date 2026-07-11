/**
 * useNotifications hook tests (#1315)
 *
 * Foco no novo comportamento introduzido para tornar as notificações in-app visíveis
 * e funcionais: polling de 30s (backstop de entrega quando o websocket cai), merge que
 * preserva marcação "lida" otimista, refresh ao reativar a aba, limpeza no unmount,
 * além do caminho em tempo real via socket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import type { AppNotification } from '../../types';

// --- Mocks -----------------------------------------------------------------

// Socket controlável para o caminho em tempo real.
const sock = vi.hoisted(() => {
    const listeners: Record<string, Set<(payload: unknown) => void>> = {};
    return {
        socket: {
            on(event: string, h: (p: unknown) => void) { (listeners[event] ||= new Set()).add(h); },
            off(event: string, h: (p: unknown) => void) { listeners[event]?.delete(h); },
            emit(event: string, payload: unknown) { listeners[event]?.forEach(h => h(payload)); },
            reset() { for (const k of Object.keys(listeners)) delete listeners[k]; },
        },
    };
});

vi.mock('../../contexts/WhatsAppContext', () => ({
    useWhatsAppContext: () => ({ socket: sock.socket }),
}));

vi.mock('../../config', () => ({ config: { API_BASE_URL: '' } }));

vi.mock('../../utils/logger', () => ({
    logger: {
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
        child: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    },
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/push-notifications', () => ({
    PushNotifications: {
        checkPermissions: vi.fn(),
        requestPermissions: vi.fn(),
        register: vi.fn(),
        addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    },
}));

import { useNotifications, useNotificationActions, NOTIFICATION_POLL_INTERVAL_MS } from '../../hooks/useNotifications';

// --- Helpers ----------------------------------------------------------------

const rawNotif = (id: string, read = false, extra: Record<string, unknown> = {}) => ({
    id,
    event: 'custom',
    title: `Título ${id}`,
    message: `Mensagem ${id}`,
    createdAt: 1000,
    priority: 'medium',
    read,
    ...extra,
});

/** Resposta fetch "ok" com o payload JSON informado. */
const okRes = (body: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
    headers: new Headers(),
    clone() { return this; },
});

/** Avança os timers fake em 0ms apenas para drenar microtasks pendentes (fetch inicial). */
const flushMicrotasks = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

// --- Setup ------------------------------------------------------------------

type SetNotifications = React.Dispatch<React.SetStateAction<AppNotification[]>>;
type NotifUpdater = (prev: AppNotification[]) => AppNotification[];

describe('useNotifications (#1315)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let setNotifications: SetNotifications & { mock: { calls: unknown[][] } };

    beforeEach(() => {
        vi.useFakeTimers();
        sock.socket.reset();
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        setNotifications = vi.fn() as unknown as SetNotifications & { mock: { calls: unknown[][] } };
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    // ---- Polling de 30s ----------------------------------------------------

    it('busca as notificações na montagem', async () => {
        fetchMock.mockResolvedValue(okRes({ notifications: [rawNotif('a')] }));

        renderHook(() => useNotifications(setNotifications, () => {}));
        await flushMicrotasks();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(setNotifications).toHaveBeenCalled();
    });

    it('re-busca a cada 30s (polling)', async () => {
        fetchMock.mockResolvedValue(okRes({ notifications: [] }));

        renderHook(() => useNotifications(setNotifications, () => {}));
        await flushMicrotasks();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await act(async () => { await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS); });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await act(async () => { await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS); });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('não dispara fetch novo antes de completar 30s', async () => {
        fetchMock.mockResolvedValue(okRes({ notifications: [] }));

        renderHook(() => useNotifications(setNotifications, () => {}));
        await flushMicrotasks();

        await act(async () => { await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS - 1); });
        expect(fetchMock).toHaveBeenCalledTimes(1); // ainda não
    });

    it('interrompe o polling no unmount', async () => {
        fetchMock.mockResolvedValue(okRes({ notifications: [] }));

        const { unmount } = renderHook(() => useNotifications(setNotifications, () => {}));
        await flushMicrotasks();

        unmount();

        await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
        expect(fetchMock).toHaveBeenCalledTimes(1); // nenhum poll após desmontar
    });

    // ---- Merge do feed -----------------------------------------------------

    it('faz aparecer notificação nova que chega via polling', async () => {
        fetchMock.mockResolvedValueOnce(okRes({ notifications: [] }));

        renderHook(() => useNotifications(setNotifications, () => {}));
        await flushMicrotasks();

        // Próximo ciclo de polling traz uma notificação nova
        fetchMock.mockResolvedValueOnce(okRes({ notifications: [rawNotif('n1')] }));
        await act(async () => { await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS); });

        const updater = setNotifications.mock.calls.at(-1)![0] as NotifUpdater;
        const result = updater([]);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('n1');
    });

    it('preserva marcação "lida" otimista local que o servidor ainda não refletiu', async () => {
        // Servidor ainda marca como não-lida
        fetchMock.mockResolvedValue(okRes({ notifications: [rawNotif('a', false)] }));

        renderHook(() => useNotifications(setNotifications, () => {}));
        await flushMicrotasks();

        await act(async () => { await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS); });

        const updater = setNotifications.mock.calls.at(-1)![0] as NotifUpdater;
        // Estado local: usuário já marcou como lida (otimista)
        const localRead: AppNotification[] = [{ id: 'a', type: 'info', title: 't', message: 'm', date: 1, priority: 'medium', read: true }];
        const result = updater(localRead);
        expect(result[0].read).toBe(true); // não reverte pra não-lida
    });

    it('reflete leitura vinda do servidor quando não há estado otimista conflitante', async () => {
        fetchMock.mockResolvedValue(okRes({ notifications: [rawNotif('a', true)] }));

        renderHook(() => useNotifications(setNotifications, () => {}));
        await flushMicrotasks();

        const updater = setNotifications.mock.calls.at(-1)![0] as NotifUpdater;
        const result: AppNotification[] = [];
        expect(updater(result)[0].read).toBe(true);
    });

    // ---- Visibilidade da aba ----------------------------------------------

    it('atualiza imediatamente quando a aba volta a ficar visível', async () => {
        fetchMock.mockResolvedValue(okRes({ notifications: [] }));

        renderHook(() => useNotifications(setNotifications, () => {}));
        await flushMicrotasks();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // ---- Caminho em tempo real (websocket) ---------------------------------

    it('adiciona notificação recebida via socket (sem duplicar)', async () => {
        fetchMock.mockResolvedValue(okRes({ notifications: [] }));
        renderHook(() => useNotifications(setNotifications, () => {}));
        await flushMicrotasks();

        sock.socket.emit('notification', rawNotif('s1'));

        const updater = setNotifications.mock.calls.at(-1)![0] as NotifUpdater;
        const first: AppNotification[] = [];
        const withS1 = updater(first);
        expect(withS1.map(n => n.id)).toContain('s1');

        // Dedupe: emitir de novo o mesmo id não duplica
        sock.socket.emit('notification', rawNotif('s1'));
        const updater2 = setNotifications.mock.calls.at(-1)![0] as NotifUpdater;
        expect(updater2(withS1).filter(n => n.id === 's1')).toHaveLength(1);
    });
});

// --- useNotificationActions --------------------------------------------------

describe('useNotificationActions', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(okRes({ success: true }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('markRead chama PUT /api/notifications/:id/read', async () => {
        const { result } = renderHook(() => useNotificationActions());
        const ok = await result.current('markRead', '42');
        expect(ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith('/api/notifications/42/read', { method: 'PUT' });
    });

    it('markAllRead chama PUT /api/notifications/read-all', async () => {
        const { result } = renderHook(() => useNotificationActions());
        await result.current('markAllRead');
        expect(fetchMock).toHaveBeenCalledWith('/api/notifications/read-all', { method: 'PUT' });
    });

    it('dismiss chama DELETE /api/notifications/:id', async () => {
        const { result } = renderHook(() => useNotificationActions());
        await result.current('dismiss', '7');
        expect(fetchMock).toHaveBeenCalledWith('/api/notifications/7', { method: 'DELETE' });
    });

    it('clearAll chama DELETE /api/notifications', async () => {
        const { result } = renderHook(() => useNotificationActions());
        await result.current('clearAll');
        expect(fetchMock).toHaveBeenCalledWith('/api/notifications', { method: 'DELETE' });
    });

    it('retorna false quando o servidor responde não-ok', async () => {
        fetchMock.mockResolvedValueOnce({ ...okRes({}), ok: false, status: 500 });
        const { result } = renderHook(() => useNotificationActions());
        const ok = await result.current('markRead', 'x');
        expect(ok).toBe(false);
    });
});
