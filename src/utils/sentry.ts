import * as Sentry from '@sentry/react';

let initialized = false;

/**
 * Inicializa o Sentry no frontend.
 *
 * No-op quando `VITE_SENTRY_DSN` não está definido — não quebra o app em dev
 * nem em builds sem DSN. Espelha o `beforeSend` do backend (`backend/src/utils/sentry.ts`),
 * removendo cabeçalhos/credenciais sensíveis antes de enviar o evento.
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
}

/**
 * Reporta uma exceção ao Sentry. No-op se o Sentry não foi inicializado (sem DSN).
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
    if (!initialized) return;
    Sentry.captureException(error, context ? { extra: context } : undefined);
}

export { Sentry };
