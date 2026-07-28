import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as atomicWriteMod from '../../utils/atomicWrite';

vi.mock('../../utils/atomicWrite', async (importOriginal) => {
    const actual = (await importOriginal()) as typeof atomicWriteMod;
    return {
        ...actual,
        atomicWriteSync: vi.fn(actual.atomicWriteSync),
    };
});

vi.mock('../../config/env', () => ({
    config: {
        llmProvider: 'local',
        localModelName: 'llama3',
        googleApiKey: 'test-key',
        zaiModel: 'glm-5.2',
        minimaxModel: 'MiniMax-M3',
        geminiModel: 'gemini-2.0-flash',
    },
}));

describe('configService', () => {
    let configService: any;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../services/configService');
        configService = mod.configService;
    });

    describe('constructor defaults', () => {
        it('initializes chat module config', () => {
            const configs = configService.getAllModuleConfigs();
            expect(configs.chat).toEqual({ provider: 'local', model: 'llama3' });
        });

        it('initializes banking module config with gemini when googleApiKey exists', () => {
            const configs = configService.getAllModuleConfigs();
            expect(configs.banking).toEqual({ provider: 'local', model: 'gemini-2.0-flash' });
        });

        it('initializes system_analysis module config', () => {
            const configs = configService.getAllModuleConfigs();
            expect(configs.system_analysis).toEqual({ provider: 'local', model: 'llama3' });
        });

        it('initializes proposals module config', () => {
            const configs = configService.getAllModuleConfigs();
            expect(configs.proposals).toEqual({ provider: 'local', model: 'llama3' });
        });

        it('initializes default prompts', () => {
            const prompts = configService.getAllPrompts();
            expect(prompts.system_base).toBe('Você é um assistente virtual inteligente do sistema ERP.');
            expect(prompts.banking_categorization).toBe('Categorize as transações bancárias fornecidas.');
            expect(prompts.banking_anomalies).toBe('Identifique gastos suspeitos ou fora do padrão.');
            expect(prompts.chat_signature).toBe('~ Assistente Virtual');
        });
    });

    describe('getModuleConfig', () => {
        it('returns existing module config', () => {
            const result = configService.getModuleConfig('chat');
            expect(result).toEqual({ provider: 'local', model: 'llama3' });
        });

        it('returns default for unknown module', () => {
            const result = configService.getModuleConfig('unknown');
            expect(result).toEqual({ provider: 'local', model: 'llama3' });
        });
    });

    describe('setModuleConfigs', () => {
        it('merges new configs into existing', () => {
            configService.setModuleConfigs({
                custom: { provider: 'google', model: 'gemini-pro' },
            });
            expect(configService.getModuleConfig('custom')).toEqual({ provider: 'google', model: 'gemini-pro' });
            expect(configService.getModuleConfig('chat')).toEqual({ provider: 'local', model: 'llama3' });
        });

        it('overwrites existing module config', () => {
            configService.setModuleConfigs({
                chat: { provider: 'google', model: 'gemini-pro' },
            });
            expect(configService.getModuleConfig('chat')).toEqual({ provider: 'google', model: 'gemini-pro' });
        });
    });

    describe('getPrompt', () => {
        it('returns existing prompt', () => {
            expect(configService.getPrompt('system_base')).toBe('Você é um assistente virtual inteligente do sistema ERP.');
        });

        it('returns empty string for unknown prompt', () => {
            expect(configService.getPrompt('nonexistent')).toBe('');
        });
    });

    describe('setPrompts', () => {
        it('merges new prompts into existing', () => {
            configService.setPrompts({ custom_prompt: 'Custom instructions' });
            expect(configService.getPrompt('custom_prompt')).toBe('Custom instructions');
            expect(configService.getPrompt('system_base')).toBe('Você é um assistente virtual inteligente do sistema ERP.');
        });

        it('overwrites existing prompt', () => {
            configService.setPrompts({ system_base: 'New system prompt' });
            expect(configService.getPrompt('system_base')).toBe('New system prompt');
        });
    });

    describe('getAllModuleConfigs', () => {
        it('returns all module configs', () => {
            const configs = configService.getAllModuleConfigs();
            expect(Object.keys(configs)).toContain('chat');
            expect(Object.keys(configs)).toContain('banking');
            expect(Object.keys(configs)).toContain('system_analysis');
            expect(Object.keys(configs)).toContain('proposals');
        });
    });

    describe('getAllPrompts', () => {
        it('returns all prompts', () => {
            const prompts = configService.getAllPrompts();
            expect(Object.keys(prompts)).toContain('system_base');
            expect(Object.keys(prompts)).toContain('banking_categorization');
            expect(Object.keys(prompts)).toContain('banking_anomalies');
            expect(Object.keys(prompts)).toContain('chat_signature');
        });
    });
});

