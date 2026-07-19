/**
 * usePageVisibility (#1577)
 *
 * Hook reutilizável que expõe o estado de visibilidade da aba/janela do navegador
 * com base na Page Visibility API (document.visibilityState + evento
 * `visibilitychange`). Retorna um booleano `isVisible` (true quando a aba está
 * visível, false quando está oculta — usuário trocou de aba, minimizou a janela
 * ou bloqueou a tela).
 *
 * Reutilização: este hook é genérico (não conhece chat/jobs). Quem o usa decide
 * o que fazer quando `isVisible` muda — ex.: ChatMessages.tsx envia o sinal
 * `POST /chat/jobs/:id/visibility { hidden: !isVisible }` ao backend durante
 * um job ativo, para que o backend saiba que pode desacelerar notificações.
 *
 * Garantias:
 *  - Reage ao evento `visibilitychange` em <500ms (event-driven: o navegador
 *    dispara o evento no instante da troca, sem polling).
 *  - Cleanup no unmount: remove o listener (sem memory leak).
 *  - SSR/jsdom-safe: se `document` não existe (SSR) ou não suporta a API
 *    (visibilidade sempre visível em jsdom), `isVisible` começa `true`.
 */
import { useEffect, useState } from 'react';

export interface PageVisibilityState {
    /** `true` quando a aba/janela está visível ao usuário. */
    isVisible: boolean;
}

function readIsVisible(): boolean {
    try {
        if (typeof document === 'undefined') return true;
        // visibilityState é 'visible' | 'hidden' | 'prerender' | 'unloaded'.
        // Qualquer valor diferente de 'visible' é tratado como NÃO-visível para
        // fins de UX (notificações só devem disparar quando não-visível).
        return document.visibilityState === 'visible';
    } catch {
        // Defensivo: jsdom antigo ou ambiente sem document — assume visível.
        return true;
    }
}

/**
 * Assina o estado de visibilidade da página. Retorna `{ isVisible }`.
 *
 * O listener é registrado uma única vez por montagem e removido no cleanup.
 * Re-renders do componente pai não re-registram o listener (dependências vazias).
 */
export function usePageVisibility(): PageVisibilityState {
    const [isVisible, setIsVisible] = useState<boolean>(readIsVisible);

    useEffect(() => {
        if (typeof document === 'undefined' || !('visibilityState' in document)) {
            // Ambiente sem suporte à Page Visibility API: trava em visível.
            return;
        }

        const handleChange = () => {
            const next = readIsVisible();
            setIsVisible((prev) => (prev === next ? prev : next));
        };

        // listener passive — Visibility API não exige capture nem preventDefault.
        document.addEventListener('visibilitychange', handleChange);
        return () => {
            document.removeEventListener('visibilitychange', handleChange);
        };
    }, []);

    return { isVisible };
}

export default usePageVisibility;
