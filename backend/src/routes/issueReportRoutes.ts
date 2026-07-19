/**
 * issueReportRoutes — POST /api/issues/report (issue #1561).
 *
 * Recebe o payload completo do "Reportar problema" (dados do usuário + htmlSnapshot
 * + screenshot base64 + console logs/errors), valida via Zod, delega o pipeline
 * ao issueReportService e responde:
 *   - 201 { reportId, issueUrl } em caso de sucesso;
 *   - 400 (VALIDATION_ERROR) se faltar campos obrigatórios (userId, url, viewport,
 *     userAgent) — via validateBody + errorHandler global;
 *   - 413 (PAYLOAD_TOO_LARGE) se o screenshot decodificado > 5 MiB;
 *   - 500 em outros erros (falha do `gh`, IO, etc.).
 *
 * Auth: requireDolibarrLogin (mesmo padrão de githubRoutes/aiRoutes/etc).
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { processIssueReport, MAX_SCREENSHOT_BYTES } from '../services/issueReportService';
import { createLogger } from '../utils/logger';

const log = createLogger('IssueReportRoute');
const router = Router();

router.use(requireDolibarrLogin);

/**
 * Schema Zod do payload. Campos obrigatórios (critério #1561):
 *   - userId, url, viewport, userAgent.
 * Opcionais: title/description (default para title), breadcrumb, htmlSnapshot,
 * screenshotBase64, consoleErrors/Logs, failedRequests, labels.
 */
export const IssueReportSchema = z.object({
    userId: z.string().min(1, 'userId é obrigatório'),
    url: z.string().min(1, 'url é obrigatório'),
    viewport: z.string().min(1, 'viewport é obrigatório'),
    userAgent: z.string().min(1, 'userAgent é obrigatório'),
    title: z.string().max(250).optional(),
    description: z.string().max(5000).optional(),
    breadcrumb: z.string().max(500).optional(),
    htmlSnapshot: z.string().max(2_000_000).optional(),
    screenshotBase64: z.string().max(12_000_000).optional(), // teto bruto p/ não estourar o JSON parser antes do check fino
    consoleErrors: z.array(z.string().max(1000)).max(100).optional(),
    consoleLogs: z.array(z.string().max(1000)).max(100).optional(),
    failedRequests: z.array(z.string().max(500)).max(100).optional(),
    labels: z.array(z.string().max(50)).max(5).optional(),
});

/**
 * POST /report — processa um report.
 *
 * O check fino de tamanho do screenshot (5 MiB decodificados) é feito pelo service
 * via assertScreenshotWithinLimit; o AppError(413) resultante é propagado ao
 * errorHandler global, que produz o envelope padronizado.
 */
router.post(
    '/report',
    validateBody(IssueReportSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const body = req.body as z.infer<typeof IssueReportSchema>;

        // Title fallback para que a issue tenha um título utilizável.
        const title = (body.title && body.title.trim())
            || `Report in-app — ${body.url.slice(0, 80)}`;

        const reporter = {
            id: (req as any).user?.id || body.userId,
            login: (req as any).user?.login || (req as any).user?.firstname,
            ip: req.ip || req.connection?.remoteAddress,
        };

        // basePublicUrl opcional (para servir URLs absolutas no GitHub).
        const basePublicUrl = process.env.PUBLIC_BASE_URL || '';

        try {
            const result = await processIssueReport(
                { ...body, title },
                reporter,
                { basePublicUrl },
            );
            res.status(201).json({
                reportId: result.reportId,
                issueUrl: result.issueUrl,
                issueNumber: result.issueNumber,
                screenshotUrl: result.screenshotUrl,
                htmlUrl: result.htmlUrl,
            });
        } catch (e: any) {
            // AppError (413/outras) já tem statusCode definido — delega ao errorHandler.
            if (e instanceof AppError) throw e;
            // Erro inesperado (ex.: `gh` CLI ausente/falhou) — loga e converte em 502
            // para não vazar stack/internals.
            log.error('processIssueReport falhou', { error: e?.message, userId: body.userId });
            throw new AppError(502, 'ISSUE_CREATE_FAILED', {
                message: 'Não foi possível criar a issue no GitHub.',
                details: { reason: String(e?.message || e).slice(0, 200) },
            });
        }
    }),
);

/** Method-not-allowed guard — blast-radius zero para verbos não-suportados. */
router.all('/report', (_req, res) => {
    res.status(405).json({ error: 'method_not_allowed' });
});

export { MAX_SCREENSHOT_BYTES };
export default router;
