import { Router, Request, Response } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/apiResponse';
import { aiJobService } from '../services/aiJobService';
import { socketService } from '../services/socketService';
import { createLogger } from '../utils/logger';

// #1577: rotas de controle de jobs do assistente (chat) expostas no prefixo
// /api/chat/jobs. Complementam o polling GET /api/ai/jobs/:id com duas ações
// acionadas pelo cliente:
//
//   POST /api/chat/jobs/:id/cancel
//     Marca um job ativo (queued/running) como cancelled e emite o evento de
//     socket 'chat:job:cancelled' carregando o partialSummary (texto acumulado
//     até o momento). O frontend usa o evento para encerrar o indicador de
//     "Processando..." e exibir o resumo parcial na UI.
//
//   POST /api/chat/jobs/:id/visibility
//     Body: { hidden: true | false }
//     Sinal de Page Visibility API: o cliente chama quando a aba fica oculta
//     (hidden=true) ou volta a ficar visível (hidden=false) durante um job
//     ativo. O backend registra o estado (pageHidden) e o timestamp do sinal
//     para dashboards/SLA e para ajustar o ritmo de notificações push.
//
// Mesmo auth de /api/ai/jobs/:id (login obrigatório). As duas rotas são
// idempotentes: cancelar/avisar visibilidade de job inexistente ou já
// terminal devolve 404 (missing/expired) sem alterar estado.

const log = createLogger('ChatJobsRoutes');

const router = Router();

router.use(requireDolibarrLogin);

/**
 * POST /api/chat/jobs/:id/cancel
 *
 * Body (opcional): { partialSummary?: string }
 *   O cliente pode repassar o texto parcial acumulado até o momento (streaming
 *   incompleto). Se ausente, o backend usa o que tiver no job (job.partialSummary
 *   ou job.result). Emite o evento 'chat:job:cancelled' com o payload:
 *     { jobId, status: 'cancelled', partialSummary, finishedAt }
 */
router.post(
    '/:id/cancel',
    asyncHandler(async (req: Request, res: Response) => {
        const jobId = req.params.id;
        const incomingSummary =
            typeof req.body?.partialSummary === 'string'
                ? req.body.partialSummary
                : undefined;

        const lookup = aiJobService.cancelJob(jobId, incomingSummary);
        if (!lookup.ok) {
            // 404 com reason explícita — o cliente diferencia "nunca existiu"
            // (missing) de "existiu mas expirou" (expired), igual ao GET /jobs/:id.
            if (lookup.reason === 'expired') {
                throw new AppError(404, 'JOB_EXPIRED', 'Job expirado.');
            }
            throw new AppError(404, 'JOB_NOT_FOUND', 'Job não encontrado.');
        }

        const job = lookup.job;
        // Preferência: texto passado pelo cliente > campo persistido > result.
        const partialSummary =
            incomingSummary ??
            job.partialSummary ??
            (typeof job.result === 'string'
                ? job.result
                : job.result?.reply ?? job.result?.text ?? '');

        const payload = {
            jobId,
            status: 'cancelled' as const,
            partialSummary,
            finishedAt: job.finishedAt,
        };

        try {
            socketService.emit('chat:job:cancelled', payload);
        } catch (e) {
            // Socket falhou (servidor sem IO inicializado, etc.) — não derruba
            // a rota: o estado do job já foi atualizado e o polling do cliente
            // ainda vai perceber o status 'cancelled'.
            log.warn(`Falha ao emitir chat:job:cancelled para ${jobId}`, e);
        }

        return ok(res, payload);
    }),
);

/**
 * POST /api/chat/jobs/:id/visibility
 *
 * Body: { hidden: boolean }
 *   hidden=true  → aba do cliente ficou oculta (usuário trocou de aba/minimizou).
 *   hidden=false → aba voltou a ficar visível.
 *
 * Aceita apenas boolean estrito no campo `hidden` para evitar coerções
 * involuntárias ("false" como string viria true com !!). 400 em caso contrário.
 */
router.post(
    '/:id/visibility',
    asyncHandler(async (req: Request, res: Response) => {
        const jobId = req.params.id;
        const { hidden } = req.body ?? {};

        if (typeof hidden !== 'boolean') {
            throw new AppError(
                400,
                'INVALID_VISIBILITY',
                'Campo "hidden" obrigatório e deve ser boolean.',
            );
        }

        const recorded = aiJobService.recordVisibility(jobId, hidden);
        if (!recorded) {
            // Job inexistente ou expirado: 404 com reason genérica (não há
            // distinção útil aqui — o cliente apenas para de sinalizar).
            throw new AppError(404, 'JOB_NOT_FOUND', 'Job não encontrado.');
        }

        return ok(res, { jobId, hidden, recordedAt: Date.now() });
    }),
);

export default router;
