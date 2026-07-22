import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { bankingService, CSVFormat } from '../services/bankingService';
import multer from 'multer';
import { createLogger } from '../utils/logger';
import { createFileFilter, validateFileUpload, containsExecutableCode, sanitizeFilename } from '../utils/fileValidation';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { dolibarrService } from '../services/dolibarr';
import { ok, fail } from '../utils/apiResponse';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import {
    validateBody,
    BankOfxImportSchema,
    BankCsvImportSchema,
    BankAutoImportSchema,
    BankCategorizeSchema,
    BankAnomaliesSchema,
    BankCashFlowSchema,
    BankChartDataSchema,
    BankReconcileSuggestSchema,
    BankReconcileSaveSchema,
    BankReconcileToggleSchema,
    BankBalanceCalculateSchema,
    CSVFormatSchema,
    SafeApiKeyHeaderSchema,
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

// Multer middleware factories — mocked nos testes; passam direto em produção mas
// populam req.file/req.files antes dos handlers.
const uploadSingle = upload.single('file');

/**
 * Extrai e valida o `userApiKey` enviado (header `dolapikey`/`DOLAPIKEY`).
 * Em caso de header malformado, retorna 401 padronizado.
 */
function validateUserApiKeyHeader(req: Request, res: Response): string | null {
    const raw = req.headers['dolapikey'] || req.headers['DOLAPIKEY'];
    if (typeof raw !== 'string' || !raw) return null;
    const result = SafeApiKeyHeaderSchema.safeParse(raw);
    if (!result.success) {
        fail(res, 'UNAUTHORIZED', 'userApiKey/DOLAPIKEY inválido (esperado alfanumérico 32-128)', 401);
        return null;
    }
    return result.data;
}

/**
 * Parse seguro de `req.body.format` (string JSON opcional). Em erro, escreve 400
 * padronizado no envelope fail e retorna null. O caller deve apenas retornar.
 */
function parseCsvFormat(req: Request, res: Response): CSVFormat | null {
    if (!req.body || !req.body.format) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(String(req.body.format));
    } catch {
        fail(res, 'INVALID_JSON', 'Formato CSV inválido: JSON mal formatado', 400);
        return null;
    }
    const result = CSVFormatSchema.safeParse(parsed);
    if (!result.success) {
        const details = result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
        fail(res, 'VALIDATION_ERROR', 'Formato CSV inválido', 400, details);
        return null;
    }
    return result.data;
}

// --- Import Endpoints ---

// Import OFX file
router.post(
    '/import/ofx',
    uploadSingle,
    validateBody(BankOfxImportSchema),
    asyncHandler(async (req: Request, res: Response) => {
        if (!req.file) {
            throw new AppError(400, 'BAD_REQUEST', 'Nenhum arquivo enviado');
        }

        const validation = validateFileUpload(req.file, 'banking');
        if (!validation.valid) {
            log.warn(`File upload rejected: ${validation.error}`);
            throw new AppError(400, 'BAD_REQUEST', validation.error || 'Arquivo inválido');
        }

        if (containsExecutableCode(req.file.buffer)) {
            log.warn('Blocked file with executable code');
            throw new AppError(400, 'BAD_REQUEST', 'Invalid file content');
        }

        sanitizeFilename(req.file.originalname);
        const content = req.file.buffer.toString('utf-8');
        const result = bankingService.parseOFX(content);

        log.info(`OFX imported: ${result.transactions.length} transactions`);

        ok(res, {
            accountNumber: result.accountNumber,
            bankId: result.bankId,
            balance: result.balance,
            transactionCount: result.transactions.length,
            transactions: result.transactions,
            metadata: result.metadata,
        });
    })
);

// Import CSV file
router.post(
    '/import/csv',
    uploadSingle,
    validateBody(BankCsvImportSchema),
    asyncHandler(async (req: Request, res: Response) => {
        if (!req.file) {
            throw new AppError(400, 'BAD_REQUEST', 'Nenhum arquivo enviado');
        }

        const content = req.file.buffer.toString('utf-8');

        const parsed = parseCsvFormat(req, res);
        if (parsed === null && req.body && req.body.format) {
            return;
        }

        const format: CSVFormat = parsed || {
            dateColumn: req.body.dateColumn || 'date',
            amountColumn: req.body.amountColumn || 'amount',
            descriptionColumn: req.body.descriptionColumn || 'description',
            delimiter: req.body.delimiter || ',',
            hasHeader: req.body.hasHeader !== 'false',
        };

        const result = bankingService.parseCSV(content, format);

        ok(res, {
            transactionCount: result.transactions.length,
            transactions: result.transactions,
            metadata: result.metadata,
        });
    })
);

