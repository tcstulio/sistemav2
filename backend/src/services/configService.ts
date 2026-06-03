
import { config } from '../config/env';

interface ModuleConfig {
    provider: string;
    model: string;
}

// Resolve o modelo padrão de acordo com o provider ativo — evita mandar o modelo
// do Ollama (localModelName) para Z.AI/MiniMax/Google e vice-versa.
function modelForProvider(provider: string): string {
    switch (provider) {
        case 'glm': return config.zaiModel;
        case 'minimax': return config.minimaxModel;
        case 'google': return config.geminiModel || 'gemini-2.0-flash';
        default: return config.localModelName;
    }
}

class ConfigService {
    private moduleConfigs: Record<string, ModuleConfig>;
    private customPrompts: Record<string, string>;

    constructor() {
        // Initialize with defaults from env/global config
        const defaultModel = modelForProvider(config.llmProvider);
        this.moduleConfigs = {
            chat: { provider: config.llmProvider, model: defaultModel },
            banking: { provider: config.llmProvider, model: config.googleApiKey ? 'gemini-2.0-flash' : defaultModel },
            system_analysis: { provider: config.llmProvider, model: defaultModel },
            proposals: { provider: config.llmProvider, model: defaultModel }
        };

        this.customPrompts = {
            system_base: 'Você é um assistente virtual inteligente do sistema ERP.',
            banking_categorization: 'Categorize as transações bancárias fornecidas.',
            banking_anomalies: 'Identifique gastos suspeitos ou fora do padrão.',
            chat_signature: '~ Assistente Virtual'
        };
    }

    getModuleConfig(moduleName: string): ModuleConfig {
        return this.moduleConfigs[moduleName] || { provider: config.llmProvider, model: modelForProvider(config.llmProvider) };
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
