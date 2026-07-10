import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';

// Cliente do dashboard de aprovações (HITL bancário). Aprovar/recusar é admin-only
// no backend (requireDolibarrAdmin). Auth no padrão das telas admin (systemEvents/
// bankingConfig/agentAction): Bearer apiKey do coolgroove_config.
const log = logger.child('approvalService');

const API_URL = '/api/approvals';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const authConfig = () => {
    const cfg = safeStorage.getJSON<Record<string, unknown>>('coolgroove_config', {});
    const apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey : '';
    return {
        headers: { Authorization: 'Bearer ' + apiKey },
        // Não lançar em 4xx (401/403/400): devolvemos status + body p/ a UI decidir
        // (toast de permissão em 403, erro de execução retornado pela API em 400).
        validateStatus: (s: number) => s < 500,
    };
};

// ===== Types (espelham o backend; única fonte para o componente) =====

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface PendingAction {
    id: string;
    type: string;
    banco?: 'inter' | 'itau';
    payload: unknown;
    description: string;
    riskLevel: RiskLevel;
    requestedBy: string;
    requestedAt: string;
    status: ApprovalStatus;
    reviewedBy?: string;
    reviewedAt?: string;
    rejectionReason?: string;
    executedAt?: string;
    result?: unknown;
    error?: string;
}

export interface ApprovalStats {
    pending: number;
    approved: number;
    rejected: number;
    executed: number;
    failed: number;
}

/**
 * Resultado normalizado de approve/reject.
 * - `status`: código HTTP (401/403 = sem permissão; 400 = regra de negócio/execução;
 *   200 = ok). `0` indica falha de rede / 5xx.
 * - `error`: mensagem devolvida pela API (ex.: erro de EXECUÇÃO da ação, vide
 *   approvalService.ts:262 — o backend executa e pode falhar). Não deve ser engolida.
 */
export interface ApprovalResult {
    success: boolean;
    status: number;
    error?: string;
    message?: string;
    result?: unknown;
}

// ===== Leituras (GET) =====

export async function getPendingActions(): Promise<PendingAction[]> {
    try {
        const { data } = await axios.get(`${API_URL}/pending`, authConfig());
        return data?.actions || [];
    } catch (e) {
        log.warn('Falha ao carregar pendentes:', errMsg(e));
        return [];
    }
}

export async function getActionHistory(limit = 50): Promise<PendingAction[]> {
    try {
        const { data } = await axios.get(`${API_URL}/history`, { ...authConfig(), params: { limit } });
        return data?.history || [];
    } catch (e) {
        log.warn('Falha ao carregar histórico:', errMsg(e));
        return [];
    }
}

export async function getApprovalStats(): Promise<ApprovalStats | null> {
    try {
        const { data } = await axios.get(`${API_URL}/stats`, authConfig());
        return data?.stats ?? null;
    } catch (e) {
        log.warn('Falha ao carregar stats:', errMsg(e));
        return null;
    }
}

// ===== Escritas (POST — admin-only no backend) =====

export async function approveAction(id: string): Promise<ApprovalResult> {
    try {
        const { status, data } = await axios.post(`${API_URL}/${id}/approve`, {}, authConfig());
        return {
            success: data?.success === true,
            status,
            error: data?.error,
            message: data?.message,
            result: data?.result,
        };
    } catch (e) {
        return { success: false, status: 0, error: errMsg(e) };
    }
}

export async function rejectAction(id: string, reason: string): Promise<ApprovalResult> {
    try {
        const { status, data } = await axios.post(`${API_URL}/${id}/reject`, { reason }, authConfig());
        return {
            success: data?.success === true,
            status,
            error: data?.error,
            message: data?.message,
        };
    } catch (e) {
        return { success: false, status: 0, error: errMsg(e) };
    }
}
