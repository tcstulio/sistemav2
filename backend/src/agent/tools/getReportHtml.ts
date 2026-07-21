import { AppError } from '../../middleware/errorHandler';
import { getReportHtmlContent } from '../../services/issueReportService';

export function getReportHtml(reportId: unknown, selector?: unknown): string {
    const id = String(reportId ?? '').trim();
    if (!id) return 'Informe o reportId do report.';

    const cssSelector = typeof selector === 'string' && selector.trim() ? selector : undefined;
    try {
        return getReportHtmlContent(id, cssSelector);
    } catch (error) {
        if (error instanceof AppError) return error.message;
        return 'Não foi possível carregar o HTML do report.';
    }
}
