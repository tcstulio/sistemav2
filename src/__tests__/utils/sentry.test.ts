import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const captureExceptionMock = vi.fn();

vi.mock('@sentry/react', () => {
    const captureException = (...args: unknown[]) => captureExceptionMock(...args);
    const init = vi.fn();
    const browserTracingIntegration = vi.fn(() => ({ name: 'BrowserTracing' }));
    return {
        init,
        captureException,
        browserTracingIntegration,
        default: { init, captureException, browserTracingIntegration },
    };
});

import {
    initSentry,
    captureException,
    installGlobalErrorListeners,
    __isSentryInitialized,
    __areGlobalListenersInstalled,
    __resetSentryForTests,
} from '../../utils/sentry';

const ORIGINAL_DSN = (import.meta.env as Record<string, unknown>).VITE_SENTRY_DSN;

function setSentryDsn(value: string | undefined): void {
    (import.meta.env as Record<string, unknown>).VITE_SENTRY_DSN = value;
}

describe('sentry (issue #1773)', () => {
    let addEventListenerSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        captureExceptionMock.mockClear();
        __resetSentryForTests();
        // Garante que cada teste começa com DSN definido (alguns testes
        // verificam o comportamento sem DSN e o reativam depois).
        setSentryDsn('https://examplePublicKey@o0.ingest.sentry.io/0');
        addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    });

    afterEach(() => {
        __resetSentryForTests();
        captureExceptionMock.mockClear();
        addEventListenerSpy.mockRestore();
        setSentryDsn(ORIGINAL_DSN as string | undefined);
    });

    describe('initSentry()', () => {
        it('is a no-op when VITE_SENTRY_DSN is not set', async () => {
            setSentryDsn(undefined);
            __resetSentryForTests();
            initSentry();
            expect(__isSentryInitialized()).toBe(false);
            expect(__areGlobalListenersInstalled()).toBe(false);
        });

        it('initializes Sentry and installs global listeners when DSN is set', () => {
            initSentry();
            expect(__isSentryInitialized()).toBe(true);
            expect(__areGlobalListenersInstalled()).toBe(true);
        });

        it('calls Sentry.init with DSN and a transport-ready config', async () => {
            const Sentry = await import('@sentry/react');
            initSentry();
            expect(Sentry.init).toHaveBeenCalledTimes(1);
            const initArg = (Sentry.init as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(initArg.dsn).toBe('https://examplePublicKey@o0.ingest.sentry.io/0');
            expect(typeof initArg.beforeSend).toBe('function');
            expect(Array.isArray(initArg.integrations)).toBe(true);
        });
    });

    describe('global window.error listener', () => {
        it('forwards window ErrorEvent to Sentry.captureException with extra metadata', () => {
            initSentry();
            const handler = addEventListenerSpy.mock.calls
                .map((call) => call[0] as string)
                .filter((name) => name === 'error');
            expect(handler).toContain('error');

            const realErr = new Error('real error from window');
            const errorEvent = new ErrorEvent('error', {
                error: realErr,
                message: realErr.message,
                filename: 'app.js',
                lineno: 42,
                colno: 7,
            });
            window.dispatchEvent(errorEvent);

            expect(captureExceptionMock).toHaveBeenCalledTimes(1);
            const [errArg, ctxArg] = captureExceptionMock.mock.calls[0];
            expect(errArg).toBe(realErr);
            expect(ctxArg).toMatchObject({
                extra: {
                    source: 'window.error',
                    filename: 'app.js',
                    lineno: 42,
                    colno: 7,
                },
            });
        });

        it('wraps non-Error reasons in window.error using event.message', () => {
            initSentry();
            const errorEvent = new ErrorEvent('error', {
                message: 'synthetic message',
                filename: 'inline.js',
                lineno: 1,
                colno: 1,
            });
            // jsdom ErrorEvent sempre popula event.error; aqui forçamos undefined
            // para exercitar o caminho do wrapper.
            Object.defineProperty(errorEvent, 'error', { value: undefined });
            window.dispatchEvent(errorEvent);

            expect(captureExceptionMock).toHaveBeenCalledTimes(1);
            const [errArg] = captureExceptionMock.mock.calls[0];
            expect(errArg).toBeInstanceOf(Error);
            expect((errArg as Error).message).toBe('synthetic message');
        });
    });

    describe('global unhandledrejection listener', () => {
        it('forwards PromiseRejectionEvent with Error reason to Sentry.captureException', async () => {
            initSentry();
            const reason = new Error('rejected promise');
            const event = new PromiseRejectionEvent('unhandledrejection', { reason, promise: Promise.reject(reason) });
            window.dispatchEvent(event);

            expect(captureExceptionMock).toHaveBeenCalledTimes(1);
            const [errArg, ctxArg] = captureExceptionMock.mock.calls[0];
            expect(errArg).toBe(reason);
            expect(ctxArg).toMatchObject({ extra: { source: 'unhandledrejection' } });
        });

        it('wraps string rejection reasons into Error instances', () => {
            initSentry();
            const event = new PromiseRejectionEvent('unhandledrejection', {
                reason: 'string-reason',
                promise: Promise.reject('string-reason'),
            });
            window.dispatchEvent(event);

            expect(captureExceptionMock).toHaveBeenCalledTimes(1);
            const [errArg] = captureExceptionMock.mock.calls[0];
            expect(errArg).toBeInstanceOf(Error);
            expect((errArg as Error).message).toBe('string-reason');
        });

        it('serializes non-string, non-Error rejection reasons safely', () => {
            initSentry();
            const reason = { code: 'EBOOM', detail: { nested: true } };
            const event = new PromiseRejectionEvent('unhandledrejection', {
                reason,
                promise: Promise.reject(reason),
            });
            window.dispatchEvent(event);

            expect(captureExceptionMock).toHaveBeenCalledTimes(1);
            const [errArg] = captureExceptionMock.mock.calls[0];
            expect(errArg).toBeInstanceOf(Error);
            expect((errArg as Error).message).toBe(JSON.stringify(reason));
        });
    });

    describe('installGlobalErrorListeners()', () => {
        it('is idempotent: calling twice does not register duplicate listeners', () => {
            // initSentry já instala uma vez; contamos os addEventListener
            // anteriores a ele, resetamos spies, e chamamos installGlobalErrorListeners
            // mais uma vez para verificar que o flag trava a segunda instalação.
            initSentry();
            const errorCallsBefore = addEventListenerSpy.mock.calls.filter((c) => c[0] === 'error').length;
            const rejectionCallsBefore = addEventListenerSpy.mock.calls.filter((c) => c[0] === 'unhandledrejection').length;

            // Resetar spy para contar SOMENTE as chamadas adicionais.
            addEventListenerSpy.mockClear();

            installGlobalErrorListeners();
            installGlobalErrorListeners();

            const newErrorCalls = addEventListenerSpy.mock.calls.filter((c) => c[0] === 'error').length;
            const newRejectionCalls = addEventListenerSpy.mock.calls.filter((c) => c[0] === 'unhandledrejection').length;
            expect(newErrorCalls).toBe(0);
            expect(newRejectionCalls).toBe(0);
            expect(errorCallsBefore).toBe(1);
            expect(rejectionCallsBefore).toBe(1);
        });

        it('still works when called directly (without initSentry) and forwards events', () => {
            installGlobalErrorListeners();
            expect(__areGlobalListenersInstalled()).toBe(true);
            // captureException ainda é no-op (initialized=false), mas o listener
            // está instalado. O teste cobre apenas o caminho de instalação.
            const event = new ErrorEvent('error', { message: 'manual' });
            window.dispatchEvent(event);
            // Nenhuma captura esperada porque Sentry não foi inicializado.
            expect(captureExceptionMock).not.toHaveBeenCalled();
        });
    });

    describe('captureException()', () => {
        it('is a no-op when Sentry is not initialized', () => {
            captureException(new Error('boom'));
            expect(captureExceptionMock).not.toHaveBeenCalled();
        });

        it('forwards to Sentry.captureException with extra context when initialized', () => {
            initSentry();
            captureExceptionMock.mockClear();
            const err = new Error('manual capture');
            captureException(err, { tag: 'manual' });
            expect(captureExceptionMock).toHaveBeenCalledTimes(1);
            const [errArg, ctxArg] = captureExceptionMock.mock.calls[0];
            expect(errArg).toBe(err);
            expect(ctxArg).toMatchObject({ extra: { tag: 'manual' } });
        });
    });
});
