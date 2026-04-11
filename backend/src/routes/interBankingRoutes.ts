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
    PagamentoBoletoSchema,
    PixCobrancaSchema,
    BoletoEmissaoSchema,
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
 * POST /api/inter/webhook/pix
 * Receive Pix webhooks from Inter
 */
router.post('/webhook/pix', async (req: Request, res: Response) => {
    try {
        if (config.interWebhookSecret) {
            const signature = req.headers['x-webhook-signature'] as string;
            const payload = JSON.stringify(req.body);

            if (!verifyWebhookSignature(payload, signature, config.interWebhookSecret)) {
                log.warn('Invalid signature for Pix webhook');
                return res.status(401).json({ error: 'Invalid webhook signature' });
            }
        }

        const webhookPayload: PixWebhookPayload = req.body;

        log.debug('Received Pix webhook', webhookPayload);

        if (webhookPayload.pix && Array.isArray(webhookPayload.pix)) {
            for (const pix of webhookPayload.pix) {
                log.info(`Pix received: ${pix.endToEndId} - R$ ${pix.valor}`);
            }
        }

        await bankingService.processInterWebhook(webhookPayload, 'pix');

        res.status(200).json({ success: true });
    } catch (error: any) {
        log.error('Pix webhook error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

/**
 * POST /api/inter/webhook/boleto
 * Receive Boleto webhooks from Inter
 */
router.post('/webhook/boleto', async (req: Request, res: Response) => {
    try {
        if (config.interWebhookSecret) {
            const signature = req.headers['x-webhook-signature'] as string;
            const payload = JSON.stringify(req.body);

            if (!verifyWebhookSignature(payload, signature, config.interWebhookSecret)) {
                log.warn('Invalid signature for Boleto webhook');
                return res.status(401).json({ error: 'Invalid webhook signature' });
            }
        }

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
    } catch (error: any) {
        log.error('Boleto webhook error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// ===== All routes below require authentication =====
router.use(requireDolibarrLogin);

// ===== Status Endpoints =====

/**
 * GET /api/inter/status
 * Get Inter API connection status
 */
router.get('/status', async (req: Request, res: Response) => {
    try {
        const status = await interApiService.getStatus();
        res.json(status);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/inter/test
 * Test Inter API connection
 */
router.post('/test', async (req: Request, res: Response) => {
    try {
        const initialized = await interApiService.initialize();
        if (!initialized) {
            return res.status(400).json({
                success: false,
                error: 'Failed to initialize. Check certificates and credentials.',
            });
        }

        // Try to get balance as a test
        const saldo = await interApiService.getSaldo();
        res.json({
            success: true,
            message: 'Connection successful',
            saldo,
        });
    } catch (error: any) {
        res.status(400).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * POST /api/inter/certificates
 * Upload Inter certificates
 */
router.post('/certificates', certUpload.array('files', 2), async (req: Request, res: Response) => {
    try {
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const uploaded = files.map(f => f.filename);
        res.json({
            success: true,
            uploaded,
            message: `Uploaded ${uploaded.length} certificate file(s)`,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Banking Endpoints =====

/**
 * GET /api/inter/saldo
 * Get account balance
 */
router.get('/saldo', async (req: Request, res: Response) => {
    try {
        const saldo = await interApiService.getSaldo();
        res.json(saldo);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/inter/extrato
 * Get account statement
 * Query: dataInicio, dataFim (YYYY-MM-DD)
 */
router.get('/extrato', async (req: Request, res: Response) => {
    try {
        const { dataInicio, dataFim } = req.query;

        if (!dataInicio || !dataFim) {
            return res.status(400).json({
                error: 'Missing parameters: dataInicio and dataFim are required (YYYY-MM-DD)',
            });
        }

        const transacoes = await interApiService.getExtratoCompleto(
            dataInicio as string,
            dataFim as string
        );

        res.json({ transacoes });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/inter/pagamento/boleto
 * Pay a boleto
 */
router.post('/pagamento/boleto', validateBody(PagamentoBoletoSchema), async (req: Request, res: Response) => {
    try {
        const dados: PagamentoBoletoRequest = req.body;
        const resultado = await interApiService.pagarBoleto(dados);
        res.json(resultado);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/inter/pagamento/:id/comprovante
 * Get payment receipt PDF
 */
router.get('/pagamento/:id/comprovante', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const pdf = await interApiService.getComprovantePagamento(id);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="comprovante_${id}.pdf"`);
        res.send(pdf);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Pix Endpoints =====

/**
 * POST /api/inter/pix/cobranca
 * Create Pix charge
 */
router.post('/pix/cobranca', async (req: Request, res: Response) => {
    try {
        const { txid, ...dados } = req.body as PixCobrancaRequest & { txid?: string };

        if (!dados.valor?.original || !dados.chave) {
            return res.status(400).json({
                error: 'Missing parameters: valor.original and chave are required',
            });
        }

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
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/inter/pix/cobranca-vencimento
 * Create Pix charge with due date
 */
router.post('/pix/cobranca-vencimento', async (req: Request, res: Response) => {
    try {
        const { txid, ...dados } = req.body;

        if (!txid) {
            return res.status(400).json({ error: 'txid is required for scheduled charges' });
        }

        const cobranca = await interApiService.criarPixCobrancaVencimento(txid, dados);
        res.json(cobranca);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/inter/pix/cobranca/:txid
 * Get Pix charge status
 */
router.get('/pix/cobranca/:txid', async (req: Request, res: Response) => {
    try {
        const { txid } = req.params;
        const cobranca = await interApiService.consultarPixCobranca(txid);
        res.json(cobranca);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/inter/pix/enviar
 * Send Pix payment
 */
router.post('/pix/enviar', async (req: Request, res: Response) => {
    try {
        const dados: PixPagamentoRequest = req.body;

        if (!dados.valor || !dados.destinatario) {
            return res.status(400).json({
                error: 'Missing parameters: valor and destinatario are required',
            });
        }

        const resultado = await interApiService.enviarPix(dados);
        res.json(resultado);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/inter/pix/recebidos
 * List received Pix
 * Query: inicio, fim (ISO 8601 datetime)
 */
router.get('/pix/recebidos', async (req: Request, res: Response) => {
    try {
        const { inicio, fim } = req.query;

        if (!inicio || !fim) {
            return res.status(400).json({
                error: 'Missing parameters: inicio and fim are required (ISO 8601 datetime)',
            });
        }

        const pix = await interApiService.listarPixRecebidos(inicio as string, fim as string);
        res.json({ pix });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/inter/pix/:e2eid
 * Get Pix by endToEndId
 */
router.get('/pix/:e2eid', async (req: Request, res: Response) => {
    try {
        const { e2eid } = req.params;
        const pix = await interApiService.consultarPix(e2eid);
        res.json(pix);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Boleto Endpoints =====

/**
 * POST /api/inter/boleto
 * Issue new boleto
 */
router.post('/boleto', async (req: Request, res: Response) => {
    try {
        const dados: BoletoEmissaoRequest = req.body;

        if (!dados.seuNumero || !dados.valorNominal || !dados.dataVencimento || !dados.pagador) {
            return res.status(400).json({
                error: 'Missing required fields: seuNumero, valorNominal, dataVencimento, pagador',
            });
        }

        const boleto = await interApiService.emitirBoleto(dados);
        res.json(boleto);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/inter/boleto
 * List boletos
 * Query: dataInicial, dataFinal, situacao, pagina, tamanhoPagina
 */
router.get('/boleto', async (req: Request, res: Response) => {
    try {
        const { dataInicial, dataFinal, situacao, pagina, tamanhoPagina } = req.query;

        const resultado = await interApiService.listarBoletos({
            dataInicial: dataInicial as string,
            dataFinal: dataFinal as string,
            situacao: situacao as any,
            pagina: pagina ? parseInt(pagina as string) : undefined,
            tamanhoPagina: tamanhoPagina ? parseInt(tamanhoPagina as string) : undefined,
        });

        res.json(resultado);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/inter/boleto/:nossoNumero
 * Get boleto details
 */
router.get('/boleto/:nossoNumero', async (req: Request, res: Response) => {
    try {
        const { nossoNumero } = req.params;
        const boleto = await interApiService.consultarBoleto(nossoNumero);
        res.json(boleto);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/inter/boleto/:nossoNumero/pdf
 * Download boleto PDF
 */
router.get('/boleto/:nossoNumero/pdf', async (req: Request, res: Response) => {
    try {
        const { nossoNumero } = req.params;
        const pdf = await interApiService.downloadBoletoPDF(nossoNumero);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="boleto_${nossoNumero}.pdf"`);
        res.send(pdf);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/inter/boleto/:nossoNumero/cancelar
 * Cancel boleto
 */
router.post('/boleto/:nossoNumero/cancelar', async (req: Request, res: Response) => {
    try {
        const { nossoNumero } = req.params;
        const { motivo } = req.body;

        await interApiService.cancelarBoleto(nossoNumero, motivo || 'Cancelado pelo usuário');
        res.json({ success: true, message: 'Boleto cancelado com sucesso' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Webhook Config Endpoints =====

/**
 * PUT /api/inter/webhook/pix/config
 * Configure Pix webhook URL
 */
router.put('/webhook/pix/config', async (req: Request, res: Response) => {
    try {
        const { chave, webhookUrl } = req.body;

        if (!chave || !webhookUrl) {
            return res.status(400).json({
                error: 'Missing parameters: chave and webhookUrl are required',
            });
        }

        await interApiService.configurarWebhookPix(chave, webhookUrl);
        res.json({ success: true, message: 'Webhook configured successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/inter/webhook/pix/config/:chave
 * Get Pix webhook configuration
 */
router.get('/webhook/pix/config/:chave', async (req: Request, res: Response) => {
    try {
        const { chave } = req.params;
        const config = await interApiService.consultarWebhookPix(chave);
        res.json(config);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/inter/webhook/pix/config/:chave
 * Delete Pix webhook
 */
router.delete('/webhook/pix/config/:chave', async (req: Request, res: Response) => {
    try {
        const { chave } = req.params;
        await interApiService.deletarWebhookPix(chave);
        res.json({ success: true, message: 'Webhook deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

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
