/**
 * Document Routes
 * 
 * Endpoints para envio de documentos via WhatsApp
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { documentService } from '../services/documentService';
import { dolibarrService } from '../services/dolibarrService';
import { adminAuditService } from '../services/adminAuditService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validation';
import { created, fail, ok } from '../utils/apiResponse';
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

export function isAdmin(req: Request): boolean {
    const user = getRequestUser(req);
    return user.role === 'admin' || user.admin === '1' || user.admin === 1 || user.admin === true;
}

function auditSkipApproval(req: Request, fields: DocumentAuditFields, allowed: boolean): void {
    const user = getRequestUser(req);
    const userId = String(user.id || user.login || 'unknown');
    const userRole = user.role || (isAdmin(req) ? 'admin' : 'user');
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

// ===== Endpoints =====

function handleSkipApprovalPolicy(
    req: Request,
    res: Response,
    data: { skipApproval?: boolean; documentType?: string; entityType?: string; entityId?: string | number }
): boolean {
    if (data.skipApproval !== true) return true;

    const allowed = isAdmin(req);
    auditSkipApproval(
        req,
        {
            documentType: data.documentType || 'unknown',
            entityType: data.entityType || 'unknown',
            entityId: data.entityId || req.params.id || 'unknown',
        },
        allowed
    );

    if (!allowed) {
        fail(res, 'FORBIDDEN', 'Apenas administradores podem pular aprovação', 403);
        return false;
    }
    return true;
}

router.post(
    '/',
    validateBody(documentCreateSchema),
    asyncHandler(async (req, res) => {
        const data = req.body as z.infer<typeof documentCreateSchema>;
        if (!handleSkipApprovalPolicy(req, res, data)) return;
        return created(res, data);
    })
);

router.put(
    '/:id',
    validateBody(documentUpdateSchema),
    asyncHandler(async (req, res) => {
        const data = req.body as z.infer<typeof documentUpdateSchema>;
        if (!handleSkipApprovalPolicy(req, res, data)) return;
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
    asyncHandler(async (req, res) => {
        const data = req.body as z.infer<typeof SendDocumentSchema>;
        const user = getRequestUser(req);

        if (data.skipApproval) {
            const allowed = isAdmin(req);
            auditSkipApproval(req, {
                documentType: data.documentType,
                entityType: data.documentType === 'boleto' ? 'bank-slip' : data.documentType,
                entityId: data.documentId,
            }, allowed);

            if (!allowed) {
                return fail(res, 'FORBIDDEN', 'Apenas administradores podem pular aprovação', 403);
            }
        }

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
            return res.status(202).json({
                success: true,
                data: {
                    message: 'Documento adicionado à fila de aprovação',
                    actionId: result.actionId,
                    approvalRequired: true,
                },
            });
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
