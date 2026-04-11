import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.unmock('../../utils/sentry');

describe('sentry utils', () => {
    let sentry: typeof import('../../utils/sentry');
    let mockSentry: any;

    beforeEach(async () => {
        vi.resetModules();
        delete process.env.SENTRY_DSN;
        delete process.env.NODE_ENV;
        delete process.env.APP_VERSION;

        mockSentry = {
            init: vi.fn(),
            captureException: vi.fn(),
            captureMessage: vi.fn(),
            httpIntegration: vi.fn(() => 'http'),
            expressIntegration: vi.fn(() => 'express'),
            nodeContextIntegration: vi.fn(() => 'nodeContext'),
            setupExpressErrorHandler: vi.fn(),
        };

        vi.doMock('@sentry/node', () => mockSentry);
        vi.doUnmock('../../utils/sentry');

        sentry = await import('../../utils/sentry');
    });

    afterEach(() => {
        delete process.env.SENTRY_DSN;
        delete process.env.NODE_ENV;
        delete process.env.APP_VERSION;
    });

    describe('initSentry', () => {
        it('does nothing when SENTRY_DSN is not set', () => {
            sentry.initSentry();
            expect(mockSentry.init).not.toHaveBeenCalled();
        });

        it('initializes Sentry when SENTRY_DSN is set', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();
            expect(mockSentry.init).toHaveBeenCalled();
        });

        it('passes correct config with production env', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            process.env.NODE_ENV = 'production';
            process.env.APP_VERSION = '2.0.0';
            sentry.initSentry();

            expect(mockSentry.init).toHaveBeenCalledWith(
                expect.objectContaining({
                    dsn: 'https://test@sentry.io/123',
                    environment: 'production',
                    release: '2.0.0',
                    tracesSampleRate: 0.1,
                    profilesSampleRate: 0.1,
                }),
            );
        });

        it('uses development defaults when NODE_ENV not set', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();

            expect(mockSentry.init).toHaveBeenCalledWith(
                expect.objectContaining({
                    environment: 'development',
                    release: '1.0.0',
                    tracesSampleRate: 1.0,
                    profilesSampleRate: 1.0,
                }),
            );
        });

        it('includes integrations', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();

            expect(mockSentry.httpIntegration).toHaveBeenCalled();
            expect(mockSentry.expressIntegration).toHaveBeenCalled();
            expect(mockSentry.nodeContextIntegration).toHaveBeenCalled();
        });
    });

    describe('beforeSend', () => {
        it('strips cookies, authorization, and cookie headers', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();

            const initConfig = mockSentry.init.mock.calls[0][0];
            const event = {
                request: {
                    cookies: { session: 'abc' },
                    headers: {
                        authorization: 'Bearer token',
                        cookie: 'session=abc',
                        'content-type': 'application/json',
                    },
                },
            };

            const result = initConfig.beforeSend(event);

            expect(result.request.cookies).toBeUndefined();
            expect(result.request.headers.authorization).toBeUndefined();
            expect(result.request.headers.cookie).toBeUndefined();
            expect(result.request.headers['content-type']).toBe('application/json');
        });

        it('returns event unchanged if no request', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();

            const initConfig = mockSentry.init.mock.calls[0][0];
            const event = { message: 'test' };

            const result = initConfig.beforeSend(event);

            expect(result).toEqual(event);
        });

        it('handles request without headers', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();

            const initConfig = mockSentry.init.mock.calls[0][0];
            const event = {
                request: {
                    cookies: { session: 'abc' },
                },
            };

            const result = initConfig.beforeSend(event);

            expect(result.request.cookies).toBeUndefined();
        });
    });

    describe('captureException', () => {
        it('does nothing when not initialized', () => {
            const error = new Error('test');
            sentry.captureException(error);
            expect(mockSentry.captureException).not.toHaveBeenCalled();
        });

        it('calls Sentry.captureException when initialized', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();

            const error = new Error('test');
            sentry.captureException(error, { foo: 'bar' });

            expect(mockSentry.captureException).toHaveBeenCalledWith(error, {
                extra: { foo: 'bar' },
            });
        });

        it('calls Sentry.captureException without context', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();

            const error = new Error('test');
            sentry.captureException(error);

            expect(mockSentry.captureException).toHaveBeenCalledWith(error, {
                extra: undefined,
            });
        });
    });

    describe('captureMessage', () => {
        it('does nothing when not initialized', () => {
            sentry.captureMessage('hello');
            expect(mockSentry.captureMessage).not.toHaveBeenCalled();
        });

        it('calls Sentry.captureMessage when initialized with level', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();

            sentry.captureMessage('hello', 'warning');

            expect(mockSentry.captureMessage).toHaveBeenCalledWith('hello', 'warning');
        });

        it('calls Sentry.captureMessage with default info level', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();

            sentry.captureMessage('hello');

            expect(mockSentry.captureMessage).toHaveBeenCalledWith('hello', 'info');
        });
    });

    describe('getSentryRequestHandler', () => {
        it('returns null when not initialized', () => {
            expect(sentry.getSentryRequestHandler()).toBeNull();
        });

        it('returns handler when initialized', () => {
            process.env.SENTRY_DSN = 'https://test@sentry.io/123';
            sentry.initSentry();

            expect(sentry.getSentryRequestHandler()).toBe(mockSentry.setupExpressErrorHandler);
        });
    });

    describe('Sentry export', () => {
        it('exports the Sentry namespace', () => {
            expect(sentry.Sentry).toBeDefined();
            expect(sentry.Sentry.init).toBe(mockSentry.init);
            expect(sentry.Sentry.captureException).toBe(mockSentry.captureException);
        });
    });
});