describe('configService without googleApiKey', () => {
    it('uses localModelName for banking when no googleApiKey', async () => {
        vi.doMock('../../config/env', () => ({
            config: {
                llmProvider: 'local',
                localModelName: 'mistral',
                googleApiKey: '',
            },
        }));
        vi.resetModules();
        const mod = await import('../../services/configService');
        const cs = mod.configService;
        const configs = cs.getAllModuleConfigs();
        expect(configs.banking.model).toBe('mistral');
    });
});

describe('configService fallback chain (#787)', () => {
    let configService: any;

    beforeEach(async () => {
        // Não resetModules (o configService é singleton); só limpa envs e state.
        delete process.env.LLM_DEFAULT_CHAIN;
        delete process.env.LLM_CHAT_CHAIN;
        delete process.env.LLM_BANKING_CHAIN;
        delete process.env.LLM_SYSTEM_ANALYSIS_CHAIN;
        delete process.env.LLM_PROPOSALS_CHAIN;
        delete process.env.LLM_RUN_WITH_CHAIN;
        delete process.env.LLM_FALLBACK_ENABLED;
        const mod = await import('../../services/configService');
        configService = mod.configService;
        // Limpa fallbackChains store para isolar testes
        const chains = configService.getAllFallbackChains();
        for (const key of Object.keys(chains)) {
            configService.setFallbackChain(key, []);
        }
    });

    afterEach(() => {
        delete process.env.LLM_DEFAULT_CHAIN;
        delete process.env.LLM_CHAT_CHAIN;
        delete process.env.LLM_BANKING_CHAIN;
        delete process.env.LLM_SYSTEM_ANALYSIS_CHAIN;
        delete process.env.LLM_PROPOSALS_CHAIN;
        delete process.env.LLM_RUN_WITH_CHAIN;
        delete process.env.LLM_FALLBACK_ENABLED;
    });

    it('retorna [primary] sem chain explicita nem env', () => {
        expect(configService.getFallbackChain('chat')).toEqual(['local']);
    });

    it('respeita LLM_DEFAULT_CHAIN do env (CSV)', () => {
        process.env.LLM_DEFAULT_CHAIN = 'glm,minimax,google';
        const chain = configService.getFallbackChain('chat');
        expect(chain[0]).toBe('local'); // primary sempre primeiro
        expect(chain).toContain('glm');
        expect(chain).toContain('minimax');
        expect(chain).toContain('google');
    });

    it('LLM_<MODULE>_CHAIN sobrescreve LLM_DEFAULT_CHAIN', () => {
        process.env.LLM_DEFAULT_CHAIN = 'glm';
        process.env.LLM_BANKING_CHAIN = 'google,glm';
        const chain = configService.getFallbackChain('banking');
        expect(chain).toContain('google');
        expect(chain).toContain('glm');
        expect(chain).not.toContain('minimax');
    });

    it('chain via setFallbackChain sobrescreve env', () => {
        process.env.LLM_CHAT_CHAIN = 'glm,minimax';
        configService.setFallbackChain('chat', ['google']);
        const chain = configService.getFallbackChain('chat');
        expect(chain).toContain('google');
        // env não é mais usado para este módulo
        expect(chain).not.toContain('glm');
        expect(chain).not.toContain('minimax');
    });

    it('filtra providers invalidos da chain do env', () => {
        process.env.LLM_DEFAULT_CHAIN = 'glm,openai,anthropic,minimax';
        const chain = configService.getFallbackChain('chat');
        expect(chain).toContain('glm');
        expect(chain).toContain('minimax');
        expect(chain).not.toContain('openai');
        expect(chain).not.toContain('anthropic');
    });

    it('remove duplicatas mantendo ordem', () => {
        process.env.LLM_DEFAULT_CHAIN = 'glm,minimax,glm';
        const chain = configService.getFallbackChain('chat');
        const occurrences = chain.filter((p: string) => p === 'glm').length;
        expect(occurrences).toBe(1);
    });

    it('retorna [primary] quando chain do env so tem providers invalidos', () => {
        process.env.LLM_DEFAULT_CHAIN = 'openai,anthropic';
        expect(configService.getFallbackChain('chat')).toEqual(['local']);
    });
});

