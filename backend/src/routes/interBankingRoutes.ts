/**
 * Banco Inter Banking Routes
 *
 * REST API endpoints for Inter banking operations
 */

import { Router, Request, Response } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { interApiService } from '../services/interApiService';
import { bankingService } from '../services/bankingService';
import { dolibarrService } from '../services/dolibarr';
import { createLogger } from '../utils/logger';
import { ok, fail } from '../utils/apiResponse';
import { AppError, asyncHandler } from '../middleware/errorHandler';

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
    PagamentoBoletoSchema,
    InterPixCobrancaSchema,
    InterPixCobrancaVencimentoSchema,
    InterPixEnviarSchema,
    InterBoletoEmissaoSchema,
    InterBoletoCancelSchema,
    WebhookConfigSchema,
    InterCertificateSchema,
    InterTestSchema,
    PixWebhookSchema,
    BoletoWebhookSchema,
} from '../middleware/validation';

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

// ===== PUBLIC Webhook Receiver Endpoints (no auth - bank callbacks) =====

/**
 * Verify webhook signature using HMAC-SHA256 (constant-time comparison).
 */
function verifyWebhookSignature(payload: string, signature: string | undefined, secret: string): boolean {
    if (!signature) return false;

    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    } catch {
        return false;
    }
}

/**
 * Verificação do webhook — quando o cliente envia `x-signature` ou `x-webhook-signature`,
 * a verificação roda INCONDICIONALMENTE (independente de NODE_ENV). Sem secret configurado
 * e SEM header → modo permissivo em dev, fail-closed (503) em produção. (#1542)
 */
function ensureWebhookAuthentic(req: Request, res: Response, label: string): boolean {
    const signature = (req.headers['x-signature'] || req.headers['x-webhook-signature']) as string | undefined;
    const payload = JSON.stringify(req.body);

    if (signature) {
        if (!config.interWebhookSecret) {
            log.warn(`${label} webhook: assinatura recebida mas INTER_WEBHOOK_SECRET não configurado — rejeitando`);
            fail(res, 'UNAUTHORIZED', 'Assinatura recebida mas INTER_WEBHOOK_SECRET não está configurado', 401);
            return false;
        }
        if (!verifyWebhookSignature(payload, signature, config.interWebhookSecret)) {
            log.warn(`Invalid signature for ${label} webhook`);
            fail(res, 'UNAUTHORIZED', 'Invalid webhook signature', 401);
            return false;
        }
        return true;
    }

    if (!config.interWebhookSecret) {
        if (process.env.NODE_ENV === 'production') {
            log.error(`${label} webhook rejeitado: INTER_WEBHOOK_SECRET não configurado em produção`);
            fail(res, 'SERVICE_UNAVAILABLE', 'Webhook signature verification not configured', 503);
            return false;
        }
        return true;
    }

    log.warn(`${label} webhook rejeitado: INTER_WEBHOOK_SECRET configurado mas nenhuma assinatura recebida`);
    fail(res, 'UNAUTHORIZED', 'Webhook signature required', 401);
    return false;
}

/**
 * POST /api/inter/webhook/pix
 * Receive Pix webhooks from Inter
 */
router.post(
    '/webhook/pix',
    validateBody(PixWebhookSchema),
    asyncHandler(async (req: Request, res: Response) => {
        if (!ensureWebhookAuthentic(req, res, 'Pix')) return;

        const webhookPayload: PixWebhookPayload = req.body;

        log.debug('Received Pix webhook', webhookPayload);

        if (webhookPayload.pix && Array.isArray(webhookPayload.pix)) {
            for (const pix of webhookPayload.pix) {
                log.info(`Pix received: ${pix.endToEndId} - R$ ${pix.valor}`);
            }
        }

        await bankingService.processInterWebhook(webhookPayload, 'pix');

        ok(res, { received: true });
    })
);

/**
 * POST /api/inter/webhook/boleto
 * Receive Boleto webhooks from Inter
 */
