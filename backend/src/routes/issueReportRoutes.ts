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
 * Endpoints de LEITURA (#1562) — usados pelas ferramentas do agente Marciano
 * (`get_report_screenshot` / `get_report_html`) para puxar o print/HTML já
 * persistido quando o usuário descrever um problema visual:
 *   - `GET /api/issues/report/:id/screenshot` → link assinado temporário (1h)
 *   - `GET /api/issues/report/:id/html[?selector=...]` → HTML bruto ou filtrado
 *   - `GET /api/issues/report/:id/file.<ext>?token=...` → binário (via token)
 *
 * Resposta:
 *   - `201 { reportId, issueUrl, issueNumber?, screenshotUrl, htmlUrl }` em sucesso (POST)
 *   - `200 { url, expiresAt, mime }` em sucesso (GET screenshot)
 *   - `200 { html, truncated?, matchedSelector? }` em sucesso (GET html)
 *   - `200 image/<ext>` binário (GET file)
 *   - `400` em campos obrigatórios ausentes / params inválidos
 *   - `401 TOKEN_INVALID_OR_EXPIRED` no GET file com token ruim
 *   - `404 REPORT_NOT_FOUND` / `SELECTOR_NO_MATCH` nos GETs
 *   - `413` em screenshot > 5 MB (decodificado, no POST)
 *   - `502` em falha do helper `gh` (propagada como AppError, no POST)
 *
 * Auth: `requireDolibarrLogin` — mesma política do resto de `/api/github/*`
 * (exceto o `GET /file.<ext>?token=...` que valida o token em vez de login).
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
    findPersistedScreenshot,
    buildSignedScreenshotUrl,
    verifySignedScreenshotToken,
    loadPersistedScreenshot,
    loadPersistedHtmlFiltered,
    truncateUtf8,
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

// =====================================================================
// #1562 — endpoints de LEITURA para ferramentas do agente Marciano.
// Servem o screenshot (via URL assinada temporária) e o HTML (bruto ou
// filtrado por seletor CSS) já persistidos pelo POST acima. Esses GETs
// são a contraparte "ler o que foi reportado" — uma issue visual sem o
// print/HTML perde metade do contexto, e o LLM precisa enxergar.
// =====================================================================

/**
 * GET /api/issues/report/:id/screenshot
 *
 * Devolve um LINK ASSINÁVEL temporário (válido por 1h) para a screenshot
 * persistida — pronto p/ colar numa issue do GitHub, abrir num chat, ou
 * passar de volta para o LLM (que tem visão). NÃO serve o arquivo binário
 * direto: o link retornado aponta para `/file.<ext>?token=...` (rota
 * abaixo) que valida o token sem exigir login.
 *
 * Auth: `requireDolibarrLogin` — mesma política do resto de `/api/issues/*`.
 * Resposta:
 *   - `200 { url, expiresAt, mime }` em sucesso (URL relativa `/api/...`).
 *   - `404 REPORT_NOT_FOUND` se o reportId não existir / não tiver screenshot.
 *   - `400 INVALID_REPORT_ID` se reportId malformado.
 */
router.get(
    '/issues/report/:id/screenshot',
    requireDolibarrLogin,
    (req: Request, res: Response, next: NextFunction) => {
        try {
            const reportId = String(req.params.id || '').trim();
            const found = findPersistedScreenshot(reportId);
            if (!found) {
                throw new AppError(
                    404,
                    'REPORT_NOT_FOUND',
                    `Report ${reportId} não encontrado ou sem screenshot anexada.`,
                );
            }
            const ttlSeconds = 3600;
            const url = buildSignedScreenshotUrl(reportId, found.ext, ttlSeconds);
            const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
            log.info('Screenshot URL assinada emitida', { reportId, ext: found.ext, ttlSeconds });
            res.json({
                reportId,
                mime: found.mime,
                ext: found.ext,
                url,
                expiresAt,
                ttlSeconds,
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /api/issues/report/:id/html[?selector=...&maxBytes=N]
 *
 * Devolve o HTML persistido (sanitizado) do report. Aceita um `selector`
 * (CSS) opcional — se passado, retorna APENAS o `innerHTML` do PRIMEIRO
 * match, reduzindo ruído para o LLM (AC #1562). `maxBytes` opcional para
 * truncar resposta (cap defensivo; default 200KB, máx 1MB).
 *
 * Auth: `requireDolibarrLogin`.
 * Resposta:
 *   - `200 { html, truncated?, matchedSelector? }` em sucesso.
 *   - `404 REPORT_NOT_FOUND` se o reportId não existir / sem HTML.
 *   - `404 SELECTOR_NO_MATCH` se o seletor não casar.
 *   - `400 INVALID_SELECTOR` / `INVALID_REPORT_ID` em params ruins.
 */
router.get(
    '/issues/report/:id/html',
    requireDolibarrLogin,
    (req: Request, res: Response, next: NextFunction) => {
        try {
            const reportId = String(req.params.id || '').trim();
            const rawSelector = typeof req.query.selector === 'string' ? req.query.selector.trim() : '';
            const rawMaxBytes = typeof req.query.maxBytes === 'string' ? Number(req.query.maxBytes) : NaN;
            const maxBytes = Number.isFinite(rawMaxBytes) && rawMaxBytes > 0
                ? Math.min(Math.floor(rawMaxBytes), 1024 * 1024)
                : 200 * 1024;

            const { html, truncated: persistedTruncated } = loadPersistedHtmlFiltered(reportId, rawSelector || undefined);
            const limited = truncateUtf8(html, maxBytes);
            const outHtml = limited.truncated ? `${limited.value}\n<!-- truncated -->` : limited.value;
            const truncated = persistedTruncated || limited.truncated;

            res.json({
                reportId,
                selector: rawSelector || null,
                html: outHtml,
                bytes: Buffer.byteLength(outHtml, 'utf8'),
                truncated,
                matchedSelector: !!rawSelector,
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /api/issues/report/:id/file.<ext>?token=...
 *
 * Serve o ARQUIVO BINÁRIO da screenshot validando o token assinado. Não
 * exige auth (o token É a credencial, com TTL de 1h). O caminho inclui a
 * extensão (`.png`, `.jpg`, etc.) para que o Content-Type saia correto
 * sem precisar de query string adicional.
 *
 * Resposta:
 *   - `200 image/<ext>` binário em sucesso.
 *   - `404 REPORT_NOT_FOUND` se o arquivo sumiu do disco (raro, mas pode
 *     acontecer se alguém limpou `uploads/reports/` entre a geração e o
 *     consumo do link).
 *   - `400 INVALID_REPORT_ID` / `INVALID_EXT` em path malformado.
 *   - `401 TOKEN_INVALID_OR_EXPIRED` se token ausente, adulterado ou expirado.
 */
router.get(
    '/issues/report/:id/file.:ext',
    (req: Request, res: Response, next: NextFunction) => {
        try {
            const reportId = String(req.params.id || '').trim();
            const rawExt = String(req.params.ext || '').trim().toLowerCase();
            // Allowlist de extensões de IMAGEM (espelha `IMAGE_EXT_BY_MIME` no
            // service). Defesa em profundidade: mesmo que o regex permissivo
            // passasse, uma `.php` ou `.html` aqui significa "alguém tentou
            // baixar arquivo não-imagem" — recusamos antes de qualquer leitura.
            const ALLOWED_FILE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
            if (!ALLOWED_FILE_EXTS.includes(rawExt)) {
                throw new AppError(
                    400,
                    'INVALID_EXT',
                    `Extensão inválida no path: "${rawExt}". Aceitas: ${ALLOWED_FILE_EXTS.join(', ')}.`,
                );
            }
            const token = typeof req.query.token === 'string' ? req.query.token : null;
            const verified = verifySignedScreenshotToken(reportId, rawExt, token);
            if (!verified) {
                throw new AppError(
                    401,
                    'TOKEN_INVALID_OR_EXPIRED',
                    'Token de acesso ao arquivo ausente, expirado ou adulterado. Gere um novo link via GET /api/issues/report/:id/screenshot.',
                );
            }
            let payload: { bytes: Buffer; mime: string; ext: string };
            try {
                payload = loadPersistedScreenshot(reportId);
            } catch (e: any) {
                if (e?.code === 'REPORT_NOT_FOUND') {
                    throw new AppError(404, 'REPORT_NOT_FOUND', e.message);
                }
                throw e;
            }
            // Re-checagem defensiva: a extensão no path TEM que bater com a do arquivo.
            // Se a persistência usou .png mas o atacante pediu .html no path, o verifySignedScreenshotToken
            // já recusa (ext !== payload.ext). Esta é a 2ª barreira.
            if (payload.ext !== rawExt) {
                throw new AppError(400, 'EXT_MISMATCH', 'Extensão do arquivo não corresponde ao solicitado.');
            }
            res.setHeader('Content-Type', payload.mime);
            res.setHeader('Cache-Control', 'private, max-age=300');
            res.send(payload.bytes);
        } catch (err) {
            next(err);
        }
    }
);

export default router;
