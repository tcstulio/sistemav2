/**
 * Document Routes
 * 
 * Endpoints para envio de documentos via WhatsApp
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { documentService } from '../services/documentService';
import { dolibarrService } from '../services/dolibarrService';
import { adminAuditService } from '../services/adminAuditService';
import { requireDolibarrLogin, requireAdmin, isAdmin } from '../middleware/authMiddleware';
import { validateBody, validatedBody } from '../middleware/validation';
import { created, fail, ok, success } from '../utils/apiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { NotFoundError } from '../middleware/errorHandler';
import { createLogger } from '../utils/logger';

const log = createLogger('Document');
const router = Router();

// Proteger todas as rotas
router.use(requireDolibarrLogin);

type DocumentUser = {
    id?: string | number;
    login?: string;
    role?: string;
    admin?: string | number | boolean;
};

type DocumentAuditFields = {
    documentType: string;
    entityType: string;
    entityId: string | number;
};

function getRequestUser(req: Request): DocumentUser {
    return (req as Request & { user?: DocumentUser }).user || {};
}

function auditSkipApproval(req: Request, fields: DocumentAuditFields, allowed: boolean): void {
    const user = getRequestUser(req);
    const userId = String(user.id || user.login || 'unknown');
    const userRole = isAdmin(req) ? 'admin' : (typeof user.role === 'string' ? user.role : 'user');
    const timestamp = new Date().toISOString();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    adminAuditService.record({
        adminId: userId,
        adminLogin: String(user.login || 'unknown'),
        action: allowed ? 'document.skip-approval' : 'document.skip-approval.denied',
        target: `${fields.entityType}:${fields.entityId}`,
        summary: allowed
            ? `Aprovação ignorada para ${fields.documentType} ${fields.entityType} #${fields.entityId}`
            : `Tentativa negada de ignorar aprovação para ${fields.documentType} ${fields.entityType} #${fields.entityId}`,
        userId,
        userRole,
        documentType: fields.documentType,
        entityType: fields.entityType,
        entityId: fields.entityId,
        timestamp,
        ip,
    });
}

/**
 * Reduz um valor `unknown` (vindo de `Record<string, unknown>` no guard de
 * skip-approval) para `string | number | undefined`. Usado para extrair
 * `entityId` / `documentId` dos bodies validados pelos 3 schemas — `as`
 * aqui seria desnecessário porque o narrowing via `typeof` produz o mesmo
 * tipo de saída e mantém o type-checker feliz.
 */
function pickEntityId(value: unknown): string | number | undefined {
    if (typeof value === 'string' || typeof value === 'number') return value;
    return undefined;
}

// ===== Schemas de Validação =====

const SendDocumentSchema = z.object({
    documentType: z.enum(['boleto', 'invoice', 'receipt']),
    documentId: z.string().min(1),
    banco: z.enum(['inter', 'itau']).optional(),
    phone: z.string().min(10),
    thirdPartyId: z.string().optional(),  // Buscar telefone do Dolibarr
    sessionId: z.string().min(1),
    message: z.string().optional(),
    skipApproval: z.boolean().default(false),
});

export const documentCreateSchema = z.object({
    documentType: z.enum(['proposal', 'invoice', 'order', 'contract', 'intervention', 'receipt']),
    entityType: z.enum(['thirdparty', 'project', 'invoice', 'order', 'proposal', 'intervention']),
    entityId: z.number().int().positive(),
    template: z.string().optional(),
    data: z.record(z.string(), z.any()).optional(),
    skipApproval: z.boolean().default(false),
});

const documentUpdateSchema = documentCreateSchema
    .omit({ skipApproval: true })
    .partial()
    .extend({ skipApproval: z.boolean().optional() })
    .refine(
        (data) => Object.keys(data).length > 0,
        { message: 'Ao menos um campo deve ser informado' }
    )
    .superRefine((data, context) => {
        if (data.skipApproval !== true) return;

        for (const field of ['documentType', 'entityType', 'entityId'] as const) {
            if (data[field] === undefined) {
                context.addIssue({
                    code: 'custom',
                    path: [field],
                    message: `${field} é obrigatório quando skipApproval=true`,
                });
            }
        }
    });

type SkipApprovalFields = (req: Request, data: Record<string, unknown>) => DocumentAuditFields;

