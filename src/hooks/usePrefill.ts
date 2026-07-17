import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AiService } from '../services/aiService';

export interface PrefillResult {
    kind: string;                       // ex.: 'create_ticket', 'create_customer', 'edit_customer'
    data: Record<string, any>;          // campos a pré-preencher (edit inclui 'id'; entidades com itens incluem 'lines')
}

/**
 * Lê o deeplink HITL do agente (`?prefill=<token>`), resolve no backend (HMAC + expiração)
 * e devolve `{ kind, data }` uma única vez. Limpa o token da URL para não reabrir ao
 * navegar/atualizar. (#57 Peça 2/3) — consumido pelas telas que aceitam criação/edição
 * pré-preenchida proposta pelo agente.
 */
export function usePrefill(): PrefillResult | null {
    const [searchParams, setSearchParams] = useSearchParams();
    const [prefill, setPrefill] = useState<PrefillResult | null>(null);

    useEffect(() => {
        const token = searchParams.get('prefill');
        if (!token) return;
        let cancelled = false;
        (async () => {
            const result = await AiService.resolvePrefill(token);
            if (cancelled) return;
            // #1521 — remove o token da URL SEMPRE (sucesso OU falha): evita reabrir o form / re-disparar
            // o toast de "link expirado" ao navegar ou atualizar a página. O aviso já saiu no resolvePrefill.
            searchParams.delete('prefill');
            setSearchParams(searchParams, { replace: true });
            if (result) setPrefill(result);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    return prefill;
}
