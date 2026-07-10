import { vi } from 'vitest';

vi.mock('../utils/logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(() => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        })),
    }),
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(() => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        })),
    },
    default: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(() => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        })),
    },
}));

vi.mock('../utils/sentry', () => ({
    initSentry: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    getSentryRequestHandler: vi.fn(() => null),
    Sentry: {
        init: vi.fn(),
        captureException: vi.fn(),
        captureMessage: vi.fn(),
    },
}));

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        patch: vi.fn(),
        create: vi.fn(() => ({
            get: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
            patch: vi.fn(),
            request: vi.fn(),
            interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
        })),
    },
}));

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() => Buffer.from('test')),
        writeFileSync: vi.fn(),
        renameSync: vi.fn(),
        unlinkSync: vi.fn(),
        readdirSync: vi.fn(() => []),
        mkdirSync: vi.fn(),
    },
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => Buffer.from('test')),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    mkdirSync: vi.fn(),
}));

vi.mock('https', () => {
    // https.Agent must be a constructor (used with `new`), so we use a regular function.
    function AgentMock(_options?: any) {
        return {};
    }
    return {
        default: { Agent: AgentMock },
        Agent: AgentMock,
    };
});
