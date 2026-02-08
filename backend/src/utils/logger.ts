/**
 * Production-ready Logger Utility
 *
 * Features:
 * - Log levels (debug, info, warn, error)
 * - Environment-aware (suppresses debug in production)
 * - Timestamps with ISO format
 * - Context/source tracking
 * - Structured logging support
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: string;
    data?: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

class Logger {
    private minLevel: LogLevel;
    private isProduction: boolean;

    constructor() {
        this.isProduction = process.env.NODE_ENV === 'production';
        this.minLevel = this.isProduction ? 'info' : 'debug';
    }

    private getTimestamp(): string {
        return new Date().toISOString();
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
    }

    private formatMessage(entry: LogEntry): string {
        const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
        const context = entry.context ? ` [${entry.context}]` : '';
        return `${prefix}${context} ${entry.message}`;
    }

    private log(level: LogLevel, message: string, context?: string, data?: unknown): void {
        if (!this.shouldLog(level)) return;

        const entry: LogEntry = {
            timestamp: this.getTimestamp(),
            level,
            message,
            context,
            data
        };

        const formattedMessage = this.formatMessage(entry);

        switch (level) {
            case 'debug':
                if (data !== undefined) {
                    console.debug(formattedMessage, data);
                } else {
                    console.debug(formattedMessage);
                }
                break;
            case 'info':
                if (data !== undefined) {
                    console.info(formattedMessage, data);
                } else {
                    console.info(formattedMessage);
                }
                break;
            case 'warn':
                if (data !== undefined) {
                    console.warn(formattedMessage, data);
                } else {
                    console.warn(formattedMessage);
                }
                break;
            case 'error':
                if (data !== undefined) {
                    console.error(formattedMessage, data);
                } else {
                    console.error(formattedMessage);
                }
                break;
        }
    }

    debug(message: string, context?: string, data?: unknown): void {
        this.log('debug', message, context, data);
    }

    info(message: string, context?: string, data?: unknown): void {
        this.log('info', message, context, data);
    }

    warn(message: string, context?: string, data?: unknown): void {
        this.log('warn', message, context, data);
    }

    error(message: string, context?: string, data?: unknown): void {
        this.log('error', message, context, data);
    }

    /**
     * Create a child logger with a fixed context
     */
    child(context: string): ContextLogger {
        return new ContextLogger(this, context);
    }

    /**
     * Set the minimum log level
     */
    setLevel(level: LogLevel): void {
        this.minLevel = level;
    }
}

class ContextLogger {
    constructor(private parent: Logger, private context: string) {}

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
export const logger = new Logger();

// Legacy support - wraps console methods with timestamps (deprecated)
export function initLogger() {
    logger.info('Logger initialized', 'System');
}

export default logger;
