/**
 * Frontend Logger Utility
 *
 * Production-safe logging that:
 * - Suppresses debug/info logs in production
 * - Preserves error/warn logs for monitoring
 * - Provides structured logging with context
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

class FrontendLogger {
    private minLevel: LogLevel;
    private isProduction: boolean;

    constructor() {
        this.isProduction = import.meta.env.PROD;
        // In production, only show warnings and errors
        this.minLevel = this.isProduction ? 'warn' : 'debug';
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
    }

    private formatPrefix(level: LogLevel, context?: string): string {
        const contextStr = context ? `[${context}]` : '';
        return `[${level.toUpperCase()}]${contextStr}`;
    }

    debug(message: string, context?: string, data?: unknown): void {
        if (!this.shouldLog('debug')) return;
        if (data !== undefined) {
            console.debug(this.formatPrefix('debug', context), message, data);
        } else {
            console.debug(this.formatPrefix('debug', context), message);
        }
    }

    info(message: string, context?: string, data?: unknown): void {
        if (!this.shouldLog('info')) return;
        if (data !== undefined) {
            console.info(this.formatPrefix('info', context), message, data);
        } else {
            console.info(this.formatPrefix('info', context), message);
        }
    }

    warn(message: string, context?: string, data?: unknown): void {
        if (!this.shouldLog('warn')) return;
        if (data !== undefined) {
            console.warn(this.formatPrefix('warn', context), message, data);
        } else {
            console.warn(this.formatPrefix('warn', context), message);
        }
    }

    error(message: string, context?: string, data?: unknown): void {
        if (!this.shouldLog('error')) return;
        if (data !== undefined) {
            console.error(this.formatPrefix('error', context), message, data);
        } else {
            console.error(this.formatPrefix('error', context), message);
        }
    }

    /**
     * Create a child logger with a fixed context
     */
    child(context: string): ContextLogger {
        return new ContextLogger(this, context);
    }

    /**
     * Enable all logs (useful for debugging in production)
     */
    enableDebug(): void {
        this.minLevel = 'debug';
    }

    /**
     * Reset to production defaults
     */
    resetLevel(): void {
        this.minLevel = this.isProduction ? 'warn' : 'debug';
    }
}

class ContextLogger {
    constructor(private parent: FrontendLogger, private context: string) {}

    debug(message: string, data?: unknown): void {
        this.parent.debug(message, this.context, data);
    }

    info(message: string, data?: unknown): void {
        this.parent.info(message, this.context, data);
    }

    warn(message: string, data?: unknown): void {
        this.parent.warn(message, this.context, data);
    }

    error(message: string, data?: unknown): void {
        this.parent.error(message, this.context, data);
    }
}

// Singleton instance
export const logger = new FrontendLogger();

// Expose to window for debugging in production
if (typeof window !== 'undefined' && !import.meta.env.PROD) {
    (window as any).__logger = logger;
}

export default logger;
