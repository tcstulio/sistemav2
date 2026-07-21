// Monta o corpo (markdown) do report in-app a partir do contexto capturado pelo
// botão "Reportar problema". Separado de githubRoutes para permitir teste puro
// (sem subir o Router nem dependências de express/child_process).
//
// Issue #1563: embute o screenshot como `![screenshot](url)` na seção
// "Contexto visual" (no topo do body), sanitiza + trunca o HTML snapshot a
// 5KB para não estourar o limite de 60KB da API do GitHub, e consolida
// `consoleErrors` + `consoleLogs` numa única seção "Console logs/erros".

import { sanitizeForIssueBody } from './sanitizeHtml';

/**
 * Contexto capturado pelo front e enviado no payload do report.
 * Espelha ReportContextPayload (front) / ReportContext (reportContext.ts).
 */
export interface IssueReportContext {
    url?: string;
    breadcrumb?: string;
    element?: string;
    source?: string;
    viewport?: string;
    userAgent?: string;
    consoleErrors?: string[];
    consoleLogs?: string[];
    failedRequests?: string[];
    /** Snapshot HTML cru (será sanitizado + truncado a 5KB antes de incluir). */
    htmlSnapshot?: string;
    /** Screenshot em base64 PNG (fallback quando não há URL pública). */
    screenshot?: string;
    /**
     * #1563: URL pública do screenshot persistido (ex.: `/static/reports/{id}.png`).
     * Quando presente, vai embarcada como `![screenshot](url)` no topo do body.
     */
    screenshotUrl?: string;
    // #1560: diagnóstico opcional da captura visual (espelha CaptureMeta do front).
    captureMeta?: {
        sensitiveRoute?: boolean;
        screenshotOmitted?: boolean;
        reason?: 'sensitive-route' | 'timeout' | 'error' | 'unavailable';
    };
}

function safeLine(value: unknown): string {
    return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function inlineCode(value: unknown): string {
    const text = safeLine(value);
    if (!text.includes('`')) return '`' + text + '`';
    const longestRun = Math.max(...(text.match(/`+/g) || ['']).map((run) => run.length));
    const fence = '`'.repeat(Math.max(2, longestRun + 1));
    return fence + ' ' + text + ' ' + fence;
}

function fencedBlock(language: string, values: unknown[] | string): string[] {
    const text = Array.isArray(values) ? values.map(safeLine).join('\n') : String(values);
    const longestRun = Math.max(...(text.match(/`+/g) || ['']).map((run) => run.length));
    const fence = '`'.repeat(Math.max(3, longestRun + 1));
    return [fence + language, text, fence];
}

/**
 * Renderiza a seção "Contexto visual" (#1563). A seção só aparece quando há
 * alguma informação de screenshot para mostrar:
 *   - `screenshotUrl` pública → embarca `![screenshot](url)` (preferido).
 *   - `screenshot` (base64 cru) → fallback textual (tamanho/presença).
 *   - `captureMeta.reason` → motivo da omissão (rota sensível, timeout, …).
 * Sem nenhuma das três → omitimos a seção inteira (não polui o body).
 */
function renderVisualContext(c: IssueReportContext): string[] {
    const lines: string[] = [];
    const hasUrl = typeof c.screenshotUrl === 'string' && c.screenshotUrl.trim().length > 0;
    const hasBase64 = typeof c.screenshot === 'string' && c.screenshot.length > 0;
    const hasReason = !!c.captureMeta?.reason;

    if (!hasUrl && !hasBase64 && !hasReason) return lines;

    lines.push('### Contexto visual', '');

    if (hasUrl) {
        lines.push(`![screenshot](${c.screenshotUrl})`, '');
        return lines;
    }
    if (hasBase64) {
        // Estimativa grosseira: cada 4 chars base64 ≈ 3 bytes → kb = chars*3/4/1024.
        const kb = Math.round((c.screenshot!.length * 3) / 4 / 1024);
        lines.push(`Screenshot capturado (${kb} kB base64/PNG) — salvo em anexo`, '');
        return lines;
    }
    // hasReason
    const map: Record<string, string> = {
        'sensitive-route': 'rota sensível (login/senha)',
        'timeout': 'timeout (≥5s) na captura',
        'error': 'erro ao gerar screenshot',
        'unavailable': 'html2canvas indisponível',
    };
    const reason = c.captureMeta!.reason as string;
    lines.push(`Screenshot não capturado — motivo: ${map[reason] || reason}`, '');
    return lines;
}

export function buildIssueBody(description: string, context: IssueReportContext | null | undefined, reporter?: string): string {
    const c: IssueReportContext = context ?? {};
    const lines: string[] = [];
    lines.push(description?.trim() || '_(sem descrição)_', '');
    lines.push('---', '');

    // #1563: "Contexto visual" (com screenshot embutido ou fallback textual).
    const visual = renderVisualContext(c);
    if (visual.length) lines.push(...visual);

    lines.push('### Contexto capturado automaticamente', '');
    if (reporter) lines.push(`- **Reportado por:** ${safeLine(reporter)}`);
    if (c.url) lines.push(`- **Tela (URL):** ${inlineCode(c.url)}`);
    if (c.breadcrumb) lines.push(`- **Onde:** ${safeLine(c.breadcrumb)}`);
    if (c.element) lines.push(`- **Elemento:** ${inlineCode(c.element)}`);
    if (c.source) lines.push(`- **Fonte (dev):** ${inlineCode(c.source)}`);
    if (c.viewport) lines.push(`- **Viewport:** ${safeLine(c.viewport)}`);
    if (c.userAgent) lines.push(`- **Navegador:** ${safeLine(c.userAgent)}`);

    // #1563: consoleErrors + consoleLogs consolidados em uma única seção.
    // Saída no code block: "[log] foo" / "[error] bar" — uma linha cada.
    const logs = Array.isArray(c.consoleLogs) ? c.consoleLogs.slice(0, 20) : [];
    const errors = Array.isArray(c.consoleErrors) ? c.consoleErrors.slice(0, 20) : [];
    if (logs.length || errors.length) {
        const combined = [
            ...logs.map((l) => `[log] ${safeLine(l)}`),
            ...errors.map((e) => `[error] ${safeLine(e)}`),
        ];
        lines.push('', '#### Console logs/erros', ...fencedBlock('', combined));
    }
    if (Array.isArray(c.failedRequests) && c.failedRequests.length) {
        // Mantemos seção separada (#1563): API failures merecem destaque próprio.
        lines.push('', '#### Chamadas de API que falharam', ...fencedBlock('', c.failedRequests.slice(0, 20)));
    }

    // #1563: HTML snapshot — sanitizado + truncado a 5KB (helper central).
    if (typeof c.htmlSnapshot === 'string' && c.htmlSnapshot.length > 0) {
        const { html } = sanitizeForIssueBody(c.htmlSnapshot);
        if (html.length > 0) {
            lines.push(
                '',
                '<details><summary>HTML snapshot (sanitizado)</summary>',
                '',
                ...fencedBlock('html', html),
                '',
                '</details>',
            );
        }
    }

    lines.push('', '_Reportado pelo botão in-app (Reportar problema)._');
    return lines.join('\n');
}
