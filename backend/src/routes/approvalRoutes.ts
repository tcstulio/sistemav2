/**
 * Approval Routes
 *
 * Endpoints para gerenciar aprovações de automações bancárias
 */

import { Router, Request } from 'express';
import { z } from 'zod';
import { approvalService } from '../services/approvalService';
import { requireDolibarrLogin, requireAdmin } from '../middleware/authMiddleware';
import {
    validateQuery,
    validateBody,
    validateParams,
    validatedBody,
    validatedParams,
    validatedQuery,
} from '../middleware/validation';
import { created, fail, ok, success } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { createLogger } from '../utils/logger';

const log = createLogger('ApprovalRoutes');
const router = Router();

router.get('/*', requireDolibarrLogin);
router.post('/*', requireDolibarrLogin);

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DIGITS_REGEX = /^\d+$/;

const ACTION_TYPES = [
    'pagar_boleto',
    'enviar_pix',
    'baixar_fatura',
    'enviar_documento',
    'aprovar_reconciliacao',
    'consulta_saldo',
] as const;

const BANCOS = ['inter', 'itau'] as const;

const AUTH_QUERY_FIELDS = {
    DOLAPIKEY: z.string().optional(),
    dolapikey: z.string().optional(),
    apiKey: z.string().optional(),
};

const ACTION_STATUSES = [
    'pending',
    'approved',
    'rejected',
    'executed',
    'failed',
] as const;

const BoletoPayloadSchema = z
    .object({
        barCode: z.string().min(1),
        amount: z.number().positive(),
    })
    .strict();

const PixPayloadSchema = z
    .object({
        chave: z.string().min(1),
        valor: z.number().positive(),
    })
    .strict();

const FaturaPayloadSchema = z
    .object({
        invoiceId: z.union([z.string(), z.number()]),
    })
    .strict();

const DocumentoPayloadSchema = z
    .object({
        documentType: z.string().min(1),
        documentId: z.union([z.string(), z.number()]),
    })
    .strict();

const ReconciliacaoPayloadSchema = z
    .object({
        lineId: z.union([z.string(), z.number()]),
        invoiceId: z.union([z.string(), z.number()]),
    })
    .strict();

const SaldoPayloadSchema = z.object({}).strict();

const CreateActionSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('pagar_boleto'),
        banco: z.enum(BANCOS).optional(),
        payload: BoletoPayloadSchema,
        description: z.string().min(1),
    }).strict(),
    z.object({
        type: z.literal('enviar_pix'),
        banco: z.enum(BANCOS).optional(),
        payload: PixPayloadSchema,
        description: z.string().min(1),
    }).strict(),
    z.object({
        type: z.literal('baixar_fatura'),
        payload: FaturaPayloadSchema,
        description: z.string().min(1),
    }).strict(),
    z.object({
        type: z.literal('enviar_documento'),
        payload: DocumentoPayloadSchema,
        description: z.string().min(1),
    }).strict(),
    z.object({
        type: z.literal('aprovar_reconciliacao'),
        payload: ReconciliacaoPayloadSchema,
        description: z.string().min(1),
    }).strict(),
    z.object({
        type: z.literal('consulta_saldo'),
        banco: z.enum(BANCOS).optional(),
        payload: SaldoPayloadSchema,
        description: z.string().min(1),
    }).strict(),
]);

export const RejectionSchema = z.object({
    reason: z.string().min(1).max(500).optional(),
}).strict();

export const ApprovalDecisionSchema = z.object({}).strict();

export const BulkApprovalSchema = z.object({
    actionIds: z
        .array(z.string().min(1))
        .min(1, 'Informe ao menos uma ação')
        .max(100, 'Limite de 100 ações por requisição'),
}).strict();

const PendingQuerySchema = z
    .object({
        ...AUTH_QUERY_FIELDS,
        type: z.enum(ACTION_TYPES).optional(),
        banco: z.enum(BANCOS).optional(),
    })
    .strict();

const HistoryQuerySchema = z
    .object({
        ...AUTH_QUERY_FIELDS,
        type: z.enum(ACTION_TYPES).optional(),
        status: z.enum(ACTION_STATUSES).optional(),
        dateFrom: z.string().regex(DATE_REGEX, 'dateFrom deve estar no formato YYYY-MM-DD').optional(),
        dateTo: z.string().regex(DATE_REGEX, 'dateTo deve estar no formato YYYY-MM-DD').optional(),
        limit: z
            .string()
            .regex(DIGITS_REGEX, 'limit deve ser numérico')
            .transform((v) => Number(v))
            .optional(),
    })
    .strict();

const EmptyQuerySchema = z.object(AUTH_QUERY_FIELDS).strict();

const IdParamSchema = z.object({
    id: z.string().min(1, 'id é obrigatório'),
}).strict();

function getRequestUser(req: Request): { id?: string | number; login?: string } {
    const user = (req as Request & { user?: { id?: string | number; login?: string } }).user;
    return user || {};
}

/**
 * GET /api/approvals/pending
 * Lista ações pendentes de aprovação
 */
router.get(
    '/pending',
    validateQuery(PendingQuerySchema),
    asyncHandler(async (req, res) => {
        const query = validatedQuery(req, PendingQuerySchema) ?? {};
        const { type, banco } = query;

        const actions = await approvalService.getPendingActions({
            type,
            banco,
        });

        return ok(res, actions, { count: actions.length });
    })
);

/**
 * GET /api/approvals/history
 * Lista histórico de ações (aprovadas, rejeitadas, executadas)
 */
