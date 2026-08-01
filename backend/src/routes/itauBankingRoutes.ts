/**
 * Banco Itaú Banking Routes
 * 
 * REST API endpoints for Itaú banking operations
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { itauApiService } from '../services/itauApiService';
import { dolibarrService } from '../services/dolibarr';
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
import apiResponse from '../utils/apiResponse';
import { asyncHandler } from '../middleware/errorHandler';

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
//
// Webhooks do Itaú têm sua PRÓPRIA validação por assinatura HMAC
// (`verifyItauWebhookSignature` abaixo). NÃO aplicamos `requireAuth` nestas
// rotas: a segurança vem da verificação criptográfica da assinatura, não da
// sessão Dolibarr — o banco não sabe logar na nossa aplicação. #1758.

/**
 * Verifica a assinatura HMAC-SHA256 do webhook Itaú.
 *
 * Header aceito: `x-webhook-signature` (hex digest do HMAC-SHA256 sobre o body
 * bruto). Comparação em tempo constante via `crypto.timingSafeEqual` para
 * neutralizar ataques de timing.
 *
 * Regras (espelha o Inter, #1542):
 *  - Segredo configurado → `timingSafeEqual` SEMPRE roda (qualquer ambiente).
 *    Assinatura ausente/errada → 401 `INVALID_SIGNATURE`.
 *  - Sem segredo, mas com header de assinatura → 503 (não confiar cegamente
 *    numa assinatura que não temos como verificar).
 *  - Sem segredo e sem assinatura, em produção → 503 (config obrigatória).
 *  - Sem segredo e sem assinatura, fora de produção → segue (compat/dev local).
 */
function verifyItauWebhookSignature(req: Request, res: Response, next: NextFunction): void {
    const rawSignature = req.headers['x-webhook-signature'] ?? req.headers['x-signature'];
    const signature = Array.isArray(rawSignature) ? rawSignature[0] : rawSignature;
    const secret = config.itauWebhookSecret;

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
        log.error('Webhook com assinatura recebido, mas ITAU_WEBHOOK_SECRET não está configurado');
        apiResponse.fail(res, 'WEBHOOK_NOT_CONFIGURED', 'Webhook signature verification not configured', 503);
        return;
    }

    if (process.env.NODE_ENV === 'production') {
        log.error('Webhook rejeitado: ITAU_WEBHOOK_SECRET não configurado em produção');
        apiResponse.fail(res, 'WEBHOOK_NOT_CONFIGURED', 'Webhook signature verification not configured', 503);
        return;
    }

    next();
}

/**
 * Compara uma assinatura fornecida com o HMAC-SHA256 esperado do payload.
 * Retorna false se a assinatura é undefined ou se `timingSafeEqual` falha
 * (comprimentos diferentes, etc).
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
 * POST /api/itau/webhook/pix
 * Receive PIX webhooks from Itaú
 */
router.post('/webhook/pix', verifyItauWebhookSignature, asyncHandler(async (req: Request, res: Response) => {
    log.info('Received PIX webhook', req.body);

    const payload: PixWebhookItauPayload = req.body;

    if (payload.pix && Array.isArray(payload.pix)) {
        for (const pix of payload.pix) {
            log.info(`PIX received: ${pix.endToEndId} - R$ ${pix.valor}`);
        }
    }

    apiResponse.ok(res, { received: true });
}));

/**
 * POST /api/itau/webhook/boleto
 * Receive Boleto webhooks from Itaú
 */
router.post('/webhook/boleto', verifyItauWebhookSignature, asyncHandler(async (req: Request, res: Response) => {
    log.info('Received Boleto webhook', req.body);

    const payload: BoletoWebhookItauPayload = req.body;

    if (payload.nossoNumero) {
        log.info(`Boleto ${payload.nossoNumero} - Event: ${payload.evento}`);

        if (payload.evento === 'LIQUIDACAO') {
            log.info(`Boleto paid: R$ ${payload.valor} on ${payload.dataPagamento}`);
        }
    }

    apiResponse.ok(res, { received: true });
}));

// ===== All routes below require authentication =====
//
// #1758: middleware `requireDolibarrLogin` (= `requireAuth`) aplicado a TODAS
// as rotas abaixo deste ponto. Os webhooks acima são a única exceção — usam
// `verifyItauWebhookSignature` (HMAC) no lugar de auth por sessão.
router.use(requireDolibarrLogin);

// ===== Status Endpoints =====

/**
 * GET /api/itau/status
 * Get Itaú API connection status
 */
router.get('/status', asyncHandler(async (req: Request, res: Response) => {
    const status = await itauApiService.getStatus();
    apiResponse.ok(res, status);
}));

/**
 * POST /api/itau/test
 * Test Itaú API connection
 */
