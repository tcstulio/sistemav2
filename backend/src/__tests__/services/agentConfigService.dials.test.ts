/**
 * #1408 — Testes da resolução REAL dos dials no agentConfigService (não mockado):
 *  - `getMaxToolCalls()`: default (config service é a fonte de verdade), lê do profile carregado,
 *    OVERRIDE de COLD-START via AGENT_MAX_ITERATIONS (decisão do critério 4) e clamp defensivo.
 *  - `requiresConfirmation()`: reflete a lista `requireConfirmationFor` do profile.
 *
 * O profile é semeado direto no singleton (`(svc as any).profile`) — o carregamento real via
 * refresh()/Dolibarr não é o objeto sob teste aqui, e o `require()` lazy de dolibarrService não
 * é interceptável pelo vitest. Semear o estado privado isola a lógica de resolução.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// env mockado e MUTÁVEL — simula o valor de cold-start de AGENT_MAX_ITERATIONS.
const envConfig = vi.hoisted(() => ({ config: { agentMaxIterations: null as number | null } }));
vi.mock('../../config/env', () => envConfig);
vi.mock('../../services/agentPromptStore', () => ({
    agentPromptStore: { getBasePrompt: vi.fn(() => '') },
}));

import { agentConfigService } from '../../services/agentConfigService';

const DEFAULT_MAX = 50; // igual ao DEFAULT_CONFIG.maxToolCallsPerConversation

/** Semeia o profile privado do singleton com um config parcial (só o que os dials leem). */
function seedConfig(cfg: { maxToolCallsPerConversation?: number; requireConfirmationFor?: string[] }) {
    (agentConfigService as any).profile = { config: cfg };
}

describe('#1408 — agentConfigService.getMaxToolCalls (fonte de verdade + override)', () => {
    beforeEach(() => {
        envConfig.config.agentMaxIterations = null;
        (agentConfigService as any).profile = null;
    });

    it('default (sem override, sem profile): usa o default do config service', () => {
        expect(agentConfigService.getMaxToolCalls()).toBe(DEFAULT_MAX);
    });

    it('lê maxToolCallsPerConversation do profile carregado (config service manda)', () => {
        seedConfig({ maxToolCallsPerConversation: 7 });
        expect(agentConfigService.getMaxToolCalls()).toBe(7);
    });

    it('AGENT_MAX_ITERATIONS (cold-start) VENCE o config quando definido', () => {
        seedConfig({ maxToolCallsPerConversation: 7 });
        envConfig.config.agentMaxIterations = 3; // override de cold-start
        expect(agentConfigService.getMaxToolCalls()).toBe(3);
    });

    it('clamp defensivo: valores absurdos são limitados a [1, 200]', () => {
        seedConfig({ maxToolCallsPerConversation: 100000 });
        expect(agentConfigService.getMaxToolCalls()).toBe(200);

        seedConfig({ maxToolCallsPerConversation: 0 });
        expect(agentConfigService.getMaxToolCalls()).toBe(1);
    });
});

describe('#1408 — agentConfigService.requiresConfirmation (gate)', () => {
    beforeEach(() => {
        envConfig.config.agentMaxIterations = null;
        (agentConfigService as any).profile = null;
    });

    it('reflete a lista requireConfirmationFor do profile', () => {
        seedConfig({ requireConfirmationFor: ['deleteInvoice', 'validate_invoice'] });
        expect(agentConfigService.requiresConfirmation('deleteInvoice')).toBe(true);
        expect(agentConfigService.requiresConfirmation('validate_invoice')).toBe(true);
        expect(agentConfigService.requiresConfirmation('list_users')).toBe(false);
    });

    it('sem profile (default): nenhuma tool exige confirmação', () => {
        expect(agentConfigService.requiresConfirmation('deleteInvoice')).toBe(false);
    });
});