router.get(
    '/history',
    validateQuery(HistoryQuerySchema),
    asyncHandler(async (req, res) => {
        const query = validatedQuery(req, HistoryQuerySchema) ?? {};
        const { type, status, dateFrom, dateTo, limit } = query;

        const history = await approvalService.getActionHistory({
            type,
            status,
            dateFrom: dateFrom ? new Date(dateFrom) : undefined,
            dateTo: dateTo ? new Date(dateTo) : undefined,
            limit: limit || 100,
        });

        return ok(res, history, { count: history.length });
    })
);

/**
 * GET /api/approvals/stats
 * Estatísticas de aprovação
 */
router.get(
    '/stats',
    validateQuery(EmptyQuerySchema),
    asyncHandler(async (_req, res) => {
        const stats = await approvalService.getStats();
        return ok(res, stats);
    })
);

/**
 * GET /api/approvals/:id
 * Detalhes de uma ação específica
 */
router.get(
    '/:id',
    validateQuery(EmptyQuerySchema),
    validateParams(IdParamSchema),
    asyncHandler(async (req, res) => {
        // O middleware validateParams já garante `id.min(1)`; se chegou aqui,
        // params está definido. O guard existe apenas para satisfazer o
        // type-checker sem recorrer a `as` (issue #1544 — substitui `as` por
        // checagem explícita).
        const params = validatedParams(req, IdParamSchema);
        if (!params) {
            throw new AppError(400, 'BAD_REQUEST', 'id é obrigatório');
        }
        const action = await approvalService.getActionById(params.id);

        if (!action) {
            return fail(res, 'NOT_FOUND', 'Ação não encontrada', 404);
        }

        return ok(res, action);
    })
);

/**
 * POST /api/approvals
 * Cria uma nova ação pendente
 */
router.post(
    '/',
    validateBody(CreateActionSchema),
    asyncHandler(async (req, res) => {
        const data = validatedBody(req, CreateActionSchema);
        if (!data) {
            throw new AppError(400, 'BAD_REQUEST', 'Corpo da requisição inválido');
        }
        const user = getRequestUser(req);

        const action = await approvalService.createPendingAction({
            type: data.type,
            banco: 'banco' in data ? data.banco : undefined,
            payload: data.payload,
            description: data.description,
            requestedBy: String(user?.login || user?.id || 'unknown'),
        });

        return created(res, action);
    })
);

/**
 * POST /api/approvals/bulk
 * Aprova várias ações em sequência. Admin-only (issue #1544).
 */
router.post(
    '/bulk',
    requireAdmin,
    validateBody(BulkApprovalSchema),
    asyncHandler(async (req, res) => {
        const data = validatedBody(req, BulkApprovalSchema);
        if (!data) {
            throw new AppError(400, 'BAD_REQUEST', 'Corpo da requisição inválido');
        }
        const { actionIds } = data;
        const user = getRequestUser(req);
        const approvedBy = String(user?.login || user?.id || 'unknown');

        const summary = await approvalService.bulkApproveActions(actionIds, approvedBy);
        const status = summary.failed === 0 ? 200 : 207;
        return success(res, summary, status);
    })
);

/**
 * POST /api/approvals/:id/approve
 * Aprova uma ação e executa automaticamente. Admin-only (issue #1544).
 */
router.post(
    '/:id/approve',
    requireAdmin,
    validateParams(IdParamSchema),
    validateBody(ApprovalDecisionSchema),
    asyncHandler(async (req, res) => {
        const params = validatedParams(req, IdParamSchema);
        if (!params) {
            throw new AppError(400, 'BAD_REQUEST', 'id é obrigatório');
        }
        const user = getRequestUser(req);
        const approvedBy = String(user?.login || user?.id || 'unknown');

        const result = await approvalService.approveAction(params.id, approvedBy);
        if (!result.success) {
            throw new AppError(400, 'BAD_REQUEST', result.error || 'Falha ao aprovar ação');
        }

        return ok(res, { result: result.result });
    })
);

/**
 * POST /api/approvals/:id/reject
 * Rejeita uma ação. Admin-only (issue #1544).
 */
router.post(
    '/:id/reject',
    requireAdmin,
    validateParams(IdParamSchema),
    validateBody(RejectionSchema),
    asyncHandler(async (req, res) => {
        const params = validatedParams(req, IdParamSchema);
        if (!params) {
            throw new AppError(400, 'BAD_REQUEST', 'id é obrigatório');
        }
        // `RejectionSchema` é `.strict()` com `reason` opcional; o ?? {} é seguro
        // porque `reason` é opcional no schema — destruturar de {} apenas
        // produz `reason === undefined`, sem `as` cast.
        const rejection = validatedBody(req, RejectionSchema) ?? {};
        const reason = rejection.reason;
        const user = getRequestUser(req);
        const rejectedBy = String(user?.login || user?.id || 'unknown');

        // Auditoria: rejeição SEM motivo compromete a rastreabilidade da decisão.
        // O schema permite reason opcional, mas em produção a UI sempre envia.
        // Log para detectar fluxos sem motivo (ex.: integrações, scripts de limpeza).
        if (typeof reason !== 'string' || !reason.trim()) {
            log.warn(
                `Rejeição sem motivo: actionId=${params.id} by=${rejectedBy} — investigando origem do request`
            );
        }

        const result = await approvalService.rejectAction(params.id, rejectedBy, reason);
        if (!result.success) {
            throw new AppError(400, 'BAD_REQUEST', result.error || 'Falha ao rejeitar ação');
        }

        return ok(res, { rejected: true });
    })
);

export default router;
