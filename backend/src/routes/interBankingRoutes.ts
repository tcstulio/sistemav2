/**
 * Banco Inter Banking Routes
 *
 * REST API endpoints for Inter banking operations
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { interApiService } from '../services/interApiService';
import { bankingService } from '../services/bankingService';
import { dolibarrService } from '../services/dolibarr';
import { createLogger } from '../utils/logger';
import { asyncHandler } from '../middleware/errorHandler';
import apiResponse from '../utils/apiResponse';

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
    InterBoletoCancelarSchema,
    InterWebhookConfigSchema,
    InterWebhookPayloadSchema,
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
        // Save as inter.crt or inter.key based on extension
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
 * Verify webhook signature using HMAC-SHA256
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
 * Middleware de verificação de assinatura de webhook do Inter.
 *
 * #1542: a verificação é INCONDICIONAL — sempre executada quando há um segredo
 * configurado, INDEPENDENTE de NODE_ENV (inclusive em development). Antes, um
 * webhook com assinatura podia ser aceito sem verificação fora de produção.
 *
 * Regras:
 *  - Segredo configurado → `timingSafeEqual` SEMPRE roda (qualquer ambiente).
 *    Assinatura ausente/errada → 401.
 *  - Sem segredo, mas com header de assinatura → 503 (não confiar cegamente
 *    numa assinatura que não temos como verificar).
 *  - Sem segredo e sem assinatura, em produção → 503 (config obrigatória).
 *  - Sem segredo e sem assinatura, fora de produção → segue (compat/dev local).
 */
function verifyInterWebhookSignature(req: Request, res: Response, next: NextFunction): void {
    const rawSignature = req.headers['x-webhook-signature'] ?? req.headers['x-signature'];
    const signature = Array.isArray(rawSignature) ? rawSignature[0] : rawSignature;
    const secret = config.interWebhookSecret;

    if (secret) {
        const payload = JSON.stringify(req.body);
        if (!verifyWebhookSignature(payload, signature, secret)) {
            log.warn('Invalid webhook signature');
            apiResponse.fail(res, 'INVALID_SIGNATURE', 'Invalid webhook signature', 401);
            return;
        }
        next();
        return;
    }

    if (signature) {
        log.error('Webhook com assinatura recebido, mas INTER_WEBHOOK_SECRET não está configurado');
        apiResponse.fail(res, 'WEBHOOK_NOT_CONFIGURED', 'Webhook signature verification not configured', 503);
        return;
    }

    if (process.env.NODE_ENV === 'production') {
        log.error('Webhook rejeitado: INTER_WEBHOOK_SECRET não configurado em produção');
        apiResponse.fail(res, 'WEBHOOK_NOT_CONFIGURED', 'Webhook signature verification not configured', 503);
        return;
    }

    next();
}

/**
 * POST /api/inter/webhook/pix
 * Receive Pix webhooks from Inter
 */
router.post('/webhook/pix', verifyInterWebhookSignature, validateBody(InterWebhookPayloadSchema), asyncHandler(async (req: Request, res: Response) => {
    const webhookPayload: PixWebhookPayload = req.body;

    log.debug('Received Pix webhook', webhookPayload);

    if (webhookPayload.pix && Array.isArray(webhookPayload.pix)) {
        for (const pix of webhookPayload.pix) {
            log.info(`Pix received: ${pix.endToEndId} - R$ ${pix.valor}`);
        }
    }

    await bankingService.processInterWebhook(webhookPayload, 'pix');

    res.status(200).json({ success: true });
}));

/**
 * POST /api/inter/webhook/boleto
 * Receive Boleto webhooks from Inter
 */
router.post('/webhook/boleto', verifyInterWebhookSignature, validateBody(InterWebhookPayloadSchema), asyncHandler(async (req: Request, res: Response) => {
    const webhookPayload: BoletoWebhookPayload = req.body;

    log.debug('Received Boleto webhook', webhookPayload);

    if (webhookPayload.nossoNumero) {
        log.info(`Boleto ${webhookPayload.nossoNumero} - Status: ${webhookPayload.situacao}`);

        if (webhookPayload.situacao === 'PAGO') {
            log.info(`Boleto paid: R$ ${webhookPayload.valorPago} on ${webhookPayload.dataPagamento}`);
        }
    }

    await bankingService.processInterWebhook(webhookPayload, 'boleto');

    res.status(200).json({ success: true });
}));

// ===== All routes below require authentication =====
router.use(requireDolibarrLogin);

// ===== Status Endpoints =====

/**
 * GET /api/inter/status
 * Get Inter API connection status
 */
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
    const status = await interApiService.getStatus();
    res.json(status);
}));

