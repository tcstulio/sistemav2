import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';

const API = '/api/admin';

function authHeaders() {
    const cfg = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    return { headers: { Authorization: 'Bearer ' + (cfg?.apiKey || '') } };
}

export interface AgentPermissions {
    canCreate: string[];
    canEdit: string[];
    canValidate: string[];
    canDelete: string[];
    canSendEmail: boolean;
    canSendWhatsapp: boolean;
    canAccessFinancial: boolean;
    canAccessAccounting: boolean;
    canAccessHR: boolean;
    canManageWebhooks: boolean;
    canCreateIssues: boolean;
    canStartTasks: boolean;
    canMergePRs: boolean;
    maxInvoiceAmount: number | null;
    maxOrderAmount: number | null;
    restrictedCustomers: string[];
    restrictedProjects: string[];
}

export interface UserPermissionProfile {
    role: string;
    dolibarrModules: Record<string, unknown>;
    frontendScreens: Record<string, boolean>;
    agent: AgentPermissions;
    computedAt: string;
}

/** Lê o perfil de permissões do agente de um usuário (admin). */
export async function getUserPermissions(userId: string): Promise<UserPermissionProfile> {
    const res = await axios.get(`${API}/users/${userId}/permissions`, authHeaders());
    return res.data;
}

/** Salva (merge) o bloco `agent` do perfil de permissões de um usuário (admin). */
export async function updateUserPermissions(
    userId: string,
    patch: { agent?: Partial<AgentPermissions> },
): Promise<UserPermissionProfile> {
    const res = await axios.put(`${API}/users/${userId}/permissions`, patch, authHeaders());
    return res.data;
}

export interface AdminAuditEntry {
    id: string;
    ts: number;
    adminId: string;
    adminLogin: string;
    action: string;
    target?: string;
    summary?: string;
    changes?: Record<string, { before: unknown; after: unknown }>;
}

/** Lê o trilho de auditoria de ações administrativas (admin). */
export async function getAuditLog(opts: { limit?: number; action?: string; target?: string } = {}): Promise<AdminAuditEntry[]> {
    const res = await axios.get(`${API}/audit`, { ...authHeaders(), params: opts });
    return res.data?.entries || [];
}

// === Acesso ao App ("Habilitar acesso") ===
export interface AppAccessStatus {
    configured: boolean;  // há um "Grupo de Acesso ao App" configurado?
    inGroup: boolean;     // o usuário já pertence a esse grupo?
    groupId: string | null;
}

/** Status de acesso ao app de um usuário (pertence ao grupo de acesso?). Admin. */
export async function getAppAccessStatus(userId: string): Promise<AppAccessStatus> {
    const res = await axios.get(`${API}/users/${userId}/app-access-status`, authHeaders());
    return res.data as AppAccessStatus;
}

/**
 * Habilita o acesso ao app de um usuário (adiciona ao grupo de acesso CONFIGURADO). A Chave de
 * API dele nasce no próximo login. Admin. O grupo é sempre o de ui_config — o backend não aceita
 * grupo arbitrário por aqui (evita escalonamento). status pode ser 'enabled' ou 'already-enabled'.
 */
export async function enableAppAccess(userId: string): Promise<{ status: string; groupId: string; message: string }> {
    const res = await axios.post(`${API}/users/${userId}/enable-app-access`, {}, authHeaders());
    return res.data;
}
