import {
    getReportScreenshotLink,
} from '../../services/issueReportService';

export function getReportScreenshot(reportId: unknown): string {
    const id = String(reportId ?? '').trim();
    if (!id) return 'Informe o reportId do report.';

    const link = getReportScreenshotLink(id);
    if (!link) return 'Report não encontrado.';

    return `Print do report: ${link}\nO link é válido por 1 hora.`;
}
