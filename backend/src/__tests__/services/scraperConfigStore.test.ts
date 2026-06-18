import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isola do disco: nunca lê arquivo na carga; nunca escreve de verdade.
vi.mock('fs', () => {
    const m = { existsSync: vi.fn(() => false), mkdirSync: vi.fn(), readFileSync: vi.fn() };
    return { ...m, default: m };
});
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));

import { scraperConfigStore, DEFAULT_SCRAPER_CONFIG } from '../../services/scraperConfigStore';

describe('scraperConfigStore', () => {
    beforeEach(() => {
        // reseta o singleton para os defaults antes de cada caso
        scraperConfigStore.updateConfig(structuredClone(DEFAULT_SCRAPER_CONFIG));
    });

    it('returns defaults (all sources enabled, 6h, autoRun)', () => {
        const cfg = scraperConfigStore.getConfig();
        expect(cfg.autoRun).toBe(true);
        expect(cfg.intervalHours).toBe(6);
        expect(cfg.sources.sympla.enabled).toBe(true);
        expect(cfg.sources.shotgun.enabled).toBe(true);
        expect(cfg.sources.blacktag.enabled).toBe(true);
    });

    it('getConfig returns a copy (no external mutation)', () => {
        const cfg = scraperConfigStore.getConfig();
        cfg.intervalHours = 999;
        cfg.sources.sympla.enabled = false;
        expect(scraperConfigStore.getConfig().intervalHours).toBe(6);
        expect(scraperConfigStore.getConfig().sources.sympla.enabled).toBe(true);
    });

    it('toggles a single source without touching the others', () => {
        const out = scraperConfigStore.updateConfig({ sources: { shotgun: { enabled: false } } });
        expect(out.sources.shotgun.enabled).toBe(false);
        expect(out.sources.sympla.enabled).toBe(true);
        expect(out.sources.blacktag.enabled).toBe(true);
    });

    it('clamps intervalHours to [1, 168]', () => {
        expect(scraperConfigStore.updateConfig({ intervalHours: 0 }).intervalHours).toBe(1);
        expect(scraperConfigStore.updateConfig({ intervalHours: 9999 }).intervalHours).toBe(168);
    });

    it('updates a source URL and clamps maxPages', () => {
        const out = scraperConfigStore.updateConfig({
            sources: { sympla: { url: 'https://www.sympla.com.br/eventos/rio-de-janeiro-rj', maxPages: 99 } },
        });
        expect(out.sources.sympla.url).toContain('rio-de-janeiro');
        expect(out.sources.sympla.maxPages).toBe(10);
    });

    it('ignores a non-http url (keeps previous)', () => {
        const prev = scraperConfigStore.getConfig().sources.blacktag.url;
        const out = scraperConfigStore.updateConfig({ sources: { blacktag: { url: 'javascript:alert(1)' } } });
        expect(out.sources.blacktag.url).toBe(prev);
    });

    it('toggles autoRun', () => {
        expect(scraperConfigStore.updateConfig({ autoRun: false }).autoRun).toBe(false);
    });
});