/**
 * POST /api/inter/test
 * Test Inter API connection
 */
router.post('/test', asyncHandler(async (req: Request, res: Response) => {
    const initialized = await interApiService.initialize();
    if (!initialized) {
        return apiResponse.fail(
            res,
            'INTER_INIT_FAILED',
            'Failed to initialize. Check certificates and credentials.',
            400
        );
    }

    // Try to get balance as a test
    const saldo = await interApiService.getSaldo();
    res.json({
        success: true,
        message: 'Connection successful',
        saldo,
    });
}));

/**
 * POST /api/inter/certificates
 * Upload Inter certificates
 */
router.post('/certificates', certUpload.array('files', 2), asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
        return apiResponse.fail(res, 'NO_FILE', 'No files uploaded', 400);
    }

    const uploaded = files.map(f => f.filename);
    res.json({
        success: true,
        uploaded,
        message: `Uploaded ${uploaded.length} certificate file(s)`,
    });
}));

// ===== Banking Endpoints =====

/**
 * GET /api/inter/saldo
 * Get account balance
 */
router.get('/saldo', asyncHandler(async (req: Request, res: Response) => {
    const saldo = await interApiService.getSaldo();
    res.json(saldo);
}));

/**
 * GET /api/inter/extrato
 * Get account statement
 * Query: dataInicio, dataFim (YYYY-MM-DD)
 */
router.get('/extrato', asyncHandler(async (req: Request, res: Response) => {
    const { dataInicio, dataFim } = req.query;

    if (!dataInicio || !dataFim) {
        return apiResponse.fail(
            res,
            'MISSING_PARAMS',
            'Missing parameters: dataInicio and dataFim are required (YYYY-MM-DD)',
            400
        );
    }

    const transacoes = await interApiService.getExtratoCompleto(
        dataInicio as string,
        dataFim as string
    );

    // Batch-fetch payables and enrich debits without N+1
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

    res.json({ transacoes: transacoesEnriquecidas });
}));

/**
 * POST /api/inter/pagamento/boleto
 * Pay a boleto
 */
router.post('/pagamento/boleto', validateBody(PagamentoBoletoSchema), asyncHandler(async (req: Request, res: Response) => {
    const dados: PagamentoBoletoRequest = req.body;
    const resultado = await interApiService.pagarBoleto(dados);
    res.json(resultado);
}));

/**
 * GET /api/inter/pagamento/:id/comprovante
 * Get payment receipt PDF
 */
