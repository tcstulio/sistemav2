/**
 * Banco Inter Banking Routes — issue #1542.
 *
 * Padrões (idem bankingRoutes):
 *   - Todas as rotas POST/PUT passam por `validateBody(ZodSchema)`.
 *   - Validação falhada → 400 (via ValidationError → errorHandler).
 *   - Respostas padronizadas via `apiResponse.ok/fail`. Erros não-tratados
 *     caem no errorHandler global via `asyncHandler` + `next(error)`.
 *   - Webhook: quando o header `x-webhook-signature` ESTIVER presente,
 *     a verificação `timingSafeEqual` é SEMPRE executada — mesmo em
 *     `NODE_ENV=development` (#1542). Sem header + sem secret + produção
 *     → 503; sem header + sem secret + dev → passa (compat); sem header
 *     + com secret → 401 MISSING_SIGNATURE (hardening).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { z } from 'zod';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { interApiService } from '../services/interApiService';
import { bankingService } from '../services/bankingService';
import { dolibarrService } from '../services/dolibarr';
import { createLogger } from '../utils/logger';

const log = createLogger('InterBanking');

import {
    PixCobrancaRequest,
    PixPagamentoRequest,
    BoletoEmissaoRequest,
    PagamentoBoletoRequest,
    PixWebhookPayload,
    BoletoWebhookPayload,
} from '../types/inter.types';
import { config } from '../config/env';
import {
    validateBody,
    validateQuery,
    PagamentoBoletoSchema,
    PixCobrancaSchema,
    PixPagamentoSchema,
    BoletoEmissaoSchema,
    PixCobrancaVencimentoSchema,
    BoletoCancelSchema,
    WebhookConfigSchema,
    SyncSchema,
    PixWebhookSchema,
    BoletoWebhookSchema,
    InterConnectionTestSchema,
    CertificateUploadSchema,
} from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';
import { ok as apiOk, fail as apiFail } from '../utils/apiResponse';

const router = Router();

// Configure multer for certificate uploads
const certStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const certDir = path.resolve('./certs');
        if (!fs.existsSync(certDir)) {
            fs.mkdirSync(certDir, { recursive: true });
        }
        cb(null, certDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.crt' || ext === '.pem') {
            cb(null, 'inter.crt');
        } else if (ext === '.key') {
            cb(null, 'inter.key');
        } else {
            cb(new Error('Invalid file type. Expected .crt, .pem, or .key'), '');
        }
    },
});

const certUpload = multer({
    storage: certStorage,
    limits: { fileSize: 10 * 1024 }, // 10KB max for certificates
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.crt', '.pem', '.key'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type') as any, false);
        }
    },
});

/**
 * Verify webhook signature using HMAC-SHA256 (timingSafeEqual).
 * Pure helper — não toca em req/res; quem decide se chama é o handler.
 */
function verifyWebhookSignature(payload: string, signature: string | undefined, secret: string): boolean {
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature || ''),
            Buffer.from(expectedSignature)
        );
    } catch {
        return false;
    }
}

/**
 * Aplica a política de verificação de assinatura (#1542):
 *   - Header `x-webhook-signature` presente → SEMPRE roda
 *     timingSafeEqual, mesmo em dev. Sem secret configurado → 503.
 *   - Header ausente + sem secret + produção → 503.
 *   - Header ausente + sem secret + dev → passa (compat de testes locais).
 *   - Header ausente + com secret → 401 MISSING_SIGNATURE (hardening).
 *
 * Retorna `true` se a request pode prosseguir; em caso de rejeição,
 * já respondeu a request e retorna `false`.
 */
