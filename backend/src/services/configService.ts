
import { config } from '../config/env';

interface ModuleConfig {
    provider: string;
    model: string;
}

class ConfigService {
    private moduleConfigs: Record<string, ModuleConfig>;
    private customPrompts: Record<string, string>;

    constructor() {
        // Initialize with defaults from env/global config
        this.moduleConfigs = {
            chat: { provider: config.llmProvider, model: config.localModelName },
            banking: { provider: config.llmProvider, model: config.googleApiKey ? 'gemini-2.0-flash' : config.localModelName },
            system_analysis: { provider: config.llmProvider, model: config.localModelName },
            proposals: { provider: config.llmProvider, model: config.localModelName }
        };

        this.customPrompts = {
            system_base: 'Você é um assistente virtual inteligente do sistema ERP.',
            banking_categorization: 'Categorize as transações bancárias fornecidas.',
            banking_anomalies: 'Identifique gastos suspeitos ou fora do padrão.',
            chat_signature: '~ Assistente Virtual'
        };
    }

    getModuleConfig(moduleName: string): ModuleConfig {
        return this.moduleConfigs[moduleName] || { provider: config.llmProvider, model: config.localModelName };
    }

    getAllModuleConfigs(): Record<string, ModuleConfig> {
        return this.moduleConfigs;
    }

    setModuleConfigs(configs: Record<string, ModuleConfig>) {
        this.moduleConfigs = { ...this.moduleConfigs, ...configs };
    }

    getPrompt(promptName: string): string {
        return this.customPrompts[promptName] || '';
    }

    getAllPrompts(): Record<string, string> {
        return this.customPrompts;
    }

    setPrompts(prompts: Record<string, string>) {
        this.customPrompts = { ...this.customPrompts, ...prompts };
    }
}

export const configService = new ConfigService();
