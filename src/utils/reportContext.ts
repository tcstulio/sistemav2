// Captura de contexto para o "Reportar problema" — para o agente saber EXATAMENTE
// onde o usuário está (inclusive janela-dentro-de-janela) e o que falhou.
// Sem dependência de React: buffers globais + leitura da DOM no momento do report.

const MAX = 30;
const consoleErrors: string[] = [];
const failedRequests: string[] = [];

function push(buf: string[], line: string) {
    buf.push(line);
    if (buf.length > MAX) buf.shift();
}

const ts = () => new Date().toISOString().substring(11, 19);

/** Registra uma chamada de API que falhou (chamado pelo wrapper de request). */
export function pushFailedRequest(method: string, url: string, status: number | string, detail?: string) {
    push(failedRequests, `[${ts()}] ${method} ${url} → ${status}${detail ? ` ${String(detail).slice(0, 120)}` : ''}`);
}

let installed = false;
/** Instala a captura global de erros (uma vez, no boot do app). */
export function installReportCapture() {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    const origError = console.error.bind(console);
    console.error = (...args: any[]) => {
        try { push(consoleErrors, `[${ts()}] ${args.map(stringifyArg).join(' ').slice(0, 300)}`); } catch { /* noop */ }
        origError(...args);
    };

    window.addEventListener('error', (e) => {
        push(consoleErrors, `[${ts()}] ${e.message} @ ${e.filename}:${e.lineno}`);
    });
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
        push(consoleErrors, `[${ts()}] unhandledrejection: ${stringifyArg(e.reason).slice(0, 300)}`);
    });
}

function stringifyArg(a: any): string {
    if (a == null) return String(a);
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try { return JSON.stringify(a); } catch { return String(a); }
}

// Texto visível de um elemento (heading) — usado p/ nomear cada janela aberta.
function headingOf(el: Element): string {
    const h = el.querySelector('h1, h2, h3, [role="heading"]');
    const t = (h?.textContent || '').trim().replace(/\s+/g, ' ');
    return t.slice(0, 60);
}

/**
 * Monta o breadcrumb lendo a DOM AGORA: página base + cada modal/diálogo aberto,
 * do mais externo ao mais interno. É isto que resolve "janela dentro da outra".
 */
function buildBreadcrumb(): string {
    const parts: string[] = [];
    const base = (document.title || 'App').replace(/\s+/g, ' ').trim();
    parts.push(base);
    // diálogos/modais abertos, em ordem de profundidade na DOM
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]'));
    for (const d of dialogs) {
        const name = headingOf(d) || 'janela';
        parts.push(`${name} (modal)`);
    }
    // aba ativa, se houver
    const activeTab = document.querySelector('[role="tab"][aria-selected="true"], [aria-selected="true"]');
    const tabText = (activeTab?.textContent || '').trim().replace(/\s+/g, ' ');
    if (tabText) parts.push(`aba ${tabText.slice(0, 30)}`);
    return parts.join(' › ');
}

export interface ReportContext {
    url: string;
    breadcrumb: string;
    viewport: string;
    userAgent: string;
    consoleErrors: string[];
    failedRequests: string[];
}

/** Snapshot do contexto atual, para anexar ao report. */
export function captureContext(): ReportContext {
    return {
        url: typeof location !== 'undefined' ? location.href : '',
        breadcrumb: typeof document !== 'undefined' ? buildBreadcrumb() : '',
        viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        consoleErrors: [...consoleErrors],
        failedRequests: [...failedRequests],
    };
}
