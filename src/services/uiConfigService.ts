import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';
import { ScreenPermissions } from '../utils/screenPermissions';

const log = logger.child('UiConfigService');

// Preferência de ordem + visibilidade (menu #110 e dashboard #111).
export interface OrderVisibilityPrefs {
    hidden: string[];
    order: string[];
}

// Config de UI da ORGANIZAÇÃO (branding/tema/menu/dashboard/permissões), definida pelo admin no backend.
export interface UiConfig {
    companyName: string;
    logoText: string;
    logoUrl?: string;
    themeColor: string;
    menu?: OrderVisibilityPrefs;       // #110 — padrão da org p/ o menu lateral
    dashboard?: OrderVisibilityPrefs;  // #111 — padrão da org p/ os widgets do painel
    screenPermissions?: ScreenPermissions;  // #112 — permissões de tela por pessoa/grupo
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
