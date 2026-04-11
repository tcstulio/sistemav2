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
    }

    info(message: string, data?: unknown): void {
        pinoInstance.info(this.enrich(message, data));
    }

    warn(message: string, data?: unknown): void {
        pinoInstance.warn(this.enrich(message, data));
    }

    error(message: string, data?: unknown): void {
        pinoInstance.error(this.enrich(message, data));
    }

    fatal(message: string, data?: unknown): void {
        pinoInstance.fatal(this.enrich(message, data));
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
