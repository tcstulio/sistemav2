import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(): void {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
        return;
    }

    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV || 'development',
        release: process.env.APP_VERSION || '1.0.0',
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        integrations: [
            Sentry.httpIntegration(),
            Sentry.expressIntegration(),
            Sentry.nodeContextIntegration(),
        ],
        beforeSend(event) {
            if (event.request) {
                delete event.request.cookies;
                if (event.request.headers) {
                    delete event.request.headers.authorization;
                    delete event.request.headers.cookie;
                }
            }
            return event;
        },
    });

    initialized = true;
}

export function captureException(error: Error, context?: Record<string, unknown>): void {
    if (!initialized) return;
    Sentry.captureException(error, { extra: context });
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
    if (!initialized) return;
    Sentry.captureMessage(message, level);
}

export function getSentryRequestHandler() {
    if (!initialized) return null;
    return Sentry.setupExpressErrorHandler;
}

export { Sentry };
