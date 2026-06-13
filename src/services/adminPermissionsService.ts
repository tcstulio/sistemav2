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
