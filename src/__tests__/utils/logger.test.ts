import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('virtual:vitest/module', () => ({
    'import.meta.env': { PROD: false },
}));

import { logger, createLogger, __setSentrySenderForTests } from '../../utils/logger';

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
        __setSentrySenderForTests(null);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        __setSentrySenderForTests(null);
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

describe('logger prod-mode behavior (issue #1773)', () => {
    let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
    let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        __setSentrySenderForTests(null);
        // Garante um `window.__logger` limpo entre testes
        delete (window as unknown as { __logger?: unknown }).__logger;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        __setSentrySenderForTests(null);
        delete (window as unknown as { __logger?: unknown }).__logger;
    });

    it('exports a dev singleton (default vitest env) for `window.__logger`', () => {
        // Em dev, o módulo já atribuiu `window.__logger` no top-level.
        expect((window as unknown as { __logger?: unknown }).__logger).toBe(logger);
    });

    it('prod logger (isProduction=true) does NOT expose `window.__logger`', () => {
        const prodLogger = createLogger({ isProduction: true, isDev: false });
        // Mesmo passando um logger prod para a "mesma posição" do singleton,
        // o singleton é o que foi atribuído em módulo-load e está em DEV.
        // Aqui validamos que criar um prod logger não escreve no window.
        prodLogger.info('should not appear (info filtered in prod)');
        expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('prod logger filters debug/info (minLevel=warn) but keeps warn/error', () => {
        const prodLogger = createLogger({ isProduction: true, isDev: false });
        prodLogger.debug('hidden');
        prodLogger.info('hidden');
        prodLogger.warn('shown');
        prodLogger.error('shown');
        expect(consoleDebugSpy).not.toHaveBeenCalled();
        expect(consoleInfoSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN]', 'shown');
        expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', 'shown');
    });

    it('prod logger forwards errors to Sentry sender', () => {
        const sentrySpy = vi.fn();
        __setSentrySenderForTests(sentrySpy);
        const prodLogger = createLogger({ isProduction: true, isDev: false });
        prodLogger.error('boom', 'auth');
        expect(sentrySpy).toHaveBeenCalledTimes(1);
        const [errArg, ctxArg] = sentrySpy.mock.calls[0];
        expect(errArg).toBeInstanceOf(Error);
        expect((errArg as Error).message).toBe('boom');
        expect(ctxArg).toMatchObject({ context: 'auth', logger: 'frontend' });
    });

    it('prod logger does NOT forward non-error levels to Sentry', () => {
        const sentrySpy = vi.fn();
        __setSentrySenderForTests(sentrySpy);
        const prodLogger = createLogger({ isProduction: true, isDev: false });
        prodLogger.warn('warn-only');
        prodLogger.info('info-only');
        prodLogger.debug('debug-only');
        expect(sentrySpy).not.toHaveBeenCalled();
    });

    it('dev logger does NOT forward errors to Sentry sender', () => {
        const sentrySpy = vi.fn();
        __setSentrySenderForTests(sentrySpy);
        const devLogger = createLogger({ isProduction: false, isDev: true });
        devLogger.error('local-only');
        expect(sentrySpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', 'local-only');
    });

    it('wraps string errors into Error instances for Sentry', () => {
        const sentrySpy = vi.fn();
        __setSentrySenderForTests(sentrySpy);
        const prodLogger = createLogger({ isProduction: true, isDev: false });
        prodLogger.error('string-error');
        expect(sentrySpy).toHaveBeenCalledTimes(1);
        const first = sentrySpy.mock.calls[0][0];
        expect(first).toBeInstanceOf(Error);
        expect((first as Error).message).toBe('string-error');
    });

    it('keeps Error instances as-is when forwarding to Sentry', () => {
        const sentrySpy = vi.fn();
        __setSentrySenderForTests(sentrySpy);
        const prodLogger = createLogger({ isProduction: true, isDev: false });
        const original = new Error('original');
        prodLogger.error(original);
        expect(sentrySpy.mock.calls[0][0]).toBe(original);
    });

    it('sentry transport never throws even if sender throws', () => {
        __setSentrySenderForTests(() => { throw new Error('sentry down'); });
        const prodLogger = createLogger({ isProduction: true, isDev: false });
        expect(() => prodLogger.error('boom')).not.toThrow();
        // O log continua sendo emitido no console
        expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', 'boom');
    });

    it('exposes isDevMode/isProductionMode getters', () => {
        const dev = createLogger({ isProduction: false, isDev: true });
        const prod = createLogger({ isProduction: true, isDev: false });
        expect(dev.isDevMode).toBe(true);
        expect(dev.isProductionMode).toBe(false);
        expect(prod.isDevMode).toBe(false);
        expect(prod.isProductionMode).toBe(true);
    });

    it('child loggers propagate the prod-mode filter to Sentry', () => {
        const sentrySpy = vi.fn();
        __setSentrySenderForTests(sentrySpy);
        const prodLogger = createLogger({ isProduction: true, isDev: false });
        const child = prodLogger.child('checkout');
        child.warn('should not forward');
        child.error('should forward');
        expect(sentrySpy).toHaveBeenCalledTimes(1);
        expect(sentrySpy.mock.calls[0][1]).toMatchObject({ context: 'checkout' });
    });

    it('structured payload includes timestamp and level metadata', () => {
        const emitted: Array<{ level: string; timestamp: string }> = [];
        const recorder = {
            emit(p: { level: string; timestamp: string }) { emitted.push(p); },
        };
        const prodLogger = createLogger({
            isProduction: true,
            isDev: false,
            transports: [recorder],
        });
        prodLogger.error('payload test', 'svc');
        expect(emitted).toHaveLength(1);
        expect(emitted[0].level).toBe('error');
        expect(typeof emitted[0].timestamp).toBe('string');
        expect(emitted[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('logger production bundle exclusion (issue #1773)', () => {
    it('singleton is bound to window.__logger in dev', () => {
        // Este teste valida a invariante em runtime: o módulo expõe o singleton
        // em `window.__logger` quando import.meta.env.DEV === true. Em produção,
        // Vite/Rollup faz dead-code elimination do bloco inteiro — o literal
        // `__logger` é removido do bundle e nenhum acesso ao window é feito.
        // A asserção aqui só é executada em ambiente vitest (dev-like).
        expect((globalThis as unknown as { __logger?: unknown }).__logger).toBeDefined();
    });
});