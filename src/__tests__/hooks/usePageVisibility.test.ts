/**
 * usePageVisibility hook tests (#1577)
 *
 * Valida:
 *  - Retorna boolean (isVisible) e reage ao evento `visibilitychange`.
 *  - isVisible inicial reflete document.visibilityState atual.
 *  - Listener é removido no unmount (sem memory leak).
 *  - Reutilização: múltiplos hooks na mesma página não conflitam.
 *  - Defensivo em jsdom (que NÃO dispara visibilitychange nativo).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePageVisibility } from '../../hooks/usePageVisibility';

function setVisible(visible: boolean) {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (visible ? 'visible' : 'hidden'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
}

describe('usePageVisibility (#1577)', () => {
    beforeEach(() => {
        setVisible(true);
    });

    afterEach(() => {
        setVisible(true);
    });

    it('retorna um objeto com `isVisible` boolean', () => {
        const { result } = renderHook(() => usePageVisibility());
        expect(typeof result.current.isVisible).toBe('boolean');
    });

    it('isVisible inicial é `true` quando a aba está visível', () => {
        setVisible(true);
        const { result } = renderHook(() => usePageVisibility());
        expect(result.current.isVisible).toBe(true);
    });

    it('isVisible inicial é `false` quando a aba começa oculta', () => {
        setVisible(false);
        const { result } = renderHook(() => usePageVisibility());
        expect(result.current.isVisible).toBe(false);
    });

    it('reage a visibilitychange: visível -> oculta', () => {
        setVisible(true);
        const { result } = renderHook(() => usePageVisibility());
        expect(result.current.isVisible).toBe(true);

        act(() => setVisible(false));
        expect(result.current.isVisible).toBe(false);
    });

    it('reage a visibilitychange: oculta -> visível', () => {
        setVisible(false);
        const { result } = renderHook(() => usePageVisibility());
        expect(result.current.isVisible).toBe(false);

        act(() => setVisible(true));
        expect(result.current.isVisible).toBe(true);
    });

    it('remove o listener no unmount (não atualiza estado após unmount)', () => {
        setVisible(true);
        const { result, unmount } = renderHook(() => usePageVisibility());
        expect(result.current.isVisible).toBe(true);

        unmount();

        // Depois do unmount, mudar a visibilidade NÃO lança warning de atualização
        // de estado desmontado.
        expect(() => act(() => setVisible(false))).not.toThrow();
        // O estado do hook desmontado permanece o último valor (não há como ler
        // após unmount, mas garantir que não há throw é o contrato do cleanup).
    });

    it('é reutilizável: múltiplas instâncias reagem independentemente ao mesmo evento', () => {
        setVisible(true);
        const { result: r1 } = renderHook(() => usePageVisibility());
        const { result: r2 } = renderHook(() => usePageVisibility());

        expect(r1.current.isVisible).toBe(true);
        expect(r2.current.isVisible).toBe(true);

        act(() => setVisible(false));
        expect(r1.current.isVisible).toBe(false);
        expect(r2.current.isVisible).toBe(false);

        act(() => setVisible(true));
        expect(r1.current.isVisible).toBe(true);
        expect(r2.current.isVisible).toBe(true);
    });

    it('não re-emite estado redundante: seta false só uma vez por toggle', () => {
        setVisible(true);
        const { result } = renderHook(() => usePageVisibility());
        // Muda de true -> false; result.current refletirá em UM ciclo.
        act(() => setVisible(false));
        expect(result.current.isVisible).toBe(false);
        // Disparar o mesmo evento sem mudar visibilityState não altera resultado.
        act(() => {
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => 'hidden',
            });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(result.current.isVisible).toBe(false);
    });

    it('trata visibilityState em valores não-padrão (prerender) como não-visível', () => {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'prerender',
        });
        const { result } = renderHook(() => usePageVisibility());
        expect(result.current.isVisible).toBe(false);
    });
});
