import { createLogger } from '../utils/logger';
import { agentPromptStore } from './agentPromptStore';
import { config } from '../config/env';

const log = createLogger('AgentConfig');

// #1408: clamp defensivo do teto de tool-calls. NÃO é a proteção principal contra estouro de
// janela de contexto (isso é o orçamento de tokens do #956 no runner) — é só uma sanidade que
// evita 0/negativo e um runaway absurdo caso alguém configure um número gigante.
const MIN_TOOL_CALLS = 1;
const MAX_TOOL_CALLS_CEILING = 200;

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
                const rawConfig = user.array_options?.options_dados_conta;
                const preview = typeof rawConfig === 'string' ? rawConfig.substring(0, 80) : JSON.stringify(rawConfig)?.substring(0, 80);
                log.warn(`Failed to parse agent config, using defaults: ${e.message} (raw: ${preview})`);
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

    /**
     * Config efetivo (sync): usa o profile carregado ou os defaults. É a base síncrona dos dials
     * consultados no hot-path do runner (getMaxToolCalls/requiresConfirmation) sem pagar refresh.
     */
    private resolveConfig(): AgentConfig {
        return this.profile?.config || DEFAULT_CONFIG;
    }

    /**
     * #1408: helper PÚBLICO de TESTE para semear o profile sem depender de Dolibarr. Evita o
     * `(svc as any).profile = ...` frágil dos testes anteriores (quebra se a representação
     * interna mudar). Aceita um config parcial — `null` reseta para defaults (estado limpo).
     *
     * Uso:
     *   agentConfigService._setProfileForTesting({ maxToolCallsPerConversation: 2 });
     *   agentConfigService._setProfileForTesting({ requireConfirmationFor: ['deleteInvoice'] });
     *   agentConfigService._setProfileForTesting(null); // reset
     *
     * O prefixo `_` e o nome longo sinalizam: não é parte da API pública de runtime. Os testes
     * em `agentConfigService.dials.test.ts` e `agentRunner.integration.test.ts` usam-no para
     * montar cenários determinísticos sem precisar de refresh() real ou de mock do dolibarr.
     */
    _setProfileForTesting(config: Partial<AgentConfig> | null): void {
        if (config === null) {
            this.profile = null;
            this.lastFetch = 0;
            return;
        }
        // Mescla com os defaults — assim um config parcial (só os dials sob teste) já é
        // suficiente para `getSystemPrompt()` e afins não quebrarem em outros pontos.
        this.profile = {
            id: '1',
            login: 'admin',
            firstname: '',
            lastname: 'MARCIANO',
            email: 'contato@coolgroove.com.br',
            job: 'Inteligencia Artificial',
            photo: '',
            notePublic: '',
            notePrivate: '',
            config: {
                ...DEFAULT_CONFIG,
                ...config,
                permissions: {
                    ...DEFAULT_CONFIG.permissions,
                    ...(config.permissions || {}),
                },
            },
        };
        this.lastFetch = Date.now();
    }

    /**
     * #1408: teto de TOOL CALLS por conversa — FONTE DE VERDADE do loop do agente.
     * Antes o teto real vinha de `AGENT_MAX_ITERATIONS` (env) e este dial era teatro.
     * Agora o valor sai de `maxToolCallsPerConversation` (editável pelo admin em runtime);
     * `AGENT_MAX_ITERATIONS` sobrevive apenas como OVERRIDE de COLD-START (compat): se definido
     * no ambiente, vence o config no boot (ver env.ts). O valor é clampado a [1, 200] só por
     * sanidade — a defesa real contra estouro de contexto é o orçamento de tokens (#956).
     */
    getMaxToolCalls(): number {
        const coldStartOverride = config.agentMaxIterations; // null quando não definido no env
        const raw = coldStartOverride != null ? coldStartOverride : this.resolveConfig().maxToolCallsPerConversation;
        const n = Number.isFinite(raw) ? Math.floor(raw as number) : DEFAULT_CONFIG.maxToolCallsPerConversation;
        return Math.min(Math.max(n, MIN_TOOL_CALLS), MAX_TOOL_CALLS_CEILING);
    }

    isToolBlocked(tool: string): boolean {
        if (!this.profile) return false;
        const { blockedTools, allowedTools } = this.profile.config;
        if (allowedTools !== 'all' && Array.isArray(allowedTools) && !allowedTools.includes(tool)) return true;
        if (blockedTools.includes(tool)) return true;
        return false;
    }

    /**
     * #1408: gate de confirmação (HITL). A tool está na lista `requireConfirmationFor` do config
     * do agente? Consumido pelo runner ANTES de executar a ferramenta. Sem chamadores antes desta
     * issue — era teatro. Usa resolveConfig() (defaults quando sem profile).
     */
    requiresConfirmation(tool: string): boolean {
        return this.resolveConfig().requireConfirmationFor.includes(tool);
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
        const parts: string[] = [];

        // Texto-base do Marciano, editável pelo admin na aba "Config IA" (#1005).
        // É a fundação do prompt — tudo o que segue são complementos dinâmicos.
        const basePrompt = agentPromptStore.getBasePrompt();
        if (basePrompt) {
            parts.push(basePrompt);
        }

        if (!this.profile) return parts.join('\n\n');

        const { config, notePublic } = this.profile;

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
