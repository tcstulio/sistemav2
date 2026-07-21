import {
    buildSignedScreenshotUrl,
    findPersistedScreenshot,
    SCREENSHOT_URL_TTL_SECONDS,
} from '../../services/issueReportService';

function getReportId(args: unknown): string {
    if (!args || typeof args !== 'object') return '';
    const values = args as Record<string, unknown>;
    const value = values.reportId ?? values.report_id;
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function reportNotFoundMessage(reportId: string): string {
    return `Report ${reportId} não encontrado ou sem screenshot anexada. Confirme o reportId (UUID retornado pelo botão "Reportar problema") ou peça ao usuário o link da issue do GitHub.`;
}

export function executeGetReportScreenshot(args: unknown): string {
    const reportId = getReportId(args);
    if (!reportId) {
        return 'Informe o reportId (ex.: "peça para o Marciano ver o print do report #42" → reportId="42").';
    }

    try {
        const found = findPersistedScreenshot(reportId);
        if (!found) return reportNotFoundMessage(reportId);

        const url = buildSignedScreenshotUrl(reportId, found.ext, SCREENSHOT_URL_TTL_SECONDS);
        const expiresAt = new Date(Date.now() + SCREENSHOT_URL_TTL_SECONDS * 1000).toISOString();
        return `Screenshot do report ${reportId} (mime: ${found.mime}, válido até ${expiresAt}):\n\n<img src="${url}" alt="Screenshot do report ${reportId}" />\n\nURL assinada (válida por ${SCREENSHOT_URL_TTL_SECONDS}s / 1h): ${url}`;
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
        if (code === 'INVALID_REPORT_ID' || code === 'REPORT_NOT_FOUND') return reportNotFoundMessage(reportId);
        return `Não foi possível acessar o screenshot do report ${reportId}. Tente novamente ou confirme o reportId.`;
    }
}

export const getReportScreenshot = {
    name: 'get_report_screenshot',
    description: 'Busca o print de um report e devolve uma URL assinada temporária, válida por 1 hora. Exemplo: peça para o Marciano ver o print do report #42.',
    execute: executeGetReportScreenshot,
};

export default getReportScreenshot;
