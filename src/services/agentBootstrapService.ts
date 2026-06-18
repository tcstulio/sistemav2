import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';

const log = logger.child('AgentBootstrapService');

export interface AgentBootstrapConfig {
    enabled: boolean;
    includeTasks: boolean;
    includeAgenda: boolean;
    includeFinancial: boolean;
    extraInstruction: string;
}

const API_URL = '/api/ai/agent/bootstrap-config';

const getAuthHeaders = () => {
    const cfg = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    return { headers: { Authorization: 'Bearer ' + (cfg.apiKey || '') } };
};

/** Lê a config da sessão automática. Retorna null em erro (chamador usa o default). */
export async function getAgentBootstrapConfig(): Promise<AgentBootstrapConfig | null> {
    try {
        const res = await axios.get(API_URL, getAuthHeaders());
        return res.data as AgentBootstrapConfig;
    } catch (e: any) {
        log.warn(`Falha ao carregar bootstrap-config: ${e?.message || e}`);
        return null;
    }
}

/** Atualiza a config (somente admin no backend). */
export async function updateAgentBootstrapConfig(patch: Partial<AgentBootstrapConfig>): Promise<AgentBootstrapConfig> {
    const res = await axios.put(API_URL, patch, getAuthHeaders());
    return res.data as AgentBootstrapConfig;
}
