import pino from 'pino';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'trace';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const pinoInstance = pino({
    level: logLevel,
    ...(isProduction
        ? {}
        : {
              transport: {
                  target: 'pino-pretty',
                  options: {
                      colorize: true,
                      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
                      ignore: 'pid,hostname,context',
                  },
              },
          }),
});

export const MAX_LOG_BUFFER = 500;

export interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    meta?: unknown;
}

const logBuffer: LogEntry[] = [];

function pushToBuffer(level: string, msg: string, data?: unknown) {
    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message: msg,
    };
    if (data !== undefined) entry.meta = data;
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
}

function formatEntry(entry: LogEntry): string {
    const ts = entry.timestamp.replace('T', ' ').substring(0, 19);
    const meta = entry.meta;
    const metaStr = meta ? ' ' + (typeof meta === 'string' ? meta : JSON.stringify(meta).substring(0, 300)) : '';
    return `${ts} [${entry.level.toUpperCase()}] ${entry.message}${metaStr}`;
}

export function getRecentLogs(lines: number = 50): string[] {
    return logBuffer.slice(-lines).map(formatEntry);
}

export function getRecentLogEntries(lines: number = 50): LogEntry[] {
    return logBuffer.slice(-lines).map((entry) => ({ ...entry }));
}

export function clearLogBuffer(): void {
    logBuffer.length = 0;
}

class Logger {
    private context?: string;

    constructor(context?: string) {
        this.context = context;
    }

    private enrich(message: string, data?: unknown): { msg: string; context?: string; data?: unknown } {
        return {
            msg: this.context ? `[${this.context}] ${message}` : message,
            ...(this.context ? { context: this.context } : {}),
            ...(data !== undefined ? { data } : {}),
        };
    }

    debug(message: string, data?: unknown): void {
        pinoInstance.debug(this.enrich(message, data));
        pushToBuffer('debug', this.enrich(message, data).msg, data);
    }

    info(message: string, data?: unknown): void {
        pinoInstance.info(this.enrich(message, data));
        pushToBuffer('info', this.enrich(message, data).msg, data);
    }

    warn(message: string, data?: unknown): void {
        pinoInstance.warn(this.enrich(message, data));
        pushToBuffer('warn', this.enrich(message, data).msg, data);
    }

    error(message: string, data?: unknown): void {
        pinoInstance.error(this.enrich(message, data));
        pushToBuffer('error', this.enrich(message, data).msg, data);
    }

    fatal(message: string, data?: unknown): void {
        pinoInstance.fatal(this.enrich(message, data));
        pushToBuffer('fatal', this.enrich(message, data).msg, data);
    }

    child(context: string): Logger {
        return new Logger(this.context ? `${this.context}:${context}` : context);
    }
}

export const logger = new Logger();

export function createLogger(context: string): Logger {
    return new Logger(context);
}

export default logger;
