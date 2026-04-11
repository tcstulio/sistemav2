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
        child: vi.fn(),
    },
    default: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
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
            interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
        })),
    },
}));
