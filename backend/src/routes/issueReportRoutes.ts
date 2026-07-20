/**
 * issueReportRoutes — issue #1561.
 *
 * Rota POST /api/issues/report que recebe o payload completo do report
 * in-app (dados do usuário + htmlSnapshot + screenshot base64 + console
 * logs/errors) e:
 *   (1) valida com Zod (userId, url, viewport, userAgent obrigatórios);
 *   (2) rejeita screenshot > 5MB com 413 (middleware screenshotSizeGuard);
 *   (3) sanitiza o HTML (remove `<script>`, mantém estrutura p/ debug);
 *   (4) salva screenshot e HTML em disco, cria issue no GitHub e loga no
 *       audit trail;
 *   (5) retorna 201 com `{ reportId, issueUrl }`.
 *
 * Auth obrigatória via `requireDolibarrLogin` (mesma régua das outras
 * rotas — sem auth, 401 antes de tocar o service).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { screenshotSizeGuard } from '../middleware/uploadSanitizer';
import { processIssueReport } from '../services/issueReportService';
import { createGitHubIssue } from '../services/issueReportService';
import { created as createdResponse, fail } from '../utils/apiResponse';
import { createLogger } from '../utils/logger';

const log = createLogger('IssueReportRoutes');
const router = Router();

router.use(requireDolibarrLogin);

/**
 * Schema Zod do payload do report.
 *
 * Campos obrigatórios: userId, url, viewport, userAgent.
 * Critério #1561: "Endpoint retorna 400 se faltar campos obrigatórios
 * (pelo menos userId, url, viewport, userAgent)".
 */
const ReportSchema = z.object({
    userId: z.string().min(1, 'userId é obrigatório').max(200),
    url: z.string().min(1, 'url é obrigatório').max(2048),
    viewport: z.string().min(1, 'viewport é obrigatório').max(200),
    userAgent: z.string().min(1, 'userAgent é obrigatório').max(1000),

    title: z.string().max(250).optional(),
    description: z.string().max(10000).optional(),
    breadcrumb: z.string().max(500).optional(),
    element: z.string().max(500).optional(),
    source: z.string().max(500).optional(),

    // Screenshot como base64 (data URL ou puro). Tamanho validado pelo
    // screenshotSizeGuard ANTES do Zod parse para devolver 413 (não 400).
    screenshot: z.string().max(15_000_000).optional(),

    htmlSnapshot: z.string().max(2_000_000).optional(),

    consoleErrors: z.array(z.string().max(2000)).max(200).optional(),
    consoleLogs: z.array(z.string().max(2000)).max(200).optional(),
    failedRequests: z.array(z.string().max(2000)).max(200).optional(),

    labels: z.array(z.string().max(50)).max(5).optional(),
});

/**
 * POST /report — processa um report de issue vindo do app.
 *
 * Fluxo: validate (400) → size guard (413) → service → 201.
 * Erros inesperados caem em 500 com envelope padrão.
 */
router.post(
    '/report',
    screenshotSizeGuard,
    async (req: Request, res: Response) => {
        let parsed;
        try {
            parsed = ReportSchema.parse(req.body);
        } catch (e: any) {
            if (e instanceof z.ZodError) {
                return fail(res, 'VALIDATION_ERROR', 'Validation failed', 400, {
                    fields: e.issues.map((i: z.ZodIssue) => ({ field: i.path.join('.'), message: i.message })),
                });
            }
            log.error('POST /report: erro inesperado na validação', { err: e?.message });
            return fail(res, 'INTERNAL_ERROR', 'Erro interno de validação', 500);
        }

        const reporter =
            (req as any).user?.login ||
            (req as any).user?.firstname ||
            (req as any).user?.id ||
            undefined;

        try {
            const result = await processIssueReport(parsed, reporter);
            return createdResponse(res, {
                reportId: result.reportId,
                issueUrl: result.issueUrl,
                ...(result.issueNumber ? { issueNumber: result.issueNumber } : {}),
                ...(result.screenshotPath ? { screenshotUrl: result.screenshotPath } : {}),
                ...(result.htmlPath ? { htmlUrl: result.htmlPath } : {}),
            });
        } catch (e: any) {
            log.error('POST /report: falha ao processar report', { err: e?.message });
            return fail(
                res,
                'ISSUE_REPORT_FAILED',
                e?.message || 'Falha ao processar report',
                500,
            );
        }
    },
);

/**
 * GET /report/methods — descreve os métodos aceitos nesta rota (blast-radius:
 * evitar que POST seja a única superfície exposta sem um erro amigável para
 * GETs acidentais). Apenas informativo.
 */
router.get('/report', (_req: Request, res: Response) => {
    res.status(200).json({
        ok: true,
        method: 'POST',
        path: '/api/issues/report',
        required: ['userId', 'url', 'viewport', 'userAgent'],
        optional: ['title', 'description', 'screenshot', 'htmlSnapshot', 'consoleErrors', 'consoleLogs', 'failedRequests', 'labels'],
    });
});

/**
 * Repassa o helper createGitHubIssue para testes/integração via API (não
 * exposto como rota — apenas export do módulo p/ reaproveitamento).
 */
export { createGitHubIssue, ReportSchema };
export default router;
