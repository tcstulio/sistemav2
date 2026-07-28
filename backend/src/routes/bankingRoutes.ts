import { Router, Request, Response } from 'express';
import { bankingService, CSVFormat } from '../services/bankingService';
import multer from 'multer';
import { createLogger } from '../utils/logger';
import { createFileFilter, validateFileUpload, containsExecutableCode } from '../utils/fileValidation';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { dolibarrService } from '../services/dolibarr';
import { asyncHandler } from '../middleware/errorHandler';
import apiResponse from '../utils/apiResponse';
import {
    validateBody,
    validateUserApiKey,
    TransactionsSchema,
    CashFlowInsightsSchema,
    ChartDataSchema,
    ReconcileSuggestSchema,
    ReconcileSaveSchema,
    ReconcileToggleSchema,
    BalanceCalculateSchema,
} from '../middleware/validation';

const log = createLogger('Banking');
const router = Router();

// Protege todas as rotas bancárias: sessão Dolibarr + validação do formato do
// header de API key quando presente (rejeita chaves malformadas com 401).
router.use(requireDolibarrLogin);
router.use(validateUserApiKey);

// Configure multer for file uploads with enhanced validation
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: createFileFilter('banking')
});

// --- Import Endpoints ---

// Import OFX file
router.post('/import/ofx', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
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
}));

// Import CSV file
router.post('/import/csv', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
        return apiResponse.fail(res, 'NO_FILE', 'Nenhum arquivo enviado', 400);
    }

    const content = req.file.buffer.toString('utf-8');

    // Get format from body or use auto-detection
    let format: CSVFormat;
    if (req.body.format) {
        // CRÍTICO (#1542): JSON.parse de entrada não-confiável precisa de try/catch —
        // sem ele, um `format` malformado derruba o processo. Em erro → 400 INVALID_JSON.
        let parsed: unknown;
        try {
            parsed = JSON.parse(req.body.format);
        } catch {
            return apiResponse.fail(res, 'INVALID_JSON', 'Formato CSV inválido: JSON mal formatado', 400);
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return apiResponse.fail(res, 'INVALID_FORMAT', 'Formato CSV inválido: objeto esperado', 400);
        }
        format = parsed as CSVFormat;
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
}));

// Auto-detect and import any supported file
router.post('/import/auto', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
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
}));

// --- Analysis Endpoints ---

// Categorize transactions using LLM
router.post('/analyze/categorize', validateBody(TransactionsSchema), asyncHandler(async (req: Request, res: Response) => {
    const { transactions } = req.body;

    // Convert date strings to Date objects
    const parsedTransactions = transactions.map((t: any) => ({
        ...t,
        date: new Date(t.date)
    }));

    const categorized = await bankingService.categorizeTransactions(parsedTransactions);

    return apiResponse.ok(res, categorized);
}));

// Detect spending anomalies
router.post('/analyze/anomalies', validateBody(TransactionsSchema), asyncHandler(async (req: Request, res: Response) => {
    const { transactions } = req.body;

    const parsedTransactions = transactions.map((t: any) => ({
        ...t,
        date: new Date(t.date)
    }));

    const anomalies = await bankingService.detectAnomalies(parsedTransactions);

    return apiResponse.ok(res, anomalies, { count: anomalies.length });
}));

// --- Insights Endpoints ---

// Get cash flow insights
router.post('/insights/cash-flow', validateBody(CashFlowInsightsSchema), asyncHandler(async (req: Request, res: Response) => {
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
}));

// Get chart data for cash flow visualization
router.post('/insights/chart-data', validateBody(ChartDataSchema), asyncHandler(async (req: Request, res: Response) => {
    const { transactions, groupBy } = req.body;

    const parsedTransactions = transactions.map((t: any) => ({
        ...t,
        date: new Date(t.date)
    }));

    const chartData = bankingService.getCashFlowChartData(parsedTransactions, groupBy || 'month');

    return apiResponse.ok(res, chartData);
}));

// --- Reconciliation Endpoints ---

// Get reconciliation suggestions
router.post('/reconcile/suggest', validateBody(ReconcileSuggestSchema), asyncHandler(async (req: Request, res: Response) => {
    const { bankLines, invoices } = req.body;

    const suggestions = await bankingService.suggestReconciliation(bankLines, invoices);

    return apiResponse.ok(res, suggestions, { count: suggestions.length });
}));

// Save reconciliation (legacy: requires invoiceId)
//
// NOTA DE CONTRATO: /reconcile/save e /reconcile/toggle NÃO usam o envelope
// apiResponse. O campo `success` no topo é o RESULTADO DE DOMÍNIO da operação
// (a conciliação persistiu no Dolibarr ou não), consumido diretamente pela SPA
// (`hrAdmin.reconcileBankLine` lê `Boolean(data.success)`). Envelopá-los
// (`{ success: true, data: { success: false } }`) inverteria a semântica.
router.post('/reconcile/save', validateBody(ReconcileSaveSchema), asyncHandler(async (req: Request, res: Response) => {
    const { lineId, invoiceId } = req.body;
    const userApiKey = req.headers['dolapikey'] as string;

    const success = await bankingService.saveReconciliation(lineId, invoiceId, userApiKey);

    res.json({
        success,
        message: success ? 'Conciliação salva com sucesso' : 'Falha ao salvar conciliação'
    });
}));

// Toggle reconciliation state of a bank line — persists directly to Dolibarr
router.post('/reconcile/toggle', validateBody(ReconcileToggleSchema), asyncHandler(async (req: Request, res: Response) => {
    const { accountId, lineId, reconciled } = req.body;
    const userApiKey = req.headers['dolapikey'] as string;

    const success = await dolibarrService.reconcileBankLine(accountId, lineId, reconciled, userApiKey);

    // `success` = resultado de domínio (ver nota em /reconcile/save).
    res.json({
        success,
        message: success ? 'Conciliação atualizada com sucesso' : 'Falha ao atualizar conciliação'
    });
}));

// Calculate dynamic balance
router.post('/balance/calculate', validateBody(BalanceCalculateSchema), asyncHandler(async (req: Request, res: Response) => {
    const { initialBalance, transactions } = req.body;

    const parsedTransactions = transactions.map((t: any) => ({
        ...t,
        date: new Date(t.date)
    }));

    const result = bankingService.calculateDynamicBalance(initialBalance, parsedTransactions);

    return apiResponse.ok(res, result);
}));

export default router;
