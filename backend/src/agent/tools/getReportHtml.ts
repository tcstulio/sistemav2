import { loadPersistedHtmlFiltered, truncateUtf8 } from '../../services/issueReportService';

export const REPORT_TOOL_HTML_MAX_BYTES = 200 * 1024;

function getArgs(args: unknown): Record<string, unknown> {
    return args && typeof args === 'object' ? args as Record<string, unknown> : {};
}

function getReportId(args: unknown): string {
    const values = getArgs(args);
    const value = values.reportId ?? values.report_id;
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function getSelector(args: unknown): string {
    const values = getArgs(args);
    const value = values.selector ?? values.css_selector;
    return typeof value === 'string' ? value.trim() : '';
}

function getErrorCode(error: unknown): string {
    return error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
}

function markdownFence(value: string): string {
    const runs = value.match(/`+/g) || [];
    const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
    const fence = '`'.repeat(Math.max(3, longestRun + 1));
    return `${fence}html\n${value}\n${fence}`;
}

function friendlyError(reportId: string, selector: string, error: unknown): string | null {
    const code = getErrorCode(error);
    if (code === 'REPORT_NOT_FOUND') {
        return `Report ${reportId} não encontrado ou sem HTML anexado. Confirme o reportId ou peça ao usuário o link da issue.`;
    }
    if (code === 'SELECTOR_NO_MATCH') {
        return `Nenhum elemento encontrado no HTML do report ${reportId} para o seletor "${selector}". Tente um seletor mais amplo (ex.: remova o último ":nth-child(...)") ou chame sem seletor para receber o HTML completo.`;
    }
    if (code === 'INVALID_SELECTOR') {
        return `Seletor CSS inválido. Use a sintaxe padrão (ex.: "#id", ".classe", "table > tbody > tr", "div[data-foo='bar']").`;
    }
    if (code === 'INVALID_REPORT_ID') {
        return `O reportId "${reportId}" é inválido. Informe o identificador retornado pelo botão "Reportar problema".`;
    }
    return null;
}

export function executeGetReportHtml(args: unknown): string {
    const reportId = getReportId(args);
    if (!reportId) {
        return 'Informe o reportId (ex.: "peça para o Marciano ver o HTML do report #42" → reportId="42").';
    }
    const selector = getSelector(args);

    let html: string;
    let persistedTruncated = false;
    try {
        const result = loadPersistedHtmlFiltered(reportId, selector || undefined);
        html = result.html;
        persistedTruncated = Boolean(result.truncated);
    } catch (error) {
        return friendlyError(reportId, selector, error)
            || `Não foi possível ler o HTML do report ${reportId}. Tente novamente ou confirme o reportId.`;
    }

    const limited = truncateUtf8(html, REPORT_TOOL_HTML_MAX_BYTES);
    const truncated = persistedTruncated || limited.truncated;
    if (limited.truncated) html = `${limited.value}\n<!-- truncated -->`;
    const selectorNote = selector ? ` (filtrado pelo seletor: ${selector})` : ' (HTML completo, sem filtro)';
    const truncatedNote = truncated ? ' [truncado em 200KB]' : '';
    return `HTML do report ${reportId}${selectorNote}${truncatedNote}:\n\n${markdownFence(html)}`;
}

export const getReportHtml = {
    name: 'get_report_html',
    description: 'Busca o HTML de um report e aceita um seletor CSS opcional; com seletor, devolve o innerHTML do primeiro match. Exemplo: peça para o Marciano analisar o HTML do report #42 no seletor .modal.',
    execute: executeGetReportHtml,
};

export default getReportHtml;