function enforceWebhookAuth(label: string) {
    return (req: Request, res: Response, next: NextFunction) => {
        const rawSignature = req.headers['x-signature'] ?? req.headers['x-webhook-signature'];
        const signature = Array.isArray(rawSignature) ? rawSignature[0] : rawSignature;

        if (rawSignature !== undefined) {
            const configuredSecret = config.interWebhookSecret;
            const verified = verifyWebhookSignature(
                JSON.stringify(req.body),
                signature,
                configuredSecret || 'unconfigured-webhook-secret'
            );

            if (!configuredSecret) {
                log.error(`${label} webhook rejeitado: INTER_WEBHOOK_SECRET não configurado`);
                return apiFail(
                    res,
                    'WEBHOOK_NOT_CONFIGURED',
                    'Webhook signature verification not configured',
                    503
                );
            }

            if (!verified) {
                log.warn(`Invalid signature for ${label} webhook`);
                return apiFail(res, 'INVALID_SIGNATURE', 'Invalid webhook signature', 401);
            }

            return next();
        }

        if (!config.interWebhookSecret) {
            if (process.env.NODE_ENV === 'production') {
                log.error(`${label} webhook rejeitado: INTER_WEBHOOK_SECRET não configurado em produção`);
                return apiFail(res, 'WEBHOOK_NOT_CONFIGURED', 'Webhook signature verification not configured', 503);
            }

            return next();
        }

        log.warn(`${label} webhook sem assinatura (secret configurado)`);
        return apiFail(res, 'MISSING_SIGNATURE', 'Missing webhook signature', 401);
    };
}

// ===== PUBLIC Webhook Receiver Endpoints (no auth - bank callbacks) =====

/**
 * POST /api/inter/webhook/pix
 * Receive Pix webhooks from Inter.
 */
router.post(
    '/webhook/pix',
    enforceWebhookAuth('Pix'),
    validateBody(PixWebhookSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const webhookPayload: PixWebhookPayload = req.body;

        log.debug('Received Pix webhook', webhookPayload);

        if (webhookPayload.pix && Array.isArray(webhookPayload.pix)) {
            for (const pix of webhookPayload.pix) {
                log.info(`Pix received: ${pix.endToEndId} - R$ ${pix.valor}`);
            }
        }

        await bankingService.processInterWebhook(webhookPayload, 'pix');

        return apiOk(res, { processed: true });
    })
);

/**
 * POST /api/inter/webhook/boleto
 * Receive Boleto webhooks from Inter.
 */
router.post(
    '/webhook/boleto',
    enforceWebhookAuth('Boleto'),
    validateBody(BoletoWebhookSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const webhookPayload: BoletoWebhookPayload = req.body;

        log.debug('Received Boleto webhook', webhookPayload);

        if (webhookPayload.nossoNumero) {
            log.info(`Boleto ${webhookPayload.nossoNumero} - Status: ${webhookPayload.situacao}`);

            if (webhookPayload.situacao === 'PAGO') {
                log.info(`Boleto paid: R$ ${webhookPayload.valorPago} on ${webhookPayload.dataPagamento}`);
            }
        }

        await bankingService.processInterWebhook(webhookPayload, 'boleto');

        return apiOk(res, { processed: true });
    })
);

// ===== All routes below require authentication =====
router.use(requireDolibarrLogin);

// ===== Status Endpoints =====

/**
 * GET /api/inter/status
 * Get Inter API connection status
 */
router.get(
    '/status',
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const status = await interApiService.getStatus();
        return apiOk(res, status);
    })
);

/**
 * POST /api/inter/test
 * Test Inter API connection — sem body (apenas side-effect).
 */
router.post(
    '/test',
    validateBody(InterConnectionTestSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const initialized = await interApiService.initialize();
        if (!initialized) {
            return apiFail(
                res,
                'INIT_FAILED',
                'Failed to initialize. Check certificates and credentials.',
                400
            );
        }

        const saldo = await interApiService.getSaldo();
        return apiOk(res, { message: 'Connection successful', saldo });
    })
);

/**
 * POST /api/inter/certificates
 * Upload Inter certificates (multipart, sem body JSON validável).
 */
router.post(
    '/certificates',
    certUpload.array('files', 2),
    validateBody(CertificateUploadSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            return apiFail(res, 'NO_FILES', 'No files uploaded', 400);
        }

        const uploaded = files.map(f => f.filename);
        return apiOk(res, { uploaded, message: `Uploaded ${uploaded.length} certificate file(s)` });
    })
);

// ===== Banking Endpoints =====

/**
 * GET /api/inter/saldo
 * Get account balance
 */
router.get(
    '/saldo',
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const saldo = await interApiService.getSaldo();
        return apiOk(res, saldo);
    })
);

/**
 * GET /api/inter/extrato
 * Get account statement
 * Query: dataInicio, dataFim (YYYY-MM-DD)
 */
