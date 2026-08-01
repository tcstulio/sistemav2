import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.unmock('../../utils/logger');

const {
    mockWinstonInstance,
    createLoggerSpy,
    consoleTransportSpy,
    dailyRotateSpy,
    combineSpy,
    timestampSpy,
    errorsSpy,
    jsonSpy,
    colorizeSpy,
    printfSpy,
} = vi.hoisted(() => {
    const instance = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        log: vi.fn(),
    };
    return {
        mockWinstonInstance: instance,
        createLoggerSpy: vi.fn(() => instance),
        consoleTransportSpy: vi.fn(),
        dailyRotateSpy: vi.fn(),
        combineSpy: vi.fn((...formats: unknown[]) => ({ kind: 'combine', formats })),
        timestampSpy: vi.fn(() => ({ kind: 'timestamp' })),
        errorsSpy: vi.fn(() => ({ kind: 'errors' })),
        jsonSpy: vi.fn(() => ({ kind: 'json' })),
        colorizeSpy: vi.fn(() => ({ kind: 'colorize' })),
        printfSpy: vi.fn((formatter: unknown) => ({ kind: 'printf', formatter })),
    };
});

vi.mock('winston', () => {
    function ConsoleMock(this: unknown, ...args: unknown[]) {
        consoleTransportSpy(...args);
    }
    const format = {
        combine: (...args: unknown[]) => combineSpy(...args),
        timestamp: () => timestampSpy(),
        errors: () => errorsSpy(),
        json: () => jsonSpy(),
        colorize: () => colorizeSpy(),
        printf: (formatter: unknown) => printfSpy(formatter),
    };
    const transports = { Console: ConsoleMock };
    return {
        default: {
            createLogger: (...args: unknown[]) => createLoggerSpy(...args),
            format,
            transports,
        },
        format,
        transports,
    };
});

vi.mock('winston-daily-rotate-file', () => {
    function DailyRotateFileMock(this: unknown, ...args: unknown[]) {
        dailyRotateSpy(...args);
    }
    return { default: DailyRotateFileMock };
});

import { createLogger, logger, getRecentLogs, getRecentLogEntries, clearLogBuffer } from '../../utils/logger';

const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_FORMAT: process.env.LOG_FORMAT,
};

function setEnvironment(name: keyof typeof originalEnvironment, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}

async function loadLoggerWithEnvironment(environment: Partial<typeof originalEnvironment>): Promise<void> {
    setEnvironment('NODE_ENV', environment.NODE_ENV);
    setEnvironment('LOG_LEVEL', environment.LOG_LEVEL);
    setEnvironment('LOG_FORMAT', environment.LOG_FORMAT);
    createLoggerSpy.mockClear();
    consoleTransportSpy.mockClear();
    dailyRotateSpy.mockClear();
    combineSpy.mockClear();
    timestampSpy.mockClear();
    errorsSpy.mockClear();
    jsonSpy.mockClear();
    colorizeSpy.mockClear();
    printfSpy.mockClear();
    vi.resetModules();
    await import('../../utils/logger');
}

afterEach(() => {
    setEnvironment('NODE_ENV', originalEnvironment.NODE_ENV);
    setEnvironment('LOG_LEVEL', originalEnvironment.LOG_LEVEL);
    setEnvironment('LOG_FORMAT', originalEnvironment.LOG_FORMAT);
});

describe('createLogger', () => {
    beforeEach(() => {
        mockWinstonInstance.log.mockClear();
    });

    it('returns a Logger with context', () => {
        const ctxLogger = createLogger('MyContext');
        ctxLogger.info('hello');
        expect(mockWinstonInstance.log).toHaveBeenCalledWith(
            'info',
            '[MyContext] hello',
            expect.objectContaining({ context: 'MyContext' }),
        );
    });
});

describe('logger (default singleton)', () => {
    beforeEach(() => {
        mockWinstonInstance.log.mockClear();
    });

    it('has no context', () => {
        logger.info('plain message');
        expect(mockWinstonInstance.log).toHaveBeenCalledWith('info', 'plain message', undefined);
    });
});

describe('log methods', () => {
    const levels: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error'];

    beforeEach(() => {
        mockWinstonInstance.log.mockClear();
    });

    levels.forEach((level) => {
        it(`${level}() calls winston.log with level ${level}`, () => {
            const ctxLogger = createLogger('Ctx');
            ctxLogger[level]('test message');
            expect(mockWinstonInstance.log).toHaveBeenCalledWith(
                level,
                '[Ctx] test message',
                expect.objectContaining({ context: 'Ctx' }),
            );
        });
    });

    it('fatal() maps to error level (kept for backward compat with previous pino API)', () => {
        const ctxLogger = createLogger('Ctx');
        ctxLogger.fatal('boom');
        expect(mockWinstonInstance.log).toHaveBeenCalledWith(
            'error',
            '[Ctx] boom',
            expect.objectContaining({ context: 'Ctx' }),
        );
    });
});

