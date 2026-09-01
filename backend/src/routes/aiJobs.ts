import { Router } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/apiResponse';
import { aiJobService } from '../services/aiJobService';
import { getProgressStream } from '../agent/progressStream';

// #1011: endpoint de heartbeat leve — GET /api/ai-jobs/:id/status.
//
// Independente do endpoint principal de resultado (GET /api/ai/jobs/:id, que devolve
// o payload completo). Este aqui consulta o aiJobService em memória e devolve APENAS
// metadados de liveness, sem tocar em disco nem baixar o resultado parcial. Serve para
// o cliente detectar que o job continua vivo durante tempestades de 429 (rate-limit):
// o polling de status não conta como "AI request" cara e é barato de servir.
//
// Distinção de 404: id desconhecido -> { reason: 'not_found' }; job expirado (TTL
// purgado) -> { reason: 'expired' }. O cliente diferencia "nunca existiu / foi GC'd"
// de "existiu mas expirou", sem confundir os dois.

const router = Router();

// Mesmo auth do endpoint principal de jobs (GET /api/ai/jobs/:id exige login).
router.use(requireDolibarrLogin);

router.get('/:id/status', (req, res) => {
    const lookup = aiJobService.getJobStatus(req.params.id);
    if (!lookup.ok) {
        // 404 distinto por `reason`: 'not_found' (id desconhecido) vs 'expired' (TTL).
        return res.status(404).json({ reason: lookup.reason === 'expired' ? 'expired' : 'not_found' });
    }
    res.status(200).json(lookup.status);
});

/**
 * #1059: cancelamento genérico de QUALQUER job de IA (chat, forecast, etc).
 *
 *   POST /api/ai-jobs/:id/cancel
 *
 * É o ponto de entrada ÚNICO para o cliente que só conhece o `jobId` retornado pelo
 * `POST /api/ai/generate-reply-async` (chat) ou `POST /api/ai/analyze/sales-forecast-async`.
 * Complementa o `POST /api/chat/jobs/:id/cancel` que é específico do chat (combina o
 * `requestCancel` do `ProgressStream` com `aiJobService.cancel`).
 *
 * Diferenças em relação ao `/chat/jobs/:id/cancel`:
 *   - NÃO chama `stream.requestCancel()` (este endpoint cobre jobs que NÃO usam o
 *     `ProgressStream` — ex.: forecast). O `aiJobService.cancel()` cobre o caminho
 *     comum (AbortController + queue removal) e é suficiente.
 *   - Mesma checagem de ownership e mesmo mapeamento HTTP (`aiJobService.cancel`
 *     retorna `{cancelled, status|reason}` e o handler traduz em 200/403/404/409).
 *
 * Auth: protegido por `requireDolibarrLogin` (no router.use acima) — só o DONO do job
 * (userId/login) OU admin pode cancelar. Cross-user → 403; job já terminal → 200
 * idempotente; id desconhecido → 404; id expirado (TTL) → 404.
 */
router.post(
    '/:id/cancel',
    asyncHandler(async (req, res) => {
        const jobId = String(req.params.id || '').trim();
        if (!jobId) {
            throw new AppError(400, 'BAD_REQUEST', 'jobId é obrigatório.');
        }
        const user = (req as any).user || {};
        const actor = {
            userId: user.id ? String(user.id) : '',
            userLogin: user.login ? String(user.login) : '',
        };
        const isAdmin = user.admin === '1' || user.admin === 1 || user.admin === true;

        const result = aiJobService.cancel(jobId, {
            reason: 'user-cancel',
            ...(isAdmin ? {} : { actor }),
        });

        if (!result.cancelled) {
            if (result.reason === 'missing') {
                throw new AppError(404, 'JOB_NOT_FOUND', 'Job não encontrado.');
            }
            if (result.reason === 'expired') {
                throw new AppError(404, 'JOB_EXPIRED', 'Job expirado.');
            }
            if (result.reason === 'not_cancellable') {
                const owner = aiJobService.getOwner(jobId);
                const ownerLogin = owner?.userLogin || 'desconhecido';
                throw new AppError(403, 'JOB_FORBIDDEN', `Apenas o dono do job (${ownerLogin}) pode cancelá-lo.`);
            }
            // already_terminal: 200 idempotente — UX consistente com o endpoint de chat.
            return ok(res, { jobId, status: 'already_terminal' });
        }

        // #1059: para jobs que TAMBÉM usam o ProgressStream (chat), propagamos a flag
        // `requestCancel` aqui. É no-op para forecast/outros que não usam o stream.
        try {
            getProgressStream().requestCancel(jobId);
        } catch {
            // best-effort: o stream é opcional para esta rota.
        }
        return ok(res, { jobId, status: 'cancelling' });
    }),
);

export default router;
