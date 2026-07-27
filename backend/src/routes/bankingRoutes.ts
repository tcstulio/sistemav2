import { Router, Request, Response, NextFunction } from 'express';
import { bankingService, CSVFormat } from '../services/bankingService';
import multer from 'multer';
import { createLogger } from '../utils/logger';
import { createFileFilter, validateFileUpload, containsExecutableCode } from '../utils/fileValidation';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { dolibarrService } from '../services/dolibarr';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import apiResponse from '../utils/apiResponse';
import {
    validateBody,
    requireUserApiKey,
    TransactionsSchema,
    CashFlowInsightsSchema,
    ChartDataSchema,
    ReconcileSuggestSchema,
    ReconcileSaveSchema,
    ReconcileToggleSchema,
    BalanceCalculateSchema,
    ExportBodySchema,
    CsvFormatSchema,
} from '../middleware/validation';
import { rateLimiters } from '../middleware/rateLimit';

const log = createLogger('Banking');
const router = Router();

// Protege todas as rotas bancárias: sessão Dolibarr obrigatória.
// Cada POST exige, por sua vez, o header `userApiKey` (CNPJ 14 dígitos ou UUID)
// via `requireUserApiKey` aplicado por-rota — o middleware opcional
// `validateUserApiKey` (alphanumeric 32-128, legacia) não cabe aqui porque
// a #1330 endurece o formato válido para o header dos endpoints sensíveis.
router.use(requireDolibarrLogin);

// Configure multer for file uploads with enhanced validation
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: createFileFilter('banking')
});

// =============================================
// Helpers (issue #1330)
// =============================================

/**
 * Faz parse seguro de `format` (string JSON-serializável) e delega via
 * `next(new AppError('INVALID_JSON', 400, 'Formato inválido'))` em erro.
 * Sem o try/catch, `JSON.parse` de entrada não-confiável derruba o
 * processo (#1542). Retorna `undefined` quando delega o erro (o caller
 * apenas interrompe e o errorHandler renderiza o envelope padronizado).
 */
function parseFormat(format: string, next: NextFunction): unknown {
    try {
        return JSON.parse(format);
    } catch {
        next(new AppError(400, 'INVALID_JSON', 'Formato inválido'));
        return undefined;
    }
}

// =============================================
// Export endpoint (#1330)
// =============================================
// POST /api/banking/export
// Body: { format: string (JSON-serializável), bankCode: string, accountId: string }
// - `bankingPost` rate-limiter (10/15min) — AC: 11ª requisição → 429
// - `requireUserApiKey` (CNPJ 14 dígitos ou UUID) — ausente ou inválido → 401
// - `exportBodySchema` valida o shape via Zod
// - `JSON.parse(format)` em try/catch → 400 INVALID_JSON
router.post(
    '/export',
    rateLimiters.bankingPost,
    requireUserApiKey,
    validateBody(ExportBodySchema),
    (req: Request, res: Response, next: NextFunction) => {
        const parsedFormat = parseFormat(req.body.format, next);
        if (parsedFormat === undefined) return;
        return apiResponse.ok(res, {
            format: parsedFormat,
            bankCode: req.body.bankCode,
            accountId: req.body.accountId
        });
    }
);

// --- Import Endpoints ---

// Import OFX file
router.post(
    '/import/ofx',
    rateLimiters.bankingPost,
    requireUserApiKey,
    upload.single('file'),
    asyncHandler(async (req: Request, res: Response) => {
        if (!req.file) {
            return apiResponse.fail(res, 'NO_FILE', 'Nenhum arquivo enviado', 400);
        }

        // Additional security validation
        const validation = validateFileUpload(req.file, 'banking');
        if (!validation.valid) {
            log.warn(`File upload rejected: ${validation.error}`);
            return apiResponse.fail(res, 'INVALID_FILE', validation.error || 'Arquivo inválido', 400);
        }

        // Check for executable code
        if (containsExecutableCode(req.file.buffer)) {
            log.warn('Blocked file with executable code');
            return apiResponse.fail(res, 'INVALID_FILE', 'Invalid file content', 400);
        }

        const content = req.file.buffer.toString('utf-8');
        const result = bankingService.parseOFX(content);

        log.info(`OFX imported: ${result.transactions.length} transactions`);

        return apiResponse.ok(res, {
            accountNumber: result.accountNumber,
            bankId: result.bankId,
            balance: result.balance,
            transactionCount: result.transactions.length,
            transactions: result.transactions,
            metadata: result.metadata
        });
    })
);

// Import CSV file
router.post(
    '/import/csv',
    rateLimiters.bankingPost,
    requireUserApiKey,
    upload.single('file'),
    asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        if (!req.file) {
            return apiResponse.fail(res, 'NO_FILE', 'Nenhum arquivo enviado', 400);
        }

        const content = req.file.buffer.toString('utf-8');

        // Get format from body or use auto-detection
        let format: CSVFormat;
        if (req.body.format !== undefined) {
            // CRÍTICO (#1542 #1330): JSON.parse de entrada não-confiável precisa
            // de try/catch — sem ele, um `format` malformado derruba o processo.
            // Em erro → 400 INVALID_JSON via AppError.
            // Null e string vazia também são tratados como inválidos (#1330),
            // porque o cliente sinalizou a intenção de usar `format` mas o
            // mandou sem valor útil — diferente de simplesmente omitir o campo.
            if (req.body.format === null || req.body.format === '') {
                next(new AppError(400, 'INVALID_JSON', 'Formato inválido'));
                return;
            }
            const parsedFormat = parseFormat(req.body.format, next);
            if (parsedFormat === undefined) return;
            if (typeof parsedFormat !== 'object' || parsedFormat === null || Array.isArray(parsedFormat)) {
                next(new AppError(400, 'INVALID_FORMAT', 'Formato inválido'));
                return;
            }
            const validatedFormat = CsvFormatSchema.safeParse(parsedFormat);
            if (!validatedFormat.success) {
                next(new AppError(400, 'INVALID_FORMAT', 'Formato inválido'));
                return;
            }
            format = validatedFormat.data as CSVFormat;
        } else {
            format = {
                dateColumn: req.body.dateColumn || 'date',
                amountColumn: req.body.amountColumn || 'amount',
                descriptionColumn: req.body.descriptionColumn || 'description',
                delimiter: req.body.delimiter || ',',
                hasHeader: req.body.hasHeader !== 'false'
            };
        }

        const result = bankingService.parseCSV(content, format);

        return apiResponse.ok(res, {
            transactionCount: result.transactions.length,
            transactions: result.transactions,
            metadata: result.metadata
        });
    })
);

