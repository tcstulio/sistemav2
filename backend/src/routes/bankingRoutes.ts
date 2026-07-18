/**
 * bankingRoutes.ts — issue #1542.
 *
 * Padrões:
 *   - Todas as rotas POST passam por `validateBody(ZodSchema)` antes do
 *     handler. Validação falhada → 400 (via ValidationError → errorHandler).
 *   - Header `userApiKey` (DOLAPIKEY) validado por `validateUserApiKey()`.
 *     Formato esperado: alfanumérico, 32–128 chars. Falha → 401.
 *   - Respostas padronizadas via `apiResponse.ok/fail`. Erros não-tratados
 *     caem no errorHandler global via `asyncHandler` + `next(error)`.
 *   - O `JSON.parse(req.body.format)` da importação CSV é blindado com
 *     try/catch — payload malformado vira 400 INVALID_JSON em vez de
 *     derrubar o processo.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { bankingService, CSVFormat } from '../services/bankingService';
import multer from 'multer';
import { createLogger } from '../utils/logger';
import { createFileFilter, validateFileUpload, containsExecutableCode } from '../utils/fileValidation';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { dolibarrService } from '../services/dolibarr';
import { asyncHandler } from '../middleware/errorHandler';
import { ok as apiOk, fail as apiFail } from '../utils/apiResponse';
import {
    validateBody,
    validateUserApiKey,
    CSVImportSchema,
    CSVFormatSchema,
    CategorizeTransactionsSchema,
    AnomalyDetectionSchema,
    CashFlowInsightsSchema,
    ChartDataSchema,
    ReconciliationSuggestSchema,
    ReconciliationSaveSchema,
    ReconciliationToggleSchema,
    BalanceCalculateSchema,
} from '../middleware/validation';

const log = createLogger('Banking');
const router = Router();

// Protect all banking routes
router.use(requireDolibarrLogin);

// Configure multer for file uploads with enhanced validation
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: createFileFilter('banking')
});

/**
 * Helper: converte date string → Date, com fallback silencioso para
 * datas inválidas (compat com o parser do service).
 */
function toDateOrNow(value: any): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        if (!isNaN(d.getTime())) return d;
    }
    return new Date();
}

// --- Import Endpoints ---

// Import OFX file
router.post(
    '/import/ofx',
    upload.single('file'),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        if (!req.file) {
            return apiFail(res, 'NO_FILE', 'Nenhum arquivo enviado', 400);
        }

        const validation = validateFileUpload(req.file, 'banking');
        if (!validation.valid) {
            log.warn(`File upload rejected: ${validation.error}`);
            return apiFail(res, 'INVALID_FILE', validation.error || 'Arquivo inválido', 400);
        }

        if (containsExecutableCode(req.file.buffer)) {
            log.warn('Blocked file with executable code');
            return apiFail(res, 'EXECUTABLE_CONTENT', 'Invalid file content', 400);
        }

        const content = req.file.buffer.toString('utf-8');
        const result = bankingService.parseOFX(content);

        log.info(`OFX imported: ${result.transactions.length} transactions`);

        return apiOk(res, {
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
    upload.single('file'),
    validateBody(CSVImportSchema),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        if (!req.file) {
            return apiFail(res, 'NO_FILE', 'Nenhum arquivo enviado', 400);
        }

        const content = req.file.buffer.toString('utf-8');

        // Resolve format: string JSON (multipart) → parsear com try/catch;
        // ausente → fallback para campos individuais do form-data.
        let format: CSVFormat;
        if (req.body.format) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(req.body.format);
            } catch {
                // CRÍTICO (#1542): sem try/catch aqui o servidor crashava.
                return apiFail(res, 'INVALID_JSON', 'Formato CSV inválido: JSON mal formatado', 400);
            }
            const formatCheck = CSVFormatSchema.safeParse(parsed);
            if (!formatCheck.success) {
                return apiFail(
                    res,
                    'INVALID_CSV_FORMAT',
                    'Formato CSV inválido',
                    400,
                    formatCheck.error.issues
                );
            }
            format = formatCheck.data as CSVFormat;
        } else {
            const fallback = {
                dateColumn: req.body.dateColumn || 'date',
                amountColumn: req.body.amountColumn || 'amount',
                descriptionColumn: req.body.descriptionColumn || 'description',
                delimiter: req.body.delimiter || ',',
                hasHeader: req.body.hasHeader !== 'false' && req.body.hasHeader !== false,
            };
            const fallbackCheck = CSVFormatSchema.safeParse(fallback);
            if (!fallbackCheck.success) {
                return apiFail(
                    res,
                    'INVALID_CSV_FORMAT',
                    'Formato CSV inválido',
                    400,
                    fallbackCheck.error.issues
                );
            }
            format = fallbackCheck.data as CSVFormat;
        }

        const result = bankingService.parseCSV(content, format);

        return apiOk(res, {
            transactionCount: result.transactions.length,
            transactions: result.transactions,
            metadata: result.metadata
        });
    })
);

