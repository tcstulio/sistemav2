/**
 * Document Routes
 * 
 * Endpoints para envio de documentos via WhatsApp
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { documentService } from '../services/documentService';
import { dolibarrService } from '../services/dolibarrService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { audit } from '../middleware/auditMiddleware';
import { createLogger } from '../utils/logger';

const log = createLogger('Document');
const router = Router();

// Proteger todas as rotas
router.use(requireDolibarrLogin);

// ===== Helpers (issue #1570) =====

/**
 * Verifica se o usuário autenticado é administrador.
 *
 * Aceita tanto o formato `req.user.role === 'admin'` (convenção genérica)
 * quanto o formato do Dolibarr (`req.user.admin === '1'`/`true`), para
 * funcionar com sessões legadas e futuras sem acoplar a rota a um schema
 * específico de usuário.
 */
export function isAdmin(req: Request): boolean {
    const user: any = (req as any).user;
    if (!user) return false;
    if (typeof user.role === 'string') {
        return user.role === 'admin';
    }
    return user.admin === '1' || user.admin === 1 || user.admin === true;
}

/**
 * Extrai o IP do cliente de forma defensiva (compatível com Express 4,
 * onde `req.ip` pode estar ausente em alguns setups de teste/proxy).
 */
function getClientIp(req: Request): string {
    return ((req.ip || (req as any).connection?.remoteAddress || 'unknown') as string);
}

/**
 * Registra no audit log que um documento pulou a aprovação.
 * Coleta todos os campos exigidos pela issue #1570.
 */
function auditSkipApproval(
    req: Request,
    fields: { documentType: string; entityType: string; entityId: number }
): void {
    const user: any = (req as any).user;
    const userRole =
        (typeof user?.role === 'string' && user.role) ||
        (user?.admin ? 'admin' : 'user');
    audit.documentSkipApproval({
        userId: String(user?.id || user?.login || 'unknown'),
        userRole,
        documentType: fields.documentType,
        entityType: fields.entityType,
        entityId: fields.entityId,
        timestamp: new Date().toISOString(),
        ip: getClientIp(req),
    });
}

/**
 * Envelope de erro padronizado usado pelas rotas de documento.
 * Mesma forma produzida pelo errorHandler global, para manter
 * consistência mesmo em rotas que tratam erros inline.
 */
function errorEnvelope(status: number, code: string, message: string, details?: unknown) {
    const body: { success: false; error: { code: string; message: string; details?: unknown } } = {
        success: false,
        error: { code, message },
    };
    if (details !== undefined) {
        body.error.details = details;
    }
    return { status, body };
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
    skipApproval: z.boolean().optional(),
});

/**
 * Schema para criação/atualização de documentos genéricos (issue #1570).
 * Validação estrita de documentType, entityType e entityId.
 */
const documentCreateSchema = z.object({
    documentType: z.enum(['proposal', 'invoice', 'order', 'contract', 'intervention', 'receipt']),
    entityType: z.enum(['thirdparty', 'project', 'invoice', 'order', 'proposal', 'intervention']),
    entityId: z.number().int().positive(),
    template: z.string().optional(),
    data: z.record(z.string(), z.any()).optional(),
    skipApproval: z.boolean().default(false),
});

// ===== Endpoints =====

/**
 * POST /api/documents/send
 * Envia documento via WhatsApp (passa pelo sistema de aprovação)
 */
