/**
 * Approval Routes
 *
 * Endpoints para gerenciar aprovações de automações bancárias.
 *
 * Segurança (#1544):
 *  - Todas as rotas exigem login (`requireDolibarrLogin`).
 *  - Ações financeiras sensíveis (aprovar/rejeitar/bulk) exigem admin
 *    (`requireDolibarrAdmin`) — usuários comuns só listam/consultam e criam
 *    novas pendências (que só são executadas após aprovação de um admin).
 *  - Query params e bodies validados via Zod (`validateQuery`/`validateBody`).
 *  - Respostas padronizadas pelo envelope `apiResponse`.
 *  - Erros propagados via `next(error)` ao errorHandler global.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { approvalService, ActionType, ActionStatus } from '../services/approvalService';
import { requireDolibarrLogin, requireDolibarrAdmin } from '../middleware/authMiddleware';
import { validateBody, validateQuery, validateParams, IdParamSchema } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';
import { ok, created, fail } from '../utils/apiResponse';
import { createLogger } from '../utils/logger';

const log = createLogger('Approval');
const router = Router();

// Login obrigatório para TODAS as rotas de aprovação (leitura e escrita).
router.use(requireDolibarrLogin);

// ===== Schemas de Validação =====

const ActionTypeEnum = z.enum([
    'pagar_boleto',
    'enviar_pix',
    'baixar_fatura',
    'enviar_documento',
    'aprovar_reconciliacao',
    'consulta_saldo',
]);

const ActionStatusEnum = z.enum(['pending', 'approved', 'rejected', 'executed', 'failed']);

const BancoEnum = z.enum(['inter', 'itau']);

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Payload de criação: obrigatoriamente um objeto (rejeita null/array/primitivo).
 * O conteúdo é variável por tipo/banco (repassado à API bancária), então usamos
 * `.passthrough()` para preservar os campos — mas NUNCA mais `z.any()`, que
 * aceitaria qualquer valor (inclusive não-objeto), abrindo brecha para dados
 * arbitrários na fila de aprovação.
 */
const ActionPayloadSchema = z.object({}).passthrough();

const CreateActionSchema = z.object({
    type: ActionTypeEnum,
    banco: BancoEnum.optional(),
    payload: ActionPayloadSchema,
    description: z.string().min(1),
});

/**
 * Body da decisão de aprovação (POST /:id/approve). Opcional/vazio por padrão
 * — a aprovação depende do :id e do admin autenticado, mas aceitamos um
 * comentário opcional. Chaves desconhecidas são descartadas (não-z.any()).
 */
const ApprovalDecisionSchema = z.object({
    comment: z.string().max(500).optional(),
}).default({});

/** Body de rejeição (POST /:id/reject): motivo opcional. */
const RejectionSchema = z.object({
    reason: z.string().max(1000).optional(),
}).default({});

/** Body de aprovação em lote (POST /bulk): lista de ids (1..100). */
const BulkApprovalSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(100),
    reason: z.string().max(1000).optional(),
});

const PendingQuerySchema = z.object({
    type: ActionTypeEnum.optional(),
    banco: BancoEnum.optional(),
    status: ActionStatusEnum.optional(),
}).passthrough();

const HistoryQuerySchema = z.object({
    type: ActionTypeEnum.optional(),
    status: ActionStatusEnum.optional(),
    startDate: z.string().regex(DATE_REGEX, 'Data deve estar no formato YYYY-MM-DD').optional(),
    endDate: z.string().regex(DATE_REGEX, 'Data deve estar no formato YYYY-MM-DD').optional(),
    limit: z.string().regex(/^\d+$/, 'limit deve ser numérico').optional(),
}).passthrough();

const EmptyQuerySchema = z.object({}).passthrough();

// ===== Endpoints =====

/**
 * GET /api/approvals/pending
 * Lista ações pendentes de aprovação
 */
router.get('/pending', validateQuery(PendingQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    const { type, banco, status } = req.query;

    const actions = await approvalService.getPendingActions({
        type: type as ActionType,
        banco: banco as 'inter' | 'itau',
        status: status as ActionStatus,
    });

    return ok(res, actions, { count: actions.length });
}));

