/**
 * useApprovalSocket hook tests (#1222)
 *
 * Valida: inscrição nos 4 eventos, cleanup no unmount (sem memory leak),
 * não-duplicação de listeners em múltiplas montagens, e uso sempre da versão
 * mais recente do callback (handlerRef) sem re-registrar no socket.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Socket-fake controlável: registra handlers por evento e permite emitir/contar.
const sock = vi.hoisted(() => {
    const listeners: Record<string, Set<(payload: unknown) => void>> = {};
    const calls: { on: number; off: number } = { on: 0, off: 0 };
    const socket = {
        on(event: string, handler: (payload: unknown) => void) {
            calls.on += 1;
            (listeners[event] ||= new Set()).add(handler);
        },
        off(event: string, handler: (payload: unknown) => void) {
            calls.off += 1;
            listeners[event]?.delete(handler);
        },
        // helpers de teste
        emit(event: string, payload: unknown) {
            listeners[event]?.forEach((h) => h(payload));
        },
        count(event: string) {
            return listeners[event]?.size ?? 0;
        },
        totalListeners() {
            return Object.values(listeners).reduce((acc, s) => acc + s.size, 0);
        },
        callCounts() {
            return { ...calls };
        },
        reset() {
            for (const k of Object.keys(listeners)) delete listeners[k];
            calls.on = 0;
            calls.off = 0;
        },
    };
    return { socket };
});

// Permite trocar o socket devolvido pelo contexto (null p/ alguns cenários).
const ctx = vi.hoisted<{ current: typeof sock.socket | null }>(() => ({ current: sock.socket }));
vi.mock('../../contexts/WhatsAppContext', () => ({
    useWhatsAppContext: () => ({ socket: ctx.current }),
}));

import { useApprovalSocket, APPROVAL_SOCKET_EVENTS } from '../../hooks/useApprovalSocket';

describe('useApprovalSocket (#1222)', () => {
    beforeEach(() => {
        sock.socket.reset();
        ctx.current = sock.socket;
    });

    it('inscreve exatamente os 4 eventos (approval_pending/executed/rejected/failed)', () => {
        renderHook(() => useApprovalSocket(vi.fn()));

        for (const evt of APPROVAL_SOCKET_EVENTS) {
            expect(sock.socket.count(evt)).toBe(1);
        }
        expect(APPROVAL_SOCKET_EVENTS).toEqual([
            'approval_pending',
            'approval_executed',
            'approval_rejected',
            'approval_failed',
        ]);
    });

    it('dispara onEvent com o nome do evento e o payload recebido', () => {
        const onEvent = vi.fn();
        renderHook(() => useApprovalSocket(onEvent));

        const payload = { actionId: 'a1', success: true, result: { tx: 'x' } };
        sock.socket.emit('approval_executed', payload);

        expect(onEvent).toHaveBeenCalledTimes(1);
        expect(onEvent).toHaveBeenCalledWith('approval_executed', payload);
    });

    it('trata payload ausente/não-objeto como objeto vazio (sem crash)', () => {
        const onEvent = vi.fn();
        renderHook(() => useApprovalSocket(onEvent));

        sock.socket.emit('approval_failed', undefined);

        expect(onEvent).toHaveBeenCalledWith('approval_failed', {});
    });

    it('faz cleanup de TODOS os listeners no unmount (sem memory leak)', () => {
        const { unmount } = renderHook(() => useApprovalSocket(vi.fn()));
        expect(sock.socket.totalListeners()).toBe(APPROVAL_SOCKET_EVENTS.length);

        unmount();

        expect(sock.socket.totalListeners()).toBe(0);
        // um off por evento registrado
        expect(sock.socket.callCounts().off).toBe(APPROVAL_SOCKET_EVENTS.length);
    });

    it('múltiplas montagens/desmontagens não duplicam listeners', () => {
        const { unmount: u1 } = renderHook(() => useApprovalSocket(vi.fn()));
        // segunda montagem (ex.: navegar pra fora e voltar)
        const { unmount: u2 } = renderHook(() => useApprovalSocket(vi.fn()));

        for (const evt of APPROVAL_SOCKET_EVENTS) {
            expect(sock.socket.count(evt)).toBe(2);
        }

        u1();
        // após desmontar a primeira, ainda há 1 (da segunda) — não acumula nem some tudo
        for (const evt of APPROVAL_SOCKET_EVENTS) {
            expect(sock.socket.count(evt)).toBe(1);
        }

        u2();
        for (const evt of APPROVAL_SOCKET_EVENTS) {
            expect(sock.socket.count(evt)).toBe(0);
        }
    });

    it('não re-registra listeners quando só o callback muda (dependência = socket)', () => {
        const { rerender } = renderHook(({ cb }) => useApprovalSocket(cb), {
            initialProps: { cb: vi.fn() },
        });

        const onBefore = sock.socket.callCounts().on;
        rerender({ cb: vi.fn() }); // novo callback a cada render
        const onAfter = sock.socket.callCounts().on;

        expect(onAfter).toBe(onBefore); // nada re-registrado
        // um listener por evento segue ativo
        for (const evt of APPROVAL_SOCKET_EVENTS) {
            expect(sock.socket.count(evt)).toBe(1);
        }
    });

    it('invoca sempre a versão mais recente do callback (handlerRef)', () => {
        const stale = vi.fn();
        const fresh = vi.fn();
        const { rerender } = renderHook(({ cb }) => useApprovalSocket(cb), {
            initialProps: { cb: stale },
        });

        rerender({ cb: fresh });
        sock.socket.emit('approval_pending', { actionId: 'z9' });

        expect(fresh).toHaveBeenCalledWith('approval_pending', { actionId: 'z9' });
        expect(stale).not.toHaveBeenCalled();
    });

    it('com socket null não registra listeners nem quebra', () => {
        ctx.current = null;
        const onEvent = vi.fn();

        const { unmount } = renderHook(() => useApprovalSocket(onEvent));

        expect(sock.socket.callCounts().on).toBe(0);
        // unmount seguro (sem throw) mesmo sem socket
        expect(() => unmount()).not.toThrow();
        expect(onEvent).not.toHaveBeenCalled();
    });
});
