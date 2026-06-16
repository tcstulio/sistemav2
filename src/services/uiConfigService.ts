import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';
import { OrderVisibilityPrefs } from '../utils/orderVisibility';
import { ScreenPermissions } from '../utils/screenPermissions';
import { CustomPage } from '../config/customPages';

const log = logger.child('UiConfigService');

export type NotifChannel = 'in-app' | 'whatsapp' | 'email';
export type TaskNotifEvent = 'assigned' | 'acceptance_pending' | 'acceptance_overdue' | 'deadline_reminder' | 'overdue' | 'stalled' | 'completed' | 'comment';
export type TaskNotifRole = 'responsavel' | 'interveniente' | 'criador';
export type TaskNotificationsConfig = Record<TaskNotifEvent, Record<TaskNotifRole, NotifChannel[]>>;

export interface TaskAutomationConfig {
    autoPlay: boolean;
    autoMerge: boolean;
    autoDecompose: boolean;
    minMergeScore: number;
}

export interface UiConfig {
    companyName: string;
    logoText: string;
    logoUrl?: string;
    themeColor: string;
    menu?: OrderVisibilityPrefs;
    dashboard?: OrderVisibilityPrefs;
    screenPermissions?: ScreenPermissions;
    customPages?: CustomPage[];
    taskNotifications?: TaskNotificationsConfig;
    taskNotificationsExternalEnabled?: boolean;
    taskAutomation?: TaskAutomationConfig;
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