// Auto-detect and import any supported file
router.post(
    '/import/auto',
    rateLimiters.bankingPost,
    requireUserApiKey,
    upload.single('file'),
    asyncHandler(async (req: Request, res: Response) => {
        if (!req.file) {
            return apiResponse.fail(res, 'NO_FILE', 'Nenhum arquivo enviado', 400);
        }

        const content = req.file.buffer.toString('utf-8');
        const result = bankingService.parseStatement(content, req.file.originalname);

        return apiResponse.ok(res, {
            accountNumber: result.accountNumber,
            balance: result.balance,
            transactionCount: result.transactions.length,
            transactions: result.transactions,
            metadata: result.metadata
        });
    })
);

// --- Analysis Endpoints ---

// Categorize transactions using LLM
router.post(
    '/analyze/categorize',
    rateLimiters.bankingPost,
    requireUserApiKey,
    validateBody(TransactionsSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { transactions } = req.body;

        // Convert date strings to Date objects
        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date)
        }));

        const categorized = await bankingService.categorizeTransactions(parsedTransactions);

        return apiResponse.ok(res, categorized);
    })
);

// Detect spending anomalies
router.post(
    '/analyze/anomalies',
    rateLimiters.bankingPost,
    requireUserApiKey,
    validateBody(TransactionsSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { transactions } = req.body;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date)
        }));

        const anomalies = await bankingService.detectAnomalies(parsedTransactions);

        return apiResponse.ok(res, anomalies, { count: anomalies.length });
    })
);

// --- Insights Endpoints ---

// Get cash flow insights
router.post(
    '/insights/cash-flow',
    rateLimiters.bankingPost,
    requireUserApiKey,
    validateBody(CashFlowInsightsSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { accounts, transactions, period } = req.body;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date)
        }));

        const insights = await bankingService.generateCashFlowInsights(
            accounts,
            parsedTransactions,
            period || 'month'
        );

        return apiResponse.ok(res, insights);
    })
);

// Get chart data for cash flow visualization
router.post(
    '/insights/chart-data',
    rateLimiters.bankingPost,
    requireUserApiKey,
    validateBody(ChartDataSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { transactions, groupBy } = req.body;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date)
        }));

        const chartData = bankingService.getCashFlowChartData(parsedTransactions, groupBy || 'month');

        return apiResponse.ok(res, chartData);
    })
);

// --- Reconciliation Endpoints ---

// Get reconciliation suggestions
router.post(
    '/reconcile/suggest',
    rateLimiters.bankingPost,
    requireUserApiKey,
    validateBody(ReconcileSuggestSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { bankLines, invoices } = req.body;

        const suggestions = await bankingService.suggestReconciliation(bankLines, invoices);

        return apiResponse.ok(res, suggestions, { count: suggestions.length });
    })
);

// Save reconciliation (legacy: requires invoiceId)
//
// NOTA DE CONTRATO: /reconcile/save e /reconcile/toggle NÃO usam o envelope
// apiResponse. O campo `success` no topo é o RESULTADO DE DOMÍNIO da operação
// (a conciliação persistiu no Dolibarr ou não), consumido diretamente pela SPA
// (`hrAdmin.reconcileBankLine` lê `Boolean(data.success)`). Envelopá-los
// (`{ success: true, data: { success: false } }`) inverteria a semântica.
router.post(
    '/reconcile/save',
    rateLimiters.bankingPost,
    requireUserApiKey,
    validateBody(ReconcileSaveSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { lineId, invoiceId } = req.body;
        const userApiKey = req.headers['dolapikey'] as string;

        const success = await bankingService.saveReconciliation(lineId, invoiceId, userApiKey);

        res.json({
            success,
            message: success ? 'Conciliação salva com sucesso' : 'Falha ao salvar conciliação'
        });
    })
);

// Toggle reconciliation state of a bank line — persists directly to Dolibarr
router.post(
    '/reconcile/toggle',
    rateLimiters.bankingPost,
    requireUserApiKey,
    validateBody(ReconcileToggleSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { accountId, lineId, reconciled } = req.body;
        const userApiKey = req.headers['dolapikey'] as string;

        const success = await dolibarrService.reconcileBankLine(accountId, lineId, reconciled, userApiKey);

        // `success` = resultado de domínio (ver nota em /reconcile/save).
        res.json({
            success,
            message: success ? 'Conciliação atualizada com sucesso' : 'Falha ao atualizar conciliação'
        });
    })
);

// Calculate dynamic balance
router.post(
    '/balance/calculate',
    rateLimiters.bankingPost,
    requireUserApiKey,
    validateBody(BalanceCalculateSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { initialBalance, transactions } = req.body;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date)
        }));

        const result = bankingService.calculateDynamicBalance(initialBalance, parsedTransactions);

        return apiResponse.ok(res, result);
    })
);

export default router;