/**
 * Guard que exige admin somente quando o body indica `skipApproval: true`.
 *
 * O schema é genérico e tipado via `validatedBody(req, schema)` — o source
 * do dado é a superfície `req.validated.body` (populada pelo middleware
 * `validateBody` que sempre roda antes). Sem `as` casts: o narrowing
 * estrutural via `'skipApproval' in data` (TypeScript type-guard) cobre os
 * 3 schemas usados com este guard (documentCreateSchema,
 * documentUpdateSchema, SendDocumentSchema), e `getFields` recebe o body
 * cru como `Record<string, unknown>` (acesso seguro por chave — campos
 * que faltarem caem nos fallbacks `|| 'unknown'`).
 *
 * Ordem dos middlewares na chain: validateBody → este guard → handler.
 */
function requireAdminForSkipApproval<S extends ZodSchema>(
    schema: S,
    getFields: SkipApprovalFields
) {
    return (req: Request, res: Response, next: NextFunction) => {
        const data = validatedBody(req, schema);
        if (!data) {
            return fail(res, 'BAD_REQUEST', 'Corpo da requisição inválido', 400);
        }
        // `validateBody` rodou antes deste middleware — `data` é o output do
        // schema. Os 3 schemas usados (documentCreateSchema, documentUpdateSchema,
        // SendDocumentSchema) são object schemas, mas o generic `S extends
        // ZodSchema` pode ser primitivo, então primeiro garantimos que é um
        // objeto antes do narrowing via `in`. Após os guards, `data` é
        // `object & { skipApproval: true }` — compatível com
        // `Record<string, unknown>` sem cast adicional.
        if (
            typeof data !== 'object' ||
            data === null ||
            !('skipApproval' in data) ||
            data.skipApproval !== true
        ) {
            return next();
        }

        const allowed = isAdmin(req);
        auditSkipApproval(req, getFields(req, data), allowed);
        return requireAdmin(req, res, next);
    };
}

router.post(
    '/',
    validateBody(documentCreateSchema),
    requireAdminForSkipApproval(
        documentCreateSchema,
        (_req, data) => ({
            documentType: typeof data.documentType === 'string' ? data.documentType : 'unknown',
            entityType: typeof data.entityType === 'string' ? data.entityType : 'unknown',
            entityId: pickEntityId(data.entityId) ?? 'unknown',
        })
    ),
    asyncHandler(async (req, res) => {
        const data = validatedBody(req, documentCreateSchema);
        if (!data) {
            return fail(res, 'BAD_REQUEST', 'Corpo da requisição inválido', 400);
        }
        return created(res, data);
    })
);

router.put(
    '/:id',
    validateBody(documentUpdateSchema),
    requireAdminForSkipApproval(
        documentUpdateSchema,
        (req, data) => ({
            documentType: typeof data.documentType === 'string' ? data.documentType : 'unknown',
            entityType: typeof data.entityType === 'string' ? data.entityType : 'unknown',
            entityId: pickEntityId(data.entityId) ?? req.params.id ?? 'unknown',
        })
    ),
    asyncHandler(async (req, res) => {
        const data = validatedBody(req, documentUpdateSchema);
        if (!data) {
            return fail(res, 'BAD_REQUEST', 'Corpo da requisição inválido', 400);
        }
        return ok(res, { id: req.params.id, ...data });
    })
);

/**
 * POST /api/documents/send
 * Envia documento via WhatsApp (passa pelo sistema de aprovação)
 */
router.post(
    '/send',
    validateBody(SendDocumentSchema),
    requireAdminForSkipApproval(
        SendDocumentSchema,
        (_req, data) => {
            const docType = typeof data.documentType === 'string' ? data.documentType : 'unknown';
            return {
                documentType: docType,
                entityType: docType === 'boleto' ? 'bank-slip' : docType,
                entityId: pickEntityId(data.documentId) ?? 'unknown',
            };
        }
    ),
    asyncHandler(async (req, res) => {
        const data = validatedBody(req, SendDocumentSchema);
        if (!data) {
            return fail(res, 'BAD_REQUEST', 'Corpo da requisição inválido', 400);
        }
        const user = getRequestUser(req);

        // Se thirdPartyId foi fornecido, buscar telefone
        let phone = data.phone;
        if (data.thirdPartyId && !data.phone) {
            const customerPhone = await documentService.getCustomerPhone(data.thirdPartyId);
            if (!customerPhone) {
                return fail(res, 'BAD_REQUEST', 'Telefone do cliente não encontrado', 400);
            }
            phone = customerPhone;
        }

        const result = await documentService.sendDocument({
            documentType: data.documentType,
            documentId: data.documentId,
            banco: data.banco,
            phone,
            sessionId: data.sessionId,
            message: data.message,
            requestedBy: String(user.login || user.id || 'unknown'),
            skipApproval: data.skipApproval,
        });

        if (result.approvalRequired) {
            return success(res, {
                message: 'Documento adicionado à fila de aprovação',
                actionId: result.actionId,
                approvalRequired: true,
            }, 202);
        }

        return ok(res, {
            message: 'Documento enviado com sucesso',
            messageId: result.messageId,
            approvalRequired: false,
        });
    })
);

