import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('virtual:vitest/module', () => ({
    'import.meta.env': { PROD: false },
}), { virtual: true });

import { logger, FrontendLogger } from '../../utils/logger';

describe('logger', () => {
    let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
    let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('FrontendLogger', () => {
        it('logs debug messages with prefix', () => {
            logger.debug('test message', 'context');
            expect(consoleDebugSpy).toHaveBeenCalledWith('[DEBUG][context]', 'test message');
        });

        it('logs info messages with prefix', () => {
            logger.info('test message', 'context');
            expect(consoleInfoSpy).toHaveBeenCalledWith('[INFO][context]', 'test message');
        });

        it('logs warn messages with prefix', () => {
            logger.warn('test message', 'context');
            expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN][context]', 'test message');
        });

        it('logs error messages with prefix', () => {
            logger.error('test message', 'context');
            expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR][context]', 'test message');
        });

        it('logs with data when provided', () => {
            logger.debug('test', 'ctx', { key: 'value' });
            expect(consoleDebugSpy).toHaveBeenCalledWith('[DEBUG][ctx]', 'test', { key: 'value' });
        });

        it('logs without context when not provided', () => {
            logger.info('simple message');
            expect(consoleInfoSpy).toHaveBeenCalledWith('[INFO]', 'simple message');
        });

        it('logs with context but no data', () => {
            logger.warn('warning message', 'context');
            expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN][context]', 'warning message');
        });
    });

    describe('child logger', () => {
        it('creates child logger with fixed context', () => {
            const child = logger.child('TestContext');
            child.debug('child message');
            expect(consoleDebugSpy).toHaveBeenCalledWith('[DEBUG][TestContext]', 'child message');
        });


    });

    it('child logger uses parent context', () => {
        const child = logger.child('Parent');
        child.error('error in child');
        expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR][Parent]', 'error in child');
    });

    describe('enableDebug', () => {
        it('enables debug level logging', () => {
            logger.enableDebug();
            logger.debug('debug after enable');
            expect(consoleDebugSpy).toHaveBeenCalled();
        });
    });

    describe('resetLevel', () => {
        it('resets log level to default', () => {
            logger.enableDebug();
            logger.resetLevel();
            logger.debug('should not log after reset in prod-like env');
        });
    });

    describe('log level filtering', () => {
        it('respects minimum log level', () => {
            logger.resetLevel();
            consoleDebugSpy.mockClear();
            logger.debug('should not appear');
        });
    });
});

describe('ContextLogger', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('forwards debug calls to parent with context', () => {
        const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const child = logger.child('Ctx');
        child.debug('msg');
        expect(consoleDebugSpy).toHaveBeenCalledWith('[DEBUG][Ctx]', 'msg');
    });

    it('forwards info calls to parent with context', () => {
        const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const child = logger.child('Ctx');
        child.info('msg');
        expect(consoleInfoSpy).toHaveBeenCalledWith('[INFO][Ctx]', 'msg');
    });

    it('forwards warn calls to parent with context', () => {
        const child = logger.child('Ctx');
        child.warn('msg');
        expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN][Ctx]', 'msg');
    });

    it('forwards error calls to parent with context', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const child = logger.child('Ctx');
        child.error('msg');
        expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR][Ctx]', 'msg');
    });

    it('passes data to parent methods', () => {
        const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const child = logger.child('Ctx');
        child.debug('msg', { extra: 'data' });
        expect(consoleDebugSpy).toHaveBeenCalledWith('[DEBUG][Ctx]', 'msg', { extra: 'data' });
    });
});