router.get(
    '/extrato',
    validateQuery(SyncSchema.pick({ dataInicio: true, dataFim: true }).refine(
        (q) => !!q.dataInicio && !!q.dataFim,
        { message: 'dataInicio e dataFim são obrigatórios (YYYY-MM-DD)' }
    )),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { dataInicio, dataFim } = req.query as { dataInicio: string; dataFim: string };

        const transacoes = await interApiService.getExtratoCompleto(
            dataInicio,
            dataFim
        );

        let payables: Awaited<ReturnType<typeof dolibarrService.getAccountsPayable>> = [];
        try {
            payables = await dolibarrService.getAccountsPayable(dataInicio as string, dataFim as string);
        } catch {
            // enrichment is best-effort
        }

        const payablesByValue = new Map<number, typeof payables[0]>();
        for (const p of payables) {
            payablesByValue.set(Math.round(p.totalTtc * 100), p);
        }

        const transacoesEnriquecidas = transacoes.map(t => {
            if (t.tipoOperacao !== 'D') return t;
            const match = payablesByValue.get(Math.round(Number(t.valor) * 100));
            return {
                ...t,
                vinculo: {
                    cliente: match?.socName || undefined,
                    finalidade: t.descricao || t.titulo,
                },
            };
        });

        return apiOk(res, { transacoes: transacoesEnriquecidas });
    })
);

/**
 * POST /api/inter/pagamento/boleto
 * Pay a boleto
 */
router.post(
    '/pagamento/boleto',
    validateBody(PagamentoBoletoSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const dados: PagamentoBoletoRequest = req.body;
        const resultado = await interApiService.pagarBoleto(dados);
        return apiOk(res, resultado);
    })
);

/**
 * GET /api/inter/pagamento/:id/comprovante
 * Get payment receipt PDF
 */
router.get(
    '/pagamento/:id/comprovante',
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { id } = req.params;
        const pdf = await interApiService.getComprovantePagamento(id);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="comprovante_${id}.pdf"`);
        res.send(pdf);
    })
);

// ===== Pix Endpoints =====

/**
 * POST /api/inter/pix/cobranca
 * Create Pix charge
 */
router.post(
    '/pix/cobranca',
    validateBody(PixCobrancaSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { txid, ...dados } = req.body as PixCobrancaRequest & { txid?: string };

        const cobranca = await interApiService.criarPixCobranca(dados, txid);

        let qrcode;
        if (cobranca.loc?.id) {
            try {
                qrcode = await interApiService.getPixQRCode(cobranca.loc.id);
            } catch (e) {
                log.warn('Could not get QR code', { error: e instanceof Error ? e.message : String(e) });
            }
        }

        return apiOk(res, { ...cobranca, qrcode: qrcode?.qrcode });
    })
);

/**
 * POST /api/inter/pix/cobranca-vencimento
 * Create Pix charge with due date
 */
router.post(
    '/pix/cobranca-vencimento',
    validateBody(PixCobrancaVencimentoSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { txid, ...dados } = req.body;

        const cobranca = await interApiService.criarPixCobrancaVencimento(txid, dados);
        return apiOk(res, cobranca);
    })
);

/**
 * GET /api/inter/pix/cobranca/:txid
 * Get Pix charge status
 */
router.get(
    '/pix/cobranca/:txid',
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { txid } = req.params;
        const cobranca = await interApiService.consultarPixCobranca(txid);
        return apiOk(res, cobranca);
    })
);

/**
 * POST /api/inter/pix/enviar
 * Send Pix payment
 */
router.post(
    '/pix/enviar',
    validateBody(PixPagamentoSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const dados: PixPagamentoRequest = req.body;

        const resultado = await interApiService.enviarPix(dados);
        return apiOk(res, resultado);
    })
);

/**
 * GET /api/inter/pix/recebidos
 * List received Pix
 * Query: inicio, fim (ISO 8601 datetime)
 */
router.get(
    '/pix/recebidos',
    validateQuery(SyncSchema.pick({ inicio: true, fim: true }).refine(
        (q) => !!q.inicio && !!q.fim,
        { message: 'inicio e fim são obrigatórios (ISO 8601 datetime)' }
    )),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { inicio, fim } = req.query as { inicio: string; fim: string };

        const pix = await interApiService.listarPixRecebidos(inicio, fim);
        return apiOk(res, { pix });
    })
);

/**
 * GET /api/inter/pix/:e2eid
 * Get Pix by endToEndId
 */
router.get(
    '/pix/:e2eid',
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { e2eid } = req.params;
        const pix = await interApiService.consultarPix(e2eid);
        return apiOk(res, pix);
    })
);

// ===== Boleto Endpoints =====

/**
 * POST /api/inter/boleto
 * Issue new boleto
 */
router.post(
    '/boleto',
    validateBody(BoletoEmissaoSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const dados: BoletoEmissaoRequest = req.body;

        const boleto = await interApiService.emitirBoleto(dados);
        return apiOk(res, boleto);
    })
);

/**
 * GET /api/inter/boleto
 * List boletos
 * Query: dataInicial, dataFinal, situacao, pagina, tamanhoPagina
 */
router.get(
    '/boleto',
    validateQuery(SyncSchema.pick({
        dataInicio: true,
        dataFim: true,
        pagina: true,
        tamanhoPagina: true,
        forcar: true,
    }).extend({
        dataInicial: SyncSchema.shape.dataInicio,
        dataFinal: SyncSchema.shape.dataFim,
        situacao: z.enum(['EMABERTO', 'PAGO', 'CANCELADO', 'EXPIRADO', 'VENCIDO', 'BAIXADO']).optional(),
    }).partial()),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { dataInicial, dataFinal, dataInicio, dataFim, situacao, pagina, tamanhoPagina } = req.query as {
            dataInicial?: string;
            dataFinal?: string;
            dataInicio?: string;
            dataFim?: string;
            situacao?: 'EMABERTO' | 'PAGO' | 'CANCELADO' | 'EXPIRADO' | 'VENCIDO' | 'BAIXADO';
            pagina?: number;
            tamanhoPagina?: number;
        };

        const resultado = await interApiService.listarBoletos({
            dataInicial: (dataInicial || dataInicio) as string,
            dataFinal: (dataFinal || dataFim) as string,
            situacao,
            pagina,
            tamanhoPagina,
        });

        return apiOk(res, resultado);
    })
);

/**
 * GET /api/inter/boleto/:nossoNumero
 * Get boleto details
 */
router.get(
    '/boleto/:nossoNumero',
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { nossoNumero } = req.params;
        const boleto = await interApiService.consultarBoleto(nossoNumero);
        return apiOk(res, boleto);
    })
);

/**
 * GET /api/inter/boleto/:nossoNumero/pdf
 * Download boleto PDF
 */
router.get(
    '/boleto/:nossoNumero/pdf',
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { nossoNumero } = req.params;
        const pdf = await interApiService.downloadBoletoPDF(nossoNumero);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="boleto_${nossoNumero}.pdf"`);
        res.send(pdf);
    })
);