/**
 * GET /api/documents/boleto/:banco/:nossoNumero/preview
 * Preview de boleto (retorna PDF)
 */
router.get(
    '/boleto/:banco/:nossoNumero/preview',
    asyncHandler(async (req, res) => {
        const { banco, nossoNumero } = req.params;

        if (banco !== 'inter' && banco !== 'itau') {
            return fail(res, 'BAD_REQUEST', 'Banco inválido', 400);
        }

        const pdf = await documentService.getBoletoPDF(banco, nossoNumero);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="boleto_${nossoNumero}.pdf"`);
        res.send(pdf);
    })
);

/**
 * GET /api/documents/invoice/:invoiceId/preview
 * Preview de fatura (retorna PDF)
 */
router.get(
    '/invoice/:invoiceId/preview',
    asyncHandler(async (req, res) => {
        const { invoiceId } = req.params;

        const pdf = await documentService.getInvoicePDF(invoiceId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="fatura_${invoiceId}.pdf"`);
        res.send(pdf);
    })
);

/**
 * GET /api/documents/customer/:thirdPartyId/phone
 * Busca telefone do cliente
 */
router.get(
    '/customer/:thirdPartyId/phone',
    asyncHandler(async (req, res) => {
        const { thirdPartyId } = req.params;

        const phone = await documentService.getCustomerPhone(thirdPartyId);

        if (!phone) {
            return fail(res, 'NOT_FOUND', 'Telefone não encontrado', 404);
        }

        return ok(res, { phone });
    })
);

const VALID_DOC_TYPES = ['invoice', 'order', 'proposal', 'supplier_order', 'supplier_invoice', 'intervention', 'contract', 'shipment'] as const;

router.get(
    '/:entityType/:entityId/pdf',
    asyncHandler(async (req, res) => {
        const { entityType, entityId } = req.params;

        if (!VALID_DOC_TYPES.includes(entityType as any)) {
            return fail(
                res,
                'BAD_REQUEST',
                `Tipo inválido: ${entityType}. Tipos: ${VALID_DOC_TYPES.join(', ')}`,
                400
            );
        }

        const pdf = await dolibarrService.getDocumentPDF(entityType, entityId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${entityType}_${entityId}.pdf"`);
        res.send(pdf);
    })
);

/**
 * Proxy da foto de usuário (avatar). Autentica pelo cookie httpOnly (requireDolibarrLogin),
 * busca a imagem no Dolibarr server-side e devolve o binário — assim o <img> do frontend não
 * precisa carregar o token na URL (#33). A chave de serviço nunca sai do servidor.
 */
router.get(
    '/user-photo',
    asyncHandler(async (req, res) => {
        const userId = String(req.query.userId || '');
        const file = String(req.query.file || '');
        if (!/^\d+$/.test(userId) || !file) {
            return fail(res, 'BAD_REQUEST', 'Parâmetros userId/file inválidos', 400);
        }
        // Anti path traversal: o nome do arquivo não pode conter separadores nem "..".
        const safeFile = file.replace(/\.\./g, '').replace(/[\\/]/g, '');
        if (!safeFile) {
            return fail(res, 'BAD_REQUEST', 'Nome de arquivo inválido', 400);
        }

        try {
            const { buffer, contentType } = await dolibarrService.getUserPhoto(userId, safeFile);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'private, max-age=300');
            res.send(buffer);
        } catch (error: any) {
            // "Sem foto" é uma condição esperada (não é falha de servidor): loga em debug para não
            // poluir o log; o frontend já exibe o avatar de fallback (iniciais) ao receber o 404.
            // Erros reais (Dolibarr fora do ar, etc.) seguem como error. (#824)
            const msg = error?.message || String(error);
            if (/n[ãa]o encontrada/i.test(msg)) {
                log.debug(`Foto não disponível para userId=${req.query.userId}`);
                throw new NotFoundError('Foto não disponível');
            }
            log.error(`Erro ao obter foto de usuário: ${msg}`);
            throw error;
        }
    })
);

export default router;