/**
 * GET /api/approvals/history
 * Lista histórico de ações (aprovadas, rejeitadas, executadas)
 */
router.get('/history', validateQuery(HistoryQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    const { type, status, startDate, endDate, limit } = req.query;

    const history = await approvalService.getActionHistory({
        type: type as ActionType,
        status: status as ActionStatus,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        limit: limit ? parseInt(limit as string, 10) : 100,
    });

    return ok(res, history, { count: history.length });
}));

/**
 * GET /api/approvals/stats
 * Estatísticas de aprovação
 */
router.get('/stats', validateQuery(EmptyQuerySchema), asyncHandler(async (_req: Request, res: Response) => {
    const stats = await approvalService.getStats();
    return ok(res, stats);
}));

/**
 * GET /api/approvals/:id
 * Detalhes de uma ação específica
 */
router.get('/:id', validateParams(IdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const action = await approvalService.getActionById(id);

    if (!action) {
        return fail(res, 'NOT_FOUND', 'Ação não encontrada', 404);
    }

    return ok(res, action);
}));

/**
 * POST /api/approvals
 * Cria uma nova ação pendente (qualquer usuário autenticado pode solicitar;
 * a execução só ocorre após aprovação de um admin)
 */
router.post('/', validateBody(CreateActionSchema), asyncHandler(async (req: Request, res: Response) => {
    const data = req.body as z.infer<typeof CreateActionSchema>;
    const user = (req as any).user;

    const action = await approvalService.createPendingAction({
        type: data.type,
        banco: data.banco,
        payload: data.payload,
        description: data.description,
        requestedBy: user?.login || user?.id || 'unknown',
    });

    return created(res, action);
}));

/**
 * POST /api/approvals/bulk
 * Aprova várias ações de uma vez (somente admin)
 */
router.post('/bulk', requireDolibarrAdmin, validateBody(BulkApprovalSchema), asyncHandler(async (req: Request, res: Response) => {
    const { ids } = req.body as z.infer<typeof BulkApprovalSchema>;
    const user = (req as any).user;
    const approver = user?.login || user?.id || 'unknown';

    type BulkResult = { id: string; success: boolean; error?: string; result?: unknown };
    const results: BulkResult[] = [];
    for (const id of ids) {
        const r = await approvalService.approveAction(id, approver);
        const entry: BulkResult = { id, success: r.success };
        if (r.error) entry.error = r.error;
        if (r.result !== undefined) entry.result = r.result;
        results.push(entry);
    }

    const approved = results.filter((r) => r.success).length;
    log.info(`Bulk approval por ${approver}: ${approved}/${ids.length} aprovadas`);

    return ok(res, { approved, total: ids.length, results });
}));

/**
 * POST /api/approvals/:id/approve
 * Aprova uma ação e executa automaticamente (somente admin)
 */
router.post('/:id/approve', requireDolibarrAdmin, validateBody(ApprovalDecisionSchema), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req as any).user;
    const approver = user?.login || user?.id || 'unknown';

    const result = await approvalService.approveAction(id, approver);

    if (!result.success) {
        return fail(res, 'BAD_REQUEST', result.error || 'Não foi possível aprovar a ação', 400);
    }

    log.info(`Ação ${id} aprovada por ${approver}`);
    return ok(res, result.result);
}));

/**
 * POST /api/approvals/:id/reject
 * Rejeita uma ação (somente admin)
 */
router.post('/:id/reject', requireDolibarrAdmin, validateBody(RejectionSchema), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body as z.infer<typeof RejectionSchema>;
    const user = (req as any).user;
    const rejecter = user?.login || user?.id || 'unknown';

    const result = await approvalService.rejectAction(id, rejecter, reason);

    if (!result.success) {
        return fail(res, 'BAD_REQUEST', result.error || 'Não foi possível rejeitar a ação', 400);
    }

    log.info(`Ação ${id} rejeitada por ${rejecter}`);
    return ok(res, { rejected: true });
}));

export default router;
