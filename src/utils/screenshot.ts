// Helpers de captura visual para o botão "Reportar problema":
// - captureHtmlSnapshot(): HTML serializado e sanitizado da página atual (sync).
// - captureScreenshot(): screenshot da viewport como PNG base64 (async, 5s timeout).
//
// Segurança: NUNCA capturamos snapshot/screenshot em rotas de autenticação
// (deny-list). Nas demais rotas, sanitizamos inputs[type=password] e campos
// ocultos suspeitos (token/apikey/...) antes de serializar o HTML.

export const CAPTURE_TIMEOUT_MS = 5000;
const MAX_HTML_SNAPSHOT_CHARS = 50000;

export type ScreenshotCaptureReason = 'timeout' | 'error' | 'unavailable';

export interface ScreenshotCaptureResult {
    dataUrl: string;
    reason?: ScreenshotCaptureReason;
}

// Rotas onde a página inteira é sensível (autenticação) — não capturamos nada.
const DENY_LIST: RegExp[] = [
    /^\/login\/?$/i,
    /^\/logout\/?$/i,
    /^\/auth\//i,
    /^\/password/i,
    /^\/register\/?$/i,
];

/** Retorna true se a rota atual é segura para captura de snapshot/screenshot. */
export function isRouteSafeForSnapshot(pathname: string = safePathname()): boolean {
    return !DENY_LIST.some((re) => re.test(pathname));
}

function safePathname(): string {
    try {
        return typeof location !== 'undefined' ? location.pathname : '';
    } catch {
        return '';
    }
}

// Substitui value/setAttribute/defaultValue de inputs de senha e limpa campos
// ocultos cujo nome sugira credenciais (best-effort; não é garantia total).
function sanitizeClone(root: ParentNode): void {
    try {
        root.querySelectorAll(
            'input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"]'
        ).forEach((el) => {
            const input = el as HTMLInputElement;
            input.value = '';
            input.setAttribute('value', '');
            input.defaultValue = '';
        });
        root.querySelectorAll(
            'input[type="hidden"][name*="token" i], input[name*="apikey" i], input[name*="password" i], input[name*="secret" i]'
        ).forEach((el) => {
            const input = el as HTMLInputElement;
            input.value = '';
            input.setAttribute('value', '');
            input.defaultValue = '';
        });
    } catch { /* noop */ }
}

/**
 * Snapshot HTML serializado e sanitizado da página atual.
 * Retorna string vazia quando indisponível ou em rota sensível.
 */
export function captureHtmlSnapshot(): string {
    if (typeof document === 'undefined') return '';
    if (!isRouteSafeForSnapshot()) return '';
    try {
        const clone = document.documentElement.cloneNode(true) as HTMLElement;
        sanitizeClone(clone);
        const html = clone.outerHTML || '';
        return html.slice(0, MAX_HTML_SNAPSHOT_CHARS);
    } catch {
        return '';
    }
}

type TimedResult<T> =
    | { status: 'success'; value: T }
    | { status: 'timeout' }
    | { status: 'error' };

function withTimeout<T>(factory: () => Promise<T>, ms: number): Promise<TimedResult<T>> {
    return new Promise((resolve) => {
        let done = false;
        const finish = (result: TimedResult<T>) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => finish({ status: 'timeout' }), ms);
        Promise.resolve()
            .then(factory)
            .then(
                (value) => finish({ status: 'success', value }),
                () => finish({ status: 'error' }),
            );
    });
}

/**
 * Screenshot da viewport como PNG base64 (data URL: "data:image/png;base64,...").
 * Usa html2canvas-pro (import dinâmico p/ não carregar em ambientes sem DOM real).
 * Retorna um resultado com data URL ou o motivo da omissão/falha.
 */
export async function captureScreenshotDetailed(timeoutMs = CAPTURE_TIMEOUT_MS): Promise<ScreenshotCaptureResult> {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return { dataUrl: '', reason: 'unavailable' };
    }
    if (!isRouteSafeForSnapshot()) {
        return { dataUrl: '', reason: 'unavailable' };
    }

    const result = await withTimeout(async () => {
        const mod: typeof import('html2canvas-pro') = await import('html2canvas-pro');
        const html2canvas = mod.default;
        if (typeof html2canvas !== 'function') return null;

        const viewportWidth = Math.max(window.innerWidth, 1);
        const viewportHeight = Math.max(window.innerHeight, 1);
        const maxPixels = 2_000_000;
        const deviceScale = window.devicePixelRatio || 1;
        const scale = Math.min(deviceScale, Math.sqrt(maxPixels / (viewportWidth * viewportHeight)));
        return html2canvas(document.body, {
            useCORS: true,
            logging: false,
            scale,
            width: viewportWidth,
            height: viewportHeight,
            windowWidth: viewportWidth,
            windowHeight: viewportHeight,
            x: window.scrollX,
            y: window.scrollY,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            onclone: (clonedDocument: Document) => sanitizeClone(clonedDocument),
        });
    }, timeoutMs);

    if (result.status === 'timeout') return { dataUrl: '', reason: 'timeout' };
    if (result.status === 'error') return { dataUrl: '', reason: 'error' };
    if (!result.value || typeof result.value.toDataURL !== 'function') {
        return { dataUrl: '', reason: 'unavailable' };
    }
    try {
        const dataUrl = result.value.toDataURL('image/png');
        return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')
            ? { dataUrl }
            : { dataUrl: '', reason: 'unavailable' };
    } catch {
        return { dataUrl: '', reason: 'error' };
    }
}

export async function captureScreenshot(timeoutMs = CAPTURE_TIMEOUT_MS): Promise<string | null> {
    const result = await captureScreenshotDetailed(timeoutMs);
    return result.dataUrl || null;
}
