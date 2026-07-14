import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInfo = vi.fn();
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({
        info: mockInfo,
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

// #1410 — features.ts importa `uiConfigService` para resolver WHATSAPP_PROVIDER no boot.
// Mockamos aqui para que cada teste controle o "valor persistido" sem precisar de disco.
// Por padrão (sem override) o mock devolve `{}` → cai no env (default 'legacy').
const mockUiConfig = vi.hoisted(() => ({
    get: vi.fn(() => ({})),
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));

describe('features', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
        mockInfo.mockClear();
        mockUiConfig.get.mockReturnValue({}); // sem override persistido → cai no env
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        mockUiConfig.get.mockReturnValue({});
    });

    async function importFeatures() {
        vi.resetModules();
        const mod = await import('../../config/features');
        return mod;
    }

    describe('FEATURES defaults', () => {
        it('has WHATSAPP_PROVIDER default legacy', async () => {
            delete process.env.WHATSAPP_PROVIDER;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.WHATSAPP_PROVIDER).toBe('legacy');
        });

        it('reads WHATSAPP_PROVIDER from env', async () => {
            process.env.WHATSAPP_PROVIDER = 'moltbot';
            const { FEATURES } = await importFeatures();
            expect(FEATURES.WHATSAPP_PROVIDER).toBe('moltbot');
        });

        it('MOLTBOT_ENABLED defaults to false', async () => {
            delete process.env.MOLTBOT_ENABLED;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.MOLTBOT_ENABLED).toBe(false);
        });

        it('MOLTBOT_ENABLED is true when env is "true"', async () => {
            process.env.MOLTBOT_ENABLED = 'true';
            const { FEATURES } = await importFeatures();
            expect(FEATURES.MOLTBOT_ENABLED).toBe(true);
        });

        it('TULIPA_ENABLED defaults to false', async () => {
            delete process.env.TULIPA_ENABLED;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.TULIPA_ENABLED).toBe(false);
        });

        it('TULIPA_ENABLED is true when env is "true"', async () => {
            process.env.TULIPA_ENABLED = 'true';
            const { FEATURES } = await importFeatures();
            expect(FEATURES.TULIPA_ENABLED).toBe(true);
        });

        it('SYNC_BRAIN_ENABLED defaults to false', async () => {
            delete process.env.SYNC_BRAIN_ENABLED;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.SYNC_BRAIN_ENABLED).toBe(false);
        });

        it('TULIPA_TASKS_ENABLED defaults to false', async () => {
            delete process.env.TULIPA_TASKS_ENABLED;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.TULIPA_TASKS_ENABLED).toBe(false);
        });

        it('MEMORY_SEARCH_ENABLED defaults to false', async () => {
            delete process.env.MEMORY_SEARCH_ENABLED;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.MEMORY_SEARCH_ENABLED).toBe(false);
        });

        it('AUTO_REPLY_ENABLED defaults to true', async () => {
            delete process.env.AUTO_REPLY_ENABLED;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.AUTO_REPLY_ENABLED).toBe(true);
        });

        it('AUTO_REPLY_ENABLED is false when env is "false"', async () => {
            process.env.AUTO_REPLY_ENABLED = 'false';
            const { FEATURES } = await importFeatures();
            expect(FEATURES.AUTO_REPLY_ENABLED).toBe(false);
        });

        it('AUDIO_TRANSCRIPTION_ENABLED defaults to true', async () => {
            delete process.env.AUDIO_TRANSCRIPTION_ENABLED;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.AUDIO_TRANSCRIPTION_ENABLED).toBe(true);
        });

        it('AUDIO_TRANSCRIPTION_ENABLED is false when env is "false"', async () => {
            process.env.AUDIO_TRANSCRIPTION_ENABLED = 'false';
            const { FEATURES } = await importFeatures();
            expect(FEATURES.AUDIO_TRANSCRIPTION_ENABLED).toBe(false);
        });

        it('FINANCIAL_COMMANDS_ENABLED defaults to false', async () => {
            delete process.env.FINANCIAL_COMMANDS_ENABLED;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.FINANCIAL_COMMANDS_ENABLED).toBe(false);
        });

        it('FINANCIAL_COMMANDS_ENABLED is true when env is "true"', async () => {
            process.env.FINANCIAL_COMMANDS_ENABLED = 'true';
            const { FEATURES } = await importFeatures();
            expect(FEATURES.FINANCIAL_COMMANDS_ENABLED).toBe(true);
        });

        it('CRM_CONTEXT_INJECTION defaults to true', async () => {
            delete process.env.CRM_CONTEXT_INJECTION;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.CRM_CONTEXT_INJECTION).toBe(true);
        });

        it('CRM_CONTEXT_INJECTION is false when env is "false"', async () => {
            process.env.CRM_CONTEXT_INJECTION = 'false';
            const { FEATURES } = await importFeatures();
            expect(FEATURES.CRM_CONTEXT_INJECTION).toBe(false);
        });

        it('CRM_SYNC_ENABLED defaults to false', async () => {
            delete process.env.CRM_SYNC_ENABLED;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.CRM_SYNC_ENABLED).toBe(false);
        });

        it('DEBUG_MODE defaults to false', async () => {
            delete process.env.DEBUG_MODE;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.DEBUG_MODE).toBe(false);
        });

        it('DRY_RUN_MODE defaults to false', async () => {
            delete process.env.DRY_RUN_MODE;
            const { FEATURES } = await importFeatures();
            expect(FEATURES.DRY_RUN_MODE).toBe(false);
        });
    });

    describe('isUsingMoltbot', () => {
        it('returns false when MOLTBOT_ENABLED is false', async () => {
            delete process.env.MOLTBOT_ENABLED;
            delete process.env.WHATSAPP_PROVIDER;
            const { isUsingMoltbot } = await importFeatures();
            expect(isUsingMoltbot()).toBe(false);
        });

        it('returns false when WHATSAPP_PROVIDER is not moltbot', async () => {
            process.env.MOLTBOT_ENABLED = 'true';
            process.env.WHATSAPP_PROVIDER = 'legacy';
            const { isUsingMoltbot } = await importFeatures();
            expect(isUsingMoltbot()).toBe(false);
        });

        it('returns true when MOLTBOT_ENABLED and WHATSAPP_PROVIDER is moltbot', async () => {
            process.env.MOLTBOT_ENABLED = 'true';
            process.env.WHATSAPP_PROVIDER = 'moltbot';
            const { isUsingMoltbot } = await importFeatures();
            expect(isUsingMoltbot()).toBe(true);
        });
    });

    describe('isUsingLegacyWhatsApp', () => {
        it('returns true when not using moltbot', async () => {
            delete process.env.MOLTBOT_ENABLED;
            delete process.env.WHATSAPP_PROVIDER;
            const { isUsingLegacyWhatsApp } = await importFeatures();
            expect(isUsingLegacyWhatsApp()).toBe(true);
        });

        it('returns false when using moltbot', async () => {
            process.env.MOLTBOT_ENABLED = 'true';
            process.env.WHATSAPP_PROVIDER = 'moltbot';
            const { isUsingLegacyWhatsApp } = await importFeatures();
            expect(isUsingLegacyWhatsApp()).toBe(false);
        });
    });

    describe('isTulipaActive', () => {
        it('returns false when TULIPA_ENABLED is false', async () => {
            delete process.env.TULIPA_ENABLED;
            const { isTulipaActive } = await importFeatures();
            expect(isTulipaActive()).toBe(false);
        });

        it('returns true when TULIPA_ENABLED is true', async () => {
            process.env.TULIPA_ENABLED = 'true';
            const { isTulipaActive } = await importFeatures();
            expect(isTulipaActive()).toBe(true);
        });
    });

    describe('isBrainSyncEnabled', () => {
        it('returns false when TULIPA_ENABLED is false', async () => {
            delete process.env.TULIPA_ENABLED;
            process.env.SYNC_BRAIN_ENABLED = 'true';
            const { isBrainSyncEnabled } = await importFeatures();
            expect(isBrainSyncEnabled()).toBe(false);
        });

        it('returns false when SYNC_BRAIN_ENABLED is false', async () => {
            process.env.TULIPA_ENABLED = 'true';
            delete process.env.SYNC_BRAIN_ENABLED;
            const { isBrainSyncEnabled } = await importFeatures();
            expect(isBrainSyncEnabled()).toBe(false);
        });

        it('returns true when both TULIPA_ENABLED and SYNC_BRAIN_ENABLED are true', async () => {
            process.env.TULIPA_ENABLED = 'true';
            process.env.SYNC_BRAIN_ENABLED = 'true';
            const { isBrainSyncEnabled } = await importFeatures();
            expect(isBrainSyncEnabled()).toBe(true);
        });
    });

    describe('isCRMContextEnabled', () => {
        it('returns true by default', async () => {
            delete process.env.CRM_CONTEXT_INJECTION;
            const { isCRMContextEnabled } = await importFeatures();
            expect(isCRMContextEnabled()).toBe(true);
        });

        it('returns false when disabled', async () => {
            process.env.CRM_CONTEXT_INJECTION = 'false';
            const { isCRMContextEnabled } = await importFeatures();
            expect(isCRMContextEnabled()).toBe(false);
        });
    });

    describe('getAllFeatures', () => {
        it('returns a copy of FEATURES', async () => {
            const { getAllFeatures, FEATURES } = await importFeatures();
            const all = getAllFeatures();
            expect(all).toEqual(FEATURES);
            expect(all).not.toBe(FEATURES);
        });
    });

    describe('logFeatures', () => {
        it('calls log.info with current configuration', async () => {
            const { logFeatures } = await importFeatures();
            logFeatures();
            expect(mockInfo).toHaveBeenCalledWith('Current configuration', expect.objectContaining({
                whatsappProvider: expect.any(String),
                moltbotEnabled: expect.any(Boolean),
                tulipaEnabled: expect.any(Boolean),
                brainSync: expect.any(Boolean),
                autoReply: expect.any(Boolean),
                crmContext: expect.any(Boolean),
                debugMode: expect.any(Boolean),
            }));
        });
    });

    describe('default export', () => {
        it('exports FEATURES as default', async () => {
            const mod = await importFeatures();
            expect(mod.default).toEqual(mod.FEATURES);
        });
    });

    // #1410 — teste de enforcement obrigatório (critério de aceite #2 da issue):
    // "teste que faz POST /admin/set-whatsapp-provider=zapi, simula reboot (recarrega features.ts),
    //  e valida que getWhatsAppProvider() retorna 'zapi' (não o env). Sem isso, é teatro."
    //
    // Aqui simulamos o ciclo completo sem precisar do Express:
    //   1) "POST" = gravar override no uiConfig (mock)
    //   2) "reboot" = vi.resetModules() + import dinâmico de features.ts e featureSwitches.ts
    //   3) Validar FEATURES.WHATSAPP_PROVIDER e getEffectiveWhatsAppProvider() com o valor
    //      persistido, e não com o env.
    async function importResolvers() {
        // Importa DEPOIS do import de features.ts p/ que featureSwitches.ts enxergue o mesmo
        // módulo de features (vi.resetModules garante consistência entre os dois).
        const featureSwitches = await import('../../config/featureSwitches');
        return featureSwitches;
    }
    describe('WHATSAPP_PROVIDER override persiste ao "reboot" (#1410)', () => {
        it('override persistido "moltbot" no uiConfig VENCE o env "legacy" pós-reboot', async () => {
            // Cenário pré-POST: env diz 'legacy'.
            process.env.WHATSAPP_PROVIDER = 'legacy';
            // "POST" — admin grava override persistido.
            mockUiConfig.get.mockReturnValue({ whatsappProvider: 'moltbot' });
            // "Reboot" — vi.resetModules() + re-import dispara resolveBootWhatsAppProvider() de novo.
            const mod = await importFeatures();
            const resolvers = await importResolvers();
            expect(mod.FEATURES.WHATSAPP_PROVIDER).toBe('moltbot');
            // getEffectiveWhatsAppProvider é o que channelRouter consome no construtor.
            expect(resolvers.getEffectiveWhatsAppProvider()).toBe('moltbot');
        });

        it('override persistido "legacy" no uiConfig VENCE o env "moltbot" pós-reboot', async () => {
            // Cenário pré-POST: env diz 'moltbot'.
            process.env.WHATSAPP_PROVIDER = 'moltbot';
            // "POST" — admin grava override persistido como 'legacy'.
            mockUiConfig.get.mockReturnValue({ whatsappProvider: 'legacy' });
            const mod = await importFeatures();
            const resolvers = await importResolvers();
            expect(mod.FEATURES.WHATSAPP_PROVIDER).toBe('legacy');
            expect(resolvers.getEffectiveWhatsAppProvider()).toBe('legacy');
        });

        it('sem override persistido, cai no env (default legacy quando env ausente)', async () => {
            delete process.env.WHATSAPP_PROVIDER;
            mockUiConfig.get.mockReturnValue({});
            const mod = await importFeatures();
            expect(mod.FEATURES.WHATSAPP_PROVIDER).toBe('legacy');
        });

        it('sem override persistido, env "moltbot" é respeitado (regressão #1410 critério #4)', async () => {
            process.env.WHATSAPP_PROVIDER = 'moltbot';
            mockUiConfig.get.mockReturnValue({});
            const mod = await importFeatures();
            expect(mod.FEATURES.WHATSAPP_PROVIDER).toBe('moltbot');
        });

        it('valor inválido persistido (ex.: "zapi") é descartado e cai no env', async () => {
            // sanity: arquivo antigo ou dado sujo em uiConfig.whatsappProvider não pode quebrar.
            process.env.WHATSAPP_PROVIDER = 'legacy';
            mockUiConfig.get.mockReturnValue({ whatsappProvider: 'zapi' as any });
            const mod = await importFeatures();
            expect(mod.FEATURES.WHATSAPP_PROVIDER).toBe('legacy');
        });
    });
});
