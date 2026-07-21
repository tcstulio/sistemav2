// Monta o corpo (markdown) do report in-app a partir do contexto capturado pelo
// botão "Reportar problema". Separado de githubRoutes para permitir teste puro
// (sem subir o Router nem dependências de express/child_process).

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
    htmlSnapshot?: string;
    screenshot?: string;
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

export function buildIssueBody(description: string, context: IssueReportContext | null | undefined, reporter?: string): string {
    const c: IssueReportContext = context ?? {};
    const lines: string[] = [];
    lines.push(description?.trim() || '_(sem descrição)_', '');
    lines.push('---', '', '### Contexto capturado automaticamente', '');
    if (reporter) lines.push(`- **Reportado por:** ${safeLine(reporter)}`);
    if (c.url) lines.push(`- **Tela (URL):** ${inlineCode(c.url)}`);
    if (c.breadcrumb) lines.push(`- **Onde:** ${safeLine(c.breadcrumb)}`);
    if (c.element) lines.push(`- **Elemento:** ${inlineCode(c.element)}`);
    if (c.source) lines.push(`- **Fonte (dev):** ${inlineCode(c.source)}`);
    if (c.viewport) lines.push(`- **Viewport:** ${safeLine(c.viewport)}`);
    if (c.userAgent) lines.push(`- **Navegador:** ${safeLine(c.userAgent)}`);
    // #1560: screenshot da viewport (base64 PNG). GitHub não aceita data-URL inline
    // no markdown do body, então registramos tamanho/presença p/ triagem. (Upload
    // via API de attachments ficaria fora de escopo do botão de report.)
    if (c.screenshot && typeof c.screenshot === 'string') {
        const kb = Math.round((c.screenshot.length * 3) / 4 / 1024);
        lines.push(`- **Screenshot:** capturado (${kb} kB base64/PNG)`);
    } else if (c.captureMeta?.reason) {
        // Captura visual parcial/omitida — útil p/ triagem entender por que faltam dados.
        const map: Record<string, string> = {
            'sensitive-route': 'rota sensível (login/senha)',
            'timeout': 'timeout (≥5s) na captura',
            'error': 'erro ao gerar screenshot',
            'unavailable': 'html2canvas indisponível',
        };
        lines.push(`- **Screenshot:** não capturado — ${map[c.captureMeta.reason] || c.captureMeta.reason}`);
    }
    if (Array.isArray(c.consoleErrors) && c.consoleErrors.length) {
        lines.push('', '#### Erros de console', ...fencedBlock('', c.consoleErrors.slice(0, 20)));
    }
    if (Array.isArray(c.consoleLogs) && c.consoleLogs.length) {
        lines.push('', '#### Logs de console', ...fencedBlock('', c.consoleLogs.slice(0, 20)));
    }
    if (Array.isArray(c.failedRequests) && c.failedRequests.length) {
        lines.push('', '#### Chamadas de API que falharam', ...fencedBlock('', c.failedRequests.slice(0, 20)));
    }
    if (c.htmlSnapshot && typeof c.htmlSnapshot === 'string') {
        // Colapsável p/ não dominar a issue. Capping p/ caber no limite final do body.
        const cap = 20000;
        const snap = c.htmlSnapshot.length > cap
            ? `${c.htmlSnapshot.slice(0, cap)}\n<!-- truncado de ${c.htmlSnapshot.length} chars -->`
            : c.htmlSnapshot;
        lines.push('', '<details><summary>Snapshot HTML da página</summary>', '', ...fencedBlock('html', snap), '', '</details>');
    }
    lines.push('', '_Reportado pelo botão in-app (Reportar problema)._');
    return lines.join('\n');
}