// Auto-detect and import any supported file
router.post(
    '/import/auto',
    upload.single('file'),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        if (!req.file) {
            return apiFail(res, 'NO_FILE', 'Nenhum arquivo enviado', 400);
        }

        const content = req.file.buffer.toString('utf-8');
        const result = bankingService.parseStatement(content, req.file.originalname);

        return apiOk(res, {
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
    validateBody(CategorizeTransactionsSchema),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { transactions } = req.body;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: toDateOrNow(t.date),
        }));

        const categorized = await bankingService.categorizeTransactions(parsedTransactions);

        return apiOk(res, categorized);
    })
);

// Detect spending anomalies
router.post(
    '/analyze/anomalies',
    validateBody(AnomalyDetectionSchema),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { transactions } = req.body;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: toDateOrNow(t.date),
        }));

        const anomalies = await bankingService.detectAnomalies(parsedTransactions);

        return res.status(200).json({
            success: true,
            count: anomalies.length,
            data: anomalies
        });
    })
);

// --- Insights Endpoints ---

// Get cash flow insights
router.post(
    '/insights/cash-flow',
    validateBody(CashFlowInsightsSchema),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { accounts, transactions, period } = req.body;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: toDateOrNow(t.date),
        }));

        const insights = await bankingService.generateCashFlowInsights(
            accounts,
            parsedTransactions,
            period || 'month'
        );

        return apiOk(res, insights);
    })
);

// Get chart data for cash flow visualization
router.post(
    '/insights/chart-data',
    validateBody(ChartDataSchema),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { transactions, groupBy } = req.body;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: toDateOrNow(t.date),
        }));

        const chartData = bankingService.getCashFlowChartData(parsedTransactions, groupBy || 'month');

        return apiOk(res, chartData);
    })
);

// --- Reconciliation Endpoints ---

// Get reconciliation suggestions
router.post(
    '/reconcile/suggest',
    validateBody(ReconciliationSuggestSchema),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { bankLines, invoices } = req.body;

        const suggestions = await bankingService.suggestReconciliation(bankLines, invoices);

        return res.status(200).json({
            success: true,
            count: suggestions.length,
            data: suggestions
        });
    })
);

// Save reconciliation (legacy: requires invoiceId)
router.post(
    '/reconcile/save',
    validateBody(ReconciliationSaveSchema),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { lineId, invoiceId } = req.body;
        const userApiKey = req.headers['dolapikey'] as string;

        const success = await bankingService.saveReconciliation(lineId, invoiceId, userApiKey);

        return res.status(200).json({
            success,
            message: success ? 'Conciliação salva com sucesso' : 'Falha ao salvar conciliação'
        });
    })
);

// Toggle reconciliation state of a bank line — persists directly to Dolibarr
router.post(
    '/reconcile/toggle',
    validateBody(ReconciliationToggleSchema),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { accountId, lineId, reconciled } = req.body;
        const userApiKey = req.headers['dolapikey'] as string;

        const success = await dolibarrService.reconcileBankLine(accountId, lineId, reconciled, userApiKey);

        return res.status(200).json({
            success,
            message: success ? 'Conciliação atualizada com sucesso' : 'Falha ao atualizar conciliação'
        });
    })
);

// Calculate dynamic balance
router.post(
    '/balance/calculate',
    validateBody(BalanceCalculateSchema),
    validateUserApiKey(),
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
        const { initialBalance, transactions } = req.body;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: toDateOrNow(t.date),
        }));

        const result = bankingService.calculateDynamicBalance(initialBalance, parsedTransactions);

        return apiOk(res, result);
    })
);

export default router;