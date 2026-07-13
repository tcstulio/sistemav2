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
    /** Nota mínima do Judge p/ APROVAR uma task (default 9). Abaixo → revisão humana. #1125 */
    minApproveScore: number;
    /** Máx. de rodadas de auto-fix do Judge (nota baixa) antes de escalar p/ revisão humana (default 3). #1154 */
    maxJudgeRounds?: number;
    /** Máx. de rodadas de self-heal de gate (regressão/veto/CI) antes de escalar (default 3). #1154 */
    maxGateFixRounds?: number;
    /** Teto de rodadas de opencode por task antes de escalar p/ revisão (default 20). #1154 item 23 */
    maxRoundsPerTask?: number;
    /** Teto global de rodadas de opencode por dia — segura novos dispatches ao atingir (default 200). #1154 item 23 */
    dailyRoundBudget?: number;
    /** Modelo do Juiz (LLM-as-judge). Vazio = cadeia do chat (MiniMax). Ex.: 'sonnet'/'opus'/'haiku' =
     * juiz roda no Claude Code CLI (gate independente do coder), com fallback pra cadeia do chat. */
    judgeModel?: string;
}

// #1204 — Kill-switches globais das automações de fundo. Default true = nada muda.
export interface AutomationSwitchesConfig {
    schedulerEnabled: boolean;
    alertCronEnabled: boolean;
}

// #1129 — Kill-switches perigosos expostos como toggles de admin (Integrações/Segurança).
export interface FeatureSwitchesConfig {
    dryRunMode: boolean;          // impede envio real de mensagens (anti-spam de incidente)
    financialCommands: boolean;   // habilita /pagar e /pix (movimentam dinheiro real)
    crmContextInjection: boolean; // injeta dados do cliente no LLM (privacidade)
}

// ---- Política de notificações (#1293): cadência de cobrança, quiet-hours por canal, alertas ----
export type QuietHoursChannel = 'whatsapp' | 'email' | 'in-app';

export interface QuietHoursRule {
    enabled: boolean;
    startHHmm: string;   // "HH:mm" (24h)
    endHHmm: string;     // "HH:mm" (24h); endHHmm < startHHmm = janela que cruza a meia-noite
    weekdaysOnly: boolean;
}

export type QuietHoursConfig = Record<QuietHoursChannel, QuietHoursRule>;

export interface CobrancaCadenceConfig {
    reminderDaysBefore: number;
    recobrancaIntervalDays: number;
    escalateAfterCobrancas: number;
    prazoDeAceiteDays: number;
}

export interface NotificationPolicyConfig {
    cobrancaCadence: CobrancaCadenceConfig;
    quietHours: QuietHoursConfig;
    staleHours: number;            // ticket stale threshold (horas)
    invoiceDueHorizonDays: number; // fatura a vencer (dias)
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
    automationSwitches?: AutomationSwitchesConfig;
    featureSwitches?: FeatureSwitchesConfig;
    notificationPolicy?: NotificationPolicyConfig;
    version?: number; // concorrência otimista (Central de Permissões)
    appAccessGroupId?: string; // grupo Dolibarr usado p/ "Habilitar acesso ao app" (carrega o direito 342)
}

export type ScreenRuleDelta = { hidden: string[]; allowed: string[] };
export interface ScreenPermsDelta {
    groups?: Record<string, ScreenRuleDelta>;
    users?: Record<string, ScreenRuleDelta>;
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

/**
 * MERGE por-entidade do screenPermissions (Central de Permissões). Envia só as entidades
 * alteradas (delta) + a versão lida. Em 409 (alguém salvou no meio), lança um erro com
 * { conflict:true, config } p/ a UI recarregar e reaplicar.
 */
export async function patchScreenPermissions(delta: ScreenPermsDelta, expectedVersion?: number): Promise<UiConfig> {
    try {
        const res = await axios.patch(`${API_URL}/screen-permissions`, { delta, expectedVersion }, getAuthHeaders());
        return res.data as UiConfig;
    } catch (e: any) {
        if (e?.response?.status === 409) {
            const err: any = new Error(e.response.data?.message || 'Configuração desatualizada.');
            err.conflict = true;
            err.config = e.response.data?.config;
            throw err;
        }
        throw e;
    }
}

export interface UserMissingPhone {
    id: string;
    login: string;
    name: string;
    email: string | null;
}

export interface UsersMissingPhoneResult {
    total: number;
    missingCount: number;
    users: UserMissingPhone[];
}

/** Admin-only: lista usuários ativos sem phone_mobile no Dolibarr. */
export async function getUsersMissingPhone(): Promise<UsersMissingPhoneResult> {
    const res = await axios.get('/api/ui-config/admin/users-missing-phone', getAuthHeaders());
    return res.data as UsersMissingPhoneResult;
}