router.post(
    '/webhook/boleto',
    validateBody(BoletoWebhookSchema),
    asyncHandler(async (req: Request, res: Response) => {
        if (!ensureWebhookAuthentic(req, res, 'Boleto')) return;

        const webhookPayload: BoletoWebhookPayload = req.body;

        log.debug('Received Boleto webhook', webhookPayload);

        if (webhookPayload.nossoNumero) {
            log.info(`Boleto ${webhookPayload.nossoNumero} - Status: ${webhookPayload.situacao}`);

            if (webhookPayload.situacao === 'PAGO') {
                log.info(`Boleto paid: R$ ${webhookPayload.valorPago} on ${webhookPayload.dataPagamento}`);
            }
        }

        await bankingService.processInterWebhook(webhookPayload, 'boleto');

        ok(res, { received: true });
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
    asyncHandler(async (req: Request, res: Response) => {
        const status = await interApiService.getStatus();
        ok(res, status);
    })
);

/**
 * POST /api/inter/test
 * Test Inter API connection
 */
router.post(
    '/test',
    validateBody(InterTestSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const initialized = await interApiService.initialize();
        if (!initialized) {
            throw new AppError(400, 'BAD_REQUEST', 'Failed to initialize. Check certificates and credentials.');
        }

        const saldo = await interApiService.getSaldo();
        ok(res, { message: 'Connection successful', saldo });
    })
);

/**
 * POST /api/inter/certificates
 * Upload Inter certificates
 */
const certUploadArray = certUpload.array('files', 2);
router.post(
    '/certificates',
    certUploadArray,
    validateBody(InterCertificateSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            throw new AppError(400, 'BAD_REQUEST', 'No files uploaded');
        }

        const uploaded = files.map(f => f.filename);
        ok(res, { uploaded, message: `Uploaded ${uploaded.length} certificate file(s)` });
    })
);

// ===== Banking Endpoints =====

/**
 * GET /api/inter/saldo
 * Get account balance
 */
router.get(
    '/saldo',
    asyncHandler(async (req: Request, res: Response) => {
        const saldo = await interApiService.getSaldo();
        ok(res, saldo);
    })
);

/**
 * GET /api/inter/extrato
 * Get account statement
 * Query: dataInicio, dataFim (YYYY-MM-DD)
 */
router.get(
    '/extrato',
    asyncHandler(async (req: Request, res: Response) => {
        const { dataInicio, dataFim } = req.query;

        if (!dataInicio || !dataFim) {
            throw new AppError(400, 'BAD_REQUEST', 'Missing parameters: dataInicio and dataFim are required (YYYY-MM-DD)');
        }

        const transacoes = await interApiService.getExtratoCompleto(
            dataInicio as string,
            dataFim as string
        );

        let payables: Awaited<ReturnType<typeof dolibarrService.getAccountsPayable>> = [];
        try {
            payables = await dolibarrService.getAccountsPayable(dataInicio as string, dataFim as string);
        } catch {
            // enrichment is best-effort — don't fail the whole request
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

        ok(res, { transacoes: transacoesEnriquecidas });
    })
);

/**
 * POST /api/inter/pagamento/boleto
 * Pay a boleto
 */
router.post(
    '/pagamento/boleto',
    validateBody(PagamentoBoletoSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const dados: PagamentoBoletoRequest = req.body;
        const resultado = await interApiService.pagarBoleto(dados);
        ok(res, resultado);
    })
);

/**
 * GET /api/inter/pagamento/:id/comprovante
 * Get payment receipt PDF (binary response preserved)
 */
router.get(
    '/pagamento/:id/comprovante',
    asyncHandler(async (req: Request, res: Response) => {
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
    validateBody(InterPixCobrancaSchema),
    asyncHandler(async (req: Request, res: Response) => {
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

        ok(res, { ...cobranca, qrcode: qrcode?.qrcode });
    })
);

/**
 * POST /api/inter/pix/cobranca-vencimento
 * Create Pix charge with due date
 */
router.post(
    '/pix/cobranca-vencimento',
    validateBody(InterPixCobrancaVencimentoSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { txid, ...dados } = req.body as { txid: string } & PixCobrancaRequest;

        const cobranca = await interApiService.criarPixCobrancaVencimento(txid, dados as PixCobrancaRequest);
        ok(res, cobranca);
    })
);

/**
 * GET /api/inter/pix/cobranca/:txid
 * Get Pix charge status
 */
router.get(
    '/pix/cobranca/:txid',
    asyncHandler(async (req: Request, res: Response) => {
        const { txid } = req.params;
        const cobranca = await interApiService.consultarPixCobranca(txid);
        ok(res, cobranca);
    })
);

/**
 * POST /api/inter/pix/enviar
 * Send Pix payment
 */
router.post(
    '/pix/enviar',
    validateBody(InterPixEnviarSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const dados: PixPagamentoRequest = req.body;
        const resultado = await interApiService.enviarPix(dados);
        ok(res, resultado);
    })
);

