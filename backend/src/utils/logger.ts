import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isProduction = process.env.NODE_ENV === 'production';
const configuredLevel = process.env.LOG_LEVEL;
const logLevel: LogLevel =
    configuredLevel === 'debug' || configuredLevel === 'info' || configuredLevel === 'warn' || configuredLevel === 'error'
        ? configuredLevel
        : 'info';
const useJsonFormat = process.env.LOG_FORMAT === 'json';

const humanReadableFormat = winston.format.printf(
    ({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`,
);

const baseFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
);

const fileFormat = useJsonFormat
    ? winston.format.combine(baseFormat, winston.format.json())
    : winston.format.combine(baseFormat, humanReadableFormat);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    baseFormat,
    useJsonFormat ? winston.format.json() : humanReadableFormat,
);

const transports: winston.transport[] = [
    new DailyRotateFile({
        dirname: 'logs',
        filename: 'app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles: '14d',
        format: fileFormat,
    }),
];

if (!isProduction) {
    transports.push(
        new winston.transports.Console({
            format: consoleFormat,
        }),
    );
}

const winstonInstance = winston.createLogger({
    level: logLevel,
    format: baseFormat,
    transports,
    defaultMeta: {},
});

export const MAX_LOG_BUFFER = 500;

export interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    meta?: unknown;
    context?: string;
}

const logBuffer: LogEntry[] = [];

function pushToBuffer(level: string, msg: string, data?: unknown, context?: string): void {
    const entry: LogEntry = { timestamp: new Date().toISOString(), level, message: msg };
    if (data !== undefined) entry.meta = data;
    if (context) entry.context = context;
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
}

function formatEntry(entry: LogEntry): string {
    const ts = entry.timestamp.replace('T', ' ').substring(0, 19);
    const metaStr = entry.meta
        ? ` ${typeof entry.meta === 'string' ? entry.meta : JSON.stringify(entry.meta).substring(0, 300)}`
        : '';
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
    constructor(private readonly context?: string) {}

    private formatMessage(message: string): string {
        return this.context ? `[${this.context}] ${message}` : message;
    }

    private log(level: LogLevel, message: string, data?: unknown): void {
        const formatted = this.formatMessage(message);
        const meta: Record<string, unknown> = {};
        if (this.context) meta.context = this.context;
        if (data !== undefined) meta.data = data;
        winstonInstance.log(level, formatted, Object.keys(meta).length > 0 ? meta : undefined);
        pushToBuffer(level, formatted, data, this.context);
    }

    debug(message: string, data?: unknown): void {
        this.log('debug', message, data);
    }

    info(message: string, data?: unknown): void {
        this.log('info', message, data);
    }

    warn(message: string, data?: unknown): void {
        this.log('warn', message, data);
    }

    error(message: string, data?: unknown): void {
        this.log('error', message, data);
    }

    fatal(message: string, data?: unknown): void {
        this.log('error', message, data);
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