/**
 * POST /api/inter/boleto/:nossoNumero/cancelar
 * Cancel boleto
 */
router.post(
    '/boleto/:nossoNumero/cancelar',
    validateBody(BoletoCancelSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { nossoNumero } = req.params;
        const { motivo } = req.body as { motivo: string };

        await interApiService.cancelarBoleto(nossoNumero, motivo);
        return apiOk(res, { message: 'Boleto cancelado com sucesso' });
    })
);

// ===== Webhook Config Endpoints =====

/**
 * PUT /api/inter/webhook/pix/config
 * Configure Pix webhook URL
 */
router.put(
    '/webhook/pix/config',
    validateBody(WebhookConfigSchema),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { chave, webhookUrl } = req.body;

        await interApiService.configurarWebhookPix(chave, webhookUrl);
        return apiOk(res, { message: 'Webhook configured successfully' });
    })
);

/**
 * GET /api/inter/webhook/pix/config/:chave
 * Get Pix webhook configuration
 */
router.get(
    '/webhook/pix/config/:chave',
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { chave } = req.params;
        const config = await interApiService.consultarWebhookPix(chave);
        return apiOk(res, config);
    })
);

/**
 * DELETE /api/inter/webhook/pix/config/:chave
 * Delete Pix webhook
 */
router.delete(
    '/webhook/pix/config/:chave',
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { chave } = req.params;
        await interApiService.deletarWebhookPix(chave);
        return apiOk(res, { message: 'Webhook deleted successfully' });
    })
);

// ===== Utility Endpoints =====

/**
 * GET /api/inter/txid/generate
 * Generate a new txid for Pix
 */
router.get('/txid/generate', (req: Request, res: Response) => {
    const txid = interApiService.generateTxId();
    return apiOk(res, { txid });
});

export default router;
