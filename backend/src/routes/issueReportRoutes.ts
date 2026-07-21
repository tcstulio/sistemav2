/**
 * Rota dedicada para o botão "Reportar problema" (issue #1561, sub-tarefa 2).
 *
 * `POST /api/issues/report` — recebe o contexto completo capturado pelo front
 * (screenshot base64, htmlSnapshot, console logs/erros, chamadas de API que
 * falharam) e persiste + cria uma issue no GitHub.
 *
 * Diferença vs `POST /api/github/issues`: este endpoint persiste os arquivos
 * binários (screenshot/HTML), gera `reportId` (UUID), usa o helper compartilhado
 * `createGitHubIssue` e grava entrada no audit log.
 *
 * Resposta:
 *   - `201 { reportId, issueUrl, issueNumber?, screenshotUrl, htmlUrl }` em sucesso
 *   - `400` em campos obrigatórios ausentes (`userId`, `url`, `viewport`, `userAgent`)
 *   - `413` em screenshot > 5 MB (decodificado)
 *   - `502` em falha do helper `gh` (propagada como AppError)
 *
 * Auth: `requireDolibarrLogin` — mesma política do resto de `/api/github/*`.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { adminAuditService } from '../services/adminAuditService';
import { createLogger } from '../utils/logger';
import { AppError, ValidationError } from '../middleware/errorHandler';
import {
    processIssueReport,
    SCREENSHOT_MAX_BYTES,
    IssueReportPayload,
} from '../services/issueReportService';

const log = createLogger('IssueReportRoute');

const router = Router();

// === Validação Zod ===
// Mantida INLINE (em vez de usar middleware validateBody) p/ retornar ENVELOPE
// `{ reportId?, error: { ... } }` consistente com a resposta de sucesso do
// endpoint — o cliente usa `reportId` p/ correlacionar mesmo em erros.

const ReportPayloadSchema = z.object({
    userId: z.string().min(1, 'userId é obrigatório'),
    userLogin: z.string().optional(),
    title: z.string().max(250).optional(),
    description: z.string().max(10_000).optional(),
    url: z.string().min(1, 'url é obrigatória'),
    breadcrumb: z.string().max(500).optional(),
    element: z.string().max(500).optional(),
    source: z.string().max(200).optional(),
    viewport: z.string().min(1, 'viewport é obrigatório'),
    userAgent: z.string().min(1, 'userAgent é obrigatório'),
    consoleErrors: z.array(z.string().max(2_000)).max(100).optional(),
    consoleLogs: z.array(z.string().max(2_000)).max(100).optional(),
    failedRequests: z.array(z.string().max(2_000)).max(100).optional(),
    // htmlSnapshot inteiro — sanitizer no service capará em 1MB no pior caso.
    htmlSnapshot: z.string().max(5 * 1024 * 1024).optional(),
    // base64 puro OU `data:<mime>;base64,...` — tamanho do STRING (não decoded).
    // Limite mais permissivo no zod (7MB) p/ dar margem ao decode (base64 infla ~33%).
    // O limite REAL de 5MB nos bytes decodificados é checado no service.
    screenshot: z.string().max(7 * 1024 * 1024).optional(),
    captureMeta: z
        .object({
            sensitiveRoute: z.boolean().optional(),
            screenshotOmitted: z.boolean().optional(),
            reason: z.enum(['sensitive-route', 'timeout', 'error', 'unavailable']).optional(),
        })
        .optional(),
    extraLabels: z.array(z.string().max(50)).max(5).optional(),
});

export type ReportPayload = z.infer<typeof ReportPayloadSchema>;

/**
 * Helper de parse — converte 400 do Zod em `ValidationError` envelopado.
 * Não usa validateBody middleware p/ poder adicionar `reportId` no body
 * de erro quando já temos um (idempotência/retries do front).
 */
function parsePayload(input: unknown): ReportPayload {
    try {
        return ReportPayloadSchema.parse(input);
    } catch (err) {
        if (err instanceof ZodError) {
            const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
            throw new ValidationError('Validation failed', details);
        }
        throw err;
    }
}

// === Handler ===

/**
 * POST /api/issues/report
 *
 * Cria um report: persiste screenshot + html, cria issue no GitHub via helper
 * compartilhado, devolve `201 { reportId, issueUrl, ... }`. Audit log de quem
 * reportou + timestamp + ip (se igual ao `auditMiddleware`).
 */
router.post(
    '/issues/report',
    requireDolibarrLogin,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const body = parsePayload(req.body);
            const user = (req as any).user || {};
            const userId = String(user.id || user.login || body.userId);
            const userLogin = String(user.login || body.userLogin || userId);

            // Pré-checagem do tamanho do screenshot decodificado (413 ANTES de
            // qualquer trabalho pesado — persist + chamada `gh`). Decode barato.
            if (body.screenshot) {
                // Calcula tamanho decodificado sem alocar tudo no Buffer (string/4*3).
                const base64Part = body.screenshot.split(',').pop() || '';
                const estimatedBytes = Math.floor((base64Part.length * 3) / 4);
                if (estimatedBytes > SCREENSHOT_MAX_BYTES) {
                    throw new AppError(
                        413,
                        'SCREENSHOT_TOO_LARGE',
                        `Screenshot excede o limite de ${(SCREENSHOT_MAX_BYTES / 1024 / 1024).toFixed(0)}MB`
                    );
                }
            }

            const payload: IssueReportPayload = {
                ...body,
                userId,
                userLogin,
                ip: req.ip || req.socket?.remoteAddress,
            };

            const result = await processIssueReport(payload);

            // Audit log — quem reportou, quando e link p/ issue resultante.
            // Não quebramos a response se o record falhar (try/catch interno do service).
            try {
                adminAuditService.record({
                    adminId: userId,
                    adminLogin: userLogin,
                    action: 'issue.report.create',
                    target: result.issueUrl,
                    summary: `Report criado: ${result.issueUrl}`,
                    userId,
                    userRole: user.role || 'user',
                    timestamp: new Date().toISOString(),
                    ip: payload.ip || 'unknown',
                });
            } catch (auditErr) {
                log.warn('audit log falhou (não-bloqueante)', { auditErr });
            }

            res.status(201).json({
                success: true,
                reportId: result.reportId,
                issueUrl: result.issueUrl,
                issueNumber: result.issueNumber,
                screenshotUrl: result.screenshotUrl,
                htmlUrl: result.htmlUrl,
            });
        } catch (err) {
            next(err);
        }
    }
);

// Head/GET para healthcheck do endpoint (usado pelo tunnel / smoke tests).
router.get('/issues/report/_health', (_req: Request, res: Response) => {
    res.json({ ok: true, endpoint: 'POST /api/issues/report' });
});

export default router;