// Auto-detect and import any supported file
router.post(
    '/import/auto',
    uploadSingle,
    validateBody(BankAutoImportSchema),
    asyncHandler(async (req: Request, res: Response) => {
        if (!req.file) {
            throw new AppError(400, 'BAD_REQUEST', 'Nenhum arquivo enviado');
        }

        const content = req.file.buffer.toString('utf-8');
        const result = bankingService.parseStatement(content, req.file.originalname);

        ok(res, {
            accountNumber: result.accountNumber,
            balance: result.balance,
            transactionCount: result.transactions.length,
            transactions: result.transactions,
            metadata: result.metadata,
        });
    })
);

// --- Analysis Endpoints ---

// Categorize transactions using LLM
router.post(
    '/analyze/categorize',
    validateBody(BankCategorizeSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { transactions } = req.body as z.infer<typeof BankCategorizeSchema>;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date as any),
        }));

        const categorized = await bankingService.categorizeTransactions(parsedTransactions as any);

        ok(res, categorized);
    })
);

// Detect spending anomalies
router.post(
    '/analyze/anomalies',
    validateBody(BankAnomaliesSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { transactions } = req.body as z.infer<typeof BankAnomaliesSchema>;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date as any),
        }));

        const anomalies = await bankingService.detectAnomalies(parsedTransactions as any);

        ok(res, anomalies, { count: anomalies.length });
    })
);

// --- Insights Endpoints ---

// Get cash flow insights
router.post(
    '/insights/cash-flow',
    validateBody(BankCashFlowSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { accounts, transactions, period } = req.body as z.infer<typeof BankCashFlowSchema>;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date as any),
        }));

        const insights = await bankingService.generateCashFlowInsights(
            accounts,
            parsedTransactions as any,
            period || 'month'
        );

        ok(res, insights);
    })
);

// Get chart data for cash flow visualization
router.post(
    '/insights/chart-data',
    validateBody(BankChartDataSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { transactions, groupBy } = req.body as z.infer<typeof BankChartDataSchema>;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date as any),
        }));

        const chartData = bankingService.getCashFlowChartData(parsedTransactions as any, groupBy || 'month');

        ok(res, chartData);
    })
);

// --- Reconciliation Endpoints ---

// Get reconciliation suggestions
router.post(
    '/reconcile/suggest',
    validateBody(BankReconcileSuggestSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { bankLines, invoices } = req.body as z.infer<typeof BankReconcileSuggestSchema>;

        const suggestions = await bankingService.suggestReconciliation(bankLines, invoices);

        ok(res, suggestions, { count: suggestions.length });
    })
);

// Save reconciliation (legacy: requires invoiceId)
router.post(
    '/reconcile/save',
    validateBody(BankReconcileSaveSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { lineId, invoiceId } = req.body as z.infer<typeof BankReconcileSaveSchema>;

        const userApiKey = validateUserApiKeyHeader(req, res);
        if (req.headers['dolapikey'] && userApiKey === null) {
            return;
        }

        const apiKey = userApiKey || (req.headers['dolapikey'] as string);

        const success = await bankingService.saveReconciliation(lineId, invoiceId, apiKey);

        ok(res, { success, message: success ? 'Conciliação salva com sucesso' : 'Falha ao salvar conciliação' });
    })
);

// Toggle reconciliation state of a bank line — persists directly to Dolibarr
router.post(
    '/reconcile/toggle',
    validateBody(BankReconcileToggleSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { accountId, lineId, reconciled } = req.body as z.infer<typeof BankReconcileToggleSchema>;

        const userApiKey = validateUserApiKeyHeader(req, res);
        if (req.headers['dolapikey'] && userApiKey === null) {
            return;
        }

        const apiKey = userApiKey || (req.headers['dolapikey'] as string);

        const success = await dolibarrService.reconcileBankLine(accountId, lineId, reconciled, apiKey);

        ok(res, { success, message: success ? 'Conciliação atualizada com sucesso' : 'Falha ao atualizar conciliação' });
    })
);

// Calculate dynamic balance
router.post(
    '/balance/calculate',
    validateBody(BankBalanceCalculateSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { initialBalance, transactions } = req.body as z.infer<typeof BankBalanceCalculateSchema>;

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date as any),
        }));

        const result = bankingService.calculateDynamicBalance(initialBalance, parsedTransactions as any);

        ok(res, result);
    })
);

export default router;
