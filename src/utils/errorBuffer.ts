// Buffer global de logs/erros de console + window.onerror/unhandledrejection,
// exposto em window.__errorBuffer para inspeção em produção e consumido pelo
// botão "Reportar problema" ao montar o contexto do report.
//
// Esta é a fonte canônica de captura de console usada por reportContext.ts.
// Mantemos buffers internos (fechados) e expomos leituras frescas via getters.

const MAX = 30;
const consoleLogs: string[] = [];
const consoleErrors: string[] = [];

export interface ErrorBufferSnapshot {
    logs: string[];
    errors: string[];
}

declare global {
    interface Window {
        __errorBuffer?: ErrorBufferSnapshot;
    }
}

function push(buf: string[], line: string) {
    buf.push(line);
    if (buf.length > MAX) buf.shift();
}

const ts = () => new Date().toISOString().substring(11, 19);

function stringifyArg(a: unknown): string {
    if (a == null) return String(a);
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try { return JSON.stringify(a); } catch { return String(a); }
}

let installed = false;

/**
 * Instala (uma única vez) a captura global de console.log/info/warn/error,
 * window.onerror e unhandledrejection. Idempotente — seguro chamar várias vezes.
 */
export function installErrorBuffer(): void {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const origLog = console.log.bind(console);
    const origInfo = console.info.bind(console);

    console.error = (...args: unknown[]) => {
        try { push(consoleErrors, `[${ts()}] ${args.map(stringifyArg).join(' ').slice(0, 300)}`); } catch { /* noop */ }
        origError(...args);
    };
    console.warn = (...args: unknown[]) => {
        try { push(consoleLogs, `[${ts()}] [warn] ${args.map(stringifyArg).join(' ').slice(0, 300)}`); } catch { /* noop */ }
        origWarn(...args);
    };
    console.log = (...args: unknown[]) => {
        try { push(consoleLogs, `[${ts()}] ${args.map(stringifyArg).join(' ').slice(0, 300)}`); } catch { /* noop */ }
        origLog(...args);
    };
    console.info = (...args: unknown[]) => {
        try { push(consoleLogs, `[${ts()}] [info] ${args.map(stringifyArg).join(' ').slice(0, 300)}`); } catch { /* noop */ }
        origInfo(...args);
    };

    window.addEventListener('error', (e) => {
        push(consoleErrors, `[${ts()}] ${e.message} @ ${e.filename}:${e.lineno}`);
    });
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
        push(consoleErrors, `[${ts()}] unhandledrejection: ${stringifyArg(e.reason).slice(0, 300)}`);
    });

    // Espelho público somente-leitura p/ inspeção/debug (produção).
    window.__errorBuffer = {
        get logs() { return [...consoleLogs]; },
        get errors() { return [...consoleErrors]; },
    };
}

/** Snapshot fresco (imutável) do buffer atual. */
export function readErrorBuffer(): ErrorBufferSnapshot {
    return { logs: [...consoleLogs], errors: [...consoleErrors] };
}

/** Limpa os buffers (uso principal: testes). */
export function resetErrorBuffer(): void {
    consoleLogs.length = 0;
    consoleErrors.length = 0;
}

/** Apenas para testes: resetar o flag "installed" e re-instalar. */
export function __resetInstalledForTests(): void {
    installed = false;
}
