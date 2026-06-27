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

const MAX_LOG_BUFFER = 500;
const logBuffer: string[] = [];

function pushToBuffer(level: string, msg: string, data?: unknown) {
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const entry = `${ts} [${level.toUpperCase()}] ${msg}${data ? ' ' + (typeof data === 'string' ? data : JSON.stringify(data).substring(0, 300)) : ''}`;
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
}

export function getRecentLogs(lines: number = 50): string[] {
    return logBuffer.slice(-lines);
}

class Logger {
    private context?: string;

    constructor(context?: string) {
        this.context = context;
    }

    private enrich(message: string, data?: unknown): { msg: string; context?: string; data?: unknown } {
        let safeData = data;
        if (data && typeof data === 'object') {
            const err = data as any;
            if (err.isAxiosError && err.response) {
                safeData = {
                    status: err.response.status,
                    data: err.response.data,
                    url: err.config?.url,
                    method: err.config?.method
                };
            } else if (err instanceof Error) {
                safeData = { message: err.message, stack: err.stack };
            }
        }
        return {
            msg: this.context ? `[${this.context}] ${message}` : message,
            ...(this.context ? { context: this.context } : {}),
            ...(safeData !== undefined ? { data: safeData } : {}),
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
