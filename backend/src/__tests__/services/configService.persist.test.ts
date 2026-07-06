import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Testes de persistência de config de LLM e WhatsApp provider (#1128).
 *
 * Simulam o ciclo boot -> edição -> restart usando mocks isolados de fs/atomicWrite,
 * sem tocar o filesystem real e sem depender do mock global de fs (setup.ts). Cada
 * boot() reconfigura os mocks e re-importa o configService (novo singleton), permitindo
 * verificar que valores editados sobrevivem a um "restart".
 */
describe('configService persistência LLM + WhatsApp (#1128)', () => {
    let disk: { config?: string };
    let configObj: any;
    let featuresObj: any;

    beforeEach(() => {
        disk = {};
        configObj = {
            llmProvider: 'local',
            localLlmUrl: 'http://localhost:11434/v1',
            localModelName: 'llama3',
            googleApiKey: '',
            geminiModel: 'gemini-2.0-flash',
            zaiApiKey: '', zaiBaseUrl: 'https://api.z.ai/', zaiModel: 'glm-5.2',
            minimaxApiKey: '', minimaxBaseUrl: 'https://api.minimax.io/', minimaxModel: 'MiniMax-M3',
        };
        featuresObj = {
            WHATSAPP_PROVIDER: 'legacy' as 'legacy' | 'moltbot',
            MOLTBOT_ENABLED: false,
        };
    });

    async function boot() {
        vi.doMock('../../config/env', () => ({ config: configObj }));
        vi.doMock('../../config/features', () => ({
            FEATURES: featuresObj,
            getAllFeatures: vi.fn(() => ({ ...featuresObj })),
            isUsingMoltbot: vi.fn(() => false),
            isTulipaActive: vi.fn(() => false),
            logFeatures: vi.fn(),
        }));
        vi.doMock('../../utils/atomicWrite', () => ({
            atomicWriteSync: vi.fn((_filePath: string, data: unknown) => {
                disk.config = JSON.stringify(data);
            }),
        }));
        vi.doMock('fs', () => {
            const exists = () => disk.config !== undefined;
            const read = () => (disk.config !== undefined ? disk.config : '');
            const fsMock = {
                existsSync: vi.fn(exists),
                readFileSync: vi.fn(read),
                writeFileSync: vi.fn(),
                renameSync: vi.fn(),
                mkdirSync: vi.fn(),
                unlinkSync: vi.fn(),
                readdirSync: vi.fn(() => []),
                statSync: vi.fn(),
            };
            return { ...fsMock, default: fsMock };
        });
        vi.resetModules();
        return await import('../../services/configService');
    }

    afterEach(() => {
        vi.resetModules();
    });

    it('aplica config de LLM persistida sobre o env no boot (override)', async () => {
        disk.config = JSON.stringify({
            moduleConfigs: {},
            customPrompts: {},
            llm: {
                llmProvider: 'glm',
                zaiApiKey: 'persisted-zai-key',
                zaiBaseUrl: 'http://z.ai/api',
                zaiModel: 'glm-5.2',
            },
        });
        const { configService } = await boot();

        // O objeto config (env) foi sobrescrito pelo persistido.
        expect(configObj.llmProvider).toBe('glm');
        expect(configObj.zaiApiKey).toBe('persisted-zai-key');
        expect(configObj.zaiBaseUrl).toBe('http://z.ai/api');
        // getLlmConfig devolve snapshot do persistido.
        expect(configService.getLlmConfig()).toMatchObject({
            llmProvider: 'glm',
            zaiApiKey: 'persisted-zai-key',
        });
    });

    it('setLlmConfig muta config runtime E grava em data/config.json', async () => {
        const { configService } = await boot();

        configService.setLlmConfig({
            provider: 'minimax',
            url: 'http://mm.api',
            key: 'mm-key',
            modelName: 'MiniMax-M3',
        });

        expect(configObj.llmProvider).toBe('minimax');
        expect(configObj.minimaxApiKey).toBe('mm-key');
        expect(configObj.minimaxBaseUrl).toBe('http://mm.api');
        expect(configObj.minimaxModel).toBe('MiniMax-M3');

        const persisted = JSON.parse(disk.config!);
        expect(persisted.llm).toMatchObject({
            llmProvider: 'minimax',
            minimaxBaseUrl: 'http://mm.api',
            minimaxApiKey: 'mm-key',
            minimaxModel: 'MiniMax-M3',
        });
    });

    it('mapeia key/url/model do provider local e google corretamente', async () => {
        const { configService } = await boot();

        configService.setLlmConfig({ provider: 'local', url: 'http://ollama:11434', modelName: 'llama3.1' });
        expect(configObj.localLlmUrl).toBe('http://ollama:11434');
        expect(configObj.localModelName).toBe('llama3.1');

        configService.setLlmConfig({ provider: 'google', key: 'g-key' });
        expect(configObj.googleApiKey).toBe('g-key');
    });

    it('sobrevive a restart: editar -> recarregar mantém os valores', async () => {
        // Boot 1: estado limpo.
        let mod = await boot();
        mod.configService.setLlmConfig({
            provider: 'glm',
            url: 'http://z.ai/api',
            key: 'zk',
            modelName: 'glm-5.2',
        });
        const snapshot = disk.config!;

        // Simula restart: resetamos o env p/ defaults e boot lendo o disco gravado.
        configObj.llmProvider = 'local';
        configObj.zaiApiKey = '';
        configObj.zaiBaseUrl = 'https://api.z.ai/';
        configObj.zaiModel = 'glm-5.2';
        disk.config = snapshot;

        mod = await boot();
        expect(configObj.llmProvider).toBe('glm');
        expect(configObj.zaiApiKey).toBe('zk');
        expect(configObj.zaiBaseUrl).toBe('http://z.ai/api');
        expect(mod.configService.getLlmConfig().zaiApiKey).toBe('zk');
    });

    it('persiste WHATSAPP_PROVIDER via setWhatsAppProvider', async () => {
        const { configService } = await boot();
        configService.setWhatsAppProvider('moltbot');

        expect(featuresObj.WHATSAPP_PROVIDER).toBe('moltbot');
        const persisted = JSON.parse(disk.config!);
        expect(persisted.whatsappProvider).toBe('moltbot');
    });

    it('aplica whatsappProvider persistido no boot (override do env)', async () => {
        disk.config = JSON.stringify({
            moduleConfigs: {},
            customPrompts: {},
            whatsappProvider: 'moltbot',
        });
        const { configService } = await boot();

        expect(configService.getWhatsAppProvider()).toBe('moltbot');
        // FEATURES também refletido p/ consistência com isUsingMoltbot()/getAllFeatures().
        expect(featuresObj.WHATSAPP_PROVIDER).toBe('moltbot');
    });

    it('ignora whatsappProvider inválido no disco', async () => {
        disk.config = JSON.stringify({
            moduleConfigs: {},
            customPrompts: {},
            whatsappProvider: 'invalid-provider',
        });
        const { configService } = await boot();

        expect(configService.getWhatsAppProvider()).toBeUndefined();
        expect(featuresObj.WHATSAPP_PROVIDER).toBe('legacy');
    });

    it('não sobrescreve campos do env que não foram persistidos', async () => {
        // Só persistiu o provider; url/key/model continuam vindo do env.
        disk.config = JSON.stringify({
            moduleConfigs: {},
            customPrompts: {},
            llm: { llmProvider: 'google' },
        });
        await boot();

        expect(configObj.llmProvider).toBe('google');
        // googleApiKey não estava no persistido -> mantém default do env ('').
        expect(configObj.googleApiKey).toBe('');
        // localLlmUrl mantém default do env.
        expect(configObj.localLlmUrl).toBe('http://localhost:11434/v1');
    });
});
