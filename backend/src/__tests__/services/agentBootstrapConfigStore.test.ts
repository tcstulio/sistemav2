import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => {
    const m = { existsSync: vi.fn(() => false), mkdirSync: vi.fn(), readFileSync: vi.fn() };
    return { ...m, default: m };
});
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));

import { agentBootstrapConfigStore, DEFAULT_BOOTSTRAP_CONFIG } from '../../services/agentBootstrapConfigStore';

describe('agentBootstrapConfigStore', () => {
    beforeEach(() => {
        agentBootstrapConfigStore.updateConfig({ ...DEFAULT_BOOTSTRAP_CONFIG });
    });

    it('returns defaults (enabled, all sources on)', () => {
        const cfg = agentBootstrapConfigStore.getConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.includeTasks).toBe(true);
        expect(cfg.includeAgenda).toBe(true);
        expect(cfg.includeFinancial).toBe(true);
    });

    it('getConfig returns a copy (no external mutation)', () => {
        const cfg = agentBootstrapConfigStore.getConfig();
        cfg.enabled = false;
        expect(agentBootstrapConfigStore.getConfig().enabled).toBe(true);
    });

    it('toggles individual flags', () => {
        const out = agentBootstrapConfigStore.updateConfig({ enabled: false, includeFinancial: false });
        expect(out.enabled).toBe(false);
        expect(out.includeFinancial).toBe(false);
        expect(out.includeTasks).toBe(true); // preservado
    });

    it('persists the extra instruction (clamped to 2000 chars)', () => {
        const out = agentBootstrapConfigStore.updateConfig({ extraInstruction: 'foco em prazos' });
        expect(out.extraInstruction).toBe('foco em prazos');
        const long = agentBootstrapConfigStore.updateConfig({ extraInstruction: 'x'.repeat(5000) });
        expect(long.extraInstruction.length).toBe(2000);
    });

    it('ignores non-boolean flag values', () => {
        const out = agentBootstrapConfigStore.updateConfig({ enabled: 'sim' as any });
        expect(out.enabled).toBe(true); // mantém o valor válido anterior
    });
});
