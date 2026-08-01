import * as Sentry from '@sentry/react';

let initialized = false;
let listenersInstalled = false;

/**
 * Inicializa o Sentry no frontend.
 *
 * No-op quando `VITE_SENTRY_DSN` não está definido — não quebra o app em dev
 * nem em builds sem DSN. Espelha o `beforeSend` do backend (`backend/src/utils/sentry.ts`),
 * removendo cabeçalhos/credenciais sensíveis antes de enviar o evento.
 *
 * Quando inicializado, registra listeners globais (`error` e `unhandledrejection`)
 * que encaminham qualquer exceção ao Sentry — independente da origem.
 */
export function initSentry(): void {
    const dsn = import.meta.env.VITE_SENTRY_DSN;
    if (!dsn) return;

    Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        release: import.meta.env.VITE_APP_VERSION || '1.0.0',
        tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
        integrations: [Sentry.browserTracingIntegration()],
        beforeSend(event) {
            if (event.request) {
                delete event.request.cookies;
                if (event.request.headers) {
                    delete event.request.headers.Authorization;
                    delete event.request.headers.authorization;
                    delete event.request.headers.cookie;
                    delete event.request.headers.DOLAPIKEY;
                }
            }
            return event;
        },
    });

    initialized = true;
    installGlobalErrorListeners();
}

/**
 * Instala (uma única vez) listeners para `window.error` e `unhandledrejection`.
 * Encaminha cada evento ao Sentry via `Sentry.captureException`. Idempotente.
 */
function installGlobalErrorListeners(): void {
    if (listenersInstalled || typeof window === 'undefined') return;
    listenersInstalled = true;

    window.addEventListener('error', (event) => {
        const err = event.error instanceof Error
            ? event.error
            : new Error(event.message || 'Unknown error');
        Sentry.captureException(err, {
            extra: {
                source: 'window.error',
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
            },
        });
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        const err = reason instanceof Error
            ? reason
            : new Error(typeof reason === 'string' ? reason : (() => {
                try { return JSON.stringify(reason); } catch { return String(reason); }
            })());
        Sentry.captureException(err, {
            extra: { source: 'unhandledrejection' },
        });
    });
}

/**
 * Reporta uma exceção ao Sentry. No-op se o Sentry não foi inicializado (sem DSN).
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
    if (!initialized) return;
    Sentry.captureException(error, context ? { extra: context } : undefined);
}

/**
 * Apenas para testes: indica se o Sentry foi inicializado nesta sessão.
 */
export function __isSentryInitialized(): boolean {
    return initialized;
}

/**
 * Apenas para testes: indica se os listeners globais foram instalados.
 */
export function __areGlobalListenersInstalled(): boolean {
    return listenersInstalled;
}

/**
 * Apenas para testes: reseta o estado interno (initialized + listenersInstalled).
 * NÃO desinstala listeners do window — apenas zera os flags para re-inicialização.
 */
export function __resetSentryForTests(): void {
    initialized = false;
    listenersInstalled = false;
}

export { Sentry };
