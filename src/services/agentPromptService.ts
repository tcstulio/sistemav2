import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';

const log = logger.child('AgentPromptService');

export interface AgentPromptActor {
    id: string;
    login: string;
    name: string;
}

export interface AgentPromptHistoryEntry {
    id: string;
    timestamp: number;
    changedBy: AgentPromptActor;
    previousPrompt: string;
    prompt: string;
    action: 'update' | 'restore';
}

export interface AgentPromptSnapshot {
    systemPrompt: string;
    defaultPrompt: string;
    history: AgentPromptHistoryEntry[];
    canEdit: boolean;
}

const API_URL = '/api/agent/config';

const getAuthHeaders = () => {
    const cfg = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    return { headers: { Authorization: 'Bearer ' + (cfg.apiKey || '') } };
};

/** Lê o system prompt atual + histórico. Retorna null em erro. */
export async function getAgentPromptConfig(): Promise<AgentPromptSnapshot | null> {
    try {
        const res = await axios.get(API_URL, getAuthHeaders());
        return res.data as AgentPromptSnapshot;
    } catch (e: any) {
        log.warn(`Falha ao carregar agent config: ${e?.message || e}`);
        return null;
    }
}

/** Salva nova versão (admin) — { systemPrompt } ou { restoreDefault: true }. */
export async function updateAgentPrompt(patch: { systemPrompt?: string; restoreDefault?: boolean }): Promise<AgentPromptSnapshot> {
    const res = await axios.put(API_URL, patch, getAuthHeaders());
    return res.data as AgentPromptSnapshot;
}
