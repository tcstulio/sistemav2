import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('AgentBootstrapConfig');

const DATA_DIR = path.join(__dirname, '../../data');
const STORE_FILE = path.join(DATA_DIR, 'agent_bootstrap_config.json');

/**
 * Config da "sessão automática" do agente (#300 item 3): controla o resumo
 * proativo que o VirtualAssistant gera ao abrir uma conversa nova — se está
 * ligado e quais informações ele reúne.
 */
export interface AgentBootstrapConfig {
    enabled: boolean;
    includeTasks: boolean;
    includeAgenda: boolean;
    includeFinancial: boolean;
    /** Instrução extra opcional, anexada ao prompt de abertura. */
    extraInstruction: string;
}

export const DEFAULT_BOOTSTRAP_CONFIG: AgentBootstrapConfig = {
    enabled: true,
    includeTasks: true,
    includeAgenda: true,
    includeFinancial: true,
    extraInstruction: '',
};

export interface AgentBootstrapConfigPatch {
    enabled?: boolean;
    includeTasks?: boolean;
    includeAgenda?: boolean;
    includeFinancial?: boolean;
    extraInstruction?: string;
}

class AgentBootstrapConfigStore {
    private data: AgentBootstrapConfig = { ...DEFAULT_BOOTSTRAP_CONFIG };

    constructor() {
        this.load();
    }

    private load() {
        if (!fs.existsSync(STORE_FILE)) return;
        try {
            const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
            this.data = this.merge(raw);
        } catch (e) {
            log.error('Falha ao carregar agent_bootstrap_config.json — usando defaults', e);
            this.data = { ...DEFAULT_BOOTSTRAP_CONFIG };
        }
    }

    private merge(raw: any): AgentBootstrapConfig {
        const base = { ...DEFAULT_BOOTSTRAP_CONFIG };
        if (raw && typeof raw === 'object') {
            for (const k of ['enabled', 'includeTasks', 'includeAgenda', 'includeFinancial'] as const) {
                if (typeof raw[k] === 'boolean') base[k] = raw[k];
            }
            if (typeof raw.extraInstruction === 'string') base.extraInstruction = raw.extraInstruction.slice(0, 2000);
        }
        return base;
    }

    private save() {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        atomicWriteSync(STORE_FILE, this.data);
    }

    getConfig(): AgentBootstrapConfig {
        return { ...this.data };
    }

    updateConfig(patch: AgentBootstrapConfigPatch): AgentBootstrapConfig {
        this.data = this.merge({ ...this.data, ...patch });
        this.save();
        log.info(`Config de sessão automática atualizada (enabled=${this.data.enabled})`);
        return this.getConfig();
    }
}

export const agentBootstrapConfigStore = new AgentBootstrapConfigStore();