router.get('/pagamento/:id/comprovante', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const pdf = await interApiService.getComprovantePagamento(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="comprovante_${id}.pdf"`);
    res.send(pdf);
}));

// ===== Pix Endpoints =====

/**
 * POST /api/inter/pix/cobranca
 * Create Pix charge
 */
router.post('/pix/cobranca', validateBody(InterPixCobrancaSchema), asyncHandler(async (req: Request, res: Response) => {
    const { txid, ...dados } = req.body as PixCobrancaRequest & { txid?: string };

    const cobranca = await interApiService.criarPixCobranca(dados, txid);

    // Get QR Code if available
    let qrcode;
    if (cobranca.loc?.id) {
        try {
            qrcode = await interApiService.getPixQRCode(cobranca.loc.id);
        } catch (e) {
            log.warn('Could not get QR code', { error: e instanceof Error ? e.message : String(e) });
        }
    }

    res.json({ ...cobranca, qrcode: qrcode?.qrcode });
}));

/**
 * POST /api/inter/pix/cobranca-vencimento
 * Create Pix charge with due date
 */
router.post('/pix/cobranca-vencimento', validateBody(InterPixCobrancaVencimentoSchema), asyncHandler(async (req: Request, res: Response) => {
    const { txid, ...dados } = req.body;

    const cobranca = await interApiService.criarPixCobrancaVencimento(txid, dados);
    res.json(cobranca);
}));

/**
 * GET /api/inter/pix/cobranca/:txid
 * Get Pix charge status
 */
router.get('/pix/cobranca/:txid', asyncHandler(async (req: Request, res: Response) => {
    const { txid } = req.params;
    const cobranca = await interApiService.consultarPixCobranca(txid);
    res.json(cobranca);
}));

/**
 * POST /api/inter/pix/enviar
 * Send Pix payment
 */
router.post('/pix/enviar', validateBody(InterPixEnviarSchema), asyncHandler(async (req: Request, res: Response) => {
    const dados: PixPagamentoRequest = req.body;

    const resultado = await interApiService.enviarPix(dados);
    res.json(resultado);
}));

/**
 * GET /api/inter/pix/recebidos
 * List received Pix
 * Query: inicio, fim (ISO 8601 datetime)
 */
router.get('/pix/recebidos', asyncHandler(async (req: Request, res: Response) => {
    const { inicio, fim } = req.query;

    if (!inicio || !fim) {
        return apiResponse.fail(
            res,
            'MISSING_PARAMS',
            'Missing parameters: inicio and fim are required (ISO 8601 datetime)',
            400
        );
    }

    const pix = await interApiService.listarPixRecebidos(inicio as string, fim as string);
    res.json({ pix });
}));

/**
 * GET /api/inter/pix/:e2eid
 * Get Pix by endToEndId
 */
router.get('/pix/:e2eid', asyncHandler(async (req: Request, res: Response) => {
    const { e2eid } = req.params;
    const pix = await interApiService.consultarPix(e2eid);
    res.json(pix);
}));

// ===== Boleto Endpoints =====

/**
 * POST /api/inter/boleto
 * Issue new boleto
 */
router.post('/boleto', validateBody(InterBoletoEmissaoSchema), asyncHandler(async (req: Request, res: Response) => {
    const dados: BoletoEmissaoRequest = req.body;

    const boleto = await interApiService.emitirBoleto(dados);
    res.json(boleto);
}));

/**
 * GET /api/inter/boleto
 * List boletos
 * Query: dataInicial, dataFinal, situacao, pagina, tamanhoPagina
 */
router.get('/boleto', asyncHandler(async (req: Request, res: Response) => {
    const { dataInicial, dataFinal, situacao, pagina, tamanhoPagina } = req.query;

    const resultado = await interApiService.listarBoletos({
        dataInicial: dataInicial as string,
        dataFinal: dataFinal as string,
        situacao: situacao as any,
        pagina: pagina ? parseInt(pagina as string) : undefined,
        tamanhoPagina: tamanhoPagina ? parseInt(tamanhoPagina as string) : undefined,
    });

    res.json(resultado);
}));

/**
 * GET /api/inter/boleto/:nossoNumero
 * Get boleto details
 */
router.get('/boleto/:nossoNumero', asyncHandler(async (req: Request, res: Response) => {
    const { nossoNumero } = req.params;
    const boleto = await interApiService.consultarBoleto(nossoNumero);
    res.json(boleto);
}));

/**
 * GET /api/inter/boleto/:nossoNumero/pdf
 * Download boleto PDF
 */
router.get('/boleto/:nossoNumero/pdf', asyncHandler(async (req: Request, res: Response) => {
    const { nossoNumero } = req.params;
    const pdf = await interApiService.downloadBoletoPDF(nossoNumero);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="boleto_${nossoNumero}.pdf"`);
    res.send(pdf);
}));

/**
 * POST /api/inter/boleto/:nossoNumero/cancelar
 * Cancel boleto
 */
router.post('/boleto/:nossoNumero/cancelar', validateBody(InterBoletoCancelarSchema), asyncHandler(async (req: Request, res: Response) => {
    const { nossoNumero } = req.params;
    const { motivo } = req.body;

    await interApiService.cancelarBoleto(nossoNumero, motivo || 'Cancelado pelo usuário');
    res.json({ success: true, message: 'Boleto cancelado com sucesso' });
}));

// ===== Webhook Config Endpoints =====

/**
 * PUT /api/inter/webhook/pix/config
 * Configure Pix webhook URL
 */
router.put('/webhook/pix/config', validateBody(InterWebhookConfigSchema), asyncHandler(async (req: Request, res: Response) => {
    const { chave, webhookUrl } = req.body;

    await interApiService.configurarWebhookPix(chave, webhookUrl);
    res.json({ success: true, message: 'Webhook configured successfully' });
}));

/**
 * GET /api/inter/webhook/pix/config/:chave
 * Get Pix webhook configuration
 */
router.get('/webhook/pix/config/:chave', asyncHandler(async (req: Request, res: Response) => {
    const { chave } = req.params;
    const webhookConfig = await interApiService.consultarWebhookPix(chave);
    res.json(webhookConfig);
}));

/**
 * DELETE /api/inter/webhook/pix/config/:chave
 * Delete Pix webhook
 */
router.delete('/webhook/pix/config/:chave', asyncHandler(async (req: Request, res: Response) => {
    const { chave } = req.params;
    await interApiService.deletarWebhookPix(chave);
    res.json({ success: true, message: 'Webhook deleted successfully' });
}));

// ===== Utility Endpoints =====

/**
 * GET /api/inter/txid/generate
 * Generate a new txid for Pix
 */
router.get('/txid/generate', (req: Request, res: Response) => {
    const txid = interApiService.generateTxId();
    res.json({ txid });
});

export default router;
