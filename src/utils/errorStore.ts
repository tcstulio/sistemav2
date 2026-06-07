export interface CapturedError {
    id: string;
    message: string;
    stack?: string;
    componentStack?: string;
    componentName?: string;
    route: string;
    timestamp: number;
}

const MAX_ERRORS = 20;
let errors: CapturedError[] = [];
let listeners: Array<() => void> = [];

export function captureError(error: {
    message: string;
    stack?: string;
    componentStack?: string;
    componentName?: string;
}) {
    const entry: CapturedError = {
        id: `err_${Date.now()}`,
        message: error.message,
        stack: error.stack,
        componentStack: error.componentStack,
        componentName: error.componentName,
        route: window.location.pathname,
        timestamp: Date.now()
    };
    errors.unshift(entry);
    if (errors.length > MAX_ERRORS) errors = errors.slice(0, MAX_ERRORS);
    listeners.forEach(fn => fn());
}

export function getErrors(limit?: number): CapturedError[] {
    return errors.slice(0, limit || 10);
}

export function clearErrors() {
    errors = [];
    listeners.forEach(fn => fn());
}

export function subscribeErrors(fn: () => void): () => void {
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
}

export function formatErrorsForAgent(): string {
    if (errors.length === 0) return 'Nenhum erro capturado recentemente.';
    return errors.slice(0, 5).map(e => {
        const ts = new Date(e.timestamp).toLocaleString('pt-BR');
        return `[${ts}] Rota: ${e.route}${e.componentName ? ` | Componente: ${e.componentName}` : ''}\nErro: ${e.message}${e.stack ? `\nStack: ${e.stack.split('\n').slice(0, 4).join('\n')}` : ''}`;
    }).join('\n\n');
}