router.post('/test', asyncHandler(async (req: Request, res: Response) => {
    const initialized = await itauApiService.initialize();
    if (!initialized) {
        return apiResponse.fail(
            res,
            'ITAU_INIT_FAILED',
            'Failed to initialize. Check certificates and credentials.',
            400
        );
    }

    // Try to get balance as a test
    const saldo = await itauApiService.getSaldo();
    apiResponse.ok(res, {
        message: 'Connection successful',
        saldo,
    });
}));

/**
 * POST /api/itau/certificates
 * Upload Itaú certificates
 */
router.post('/certificates', certUpload.array('files', 2), asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
        return apiResponse.fail(res, 'NO_FILE', 'No files uploaded', 400);
    }

    const uploaded = files.map(f => f.filename);
    apiResponse.ok(res, {
        uploaded,
        message: `Uploaded ${uploaded.length} certificate file(s)`,
    });
}));

// ===== Banking Endpoints =====

/**
 * GET /api/itau/saldo
 * Get account balance
 */
router.get('/saldo', asyncHandler(async (req: Request, res: Response) => {
    const saldo = await itauApiService.getSaldo();
    apiResponse.ok(res, saldo);
}));

/**
 * GET /api/itau/extrato
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

    const transacoes = await itauApiService.getExtratoCompleto(
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
        const match = payablesByValue.get(Math.round(t.valor * 100));
        return {
            ...t,
            vinculo: {
                cliente: match?.socName || undefined,
                finalidade: t.complemento || t.descricao,
            },
        };
    });

    apiResponse.ok(res, { transacoes: transacoesEnriquecidas });
}));

/**
 * POST /api/itau/pagamento/boleto
 * Pay a boleto
 */
router.post('/pagamento/boleto', asyncHandler(async (req: Request, res: Response) => {
    const dados: PagamentoBoletoItauRequest = req.body;

    if (!dados.codigo_barras_linha_digitavel || !dados.valor_pagamento) {
        return apiResponse.fail(
            res,
            'MISSING_PARAMS',
            'Missing parameters: codigo_barras_linha_digitavel and valor_pagamento are required',
            400
        );
    }

    const resultado = await itauApiService.pagarBoleto(dados);
    apiResponse.ok(res, resultado);
}));

/**
 * GET /api/itau/pagamento/:id/comprovante
 * Get payment receipt PDF
 */
