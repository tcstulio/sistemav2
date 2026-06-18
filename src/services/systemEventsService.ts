import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';

const log = logger.child('SystemEventsService');

export type SystemEventSource = 'audit' | 'agent' | 'delegation' | 'notification' | 'scheduler' | 'approval' | 'task' | 'dolibarr';

export interface SystemEvent {
    id: string;
    timestamp: string; // ISO
    source: SystemEventSource;
    actor: { id: string; name: string };
    type: string;
    entityType?: string;
    entityId?: string;
    description: string;
    linkTo?: string;
    status?: string;
    severity: 'info' | 'warn' | 'error';
    metadata?: Record<string, any>;
}

export interface SystemEventQueryParams {
    sources?: string; // csv
    type?: string;
    actor?: string;
    search?: string;
    dateFrom?: number; // ms
    dateTo?: number; // ms
    limit?: number;
    offset?: number;
}

const API_URL = '/api/system-events';

const getAuthHeaders = () => {
    const cfg = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    return { headers: { Authorization: 'Bearer ' + (cfg.apiKey || '') } };
};

/** Feed unificado dos eventos do sistema (backend agrega 7 fontes; dolibarr é mesclado no cliente). */
export async function getSystemEvents(params: SystemEventQueryParams): Promise<{ events: SystemEvent[]; total: number; sources: SystemEventSource[] }> {
    try {
        const { data } = await axios.get(API_URL, { ...getAuthHeaders(), params });
        return data;
    } catch (e: any) {
        log.warn(`Falha ao carregar system-events: ${e?.message || e}`);
        return { events: [], total: 0, sources: [] };
    }
}

/** Fontes que o usuário logado pode ver (para montar os chips). */
export async function getSystemEventSources(): Promise<SystemEventSource[]> {
    try {
        const { data } = await axios.get(`${API_URL}/sources`, getAuthHeaders());
        return data.sources || [];
    } catch {
        return [];
    }
}
