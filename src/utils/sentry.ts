import * as Sentry from '@sentry/react';

let initialized = false;
let listenersInstalled = false;

// Referências aos listeners instalados — usadas para removê-los em testes que
// reinicializam o Sentry após `__resetSentryForTests()`. Sem isso, os listeners
// antigos ficam ativos no window e disparam junto com os novos, gerando
// contagens duplicadas em spies de `Sentry.captureException`.
let installedErrorListener: ((event: ErrorEvent) => void) | null = null;
let installedRejectionListener: ((event: PromiseRejectionEvent) => void) | null = null;

/**
 * Normaliza o `VITE_SENTRY_DSN` lido de `import.meta.env`.
 *
 * Aceita apenas strings não-vazias que sejam URLs válidas; qualquer outro valor
 * (incluindo `undefined`, string vazia e a string literal `"undefined"`, que
 * alguns ambientes produzem quando se atribui `undefined` ao proxy de
 * `import.meta.env`) é tratado como DSN ausente.
 */
function readSentryDsn(): string {
    const raw = import.meta.env.VITE_SENTRY_DSN;
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return '';
    return trimmed;
}

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
    const dsn = readSentryDsn();
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
 * Converte qualquer `reason` de uma Promise rejeitada em uma Error com mensagem
 * útil para o Sentry. Strings são preservadas; objetos são serializados (com
 * fallback para `String(reason)` em caso de ciclo/circular ref).
 */
function rejectionReasonToError(reason: unknown): Error {
    if (reason instanceof Error) return reason;
    if (typeof reason === 'string') return new Error(reason);
    try {
        return new Error(JSON.stringify(reason));
    } catch {
        return new Error(String(reason));
    }
}

/**
 * Instala (uma única vez) listeners para `window.error` e `unhandledrejection`.
 * Encaminha cada evento ao Sentry via `Sentry.captureException`. Idempotente.
 *
 * Exportada apenas para os testes poderem exercitar a idempotência diretamente.
 */
export function installGlobalErrorListeners(): void {
    if (listenersInstalled || typeof window === 'undefined') return;
    listenersInstalled = true;

    installedErrorListener = (event: ErrorEvent) => {
        const err = event.error instanceof Error
            ? event.error
            : new Error(event.message || 'Unknown error');
        // Chama `captureException` deste módulo (não `Sentry.captureException` direto)
        // para que o guard `initialized` seja respeitado. Sem isso, o listener
        // dispararia mesmo quando `initSentry()` não foi chamado.
        captureException(err, {
            source: 'window.error',
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
        });
    };

    installedRejectionListener = (event: PromiseRejectionEvent) => {
        captureException(rejectionReasonToError(event.reason), {
            source: 'unhandledrejection',
        });
    };

    window.addEventListener('error', installedErrorListener);
    window.addEventListener('unhandledrejection', installedRejectionListener);
}

/**
 * Remove os listeners globais instalados por `installGlobalErrorListeners`.
 * Idempotente. Usado por `__resetSentryForTests` para isolar testes.
 */
function uninstallGlobalErrorListeners(): void {
    if (!listenersInstalled || typeof window === 'undefined') return;
    if (installedErrorListener) {
        window.removeEventListener('error', installedErrorListener);
        installedErrorListener = null;
    }
    if (installedRejectionListener) {
        window.removeEventListener('unhandledrejection', installedRejectionListener);
        installedRejectionListener = null;
    }
    listenersInstalled = false;
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
 * Apenas para testes: reseta o estado interno (initialized + listenersInstalled)
 * E remove listeners antigos do window, evitando disparo duplicado quando
 * `initSentry()` é chamado novamente.
 */
export function __resetSentryForTests(): void {
    uninstallGlobalErrorListeners();
    initialized = false;
}

export { Sentry };
