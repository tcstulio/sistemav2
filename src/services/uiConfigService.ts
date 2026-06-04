import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';

const log = logger.child('UiConfigService');

// Config de UI da ORGANIZAÇÃO (branding/tema), definida pelo admin no backend.
export interface UiConfig {
    companyName: string;
    logoText: string;
    logoUrl?: string;
    themeColor: string;
}

const API_URL = '/api/ui-config';

const getAuthHeaders = () => {
    const cfg = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    return { headers: { Authorization: 'Bearer ' + (cfg.apiKey || '') } };
};

/** Lê a config de UI da organização. Retorna null em caso de erro (frontend cai nos defaults). */
export async function getUiConfig(): Promise<UiConfig | null> {
    try {
        const res = await axios.get(API_URL, getAuthHeaders());
        return res.data as UiConfig;
    } catch (e: any) {
        log.warn(`Falha ao carregar ui-config: ${e?.message || e}`);
        return null;
    }
}

/** Atualiza a config da organização (somente admin no backend). */
export async function updateUiConfig(patch: Partial<UiConfig>): Promise<UiConfig> {
    const res = await axios.put(API_URL, patch, getAuthHeaders());
    return res.data as UiConfig;
}
