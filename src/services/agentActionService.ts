import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';

// Cliente da infra de confirmação de ação irreversível (HITL — robô-de-negócio §8.1).
// A tela /confirm-action usa `describe` (mostrar) e `execute` (confirmar). A execução no backend
// roda com a chave do PRÓPRIO usuário (via o token de sessão abaixo) — RBAC real do Dolibarr.

const getAuthHeaders = () => {
    const cfg = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    return { headers: { Authorization: 'Bearer ' + (cfg.apiKey || '') }, timeout: 30000, validateStatus: (s: number) => s < 500 };
};

export interface ConfirmDescribe {
    ok: boolean;
    action?: string;
    title?: string;
    summary?: string;
    entityType?: string;
    entityId?: string;
    actorUserId?: string;
    error?: string;
}

export interface ConfirmExecute {
    ok: boolean;
    action?: string;
    result?: any;
    error?: string;
}

/** Verifica o token e devolve a descrição legível (sem executar). */
export async function describeAction(token: string): Promise<ConfirmDescribe> {
    const { data } = await axios.post('/api/agent-actions/describe', { token }, getAuthHeaders());
    return data;
}

/** Confirma e executa a ação (com a chave do usuário logado). */
export async function executeAction(token: string): Promise<ConfirmExecute> {
    const { data } = await axios.post('/api/agent-actions/execute', { token }, getAuthHeaders());
    return data;
}
