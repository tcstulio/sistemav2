import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock do uiConfigService p/ controlar o toggle de admin sem tocar disco.
const mockUiConfig = vi.hoisted(() => ({
    get: vi.fn(() => ({ featureSwitches: { dryRunMode: false, financialCommands: false, crmContextInjection: true } })),
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: mockUiConfig }));
vi.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('featureSwitches — resolvers de runtime (#1129)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
        mockUiConfig.get.mockReturnValue({
            featureSwitches: { dryRunMode: false, financialCommands: false, crmContextInjection: true },
        });
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    async function importResolvers() {
        vi.resetModules();
        const mod = await import('../../config/featureSwitches');
        return mod;
    }

    describe('isDryRunEnabled', () => {
        it('desligado por padrão (env ausente + toggle off)', async () => {
            delete process.env.DRY_RUN_MODE;
            const { isDryRunEnabled } = await importResolvers();
            expect(isDryRunEnabled()).toBe(false);
        });

        it('ligado via env DRY_RUN_MODE=true (fallback)', async () => {
            process.env.DRY_RUN_MODE = 'true';
            const { isDryRunEnabled } = await importResolvers();
            expect(isDryRunEnabled()).toBe(true);
        });

        it('ligado via toggle de UI (efeito imediato, sem restart)', async () => {
            delete process.env.DRY_RUN_MODE;
            const { isDryRunEnabled } = await importResolvers();
            mockUiConfig.get.mockReturnValue({
                featureSwitches: { dryRunMode: true, financialCommands: false, crmContextInjection: true },
            });
            expect(isDryRunEnabled()).toBe(true);
        });

        it('env liga mesmo se toggle estiver off (OR)', async () => {
            process.env.DRY_RUN_MODE = 'true';
            const { isDryRunEnabled } = await importResolvers();
            mockUiConfig.get.mockReturnValue({
                featureSwitches: { dryRunMode: false, financialCommands: false, crmContextInjection: true },
            });
            expect(isDryRunEnabled()).toBe(true);
        });
    });

    describe('isFinancialCommandsEnabled', () => {
        it('desligado por padrão (secure-default OFF)', async () => {
            delete process.env.FINANCIAL_COMMANDS_ENABLED;
            const { isFinancialCommandsEnabled } = await importResolvers();
            expect(isFinancialCommandsEnabled()).toBe(false);
        });

        it('ligado via env FINANCIAL_COMMANDS_ENABLED=true', async () => {
            process.env.FINANCIAL_COMMANDS_ENABLED = 'true';
            const { isFinancialCommandsEnabled } = await importResolvers();
            expect(isFinancialCommandsEnabled()).toBe(true);
        });

        it('ligado via toggle de UI', async () => {
            delete process.env.FINANCIAL_COMMANDS_ENABLED;
            const { isFinancialCommandsEnabled } = await importResolvers();
            mockUiConfig.get.mockReturnValue({
                featureSwitches: { dryRunMode: false, financialCommands: true, crmContextInjection: true },
            });
            expect(isFinancialCommandsEnabled()).toBe(true);
        });
    });

    describe('isCrmContextInjectionEnabled', () => {
        it('ligado por padrão (preserva comportamento histórico)', async () => {
            delete process.env.CRM_CONTEXT_INJECTION;
            const { isCrmContextInjectionEnabled } = await importResolvers();
            expect(isCrmContextInjectionEnabled()).toBe(true);
        });

        it('desligado via env CRM_CONTEXT_INJECTION=false (kill-switch de privacidade)', async () => {
            process.env.CRM_CONTEXT_INJECTION = 'false';
            const { isCrmContextInjectionEnabled } = await importResolvers();
            expect(isCrmContextInjectionEnabled()).toBe(false);
        });

        it('desligado via toggle de UI (admin corta injeção no LLM em runtime)', async () => {
            delete process.env.CRM_CONTEXT_INJECTION;
            const { isCrmContextInjectionEnabled } = await importResolvers();
            mockUiConfig.get.mockReturnValue({
                featureSwitches: { dryRunMode: false, financialCommands: false, crmContextInjection: false },
            });
            expect(isCrmContextInjectionEnabled()).toBe(false);
        });

        it('env OU toggle desligando basta para cortar (semântica AND)', async () => {
            delete process.env.CRM_CONTEXT_INJECTION;
            const { isCrmContextInjectionEnabled } = await importResolvers();
            // toggle off, env default on → desligado
            mockUiConfig.get.mockReturnValue({
                featureSwitches: { dryRunMode: false, financialCommands: false, crmContextInjection: false },
            });
            expect(isCrmContextInjectionEnabled()).toBe(false);
        });
    });
});