describe('enrich', () => {
    beforeEach(() => {
        mockWinstonInstance.log.mockClear();
    });

    it('prepends context to message when context exists', () => {
        const ctxLogger = createLogger('App');
        ctxLogger.info('doing work');
        expect(mockWinstonInstance.log).toHaveBeenCalledWith(
            'info',
            '[App] doing work',
            expect.objectContaining({ context: 'App' }),
        );
    });

    it('does not add context when no context', () => {
        logger.info('doing work');
        const callArgs = mockWinstonInstance.log.mock.calls[0];
        expect(callArgs[1]).toBe('doing work');
        expect(callArgs[2]).toBeUndefined();
    });

    it('includes data when provided', () => {
        const ctxLogger = createLogger('Ctx');
        ctxLogger.info('msg', { key: 'value' });
        expect(mockWinstonInstance.log).toHaveBeenCalledWith(
            'info',
            '[Ctx] msg',
            expect.objectContaining({ context: 'Ctx', data: { key: 'value' } }),
        );
    });

    it('does not include data when undefined', () => {
        const ctxLogger = createLogger('Ctx');
        ctxLogger.info('msg');
        const meta = mockWinstonInstance.log.mock.calls[0][2] as Record<string, unknown> | undefined;
        expect(meta).toBeDefined();
        expect(meta).not.toHaveProperty('data');
    });
});

describe('child', () => {
    beforeEach(() => {
        mockWinstonInstance.log.mockClear();
    });

    it('creates nested context (parent:child)', () => {
        const parent = createLogger('Parent');
        const child = parent.child('Child');
        child.info('nested');
        expect(mockWinstonInstance.log).toHaveBeenCalledWith(
            'info',
            '[Parent:Child] nested',
            expect.objectContaining({ context: 'Parent:Child' }),
        );
    });

    it('uses context directly on root logger', () => {
        const child = logger.child('RootChild');
        child.info('orphan');
        expect(mockWinstonInstance.log).toHaveBeenCalledWith(
            'info',
            '[RootChild] orphan',
            expect.objectContaining({ context: 'RootChild' }),
        );
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

describe('winston configuration', () => {
    type MockFormat = {
        kind: string;
        formats?: MockFormat[];
        formatter?: (info: { timestamp: string; level: string; message: string }) => string;
    };

    function getLoggerConfiguration(): { level: string; format: unknown; transports: unknown[] } {
        return createLoggerSpy.mock.calls[0][0] as { level: string; format: unknown; transports: unknown[] };
    }

    function getDailyRotateOptions(): Record<string, unknown> & { format: MockFormat } {
        return dailyRotateSpy.mock.calls[0][0] as Record<string, unknown> & { format: MockFormat };
    }

    it('creates the logger with the default info level and configured transports', async () => {
        await loadLoggerWithEnvironment({ NODE_ENV: 'development' });

        const configuration = getLoggerConfiguration();
        expect(configuration.level).toBe('info');
        expect(configuration.format).toBeDefined();
        expect(configuration.transports).toHaveLength(2);
    });

    it('includes a colorized Console transport only outside production', async () => {
        await loadLoggerWithEnvironment({ NODE_ENV: 'development' });

        expect(consoleTransportSpy).toHaveBeenCalledOnce();
        const consoleOptions = consoleTransportSpy.mock.calls[0][0] as { format: MockFormat };
        expect(consoleOptions.format.formats?.some((format) => format.kind === 'colorize')).toBe(true);

        await loadLoggerWithEnvironment({ NODE_ENV: 'production' });

        expect(consoleTransportSpy).not.toHaveBeenCalled();
        expect(getLoggerConfiguration().transports).toHaveLength(1);
    });

    it('configures daily file rotation and fourteen-day retention', async () => {
        await loadLoggerWithEnvironment({ NODE_ENV: 'production' });

        expect(dailyRotateSpy).toHaveBeenCalledOnce();
        const options = getDailyRotateOptions();
        expect(options.dirname).toBe('logs');
        expect(options.filename).toBe('app-%DATE%.log');
        expect(options.datePattern).toBe('YYYY-MM-DD');
        expect(options.maxFiles).toBe('14d');
    });

    it('uses JSON format when LOG_FORMAT=json', async () => {
        await loadLoggerWithEnvironment({ NODE_ENV: 'production', LOG_FORMAT: 'json' });

        const fileFormat = getDailyRotateOptions().format;
        expect(fileFormat.formats?.some((format) => format.kind === 'json')).toBe(true);
    });

    it('uses a human-readable timestamp, level and message by default', async () => {
        await loadLoggerWithEnvironment({ NODE_ENV: 'production' });

        const fileFormat = getDailyRotateOptions().format;
        expect(fileFormat.formats?.some((format) => format.kind === 'printf')).toBe(true);
        const formatter = printfSpy.mock.results[0].value.formatter as MockFormat['formatter'];
        expect(formatter?.({ timestamp: '2026-08-01T12:00:00.000Z', level: 'info', message: 'ready' }))
            .toBe('2026-08-01T12:00:00.000Z [INFO] ready');
    });

    it.each(['debug', 'info', 'warn', 'error'])('accepts LOG_LEVEL=%s', async (level) => {
        await loadLoggerWithEnvironment({ NODE_ENV: 'production', LOG_LEVEL: level });

        expect(getLoggerConfiguration().level).toBe(level);
    });

    it('falls back to info for an invalid LOG_LEVEL', async () => {
        await loadLoggerWithEnvironment({ NODE_ENV: 'production', LOG_LEVEL: 'verbose' });

        expect(getLoggerConfiguration().level).toBe('info');
    });
});
