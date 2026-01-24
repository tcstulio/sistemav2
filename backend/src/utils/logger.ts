/**
 * Logger utility to add timestamps to console logs.
 * Overrides global console methods to prepend [YYYY-MM-DD HH:mm:ss] to all outputs.
 */

export function initLogger() {
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;

    const getTimestamp = () => {
        const now = new Date();
        const date = now.toISOString().split('T')[0];
        const time = now.toLocaleTimeString('pt-BR', { hour12: false });
        return `[${date} ${time}]`;
    };

    console.log = (...args: any[]) => {
        originalLog.apply(console, [getTimestamp(), ...args]);
    };

    console.info = (...args: any[]) => {
        originalInfo.apply(console, [getTimestamp(), ...args]);
    };

    console.warn = (...args: any[]) => {
        originalWarn.apply(console, [getTimestamp(), ...args]);
    };

    console.error = (...args: any[]) => {
        originalError.apply(console, [getTimestamp(), ...args]);
    };
}
