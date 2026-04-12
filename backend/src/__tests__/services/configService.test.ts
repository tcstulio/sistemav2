import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/env', () => ({
    config: {
        llmProvider: 'local',
        localModelName: 'llama3',
        googleApiKey: 'test-key',
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
