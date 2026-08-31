/**
 * Frontend Logger Utility
 *
 * Production-safe structured logging:
 * - Structured wrapper with explicit levels (debug / info / warn / error)
 * - Suppresses debug/info logs in production; preserves warn/error for monitoring
 * - In production, forwards errors to Sentry via `captureException` (no-op se DSN ausente)
 * - Exposes itself on `window.__logger` only in DEV — Vite/Rollup tree-shake removes
 *   the assignment in production builds, so `__logger` nunca aparece em `dist/`.
 */
import { captureException as sentryCaptureException } from './sentry';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

interface LogPayload {
    level: LogLevel;
    context?: string;
    message: unknown;
    data?: unknown;
    timestamp: string;
}

export interface LoggerTransport {
    emit(payload: LogPayload): void;
}

function safeStringify(value: unknown): string {
    try { return JSON.stringify(value); } catch { return String(value); }
}

class ConsoleTransport implements LoggerTransport {
    private readonly consoleFn: Record<LogLevel, (...args: unknown[]) => void> = {
        debug: (...args) => console.debug(...args),
        info: (...args) => console.info(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
    };

    emit(payload: LogPayload): void {
        const prefix = payload.context
            ? `[${payload.level.toUpperCase()}][${payload.context}]`
            : `[${payload.level.toUpperCase()}]`;
        const fn = this.consoleFn[payload.level];
        if (payload.data !== undefined) {
            fn(prefix, payload.message, payload.data);
        } else {
            fn(prefix, payload.message);
        }
    }
}

class SentryTransport implements LoggerTransport {
    private readonly isProduction: boolean;
    private readonly sendImpl: (error: Error, context?: Record<string, unknown>) => void | null;

    constructor(opts: {
        isProduction: boolean;
        send: (error: Error, context?: Record<string, unknown>) => void;
    }) {
        this.isProduction = opts.isProduction;
        this.sendImpl = opts.isProduction ? opts.send : () => {};
    }

    emit(payload: LogPayload): void {
        if (payload.level !== 'error') return;
        try {
            const err = payload.message instanceof Error
                ? payload.message
                : new Error(typeof payload.message === 'string' ? payload.message : safeStringify(payload.message));
            this.sendImpl(err, {
                logger: 'frontend',
                context: payload.context,
                data: payload.data !== undefined ? safeStringify(payload.data) : undefined,
                timestamp: payload.timestamp,
            });
        } catch {
            // nunca quebrar o app por causa de logging
        }
    }
}

class FrontendLogger {
    private minLevel: LogLevel;
    private readonly isProduction: boolean;
    private readonly isDev: boolean;
    private readonly transports: LoggerTransport[];

    constructor(opts?: {
        isProduction?: boolean;
        isDev?: boolean;
        transports?: LoggerTransport[];
        sentrySender?: (error: Error, context?: Record<string, unknown>) => void;
    }) {
        this.isProduction = opts?.isProduction ?? import.meta.env.PROD;
        this.isDev = opts?.isDev ?? (import.meta.env.DEV === true);
        this.minLevel = this.isProduction ? 'warn' : 'debug';
        this.transports = opts?.transports ?? [
            new ConsoleTransport(),
            new SentryTransport({
                isProduction: this.isProduction,
                send: opts?.sentrySender ?? defaultSentrySender,
            }),
        ];
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
    }

    private emit(level: LogLevel, message: unknown, context?: string, data?: unknown): void {
        if (!this.shouldLog(level)) return;
        const payload: LogPayload = {
            level,
            context,
            message,
            data,
            timestamp: new Date().toISOString(),
        };
        for (const t of this.transports) {
            try { t.emit(payload); } catch { /* never break logging */ }
        }
    }

    debug(message: string, context?: string, data?: unknown): void {
        this.emit('debug', message, context, data);
    }

    info(message: string, context?: string, data?: unknown): void {
        this.emit('info', message, context, data);
    }

    warn(message: unknown, context?: string, data?: unknown): void {
        this.emit('warn', message, context, data);
    }

    error(message: unknown, context?: string, data?: unknown): void {
        this.emit('error', message, context, data);
    }

    child(context: string): ContextLogger {
        return new ContextLogger(this, context);
    }

    enableDebug(): void {
        this.minLevel = 'debug';
    }

    resetLevel(): void {
        this.minLevel = this.isProduction ? 'warn' : 'debug';
    }

    /** Exposto para testes: indica se este logger foi criado em DEV. */
    get isDevMode(): boolean {
        return this.isDev;
    }

    /** Exposto para testes: indica se este logger foi criado em PROD. */
    get isProductionMode(): boolean {
        return this.isProduction;
    }

    /** Exposto para testes: lista de transports atuais. */
    getActiveTransports(): readonly LoggerTransport[] {
        return this.transports;
    }
}

class ContextLogger {
    constructor(private readonly parent: FrontendLogger, private readonly context: string) {}

    debug(message: string, data?: unknown): void {
        this.parent.debug(message, this.context, data);
    }

    info(message: string, data?: unknown): void {
        this.parent.info(message, this.context, data);
    }

    warn(message: unknown, data?: unknown): void {
        this.parent.warn(message, this.context, data);
    }

    error(message: unknown, data?: unknown): void {
        this.parent.error(message, this.context, data);
    }
}

let sentrySenderRef: ((error: Error, context?: Record<string, unknown>) => void) | null = null;

function defaultSentrySender(error: Error, context?: Record<string, unknown>): void {
    if (sentrySenderRef) {
        sentrySenderRef(error, context);
        return;
    }
    // Import estático: `sentry.ts` NÃO importa `logger.ts`, então não há ciclo.
    // `sentryCaptureException` é no-op se `initSentry()` ainda não foi chamado —
    // perda zero de eventos. Isso elimina a race condition do import dinâmico
    // da implementação anterior (primeira chamada ao `logger.error()` resolvia
    // só em microtask, perdendo erros SINCRONOS muito iniciais).
    sentryCaptureException(error, context);
}

/** Injeta um sender customizado (usado pelos testes para capturar chamadas). */
export function __setSentrySenderForTests(
    sender: ((error: Error, context?: Record<string, unknown>) => void) | null,
): void {
    sentrySenderRef = sender;
}

/**
 * Cria uma nova instância de logger (útil para testes e para casos onde o
 * caller precisa injetar transports/sender customizados). A configuração
 * omite `isProduction`/`isDev` apenas se forem fornecidos — em produção,
 * `isProduction` deve ser `true` e erros são repassados ao Sentry.
 */
export function createLogger(
    opts?: {
        isProduction?: boolean;
        isDev?: boolean;
        transports?: LoggerTransport[];
        sentrySender?: (error: Error, context?: Record<string, unknown>) => void;
    },
): FrontendLogger {
    return new FrontendLogger(opts);
}

/** Tipo público do logger (exportado para consumidores TypeScript). */
export type { FrontendLogger, ContextLogger };

// Singleton
export const logger = new FrontendLogger();

// Expõe `window.__logger` APENAS em DEV. Em produção, Vite/Rollup substitui
// `import.meta.env.DEV` por `false` em build time, e o bloco inteiro é
// eliminado por dead-code elimination — o literal `__logger` não chega ao `dist/`.
if (import.meta.env.DEV === true && typeof window !== 'undefined') {
    (window as unknown as { __logger?: FrontendLogger }).__logger = logger;
}

export default logger;
