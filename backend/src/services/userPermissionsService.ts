import { createLogger } from '../utils/logger';
import { agentConfigService } from './agentConfigService';

const log = createLogger('UserPermissions');

export interface ModulePermissions {
    read: boolean;
    create: boolean;
    edit: boolean;
    delete?: boolean;
    validate?: boolean;
}

export interface UserPermissionProfile {
    role: string;
    dolibarrModules: Record<string, ModulePermissions>;
    frontendScreens: Record<string, boolean>;
    agent: {
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
    };
    computedAt: string;
}

const HIDDEN_FIELD = 'options_entrevista_inicial';

function defaultProfile(user: any): UserPermissionProfile {
    const isAdmin = user?.admin === '1' || user?.admin === 1;
    const allModules = ['invoices', 'orders', 'proposals', 'projects', 'tasks', 'tickets',
        'contacts', 'products', 'bank', 'payments', 'contracts', 'hr', 'manufacturing',
        'interventions', 'suppliers', 'categories', 'shipments', 'agenda', 'candidates', 'jobs'];
    const allScreens = ['/', '/invoices', '/orders', '/proposals', '/payments', '/bank_accounts',
        '/projects', '/tasks', '/tickets', '/contacts', '/agenda', '/suppliers', '/products',
        '/contracts', '/interventions', '/categories', '/shipments', '/hr', '/hr/users',
        '/hr/expenses', '/hr/leaves', '/hr/candidates', '/hr/jobs', '/manufacturing',
        '/inventory', '/reports', '/simulator', '/settings', '/issues', '/chat', '/email'];

    const mp: ModulePermissions = { read: true, create: isAdmin, edit: isAdmin, delete: isAdmin, validate: isAdmin };

    return {
        role: user?.job || 'usuario',
        dolibarrModules: Object.fromEntries(allModules.map(m => [m, { ...mp }])),
        frontendScreens: Object.fromEntries(allScreens.map(s => [s, isAdmin])),
        agent: {
            canCreate: isAdmin ? ['invoice', 'order', 'proposal', 'ticket', 'contact', 'event', 'payment', 'customer', 'supplier', 'project', 'task', 'product', 'intervention', 'contract'] : [],
            canEdit: isAdmin ? ['invoice', 'order', 'proposal', 'ticket', 'contact', 'event', 'customer', 'supplier', 'project', 'task', 'product', 'intervention', 'contract'] : [],
            canValidate: isAdmin ? ['invoice', 'order', 'proposal'] : [],
            canDelete: isAdmin ? ['ticket', 'contact', 'event'] : [],
            canSendEmail: isAdmin,
            canSendWhatsapp: isAdmin,
            canAccessFinancial: isAdmin,
            canAccessAccounting: isAdmin,
            canAccessHR: isAdmin,
            canManageWebhooks: isAdmin,
            canCreateIssues: isAdmin,
            canStartTasks: isAdmin,
            canMergePRs: isAdmin,
            maxInvoiceAmount: null,
            maxOrderAmount: null,
            restrictedCustomers: [],
            restrictedProjects: [],
        },
        computedAt: new Date().toISOString(),
    };
}

class UserPermissionsService {
    private cache = new Map<string, { profile: UserPermissionProfile; ts: number }>();
    private readonly CACHE_TTL = 10 * 60 * 1000;

    async getProfile(userId: string): Promise<UserPermissionProfile> {
        const cached = this.cache.get(userId);
        if (cached && Date.now() - cached.ts < this.CACHE_TTL) {
            return cached.profile;
        }

        try {
            const { dolibarrService } = require('./dolibarrService');
            const user = await dolibarrService.getUserById(userId);
            if (!user) {
                log.warn(`User ${userId} not found, using defaults`);
                return defaultProfile({ admin: false });
            }

            const raw = user.array_options?.[HIDDEN_FIELD];
            if (raw) {
                try {
                    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    const profile = { ...defaultProfile(user), ...parsed, computedAt: parsed.computedAt || new Date().toISOString() };
                    this.cache.set(userId, { profile, ts: Date.now() });
                    return profile;
                } catch {
                    log.warn(`Failed to parse permissions for user ${userId}`);
                }
            }

            const profile = defaultProfile(user);
            this.cache.set(userId, { profile, ts: Date.now() });
            return profile;
        } catch (e: any) {
            log.error(`Failed to get permissions for user ${userId}`, e.message);
            return defaultProfile({ admin: false });
        }
    }

    async getProfileForContext(userId: string): Promise<string> {
        const profile = await this.getProfile(userId);
        const parts: string[] = [];

        parts.push(`PERFIL DO USUÁRIO: ${profile.role}`);

        const readable = Object.entries(profile.dolibarrModules)
            .filter(([, p]) => p.read)
            .map(([m]) => m);
        const creatable = Object.entries(profile.dolibarrModules)
            .filter(([, p]) => p.create)
            .map(([m]) => m);
        const editable = Object.entries(profile.dolibarrModules)
            .filter(([, p]) => p.edit)
            .map(([m]) => m);

        parts.push(`Módulos que pode VER: ${readable.join(', ') || 'nenhum'}`);
        parts.push(`Módulos que pode CRIAR: ${creatable.join(', ') || 'nenhum'}`);
        parts.push(`Módulos que pode EDITAR: ${editable.join(', ') || 'nenhum'}`);

        const agent = profile.agent;
        if (agent.canCreate.length > 0) parts.push(`Entidades que pode criar via agente: ${agent.canCreate.join(', ')}`);
        if (agent.canEdit.length > 0) parts.push(`Entidades que pode editar via agente: ${agent.canEdit.join(', ')}`);
        if (agent.canValidate.length > 0) parts.push(`Entidades que pode validar via agente: ${agent.canValidate.join(', ')}`);
        if (agent.canDelete.length > 0) parts.push(`Entidades que pode deletar via agente: ${agent.canDelete.join(', ')}`);

        if (agent.maxInvoiceAmount) parts.push(`Valor máximo de fatura: R$ ${agent.maxInvoiceAmount}`);
        if (agent.maxOrderAmount) parts.push(`Valor máximo de pedido: R$ ${agent.maxOrderAmount}`);
        if (agent.restrictedCustomers.length > 0) parts.push(`Clientes restritos: ${agent.restrictedCustomers.join(', ')}`);

        const blockedScreens = Object.entries(profile.frontendScreens)
            .filter(([, v]) => !v)
            .map(([s]) => s);
        if (blockedScreens.length > 0 && blockedScreens.length < 10) {
            parts.push(`Telas que NÃO pode acessar: ${blockedScreens.join(', ')}`);
        }

        return parts.join('\n');
    }

    canUserCreate(profile: UserPermissionProfile, entity: string): boolean {
        return profile.agent.canCreate.includes(entity) || profile.agent.canCreate.includes('all');
    }

    canUserEdit(profile: UserPermissionProfile, entity: string): boolean {
        return profile.agent.canEdit.includes(entity) || profile.agent.canEdit.includes('all');
    }

    canUserValidate(profile: UserPermissionProfile, entity: string): boolean {
        return profile.agent.canValidate.includes(entity) || profile.agent.canValidate.includes('all');
    }

    canUserDelete(profile: UserPermissionProfile, entity: string): boolean {
        return profile.agent.canDelete.includes(entity) || profile.agent.canDelete.includes('all');
    }

    invalidateCache(userId?: string) {
        if (userId) {
            this.cache.delete(userId);
        } else {
            this.cache.clear();
        }
    }
}

export const userPermissionsService = new UserPermissionsService();
