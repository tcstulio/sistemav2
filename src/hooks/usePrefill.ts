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
            if (cancelled || !result) return;
            setPrefill(result);
            // remove o token da URL (mantém a rota atual)
            searchParams.delete('prefill');
            setSearchParams(searchParams, { replace: true });
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    return prefill;
}
