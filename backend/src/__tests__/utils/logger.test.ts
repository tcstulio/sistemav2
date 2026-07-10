import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.unmock('../../utils/logger');

const { mockPinoInstance, pinoMock } = vi.hoisted(() => {
    const instance = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    };
    const mock = vi.fn(() => instance);
    return { mockPinoInstance: instance, pinoMock: mock };
});

vi.mock('pino', () => ({
    default: (...args: any[]) => pinoMock(...args),
}));

import { createLogger, logger, getRecentLogs, getRecentLogEntries, clearLogBuffer } from '../../utils/logger';

describe('createLogger', () => {
    beforeEach(() => {
        mockPinoInstance.info.mockClear();
    });

    it('returns a Logger with context', () => {
        const ctxLogger = createLogger('MyContext');
        ctxLogger.info('hello');
        expect(mockPinoInstance.info).toHaveBeenCalledWith({
            msg: '[MyContext] hello',
            context: 'MyContext',
        });
    });
});

describe('logger (default singleton)', () => {
    beforeEach(() => {
        mockPinoInstance.info.mockClear();
    });

    it('has no context', () => {
        logger.info('plain message');
        expect(mockPinoInstance.info).toHaveBeenCalledWith({
            msg: 'plain message',
        });
    });
});

describe('log methods', () => {
    const levels = ['debug', 'info', 'warn', 'error', 'fatal'] as const;

    beforeEach(() => {
        levels.forEach((level) => mockPinoInstance[level].mockClear());
    });

    levels.forEach((level) => {
        it(`${level}() calls pino.${level}`, () => {
            const ctxLogger = createLogger('Ctx');
            ctxLogger[level]('test message');
            expect(mockPinoInstance[level]).toHaveBeenCalledWith(
                expect.objectContaining({ msg: '[Ctx] test message' }),
            );
        });
    });
});

describe('enrich', () => {
    beforeEach(() => {
        mockPinoInstance.info.mockClear();
    });

    it('prepends context to message when context exists', () => {
        const ctxLogger = createLogger('App');
        ctxLogger.info('doing work');
        expect(mockPinoInstance.info).toHaveBeenCalledWith(
            expect.objectContaining({ msg: '[App] doing work' }),
        );
    });

    it('does not add context when no context', () => {
        logger.info('doing work');
        const callArgs = mockPinoInstance.info.mock.calls[0][0];
        expect(callArgs).toEqual({ msg: 'doing work' });
    });

    it('includes data when provided', () => {
        const ctxLogger = createLogger('Ctx');
        ctxLogger.info('msg', { key: 'value' });
        expect(mockPinoInstance.info).toHaveBeenCalledWith({
            msg: '[Ctx] msg',
            context: 'Ctx',
            data: { key: 'value' },
        });
    });

    it('does not include data when undefined', () => {
        const ctxLogger = createLogger('Ctx');
        ctxLogger.info('msg');
        const callArgs = mockPinoInstance.info.mock.calls[0][0];
        expect('data' in callArgs).toBe(false);
    });
});

describe('child', () => {
    beforeEach(() => {
        mockPinoInstance.info.mockClear();
    });

    it('creates nested context (parent:child)', () => {
        const parent = createLogger('Parent');
        const child = parent.child('Child');
        child.info('nested');
        expect(mockPinoInstance.info).toHaveBeenCalledWith({
            msg: '[Parent:Child] nested',
            context: 'Parent:Child',
        });
    });

    it('uses context directly on root logger', () => {
        const child = logger.child('RootChild');
        child.info('orphan');
        expect(mockPinoInstance.info).toHaveBeenCalledWith({
            msg: '[RootChild] orphan',
            context: 'RootChild',
        });
    });
});

