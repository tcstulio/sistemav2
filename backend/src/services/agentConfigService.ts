import { createLogger } from '../utils/logger';

const log = createLogger('AgentConfig');

export interface AgentPermissions {
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canValidate: boolean;
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
    allowedEntities: string | string[];
    restrictedCustomers: string[];
    restrictedProjects: string[];
}

export interface AgentConfig {
    personality: string;
    tone: string;
    allowedTools: string | string[];
    blockedTools: string[];
    requireConfirmationFor: string[];
    autoCreateIssues: boolean;
    maxToolCallsPerConversation: number;
    extraInstructions: string;
    enabled: boolean;
    version: string;
    permissions: AgentPermissions;
}

export interface AgentProfile {
    id: string;
    login: string;
    firstname: string;
    lastname: string;
    email: string;
    job: string;
    photo: string;
    notePublic: string;
    notePrivate: string;
    config: AgentConfig;
}

const DEFAULT_CONFIG: AgentConfig = {
    personality: 'profissional, conciso e prestativo',
    tone: 'Português do Brasil',
    allowedTools: 'all',
    blockedTools: [],
    requireConfirmationFor: [],
    autoCreateIssues: true,
    maxToolCallsPerConversation: 50,
    extraInstructions: '',
    enabled: true,
    version: '1.0.0',
    permissions: {
        canCreate: true,
        canEdit: true,
        canDelete: true,
        canValidate: true,
        canSendEmail: true,
        canSendWhatsapp: true,
        canAccessFinancial: true,
        canAccessAccounting: true,
        canAccessHR: true,
        canManageWebhooks: true,
        canCreateIssues: true,
        canStartTasks: true,
        canMergePRs: true,
        maxInvoiceAmount: null,
        maxOrderAmount: null,
        allowedEntities: 'all',
        restrictedCustomers: [],
        restrictedProjects: [],
    },
};

const AGENT_USER_ID = '1';

class AgentConfigService {
    private profile: AgentProfile | null = null;
    private lastFetch = 0;
    private readonly CACHE_TTL = 5 * 60 * 1000;

    async refresh(): Promise<void> {
        try {
            const { dolibarrService } = require('./dolibarrService');
            const user = await dolibarrService.getUserById(AGENT_USER_ID);
            if (!user) {
                log.warn('Marciano user not found, using defaults');
                return;
            }

            let config = DEFAULT_CONFIG;
            try {
                const rawConfig = user.array_options?.options_dados_conta;
                if (rawConfig) {
                    const parsed = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
                    config = {
                        ...DEFAULT_CONFIG,
                        ...parsed,
                        permissions: {
                            ...DEFAULT_CONFIG.permissions,
                            ...(parsed.permissions || {}),
                        },
                    };
                }
            } catch (e: any) {
                log.warn('Failed to parse agent config, using defaults', e.message);
            }

            this.profile = {
                id: String(user.id),
                login: user.login || 'admin',
                firstname: user.firstname || '',
                lastname: user.lastname || 'MARCIANO',
                email: user.email || '',
                job: user.job || 'Inteligencia Artificial',
                photo: user.photo || '',
                notePublic: user.note_public || '',
                notePrivate: user.note_private || '',
                config,
            };

            this.lastFetch = Date.now();
            log.info(`Agent config loaded: ${config.personality}, enabled=${config.enabled}, blocked=${config.blockedTools.length} tools`);
        } catch (e: any) {
            log.error('Failed to fetch agent config', e.message);
        }
    }

    async getConfig(): Promise<AgentConfig> {
        if (!this.profile || Date.now() - this.lastFetch > this.CACHE_TTL) {
            await this.refresh();
        }
        return this.profile?.config || DEFAULT_CONFIG;
    }

    async getProfile(): Promise<AgentProfile> {
        if (!this.profile || Date.now() - this.lastFetch > this.CACHE_TTL) {
            await this.refresh();
        }
        if (!this.profile) {
            return {
                id: '1',
                login: 'admin',
                firstname: '',
                lastname: 'MARCIANO',
                email: 'contato@coolgroove.com.br',
                job: 'Inteligencia Artificial',
                photo: '',
                notePublic: '',
                notePrivate: '',
                config: DEFAULT_CONFIG,
            };
        }
        return this.profile;
    }

    isToolBlocked(tool: string): boolean {
        if (!this.profile) return false;
        const { blockedTools, allowedTools } = this.profile.config;
        if (allowedTools !== 'all' && Array.isArray(allowedTools) && !allowedTools.includes(tool)) return true;
        if (blockedTools.includes(tool)) return true;
        return false;
    }

    requiresConfirmation(tool: string): boolean {
        if (!this.profile) return false;
        return this.profile.config.requireConfirmationFor.includes(tool);
    }

    canDo(action: keyof AgentPermissions): boolean {
        if (!this.profile) return true;
        return this.profile.config.permissions[action] as boolean;
    }

    isCustomerRestricted(socid: string): boolean {
        if (!this.profile) return false;
        const { restrictedCustomers } = this.profile.config.permissions;
        return restrictedCustomers.length > 0 && !restrictedCustomers.includes(socid);
    }

    isProjectRestricted(projectId: string): boolean {
        if (!this.profile) return false;
        const { restrictedProjects } = this.profile.config.permissions;
        return restrictedProjects.length > 0 && !restrictedProjects.includes(projectId);
    }

    isAmountAllowed(type: 'invoice' | 'order', amount: number): boolean {
        if (!this.profile) return true;
        const { maxInvoiceAmount, maxOrderAmount } = this.profile.config.permissions;
        const limit = type === 'invoice' ? maxInvoiceAmount : maxOrderAmount;
        return limit === null || amount <= limit;
    }

    getSystemPrompt(): string {
        if (!this.profile) return '';
        const { config, notePublic } = this.profile;
        const parts: string[] = [];

        if (notePublic) {
            parts.push(`INSTRUÇÕES DO AGENTE:\n${notePublic}`);
        }

        if (config.personality) {
            parts.push(`Personalidade: ${config.personality}`);
        }

        if (config.tone) {
            parts.push(`Tom: ${config.tone}`);
        }

        if (config.extraInstructions) {
            parts.push(`Instruções extras: ${config.extraInstructions}`);
        }

        if (config.autoCreateIssues === false) {
            parts.push('NUNCA crie issues, tasks ou bug reports por conta própria — SEMPRE pergunte o usuário antes.');
        }

        if (config.blockedTools.length > 0) {
            parts.push(`Ferramentas bloqueadas: ${config.blockedTools.join(', ')}`);
        }

        return parts.join('\n\n');
    }
}

export const agentConfigService = new AgentConfigService();
