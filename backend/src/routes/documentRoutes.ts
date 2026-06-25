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
import { createLogger } from '../utils/logger';

const log = createLogger('Document');
const router = Router();

// Proteger todas as rotas
router.use(requireDolibarrLogin);

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

// ===== Endpoints =====

/**
 * POST /api/documents/send
 * Envia documento via WhatsApp (passa pelo sistema de aprovação)
 */
router.post('/send', async (req: Request, res: Response) => {
    try {
        const data = SendDocumentSchema.parse(req.body);
        const user = (req as any).user;

        // Se thirdPartyId foi fornecido, buscar telefone
        let phone = data.phone;
        if (data.thirdPartyId && !data.phone) {
            const customerPhone = await documentService.getCustomerPhone(data.thirdPartyId);
            if (!customerPhone) {
                return res.status(400).json({
                    success: false,
                    error: 'Telefone do cliente não encontrado',
                });
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
            return res.status(400).json({
                success: false,
                error: 'Dados inválidos',
                details: error.issues,
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/documents/boleto/:banco/:nossoNumero/preview
 * Preview de boleto (retorna PDF)
 */
router.get('/boleto/:banco/:nossoNumero/preview', async (req: Request, res: Response) => {
    try {
        const { banco, nossoNumero } = req.params;

        if (banco !== 'inter' && banco !== 'itau') {
            return res.status(400).json({ success: false, error: 'Banco inválido' });
        }

        const pdf = await documentService.getBoletoPDF(banco, nossoNumero);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="boleto_${nossoNumero}.pdf"`);
        res.send(pdf);
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
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
        res.status(500).json({ success: false, error: error.message });
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
            return res.status(404).json({ success: false, error: 'Telefone não encontrado' });
        }

        res.json({ success: true, phone });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const VALID_DOC_TYPES = ['invoice', 'order', 'proposal', 'supplier_order', 'supplier_invoice', 'intervention', 'contract', 'shipment'] as const;

router.get('/:entityType/:entityId/pdf', async (req: Request, res: Response) => {
    try {
        const { entityType, entityId } = req.params;

        if (!VALID_DOC_TYPES.includes(entityType as any)) {
            return res.status(400).json({ success: false, error: `Tipo inválido: ${entityType}. Tipos: ${VALID_DOC_TYPES.join(', ')}` });
        }

        const pdf = await dolibarrService.getDocumentPDF(entityType, entityId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${entityType}_${entityId}.pdf"`);
        res.send(pdf);
    } catch (error: any) {
        log.error(`Erro ao obter PDF ${req.params.entityType}/${req.params.entityId}: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
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
            return res.status(400).json({ success: false, error: 'Parâmetros userId/file inválidos' });
        }
        // Anti path traversal: o nome do arquivo não pode conter separadores nem "..".
        const safeFile = file.replace(/\.\./g, '').replace(/[\\/]/g, '');
        if (!safeFile) {
            return res.status(400).json({ success: false, error: 'Nome de arquivo inválido' });
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
        res.status(404).json({ success: false, error: 'Foto não disponível' });
    }
});

export default router;
