import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';

/**
 * Cliente do digest de cobranças (issue #1404 / epic #1400).
 *
 * Endpoint: `GET /api/dunning`. Retorna um digest priorizado de clientes
 * com recebíveis em aberto e um rascunho (texto) de mensagem por item.
 *
 * Auth: mesma convenção das telas admin (systemEvents/bankingConfig/
 * agentAction/approvals) — Bearer apiKey do `coolgroove_config`.
 */
const log = logger.child('DunningService');

const API_URL = '/api/dunning';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const authConfig = () => {
    const cfg = safeStorage.getJSON<Record<string, unknown>>('coolgroove_config', {});
    const apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey : '';
    return {
        headers: { Authorization: 'Bearer ' + apiKey },
        // Não lançar em 4xx — devolvemos status p/ a UI decidir (404 = digest
        // indisponível; 401 = sessão expirada).
        validateStatus: (s: number) => s < 500,
    };
};

// ===== Types (espelham o contrato da API) =====

export type DunningItemStatus = 'ready' | 'incomplete';

export interface DunningInvoiceRef {
    /** Ref da fatura (ex.: "(FA)2026-00012") */
    ref: string;
    /** Vencimento — timestamp unix (s) ou ISO string */
    vencimento: string | number;
    /** Valor em aberto da fatura (opcional) */
    valor?: number;
}

export interface DunningItem {
    /** ID estável (socid na maioria dos casos) */
    id: string;
    /** Nome do cliente (socname) */
    socname: string;
    /** Total em aberto, somado de todas as faturas */
    totalAberto: number;
    /** Maior atraso entre as faturas do cliente (em dias) */
    diasAtrasoMax: number;
    /** Lista de faturas que compõem o total */
    faturas: DunningInvoiceRef[];
    /** Texto do rascunho de mensagem a ser enviado */
    rascunho: string;
    /** Pronto p/ copiar, ou incompleto (dado faltando) */
    status: DunningItemStatus;
}

export interface DunningDigest {
    totalItems: number;
    totalReady: number;
    totalIncomplete: number;
}

export interface DunningResponse {
    digest: DunningDigest;
    items: DunningItem[];
}

const emptyResponse: DunningResponse = {
    digest: { totalItems: 0, totalReady: 0, totalIncomplete: 0 },
    items: [],
};

/**
 * Busca o digest priorizado de cobranças.
 * Em caso de erro de rede/4xx/5xx devolve um digest vazio (fail-soft) —
 * a UI exibe empty state em vez de travar.
 */
export async function getDunningDigest(): Promise<DunningResponse> {
    try {
        const { status, data } = await axios.get(API_URL, authConfig());
        if (status >= 400) {
            log.warn('Falha ao carregar digest de cobranças:', status);
            return emptyResponse;
        }
        const payload = (data && typeof data === 'object' ? data : {}) as Partial<DunningResponse>;
        const digest = payload.digest ?? emptyResponse.digest;
        const items = Array.isArray(payload.items) ? payload.items : [];
        return {
            digest: {
                totalItems: Number(digest.totalItems) || items.length,
                totalReady: Number(digest.totalReady) || 0,
                totalIncomplete: Number(digest.totalIncomplete) || 0,
            },
            items,
        };
    } catch (e) {
        log.warn('Falha ao carregar digest de cobranças:', errMsg(e));
        return emptyResponse;
    }
}