describe('configService isRunWithChainEnabled (#787)', () => {
    let configService: any;

    beforeEach(async () => {
        delete process.env.LLM_RUN_WITH_CHAIN;
        delete process.env.LLM_FALLBACK_ENABLED;
        delete process.env.NODE_ENV;
    });

    it('LLM_RUN_WITH_CHAIN=true → enabled', async () => {
        process.env.LLM_RUN_WITH_CHAIN = 'true';
        const mod = await import('../../services/configService');
        expect(mod.configService.isRunWithChainEnabled()).toBe(true);
    });

    it('LLM_RUN_WITH_CHAIN=false → disabled', async () => {
        process.env.LLM_RUN_WITH_CHAIN = 'false';
        const mod = await import('../../services/configService');
        expect(mod.configService.isRunWithChainEnabled()).toBe(false);
    });

    it('LLM_FALLBACK_ENABLED=false legado → disabled (compat)', async () => {
        process.env.LLM_FALLBACK_ENABLED = 'false';
        const mod = await import('../../services/configService');
        expect(mod.configService.isRunWithChainEnabled()).toBe(false);
    });

    it('sem env + NODE_ENV=production → disabled (safe default)', async () => {
        process.env.NODE_ENV = 'production';
        const mod = await import('../../services/configService');
        expect(mod.configService.isRunWithChainEnabled()).toBe(false);
    });

    it('sem env + NODE_ENV=development → enabled', async () => {
        process.env.NODE_ENV = 'development';
        const mod = await import('../../services/configService');
        expect(mod.configService.isRunWithChainEnabled()).toBe(true);
    });
});

// =============================================================================
// Issue #1541 — filesystem safety: setConfig NUNCA escreve em .env
// =============================================================================
// Estes testes isolam o configService REAL e inspecionam `atomicWriteSync`
// (mockado no nível deste arquivo como `vi.fn(...)`) para garantir:
//   1. nenhum write é feito em arquivo cujo path contenha ".env"
//   2. o write é feito em `config/runtime.json` (sugestão da issue),
//      NÃO `data/config.json`
// Como `atomicWriteSync` é a ÚNICA função de persistência do configService,
// cobrir o spy nela cobre o requisito de "fs.watch em teste ou mock do fs"
// da issue (#1541 critério #1).
describe('configService — filesystem safety (#1541: never writes to .env)', () => {
    let atomicWriteMock: ReturnType<typeof vi.fn>;
    let realConfigService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        const awMod = await import('../../utils/atomicWrite');
        atomicWriteMock = vi.mocked(awMod.atomicWriteSync);
        const mod = await import('../../services/configService');
        realConfigService = mod.configService;
    });

    function recordedPaths(): string[] {
        return atomicWriteMock.mock.calls.map((c: any[]) => String(c[0]));
    }

    it('setConfig NUNCA escreve em arquivo .env (qualquer path contendo ".env")', () => {
        realConfigService.setConfig('googleApiKey', 'secret-key-abc');
        realConfigService.setConfig('zaiApiKey', 'another-key');
        realConfigService.setConfig('minimaxApiKey', 'third-key');
        realConfigService.setConfig('geminiModel', 'gemini-2.0-flash');

        const paths = recordedPaths();
        // Sanity: houve write
        expect(paths.length).toBeGreaterThan(0);
        // Segurança: nenhum path com ".env" (case-insensitive, basename OU path inteiro)
        for (const p of paths) {
            expect(p.toLowerCase()).not.toContain('.env');
        }
    });

    it('setConfig persiste em config/runtime.json (não em data/config.json nem .env)', () => {
        realConfigService.setConfig('localLlmUrl', 'http://localhost:9999');

        const paths = recordedPaths();
        expect(paths.length).toBeGreaterThanOrEqual(1);
        // O path destino deve ser `config/runtime.json` (sugestão da issue),
        // NÃO `data/config.json`. Verifica normalizando separadores Windows.
        const runtimeWrite = paths.find((p) => p.replace(/\\/g, '/').endsWith('config/runtime.json'));
        expect(runtimeWrite).toBeDefined();
        // E definitivamente NÃO em `data/config.json` (local antigo)
        const legacyWrite = paths.find((p) => p.replace(/\\/g, '/').endsWith('data/config.json'));
        expect(legacyWrite).toBeUndefined();
    });

    it('setConfig rejeita chave que tenta tocar em .env (defesa em profundidade — duas camadas)', () => {
        // chave EXATAMENTE ".env" → bloqueado
        expect(() => realConfigService.setConfig('.env', 'foo')).toThrow(/cannot target \.env/);
        // chave CONTENDO ".env" → bloqueado
        expect(() => realConfigService.setConfig('api.env_key', 'foo')).toThrow(/cannot target \.env/);
        expect(() => realConfigService.setConfig('MY.ENV.KEY', 'foo')).toThrow(/cannot target \.env/);
    });
});
