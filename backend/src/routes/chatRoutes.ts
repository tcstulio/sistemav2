/**
 * #1578 — Rotas do chat do assistente.
 *
 * Mantém endpoints que NÃO são de geração de reply (esses ficam em aiRoutes.ts,
 * histórico e separação por responsabilidade). Aqui mora o estado de UX do
 * cliente relacionado a um job:
 *
 *   POST /api/chat/jobs/:id/visibility
 *     - atualiza a flag `tabHidden` (aba oculta) no jobState.
 *     - usado pelo agentCompletionNotifier para decidir se dispara notify_person
 *       no fim do job (aba oculta → notifica; visível → silencioso).
 *
 *   GET  /api/chat/notify-prefs
 *   PUT  /api/chat/notify-prefs
 *     - preferências de opt-out do usuário corrente. Quando optedOut=true,
 *       nenhuma notificação de "Pronto" é disparada, mesmo com aba oculta.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/apiResponse';
import { jobState } from '../agent/jobState';
import { aiJobService } from '../services/aiJobService';
import { userNotifyPrefsStore } from '../services/userNotifyPrefsStore';

const router = Router();

// Todas as rotas aqui exigem login (contexto de usuário para recipient/opt-out).
router.use(requireDolibarrLogin);

const VisibilitySchema = z.object({
    tabHidden: z.boolean(),
});

/**
 * POST /api/chat/jobs/:id/visibility
 *
 * Body: { tabHidden: boolean }  — true quando document.hidden=true no cliente.
 *
 * Idempotente: o cliente chama a cada evento visibilitychange do navegador.
 * Cria o jobState sob demanda (pode chegar antes do servidor ter feito init
 * no enqueue, embora raro). 404 se o job não existe ou expirou.
 */
router.post('/jobs/:id/visibility', asyncHandler(async (req, res, next) => {
    const jobId = req.params.id;
    const parsed = VisibilitySchema.parse(req.body);
    const { tabHidden } = parsed;

    // Valida que o job existe no aiJobService (404 distinto: missing vs expired).
    const lookup = aiJobService.get(jobId);
    if (!lookup.ok) {
        if (lookup.reason === 'expired') {
            return next(new AppError(404, 'JOB_EXPIRED', 'Job expirado.'));
        }
        return next(new AppError(404, 'JOB_NOT_FOUND', 'Job não encontrado.'));
    }

    // Garante que o estado existe (overlay seguro — init preserva campos já setados).
    jobState.init(jobId);
    jobState.setVisibility(jobId, tabHidden);

    return ok(res, { jobId, tabHidden });
}));

const NotifyPrefsSchema = z.object({
    optedOut: z.boolean(),
});

/** GET /api/chat/notify-prefs — preferências do usuário corrente. */
router.get('/notify-prefs', asyncHandler(async (req, res) => {
    const userId = String((req as any).user?.id || '');
    const prefs = userNotifyPrefsStore.get(userId);
    return ok(res, prefs);
}));

/** PUT /api/chat/notify-prefs — define opt-out do usuário corrente. */
router.put('/notify-prefs', asyncHandler(async (req, res) => {
    const userId = String((req as any).user?.id || '');
    const { optedOut } = NotifyPrefsSchema.parse(req.body);
    const prefs = userNotifyPrefsStore.setOptOut(userId, optedOut);
    return ok(res, prefs);
}));

export default router;
