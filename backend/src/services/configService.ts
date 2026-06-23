
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';
import { atomicWriteSync } from '../utils/atomicWrite';

interface ModuleConfig {
    provider: string;
    model: string;
    fallbackChain?: string[];
}

interface PersistedConfig {
    moduleConfigs: Record<string, ModuleConfig>;
    customPrompts: Record<string, string>;
    fallbackChains?: Record<string, string[]>;
}

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');

const KNOWN_PROVIDERS = new Set(['local', 'google', 'glm', 'minimax']);

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

// Parse CSV de env: "glm,minimax,google" → ["glm", "minimax", "google"].
// Filtra valores inválidos (não são providers conhecidos) para evitar config quebrado.
function parseChainFromEnv(envValue: string | undefined): string[] | undefined {
    if (!envValue) return undefined;
    const chain = envValue.split(',').map((s) => s.trim()).filter(Boolean);
    const filtered = chain.filter((p) => KNOWN_PROVIDERS.has(p));
    return filtered.length > 0 ? filtered : undefined;
}

function defaultModules(): Record<string, ModuleConfig> {
    const defaultModel = modelForProvider(config.llmProvider);
    return {
        chat: { provider: config.llmProvider, model: defaultModel },
        banking: { provider: config.llmProvider, model: config.googleApiKey ? 'gemini-2.0-flash' : defaultModel },
        system_analysis: { provider: config.llmProvider, model: defaultModel },
        proposals: { provider: config.llmProvider, model: defaultModel }
    };
}

function defaultPrompts(): Record<string, string> {
    return {
        system_base: 'Você é um assistente virtual inteligente do sistema ERP.',
        banking_categorization: 'Categorize as transações bancárias fornecidas.',
        banking_anomalies: 'Identifique gastos suspeitos ou fora do padrão.',
        chat_signature: '~ Assistente Virtual'
    };
}

class ConfigService {
    private moduleConfigs: Record<string, ModuleConfig>;
    private customPrompts: Record<string, string>;
    // Cadeia de fallback POR MÓDULO — quando presente, sobrescreve o default global.
    private fallbackChains: Record<string, string[]>;

    constructor() {
        const persisted = this.loadFromDisk();
        this.moduleConfigs = persisted?.moduleConfigs ?? defaultModules();
        this.customPrompts = persisted?.customPrompts ?? defaultPrompts();
        this.fallbackChains = persisted?.fallbackChains ?? {};
        if (!persisted) {
            // Primeiro boot: persiste defaults para que survive restart.
            this.flush();
        }
    }

    /**
     * Carrega data/config.json. Tolerante a:
     * - arquivo inexistente → retorna undefined (usa defaults)
     * - JSON corrompido → log + retorna undefined (fallback para defaults)
     * NUNCA derruba o boot.
     */
    private loadFromDisk(): PersistedConfig | undefined {
        try {
            if (!fs.existsSync(CONFIG_PATH)) return undefined;
            const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
            const parsed = JSON.parse(raw) as PersistedConfig;
            if (!parsed || typeof parsed !== 'object') {
                console.warn(`[ConfigService] data/config.json malformado (não é objeto); usando defaults.`);
                return undefined;
            }
            return parsed;
        } catch (e: any) {
            console.warn(`[ConfigService] Falha ao carregar data/config.json: ${e?.message || e}. Usando defaults.`);
            return undefined;
        }
    }

    /**
     * Serializa o estado atual em data/config.json de forma atômica.
     * Chamado após cada setter — garante que edição runtime sobreviva restart.
     * Tolerante a falhas: log mas não propaga (não deve quebrar caller).
     */
    private flush(): void {
        try {
            const persisted: PersistedConfig = {
                moduleConfigs: this.moduleConfigs,
                customPrompts: this.customPrompts,
                fallbackChains: this.fallbackChains
            };
            atomicWriteSync(CONFIG_PATH, persisted);
        } catch (e: any) {
            console.error(`[ConfigService] Falha ao persistir config: ${e?.message || e}`);
        }
    }

    getModuleConfig(moduleName: string): ModuleConfig {
        return this.moduleConfigs[moduleName] || { provider: config.llmProvider, model: modelForProvider(config.llmProvider) };
    }

    getAllModuleConfigs(): Record<string, ModuleConfig> {
        return this.moduleConfigs;
    }

    setModuleConfigs(configs: Record<string, ModuleConfig>) {
        this.moduleConfigs = { ...this.moduleConfigs, ...configs };
        this.flush();
    }