router.get('/pagamento/:id/comprovante', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const pdf = await itauApiService.getComprovantePagamento(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="comprovante_${id}.pdf"`);
    res.send(pdf);
}));

// ===== PIX Endpoints =====

/**
 * POST /api/itau/pix/cobranca
 * Create PIX charge
 */
router.post('/pix/cobranca', asyncHandler(async (req: Request, res: Response) => {
    const { txid, ...dados } = req.body as PixCobrancaItauRequest & { txid?: string };

    if (!dados.valor?.original || !dados.chave) {
        return apiResponse.fail(
            res,
            'MISSING_PARAMS',
            'Missing parameters: valor.original and chave are required',
            400
        );
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

    apiResponse.ok(res, { ...cobranca, qrcode: qrcode?.qrcode });
}));

/**
 * POST /api/itau/pix/cobranca-vencimento
 * Create PIX charge with due date
 */
router.post('/pix/cobranca-vencimento', asyncHandler(async (req: Request, res: Response) => {
    const { txid, ...dados } = req.body;

    if (!txid) {
        return apiResponse.fail(res, 'MISSING_PARAMS', 'txid is required for scheduled charges', 400);
    }

    const cobranca = await itauApiService.criarPixCobrancaVencimento(txid, dados);
    apiResponse.ok(res, cobranca);
}));

/**
 * GET /api/itau/pix/cobranca/:txid
 * Get PIX charge status
 */
router.get('/pix/cobranca/:txid', asyncHandler(async (req: Request, res: Response) => {
    const { txid } = req.params;
    const cobranca = await itauApiService.consultarPixCobranca(txid);
    apiResponse.ok(res, cobranca);
}));

/**
 * POST /api/itau/pix/enviar
 * Send PIX payment
 */
router.post('/pix/enviar', asyncHandler(async (req: Request, res: Response) => {
    const dados: PixPagamentoItauRequest = req.body;

    if (!dados.valor || !dados.pagamento) {
        return apiResponse.fail(
            res,
            'MISSING_PARAMS',
            'Missing parameters: valor and pagamento are required',
            400
        );
    }

    const resultado = await itauApiService.enviarPix(dados);
    apiResponse.ok(res, resultado);
}));

/**
 * GET /api/itau/pix/recebidos
 * List received PIX
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

    const pix = await itauApiService.listarPixRecebidos(inicio as string, fim as string);
    apiResponse.ok(res, { pix });
}));

/**
 * GET /api/itau/pix/:e2eid
 * Get PIX by endToEndId
 */
router.get('/pix/:e2eid', asyncHandler(async (req: Request, res: Response) => {
    const { e2eid } = req.params;
    const pix = await itauApiService.consultarPix(e2eid);
    apiResponse.ok(res, pix);
}));

// ===== Boleto Endpoints =====

/**
 * POST /api/itau/boleto
 * Issue new boleto
 */
router.post('/boleto', asyncHandler(async (req: Request, res: Response) => {
    const dados: BoletoItauRequest = req.body;

    if (!dados.dado_boleto?.valor_total_titulo || !dados.dado_boleto?.data_vencimento) {
        return apiResponse.fail(
            res,
            'MISSING_PARAMS',
            'Missing required fields: dado_boleto.valor_total_titulo, dado_boleto.data_vencimento',
            400
        );
    }

    const boleto = await itauApiService.emitirBoleto(dados);
    apiResponse.ok(res, boleto);
}));

/**
 * GET /api/itau/boleto
 * List boletos
 * Query: dataInicial, dataFinal, situacao, pagina, tamanhoPagina
 */
router.get('/boleto', asyncHandler(async (req: Request, res: Response) => {
    const { dataInicial, dataFinal, situacao, pagina, tamanhoPagina } = req.query;

    const resultado = await itauApiService.listarBoletos({
        dataInicial: dataInicial as string,
        dataFinal: dataFinal as string,
        situacao: situacao as any,
        pagina: pagina ? parseInt(pagina as string) : undefined,
        tamanhoPagina: tamanhoPagina ? parseInt(tamanhoPagina as string) : undefined,
    });

    apiResponse.ok(res, resultado);
}));

/**
 * GET /api/itau/boleto/:nossoNumero
 * Get boleto details
 */
router.get('/boleto/:nossoNumero', asyncHandler(async (req: Request, res: Response) => {
    const { nossoNumero } = req.params;
    const boleto = await itauApiService.consultarBoleto(nossoNumero);
    apiResponse.ok(res, boleto);
}));

/**
 * GET /api/itau/boleto/:nossoNumero/pdf
 * Download boleto PDF
 */
router.get('/boleto/:nossoNumero/pdf', asyncHandler(async (req: Request, res: Response) => {
    const { nossoNumero } = req.params;
    const pdf = await itauApiService.downloadBoletoPDF(nossoNumero);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="boleto_${nossoNumero}.pdf"`);
    res.send(pdf);
}));

/**
 * POST /api/itau/boleto/:nossoNumero/baixar
 * Baixa (cancel) boleto
 */
router.post('/boleto/:nossoNumero/baixar', asyncHandler(async (req: Request, res: Response) => {
    const { nossoNumero } = req.params;
    const { motivo } = req.body;

    await itauApiService.baixarBoleto(nossoNumero, motivo || 'ACERTOS');
    apiResponse.ok(res, { message: 'Boleto baixado com sucesso' });
}));

// ===== Webhook Config Endpoints =====

/**
 * PUT /api/itau/webhook/pix/config
 * Configure PIX webhook URL
 */
router.put('/webhook/pix/config', asyncHandler(async (req: Request, res: Response) => {
    const { chave, webhookUrl } = req.body;

    if (!chave || !webhookUrl) {
        return apiResponse.fail(
            res,
            'MISSING_PARAMS',
            'Missing parameters: chave and webhookUrl are required',
            400
        );
    }

    await itauApiService.configurarWebhookPix(chave, webhookUrl);
    apiResponse.ok(res, { message: 'Webhook configured successfully' });
}));

/**
 * GET /api/itau/webhook/pix/config/:chave
 * Get PIX webhook configuration
 */
router.get('/webhook/pix/config/:chave', asyncHandler(async (req: Request, res: Response) => {
    const { chave } = req.params;
    const webhookConfig = await itauApiService.consultarWebhookPix(chave);
    apiResponse.ok(res, webhookConfig);
}));

/**
 * DELETE /api/itau/webhook/pix/config/:chave
 * Delete PIX webhook
 */
router.delete('/webhook/pix/config/:chave', asyncHandler(async (req: Request, res: Response) => {
    const { chave } = req.params;
    await itauApiService.deletarWebhookPix(chave);
    apiResponse.ok(res, { message: 'Webhook deleted successfully' });
}));

// ===== Utility Endpoints =====

/**
 * GET /api/itau/txid/generate
 * Generate a new txid for PIX
 */
router.get('/txid/generate', (req: Request, res: Response) => {
    const txid = itauApiService.generateTxId();
    apiResponse.ok(res, { txid });
});

export default router;
