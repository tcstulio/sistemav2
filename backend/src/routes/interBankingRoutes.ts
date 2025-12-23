/**
 * Banco Inter Banking Routes
 * 
 * REST API endpoints for Inter banking operations
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { interApiService } from '../services/interApiService';
import { bankingService } from '../services/bankingService';

import {
    PixCobrancaRequest,
    PixPagamentoRequest,
    BoletoEmissaoRequest,
    PagamentoBoletoRequest,
    PixWebhookPayload,
    BoletoWebhookPayload,
} from '../types/inter.types';
import { config } from '../config/env';

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
router.post('/pagamento/boleto', async (req: Request, res: Response) => {
    try {
        const dados: PagamentoBoletoRequest = req.body;

        if (!dados.codBarraLinhaDigitavel || !dados.valorPagar) {
            return res.status(400).json({
                error: 'Missing parameters: codBarraLinhaDigitavel and valorPagar are required',
            });
        }

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
                console.warn('[InterRoutes] Could not get QR code:', e);
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

// ===== Webhook Endpoints =====

/**
 * POST /api/inter/webhook/pix
 * Receive Pix webhooks from Inter
 */
router.post('/webhook/pix', async (req: Request, res: Response) => {
    try {
        console.log('[InterWebhook] Received Pix webhook:', JSON.stringify(req.body));

        // Validate webhook secret if configured
        if (config.interWebhookSecret) {
            const signature = req.headers['x-webhook-signature'];
            // TODO: Implement signature validation
        }

        const payload: PixWebhookPayload = req.body;

        if (payload.pix && Array.isArray(payload.pix)) {
            for (const pix of payload.pix) {
                console.log(`[InterWebhook] Pix received: ${pix.endToEndId} - R$ ${pix.valor}`);
            }
        }

        // Process via Banking Service (Socket Emit)
        await bankingService.processInterWebhook(payload, 'pix');

        res.status(200).json({ success: true });
    } catch (error: any) {
        console.error('[InterWebhook] Pix webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/inter/webhook/boleto
 * Receive Boleto webhooks from Inter
 */
router.post('/webhook/boleto', async (req: Request, res: Response) => {
    try {
        console.log('[InterWebhook] Received Boleto webhook:', JSON.stringify(req.body));

        const payload: BoletoWebhookPayload = req.body;

        if (payload.nossoNumero) {
            console.log(`[InterWebhook] Boleto ${payload.nossoNumero} - Status: ${payload.situacao}`);

            if (payload.situacao === 'PAGO') {
                console.log(`[InterWebhook] Boleto paid: R$ ${payload.valorPago} on ${payload.dataPagamento}`);
            }
        }

        // Process via Banking Service (Socket Emit)
        await bankingService.processInterWebhook(payload, 'boleto');

        res.status(200).json({ success: true });
    } catch (error: any) {
        console.error('[InterWebhook] Boleto webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

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