    /**
     * Reaplica config.llmProvider atual aos módulos default, mas PRESERVA
     * overrides explícitos feitos via setModuleConfigs (módulos onde provider
     * !== config.llmProvider atual continuam como estão).
     */
    resetModulesToGlobal(): void {
        const p = config.llmProvider;
        const m = modelForProvider(p);
        const next: Record<string, ModuleConfig> = {};
        for (const key of Object.keys(this.moduleConfigs)) {
            const existing = this.moduleConfigs[key];
            // preserva override se provider foi explicitamente setado diferente do global
            if (existing.provider && existing.provider !== config.llmProvider) {
                next[key] = existing;
            } else {
                next[key] = key === 'banking' && config.googleApiKey
                    ? { provider: p, model: 'gemini-2.0-flash' }
                    : { provider: p, model: m };
            }
        }
        this.moduleConfigs = next;
        this.flush();
    }

    /**
     * Cadeia de fallback por módulo.
     *
     * Ordem de resolução:
     * 1. `moduleConfigs[moduleName].fallbackChain` (override explícito do admin)
     * 2. `fallbackChains[moduleName]` (chain setada via setFallbackChain)
     * 3. env `LLM_<MODULE>_CHAIN` (CSV)
     * 4. env `LLM_DEFAULT_CHAIN` (CSV global)
     * 5. `[moduleConfig.provider]` (sem fallback — fallback fica para #789 wire-up)
     *
     * O resultado é SEMPRE `[primary, ...alternates]` onde o primeiro elemento é
     * o provider ativo do módulo. Providers inválidos são filtrados.
     */
    getFallbackChain(moduleName: string): string[] {
        const moduleCfg = this.getModuleConfig(moduleName);
        const primary = moduleCfg.provider;

        // 1. override explícito no ModuleConfig
        if (moduleCfg.fallbackChain?.length) {
            return this.cleanChain(primary, moduleCfg.fallbackChain);
        }
        // 2. fallbackChains explícito
        const fromStore = this.fallbackChains[moduleName];
        if (fromStore?.length) {
            return this.cleanChain(primary, fromStore);
        }
        // 3. env por módulo
        const envKey = `LLM_${moduleName.toUpperCase()}_CHAIN`;
        const envChain = parseChainFromEnv(process.env[envKey]);
        if (envChain?.length) {
            return this.cleanChain(primary, envChain);
        }
        // 4. env global
        const defaultChain = parseChainFromEnv(process.env.LLM_DEFAULT_CHAIN);
        if (defaultChain?.length) {
            return this.cleanChain(primary, defaultChain);
        }
        // 5. sem fallback
        return [primary];
    }

    setFallbackChain(moduleName: string, chain: string[]) {
        this.fallbackChains = { ...this.fallbackChains, [moduleName]: chain };
        this.flush();
    }

    getAllFallbackChains(): Record<string, string[]> {
        return { ...this.fallbackChains };
    }

    private cleanChain(primary: string, chain: string[]): string[] {
        // Garante primary na frente, sem duplicatas, e providers válidos.
        const seen = new Set<string>();
        const result: string[] = [];
        for (const p of [primary, ...chain]) {
            if (KNOWN_PROVIDERS.has(p) && !seen.has(p)) {
                seen.add(p);
                result.push(p);
            }
        }
        return result.length > 0 ? result : [primary];
    }

    getPrompt(promptName: string): string {
        return this.customPrompts[promptName] || '';
    }

    getAllPrompts(): Record<string, string> {
        return this.customPrompts;
    }

    setPrompts(prompts: Record<string, string>) {
        this.customPrompts = { ...this.customPrompts, ...prompts };
        this.flush();
    }

    /**
     * Feature flag do wrapper runWithChain (WS-D, #789).
     *
     * - LLM_RUN_WITH_CHAIN=true: força ON.
     * - LLM_RUN_WITH_CHAIN=false: força OFF.
     * - LLM_RUN_WITH_CHAIN não setada: default `NODE_ENV !== 'production'`
     *   (dev/staging ON; prod OFF até #789 validado em staging).
     *
     * Compat com legado: LLM_FALLBACK_ENABLED=false também desliga
     * (mantém comportamento de quem usava a flag antiga).
     */
    isRunWithChainEnabled(): boolean {
        if (process.env.LLM_FALLBACK_ENABLED === 'false') return false;
        const v = process.env.LLM_RUN_WITH_CHAIN;
        if (v === 'true') return true;
        if (v === 'false') return false;
        return process.env.NODE_ENV !== 'production';
    }
}

export const configService = new ConfigService();
// Exporta a classe para tests que precisam de instância isolada (sem singleton).
export { ConfigService };
