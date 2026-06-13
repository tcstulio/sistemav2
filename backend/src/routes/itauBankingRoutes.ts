/**
 * Banco Itaú Banking Routes
 * 
 * REST API endpoints for Itaú banking operations
 */

import { Router, Request, Response } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { itauApiService } from '../services/itauApiService';
import {
    PixCobrancaItauRequest,
    PixPagamentoItauRequest,
    BoletoItauRequest,
    PagamentoBoletoItauRequest,
    PixWebhookItauPayload,
    BoletoWebhookItauPayload,
} from '../types/itau.types';
import { config } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('ItauBanking');
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
            cb(null, 'itau.crt');
        } else if (ext === '.key') {
            cb(null, 'itau.key');
        } else {
            cb(new Error('Invalid file type. Expected .crt, .pem, or .key'), '');
        }
    },
});

const certUpload = multer({
    storage: certStorage,
    limits: { fileSize: 10 * 1024 }, // 10KB max
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
 * Verifica a assinatura HMAC-SHA256 do webhook (header x-webhook-signature).
 * Mesmo padrão do Inter. Comparação em tempo constante.
 */
function verifyWebhookSignature(payload: string, signature: string | undefined, secret: string): boolean {
    if (!signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
}

/**
 * Se ITAU_WEBHOOK_SECRET estiver configurado, exige assinatura válida; senão segue (compat).
 * Retorna true se OK, ou já responde 401 e retorna false.
 */
function ensureWebhookAuthentic(req: Request, res: Response, label: string): boolean {
    if (!config.itauWebhookSecret) {
        // Em produção, falhar fechado: sem secret não há como autenticar o webhook.
        if (process.env.NODE_ENV === 'production') {
            log.error(`${label} webhook rejeitado: ITAU_WEBHOOK_SECRET não configurado em produção`);
            res.status(503).json({ error: 'Webhook signature verification not configured' });
            return false;
        }
        return true; // dev/test: segue sem verificação (compat)
    }
    const signature = req.headers['x-webhook-signature'] as string | undefined;
    const payload = JSON.stringify(req.body);
    if (!verifyWebhookSignature(payload, signature, config.itauWebhookSecret)) {
        log.warn(`Invalid signature for ${label} webhook`);
        res.status(401).json({ error: 'Invalid webhook signature' });
        return false;
    }
    return true;
}

/**
 * POST /api/itau/webhook/pix
 * Receive PIX webhooks from Itaú
 */
router.post('/webhook/pix', async (req: Request, res: Response) => {
    try {
        if (!ensureWebhookAuthentic(req, res, 'PIX')) return;
        log.info('Received PIX webhook', req.body);

        const payload: PixWebhookItauPayload = req.body;

        if (payload.pix && Array.isArray(payload.pix)) {
            for (const pix of payload.pix) {
                log.info(`PIX received: ${pix.endToEndId} - R$ ${pix.valor}`);
            }
        }

        res.status(200).json({ success: true });
    } catch (error: any) {
        log.error('PIX webhook error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/itau/webhook/boleto
 * Receive Boleto webhooks from Itaú
 */
router.post('/webhook/boleto', async (req: Request, res: Response) => {
    try {
        if (!ensureWebhookAuthentic(req, res, 'Boleto')) return;
        log.info('Received Boleto webhook', req.body);

        const payload: BoletoWebhookItauPayload = req.body;

        if (payload.nossoNumero) {
            log.info(`Boleto ${payload.nossoNumero} - Event: ${payload.evento}`);

            if (payload.evento === 'LIQUIDACAO') {
                log.info(`Boleto paid: R$ ${payload.valor} on ${payload.dataPagamento}`);
            }
        }

        res.status(200).json({ success: true });
    } catch (error: any) {
        log.error('Boleto webhook error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message });
    }
});

// ===== All routes below require authentication =====
router.use(requireDolibarrLogin);

// ===== Status Endpoints =====

/**
 * GET /api/itau/status
 * Get Itaú API connection status
 */
router.get('/status', async (req: Request, res: Response) => {
    try {
        const status = await itauApiService.getStatus();
        res.json(status);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/itau/test
 * Test Itaú API connection
 */
router.post('/test', async (req: Request, res: Response) => {
    try {
        const initialized = await itauApiService.initialize();
        if (!initialized) {
            return res.status(400).json({
                success: false,
                error: 'Failed to initialize. Check certificates and credentials.',
            });
        }

        // Try to get balance as a test
        const saldo = await itauApiService.getSaldo();
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
 * POST /api/itau/certificates
 * Upload Itaú certificates
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
 * GET /api/itau/saldo
 * Get account balance
 */
router.get('/saldo', async (req: Request, res: Response) => {
    try {
        const saldo = await itauApiService.getSaldo();
        res.json(saldo);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/itau/extrato
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

        const transacoes = await itauApiService.getExtratoCompleto(
            dataInicio as string,
            dataFim as string
        );

        res.json({ transacoes });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/itau/pagamento/boleto
 * Pay a boleto
 */
router.post('/pagamento/boleto', async (req: Request, res: Response) => {
    try {
        const dados: PagamentoBoletoItauRequest = req.body;

        if (!dados.codigo_barras_linha_digitavel || !dados.valor_pagamento) {
            return res.status(400).json({
                error: 'Missing parameters: codigo_barras_linha_digitavel and valor_pagamento are required',
            });
        }

        const resultado = await itauApiService.pagarBoleto(dados);
        res.json(resultado);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/itau/pagamento/:id/comprovante
 * Get payment receipt PDF
 */
router.get('/pagamento/:id/comprovante', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const pdf = await itauApiService.getComprovantePagamento(id);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="comprovante_${id}.pdf"`);
        res.send(pdf);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ===== PIX Endpoints =====

/**
 * POST /api/itau/pix/cobranca
 * Create PIX charge
 */
router.post('/pix/cobranca', async (req: Request, res: Response) => {
    try {
        const { txid, ...dados } = req.body as PixCobrancaItauRequest & { txid?: string };

        if (!dados.valor?.original || !dados.chave) {
            return res.status(400).json({
                error: 'Missing parameters: valor.original and chave are required',
            });
        }

        const cobranca = await itauApiService.criarPixCobranca(dados, txid);

        // Get QR Code if available
        let qrcode;
        if (cobranca.loc?.id) {
            try {
                qrcode = await itauApiService.getPixQRCode(cobranca.loc.id);
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
 * POST /api/itau/pix/cobranca-vencimento
 * Create PIX charge with due date
 */
router.post('/pix/cobranca-vencimento', async (req: Request, res: Response) => {
    try {
        const { txid, ...dados } = req.body;

        if (!txid) {
            return res.status(400).json({ error: 'txid is required for scheduled charges' });
        }

        const cobranca = await itauApiService.criarPixCobrancaVencimento(txid, dados);
        res.json(cobranca);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/itau/pix/cobranca/:txid
 * Get PIX charge status
 */
router.get('/pix/cobranca/:txid', async (req: Request, res: Response) => {
    try {
        const { txid } = req.params;
        const cobranca = await itauApiService.consultarPixCobranca(txid);
        res.json(cobranca);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/itau/pix/enviar
 * Send PIX payment
 */
router.post('/pix/enviar', async (req: Request, res: Response) => {
    try {
        const dados: PixPagamentoItauRequest = req.body;

        if (!dados.valor || !dados.pagamento) {
            return res.status(400).json({
                error: 'Missing parameters: valor and pagamento are required',
            });
        }

        const resultado = await itauApiService.enviarPix(dados);
        res.json(resultado);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/itau/pix/recebidos
 * List received PIX
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

        const pix = await itauApiService.listarPixRecebidos(inicio as string, fim as string);
        res.json({ pix });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/itau/pix/:e2eid
 * Get PIX by endToEndId
 */
router.get('/pix/:e2eid', async (req: Request, res: Response) => {
    try {
        const { e2eid } = req.params;
        const pix = await itauApiService.consultarPix(e2eid);
        res.json(pix);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Boleto Endpoints =====

/**
 * POST /api/itau/boleto
 * Issue new boleto
 */
router.post('/boleto', async (req: Request, res: Response) => {
    try {
        const dados: BoletoItauRequest = req.body;

        if (!dados.dado_boleto?.valor_total_titulo || !dados.dado_boleto?.data_vencimento) {
            return res.status(400).json({
                error: 'Missing required fields: dado_boleto.valor_total_titulo, dado_boleto.data_vencimento',
            });
        }

        const boleto = await itauApiService.emitirBoleto(dados);
        res.json(boleto);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/itau/boleto
 * List boletos
 * Query: dataInicial, dataFinal, situacao, pagina, tamanhoPagina
 */
router.get('/boleto', async (req: Request, res: Response) => {
    try {
        const { dataInicial, dataFinal, situacao, pagina, tamanhoPagina } = req.query;

        const resultado = await itauApiService.listarBoletos({
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
 * GET /api/itau/boleto/:nossoNumero
 * Get boleto details
 */
router.get('/boleto/:nossoNumero', async (req: Request, res: Response) => {
    try {
        const { nossoNumero } = req.params;
        const boleto = await itauApiService.consultarBoleto(nossoNumero);
        res.json(boleto);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/itau/boleto/:nossoNumero/pdf
 * Download boleto PDF
 */
router.get('/boleto/:nossoNumero/pdf', async (req: Request, res: Response) => {
    try {
        const { nossoNumero } = req.params;
        const pdf = await itauApiService.downloadBoletoPDF(nossoNumero);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="boleto_${nossoNumero}.pdf"`);
        res.send(pdf);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/itau/boleto/:nossoNumero/baixar
 * Baixa (cancel) boleto
 */
router.post('/boleto/:nossoNumero/baixar', async (req: Request, res: Response) => {
    try {
        const { nossoNumero } = req.params;
        const { motivo } = req.body;

        await itauApiService.baixarBoleto(nossoNumero, motivo || 'ACERTOS');
        res.json({ success: true, message: 'Boleto baixado com sucesso' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Webhook Config Endpoints =====

/**
 * PUT /api/itau/webhook/pix/config
 * Configure PIX webhook URL
 */
router.put('/webhook/pix/config', async (req: Request, res: Response) => {
    try {
        const { chave, webhookUrl } = req.body;

        if (!chave || !webhookUrl) {
            return res.status(400).json({
                error: 'Missing parameters: chave and webhookUrl are required',
            });
        }

        await itauApiService.configurarWebhookPix(chave, webhookUrl);
        res.json({ success: true, message: 'Webhook configured successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/itau/webhook/pix/config/:chave
 * Get PIX webhook configuration
 */
router.get('/webhook/pix/config/:chave', async (req: Request, res: Response) => {
    try {
        const { chave } = req.params;
        const webhookConfig = await itauApiService.consultarWebhookPix(chave);
        res.json(webhookConfig);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/itau/webhook/pix/config/:chave
 * Delete PIX webhook
 */
router.delete('/webhook/pix/config/:chave', async (req: Request, res: Response) => {
    try {
        const { chave } = req.params;
        await itauApiService.deletarWebhookPix(chave);
        res.json({ success: true, message: 'Webhook deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Utility Endpoints =====

/**
 * GET /api/itau/txid/generate
 * Generate a new txid for PIX
 */
router.get('/txid/generate', (req: Request, res: Response) => {
    const txid = itauApiService.generateTxId();
    res.json({ txid });
});

export default router;