router.post('/send', async (req: Request, res: Response) => {
    try {
        const data = SendDocumentSchema.parse(req.body);
        const user = (req as any).user;

        // Apenas admins podem pular aprovação (issue #1570).
        if (data.skipApproval && !isAdmin(req)) {
            const { status, body } = errorEnvelope(
                403,
                'FORBIDDEN',
                'Apenas administradores podem pular aprovação'
            );
            return res.status(status).json(body);
        }

        // Se thirdPartyId foi fornecido, buscar telefone
        let phone = data.phone;
        if (data.thirdPartyId && !data.phone) {
            const customerPhone = await documentService.getCustomerPhone(data.thirdPartyId);
            if (!customerPhone) {
                const { status, body } = errorEnvelope(400, 'BAD_REQUEST', 'Telefone do cliente não encontrado');
                return res.status(status).json(body);
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
            requestedBy: user?.login || user?.id || 'unknown',
            skipApproval: data.skipApproval,
        });

        // Registra no audit log sempre que o fluxo de aprovação for pulado (issue #1570).
        if (data.skipApproval) {
            auditSkipApproval(req, {
                documentType: data.documentType,
                entityType: data.documentType,
                entityId: Number(data.documentId) || 0,
            });
        }

        if (result.approvalRequired) {
            return res.status(202).json({
                success: true,
                message: 'Documento adicionado à fila de aprovação',
                actionId: result.actionId,
            });
        }

        res.json({
            success: true,
            message: 'Documento enviado com sucesso',
            messageId: result.messageId,
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            const { status, body } = errorEnvelope(400, 'VALIDATION_ERROR', 'Dados inválidos', error.issues);
            return res.status(status).json(body);
        }
        const { status, body } = errorEnvelope(500, 'INTERNAL_ERROR', error.message);
        res.status(status).json(body);
    }
});

/**
 * Processa criação/atualização de documento validando o corpo com
 * `documentCreateSchema`, aplicando a política de skipApproval (admin
 * only) e registrando auditoria. Compartilhado entre POST / e PUT /:id.
 */
async function handleDocumentCreate(req: Request, res: Response, docId?: string): Promise<void> {
    try {
        const data = documentCreateSchema.parse(req.body);

        // Política (issue #1570): apenas admins podem pular a aprovação.
        if (data.skipApproval && !isAdmin(req)) {
            const { status, body } = errorEnvelope(
                403,
                'FORBIDDEN',
                'Apenas administradores podem pular aprovação'
            );
            res.status(status).json(body);
            return;
        }

        // Auditoria obrigatória para toda requisição com skipApproval=true.
        if (data.skipApproval) {
            auditSkipApproval(req, {
                documentType: data.documentType,
                entityType: data.entityType,
                entityId: data.entityId,
            });
        }

        const responsePayload = {
            documentType: data.documentType,
            entityType: data.entityType,
            entityId: data.entityId,
            template: data.template ?? null,
            skipApproval: data.skipApproval,
            ...(docId !== undefined ? { id: docId } : {}),
        };

        res.status(docId !== undefined ? 200 : 201).json({
            success: true,
            data: responsePayload,
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            const { status, body } = errorEnvelope(400, 'VALIDATION_ERROR', 'Dados inválidos', error.issues);
            res.status(status).json(body);
            return;
        }
        const { status, body } = errorEnvelope(500, 'INTERNAL_ERROR', error.message);
        res.status(status).json(body);
    }
}

/**
 * POST /api/documents
 * Cria um documento. Validação Zod + política de skipApproval (admin only) + audit (issue #1570).
 */
router.post('/', (req: Request, res: Response) => handleDocumentCreate(req, res));

/**
 * PUT /api/documents/:id
 * Atualiza um documento. Mesma política de skipApproval da criação.
 */
router.put('/:id', (req: Request, res: Response) => handleDocumentCreate(req, res, req.params.id));

/**
 * GET /api/documents/boleto/:banco/:nossoNumero/preview
 * Preview de boleto (retorna PDF)
 */
router.get('/boleto/:banco/:nossoNumero/preview', async (req: Request, res: Response) => {
    try {
        const { banco, nossoNumero } = req.params;

        if (banco !== 'inter' && banco !== 'itau') {
            const { status, body } = errorEnvelope(400, 'BAD_REQUEST', 'Banco inválido');
            return res.status(status).json(body);
        }

        const pdf = await documentService.getBoletoPDF(banco, nossoNumero);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="boleto_${nossoNumero}.pdf"`);
        res.send(pdf);
    } catch (error: any) {
        const { status, body } = errorEnvelope(500, 'INTERNAL_ERROR', error.message);
        res.status(status).json(body);
    }
});

/**
 * GET /api/documents/invoice/:invoiceId/preview
 * Preview de fatura (retorna PDF)
 */
router.get('/invoice/:invoiceId/preview', async (req: Request, res: Response) => {
    try {
        const { invoiceId } = req.params;

        const pdf = await documentService.getInvoicePDF(invoiceId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="fatura_${invoiceId}.pdf"`);
        res.send(pdf);
    } catch (error: any) {
        const { status, body } = errorEnvelope(500, 'INTERNAL_ERROR', error.message);
        res.status(status).json(body);
    }
});

/**
 * GET /api/documents/customer/:thirdPartyId/phone
 * Busca telefone do cliente
 */
router.get('/customer/:thirdPartyId/phone', async (req: Request, res: Response) => {
    try {
        const { thirdPartyId } = req.params;

        const phone = await documentService.getCustomerPhone(thirdPartyId);

        if (!phone) {
            const { status, body } = errorEnvelope(404, 'NOT_FOUND', 'Telefone não encontrado');
            return res.status(status).json(body);
        }

        res.json({ success: true, phone });
    } catch (error: any) {
        const { status, body } = errorEnvelope(500, 'INTERNAL_ERROR', error.message);
        res.status(status).json(body);
    }
});

const VALID_DOC_TYPES = ['invoice', 'order', 'proposal', 'supplier_order', 'supplier_invoice', 'intervention', 'contract', 'shipment'] as const;

router.get('/:entityType/:entityId/pdf', async (req: Request, res: Response) => {
    try {
        const { entityType, entityId } = req.params;

        if (!VALID_DOC_TYPES.includes(entityType as any)) {
            const { status, body } = errorEnvelope(
                400,
                'BAD_REQUEST',
                `Tipo inválido: ${entityType}. Tipos: ${VALID_DOC_TYPES.join(', ')}`
            );
            return res.status(status).json(body);
        }

        const pdf = await dolibarrService.getDocumentPDF(entityType, entityId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${entityType}_${entityId}.pdf"`);
        res.send(pdf);
    } catch (error: any) {
        log.error(`Erro ao obter PDF ${req.params.entityType}/${req.params.entityId}: ${error.message}`);
        const { status, body } = errorEnvelope(500, 'INTERNAL_ERROR', error.message);
        res.status(status).json(body);
    }
});

/**
 * Proxy da foto de usuário (avatar). Autentica pelo cookie httpOnly (requireDolibarrLogin),
 * busca a imagem no Dolibarr server-side e devolve o binário — assim o <img> do frontend não
 * precisa carregar o token na URL (#33). A chave de serviço nunca sai do servidor.
 */
router.get('/user-photo', async (req: Request, res: Response) => {
    try {
        const userId = String(req.query.userId || '');
        const file = String(req.query.file || '');
        if (!/^\d+$/.test(userId) || !file) {
            const { status, body } = errorEnvelope(400, 'BAD_REQUEST', 'Parâmetros userId/file inválidos');
            return res.status(status).json(body);
        }
        // Anti path traversal: o nome do arquivo não pode conter separadores nem "..".
        const safeFile = file.replace(/\.\./g, '').replace(/[\\/]/g, '');
        if (!safeFile) {
            const { status, body } = errorEnvelope(400, 'BAD_REQUEST', 'Nome de arquivo inválido');
            return res.status(status).json(body);
        }

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
        } else {
            log.error(`Erro ao obter foto de usuário: ${msg}`);
        }
        const { status, body } = errorEnvelope(404, 'NOT_FOUND', 'Foto não disponível');
        res.status(status).json(body);
    }
});

export default router;
