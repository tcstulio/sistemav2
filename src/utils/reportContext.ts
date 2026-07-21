// Captura de contexto para o "Reportar problema" — para o agente saber EXATAMENTE
// onde o usuário está (inclusive janela-dentro-de-janela) e o que falhou.
// Sem dependência de React: buffers globais + leitura da DOM no momento do report.
//
// A captura de console.log/warn/info/error e erros globais vive em errorBuffer.ts.
// Aqui ficam: o buffer de chamadas de API que falharam, o breadcrumb (DOM), e a
// composição do ReportContext final (incluindo htmlSnapshot + screenshot).

import { installErrorBuffer, readErrorBuffer } from './errorBuffer';
import { captureHtmlSnapshot, captureScreenshotDetailed, isRouteSafeForSnapshot } from './screenshot';

const MAX = 30;
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

/**
 * Instala a captura global de erros/logs (uma vez, no boot do app).
 * Mantida como thin-wrapper sobre installErrorBuffer por compatibilidade.
 */
export function installReportCapture() {
    installErrorBuffer();
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
    consoleLogs: string[];
    failedRequests: string[];
    htmlSnapshot: string;
    screenshot: string; // base64 PNG data URL ou ''
    // #1560: diagnóstico opcional sobre por que a captura visual foi parcial/omitida.
    // Ausente quando tudo foi capturado normalmente.
    captureMeta?: CaptureMeta;
}

/**
 * Diagnóstico da captura visual (HTML/screenshot). Combina os flags
 * `captureSkipped`/`captureError` das tentativas anteriores num único campo
 * opcional, mantendo compatibilidade com contextos já serializados.
 */
export interface CaptureMeta {
    /** Rota sensível (deny-list) — nem HTML nem screenshot foram capturados. */
    sensitiveRoute?: boolean;
    /** Screenshot omitido (timeout/html2canvas indisponível ou falhou). */
    screenshotOmitted?: boolean;
    /** Motivo textual curto p/ exibição na UI (transparência). */
    reason?: 'sensitive-route' | 'timeout' | 'error' | 'unavailable';
}

/** Snapshot síncrono do contexto atual (sem screenshot — esse é assíncrono). */
export function captureContext(): ReportContext {
    const buffer = readErrorBuffer();
    return {
        url: typeof location !== 'undefined' ? location.href : '',
        breadcrumb: typeof document !== 'undefined' ? buildBreadcrumb() : '',
        viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        consoleErrors: buffer.errors,
        consoleLogs: buffer.logs,
        failedRequests: [...failedRequests],
        htmlSnapshot: captureHtmlSnapshot(),
        screenshot: '',
    };
}

/**
 * Snapshot completo (assíncrono): captura o contexto síncrono + screenshot da
 * viewport com timeout de 5s. Se a captura estourar o timeout, retorna sem
 * screenshot/HTML, mas mantém logs, erros e os demais campos.
 *
 * Popula `captureMeta` quando a captura visual for parcial/omitida, p/ a UI
 * explicar ao usuário o motivo (rota sensível, timeout, etc.).
 */
export async function captureFullContext(): Promise<ReportContext> {
    const base = captureContext();
    // Rota sensível (deny-list): captureHtmlSnapshot já devolveu '' e
    // captureScreenshot devolverá null — registramos o motivo p/ a UI.
    if (!isRouteSafeForSnapshot()) {
        return {
            ...base,
            captureMeta: { sensitiveRoute: true, screenshotOmitted: true, reason: 'sensitive-route' },
        };
    }
    try {
        const screenshot = await captureScreenshotDetailed();
        if (screenshot.dataUrl) return { ...base, screenshot: screenshot.dataUrl };
        if (screenshot.reason === 'timeout') {
            return {
                ...base,
                htmlSnapshot: '',
                screenshot: '',
                captureMeta: { screenshotOmitted: true, reason: 'timeout' },
            };
        }
        return {
            ...base,
            captureMeta: {
                screenshotOmitted: true,
                reason: screenshot.reason || 'unavailable',
            },
        };
    } catch {
        return {
            ...base,
            captureMeta: { screenshotOmitted: true, reason: 'error' },
        };
    }
}

/** Acesso ao buffer de requisições que falharam (uso interno/testes). */
export function readFailedRequests(): string[] {
    return [...failedRequests];
}