/**
 * GET /api/inter/pix/recebidos
 * List received Pix
 * Query: inicio, fim (ISO 8601 datetime)
 */
router.get(
    '/pix/recebidos',
    asyncHandler(async (req: Request, res: Response) => {
        const { inicio, fim } = req.query;

        if (!inicio || !fim) {
            throw new AppError(400, 'BAD_REQUEST', 'Missing parameters: inicio and fim are required (ISO 8601 datetime)');
        }

        const pix = await interApiService.listarPixRecebidos(inicio as string, fim as string);
        ok(res, { pix });
    })
);

/**
 * GET /api/inter/pix/:e2eid
 * Get Pix by endToEndId
 */
router.get(
    '/pix/:e2eid',
    asyncHandler(async (req: Request, res: Response) => {
        const { e2eid } = req.params;
        const pix = await interApiService.consultarPix(e2eid);
        ok(res, pix);
    })
);

// ===== Boleto Endpoints =====

/**
 * POST /api/inter/boleto
 * Issue new boleto
 */
router.post(
    '/boleto',
    validateBody(InterBoletoEmissaoSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const dados: BoletoEmissaoRequest = req.body;
        const boleto = await interApiService.emitirBoleto(dados);
        ok(res, boleto);
    })
);

/**
 * GET /api/inter/boleto
 * List boletos
 * Query: dataInicial, dataFinal, situacao, pagina, tamanhoPagina
 */
router.get(
    '/boleto',
    asyncHandler(async (req: Request, res: Response) => {
        const { dataInicial, dataFinal, situacao, pagina, tamanhoPagina } = req.query;

        const resultado = await interApiService.listarBoletos({
            dataInicial: dataInicial as string,
            dataFinal: dataFinal as string,
            situacao: situacao as any,
            pagina: pagina ? parseInt(pagina as string) : undefined,
            tamanhoPagina: tamanhoPagina ? parseInt(tamanhoPagina as string) : undefined,
        });

        ok(res, resultado);
    })
);

/**
 * GET /api/inter/boleto/:nossoNumero
 * Get boleto details
 */
router.get(
    '/boleto/:nossoNumero',
    asyncHandler(async (req: Request, res: Response) => {
        const { nossoNumero } = req.params;
        const boleto = await interApiService.consultarBoleto(nossoNumero);
        ok(res, boleto);
    })
);

/**
 * GET /api/inter/boleto/:nossoNumero/pdf
 * Download boleto PDF (binary response preserved)
 */
router.get(
    '/boleto/:nossoNumero/pdf',
    asyncHandler(async (req: Request, res: Response) => {
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
    validateBody(InterBoletoCancelSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { nossoNumero } = req.params;
        const { motivo } = req.body;

        await interApiService.cancelarBoleto(nossoNumero, motivo || 'Cancelado pelo usuário');
        ok(res, { message: 'Boleto cancelado com sucesso' });
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
    asyncHandler(async (req: Request, res: Response) => {
        const { chave, webhookUrl } = req.body;

        await interApiService.configurarWebhookPix(chave, webhookUrl);
        ok(res, { message: 'Webhook configured successfully' });
    })
);

/**
 * GET /api/inter/webhook/pix/config/:chave
 * Get Pix webhook configuration
 */
router.get(
    '/webhook/pix/config/:chave',
    asyncHandler(async (req: Request, res: Response) => {
        const { chave } = req.params;
        const webhookConfig = await interApiService.consultarWebhookPix(chave);
        ok(res, webhookConfig);
    })
);

/**
 * DELETE /api/inter/webhook/pix/config/:chave
 * Delete Pix webhook
 */
router.delete(
    '/webhook/pix/config/:chave',
    asyncHandler(async (req: Request, res: Response) => {
        const { chave } = req.params;
        await interApiService.deletarWebhookPix(chave);
        ok(res, { message: 'Webhook deleted successfully' });
    })
);

// ===== Utility Endpoints =====

/**
 * GET /api/inter/txid/generate
 * Generate a new txid for Pix
 */
router.get('/txid/generate', (req: Request, res: Response) => {
    const txid = interApiService.generateTxId();
    ok(res, { txid });
});

export default router;