describe('in-memory log buffer', () => {
    beforeEach(() => {
        clearLogBuffer();
    });

    it('getRecentLogEntries retorna entradas estruturadas (timestamp ISO, level, message, meta)', () => {
        logger.info('hello', { k: 'v' });

        const entries = getRecentLogEntries(50);

        expect(entries).toHaveLength(1);
        expect(entries[0].level).toBe('info');
        expect(entries[0].message).toBe('hello');
        expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(entries[0].meta).toEqual({ k: 'v' });
    });

    it('getRecentLogEntries preserva o contexto no message', () => {
        const ctx = createLogger('Ctx');
        ctx.warn('doing work');

        const entries = getRecentLogEntries(50);

        expect(entries[0].level).toBe('warn');
        expect(entries[0].message).toBe('[Ctx] doing work');
    });

    it('entries sem data não possuem meta', () => {
        logger.info('plain');

        const entries = getRecentLogEntries(50);

        expect(entries[0].meta).toBeUndefined();
    });

    it('getRecentLogs retorna strings formatadas (compatibilidade com agentTools)', () => {
        logger.error('boom', { code: 'X' });

        const lines = getRecentLogs(50);

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[ERROR\] boom \{"code":"X"\}$/);
    });

    it('getRecentLogs preserva o formato de data string data (não JSON-stringify)', () => {
        logger.info('msg', 'raw-string-data');

        const lines = getRecentLogs(50);

        expect(lines[0]).toMatch(/\[INFO\] msg raw-string-data$/);
    });

    it('filtra por nível retornando o subset correto', () => {
        logger.info('i');
        logger.warn('w');
        logger.error('e');

        const errors = getRecentLogEntries(50).filter((e) => e.level === 'error');

        expect(errors).toHaveLength(1);
        expect(errors[0].message).toBe('e');
    });

    it('limita a N linhas (mais recentes)', () => {
        for (let i = 0; i < 5; i++) logger.info(`m${i}`);

        const entries = getRecentLogEntries(3);

        expect(entries).toHaveLength(3);
        expect(entries[2].message).toBe('m4');
    });

    it('buffer é limitado a MAX_LOG_BUFFER entradas (FIFO)', () => {
        for (let i = 0; i < 501; i++) logger.info(`m${i}`);

        const entries = getRecentLogEntries(1000);

        expect(entries).toHaveLength(500);
        expect(entries[0].message).toBe('m1');
        expect(entries[499].message).toBe('m500');
    });
});

describe('pino configuration', () => {
    it('uses debug level and pino-pretty transport in non-production', () => {
        expect(pinoMock).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'debug',
                transport: expect.objectContaining({
                    target: 'pino-pretty',
                }),
            }),
        );
    });

    it('uses info level and no transport in production', async () => {
        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        vi.resetModules();

        const prodPinoMock = vi.fn(() => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }));

        vi.doMock('pino', () => ({
            default: (...args: any[]) => prodPinoMock(...args),
        }));
        vi.doUnmock('../../utils/logger');

        await import('../../utils/logger');

        expect(prodPinoMock).toHaveBeenCalledWith(
            expect.objectContaining({ level: 'info' }),
        );
        const callArg = prodPinoMock.mock.calls[0][0];
        expect(callArg.transport).toBeUndefined();

        process.env.NODE_ENV = origEnv;
    });

    it('respects LOG_LEVEL env var', async () => {
        const origLogLevel = process.env.LOG_LEVEL;
        const origEnv = process.env.NODE_ENV;
        process.env.LOG_LEVEL = 'warn';
        delete process.env.NODE_ENV;
        vi.resetModules();

        const llPinoMock = vi.fn(() => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }));

        vi.doMock('pino', () => ({
            default: (...args: any[]) => llPinoMock(...args),
        }));
        vi.doUnmock('../../utils/logger');

        await import('../../utils/logger');

        expect(llPinoMock).toHaveBeenCalledWith(
            expect.objectContaining({ level: 'warn' }),
        );

        process.env.LOG_LEVEL = origLogLevel;
        process.env.NODE_ENV = origEnv;
    });
});
