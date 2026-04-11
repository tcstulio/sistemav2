import { describe, it, expect, vi } from 'vitest';

describe('Backend test infrastructure', () => {
    it('vitest is working', () => {
        expect(1 + 1).toBe(2);
    });

    it('can mock modules', () => {
        const fn = vi.fn();
        fn.mockReturnValue('mocked');
        expect(fn()).toBe('mocked');
    });

    it('logger mock works', async () => {
        const { logger } = await import('../utils/logger');
        expect(typeof logger.info).toBe('function');
        logger.info('test');
    });

    it('sentry mock works', async () => {
        const { initSentry } = await import('../utils/sentry');
        expect(typeof initSentry).toBe('function');
    });
});
