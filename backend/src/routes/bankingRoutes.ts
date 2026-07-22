import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { bankingService, CSVFormat } from '../services/bankingService';
import multer from 'multer';
import { createLogger } from '../utils/logger';
import { createFileFilter, validateFileUpload, containsExecutableCode, sanitizeFilename } from '../utils/fileValidation';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { dolibarrService } from '../services/dolibarr';
import { createBankingLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validation';
import { AppError } from '../middleware/errorHandler';

const log = createLogger('Banking');
const router = Router();

// #1330: limiter POST dedicado, criado pela factory `createBankingLimiter`
// (10 req/15min, bucket por IP, skip interno de métodos não-POST). Aplicado via
// `router.use` ANTES do auth — abuso não-autenticado também é limitado — e cobre
// TODAS as rotas POST deste arquivo. Exportado para os testes resetarem o bucket
// entre casos (resetKey), como no schedulerLimiter (#1567).
export const bankingLimiter = createBankingLimiter();
router.use(bankingLimiter);

// Protect all banking routes
router.use(requireDolibarrLogin);

// Configure multer for file uploads with enhanced validation
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: createFileFilter('banking')
});

// =============================================
// #1330 — Validação de input (Zod + userApiKey)
// =============================================

// Campos de formulário multipart chegam sempre como string: `format` carrega um
// JSON serializado (parseado com try/catch no handler), `bankCode`/`accountId`
// são metadados opcionais do upload. `.passthrough()` preserva campos extras que
// os handlers leem direto de `req.body` (dateColumn, delimiter, ...).
const ImportBodySchema = z.object({
    format: z.string().optional(),
    bankCode: z.string().optional(),
    accountId: z.string().optional()
}).passthrough();

const CsvImportBodySchema = z.object({
    format: z.string().optional(),
    bankCode: z.string().optional(),
    accountId: z.string().optional(),
    dateColumn: z.string().optional(),
    amountColumn: z.string().optional(),
    descriptionColumn: z.string().optional(),
    delimiter: z.string().optional(),
    hasHeader: z.string().optional()
}).passthrough();

const TransactionsBodySchema = z.object({
    transactions: z.array(z.any())
}).passthrough();

const CashFlowBodySchema = z.object({
    accounts: z.array(z.any()),
    transactions: z.array(z.any()),
    period: z.string().optional()
}).passthrough();

const ChartDataBodySchema = z.object({
    transactions: z.array(z.any()),
    groupBy: z.string().optional()
}).passthrough();

const ReconcileSuggestBodySchema = z.object({
    bankLines: z.array(z.any()),
    invoices: z.array(z.any())
}).passthrough();

const ReconcileSaveBodySchema = z.object({
    lineId: z.union([z.string().min(1), z.number()]),
    invoiceId: z.union([z.string().min(1), z.number()])
}).passthrough();

const ReconcileToggleBodySchema = z.object({
    accountId: z.union([z.string().min(1), z.number()]),
    lineId: z.union([z.string().min(1), z.number()]),
    reconciled: z.boolean()
}).passthrough();

const BalanceCalculateBodySchema = z.object({
    initialBalance: z.number(),
    transactions: z.array(z.any())
}).passthrough();

// #1330: a chave de API do usuário (header `dolapikey`, variável `userApiKey`) é
// repassada ao Dolibarr nas rotas de escrita de conciliação. Aceita apenas os dois
// formatos provisionados no ERP: CNPJ (14 dígitos) ou UUID v-qualquer. Ausente ou
// fora do padrão → 401 via errorHandler (envelope padronizado).
const CNPJ_REGEX = /^\d{14}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUserApiKey(req: Request, _res: Response, next: NextFunction) {
    const userApiKey = req.headers['dolapikey'];
    if (typeof userApiKey !== 'string' || !(CNPJ_REGEX.test(userApiKey) || UUID_REGEX.test(userApiKey))) {
        return next(new AppError(401, 'UNAUTHORIZED', 'userApiKey ausente ou inválido (esperado CNPJ ou UUID)'));
    }
    return next();
}

// --- Import Endpoints ---

// Import OFX file
router.post('/import/ofx', upload.single('file'), validateBody(ImportBodySchema), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        // Additional security validation
        const validation = validateFileUpload(req.file, 'banking');
        if (!validation.valid) {
            log.warn(`File upload rejected: ${validation.error}`);
            return res.status(400).json({ error: validation.error });
        }

        // Check for executable code
        if (containsExecutableCode(req.file.buffer)) {
            log.warn('Blocked file with executable code');
            return res.status(400).json({ error: 'Invalid file content' });
        }

        const content = req.file.buffer.toString('utf-8');
        const result = bankingService.parseOFX(content);

        log.info(`OFX imported: ${result.transactions.length} transactions`);

        res.json({
            success: true,
            data: {
                accountNumber: result.accountNumber,
                bankId: result.bankId,
                balance: result.balance,
                transactionCount: result.transactions.length,
                transactions: result.transactions,
                metadata: result.metadata
            }
        });
    } catch (error: any) {
        log.error('OFX import error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao importar arquivo OFX' });
    }
});

// Import CSV file
router.post('/import/csv', upload.single('file'), validateBody(CsvImportBodySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
        // #1330: `format` é validado ANTES do arquivo — JSON mal formado nunca
        // derruba o request (crash 500); o erro é delegado ao errorHandler global.
        let format: CSVFormat;
        if (typeof req.body.format === 'string' && req.body.format.trim() !== '') {
            let parsed: unknown;
            try {
                parsed = JSON.parse(req.body.format);
            } catch {
                return next(new AppError(400, 'VALIDATION_ERROR', 'Formato inválido'));
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return next(new AppError(400, 'VALIDATION_ERROR', 'Formato inválido'));
            }
            format = parsed as CSVFormat;
        } else {
            // Auto-detecção via campos avulsos do formulário
            format = {
                dateColumn: req.body.dateColumn || 'date',
                amountColumn: req.body.amountColumn || 'amount',
                descriptionColumn: req.body.descriptionColumn || 'description',
                delimiter: req.body.delimiter || ',',
                hasHeader: req.body.hasHeader !== 'false'
            };
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const content = req.file.buffer.toString('utf-8');

        const result = bankingService.parseCSV(content, format);

        res.json({
            success: true,
            data: {
                transactionCount: result.transactions.length,
                transactions: result.transactions,
                metadata: result.metadata
            }
        });
    } catch (error: any) {
        log.error('CSV import error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao importar arquivo CSV' });
    }
});

// Auto-detect and import any supported file
router.post('/import/auto', upload.single('file'), validateBody(ImportBodySchema), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const content = req.file.buffer.toString('utf-8');
        const result = bankingService.parseStatement(content, req.file.originalname);

        res.json({
            success: true,
            data: {
                accountNumber: result.accountNumber,
                balance: result.balance,
                transactionCount: result.transactions.length,
                transactions: result.transactions,
                metadata: result.metadata
            }
        });
    } catch (error: any) {
        log.error('Auto import error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao importar arquivo' });
    }
});

// --- Analysis Endpoints ---

// Categorize transactions using LLM
router.post('/analyze/categorize', validateBody(TransactionsBodySchema), async (req: Request, res: Response) => {
    try {
        const { transactions } = req.body;

        if (!transactions || !Array.isArray(transactions)) {
            return res.status(400).json({ error: 'Transactions array is required' });
        }

        // Convert date strings to Date objects
        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date)
        }));

        const categorized = await bankingService.categorizeTransactions(parsedTransactions);

        res.json({
            success: true,
            data: categorized
        });
    } catch (error: any) {
        log.error('Categorization error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao categorizar transações' });
    }
});

// Detect spending anomalies
router.post('/analyze/anomalies', validateBody(TransactionsBodySchema), async (req: Request, res: Response) => {
    try {
        const { transactions } = req.body;

        if (!transactions || !Array.isArray(transactions)) {
            return res.status(400).json({ error: 'Transactions array is required' });
        }

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date)
        }));

        const anomalies = await bankingService.detectAnomalies(parsedTransactions);

        res.json({
            success: true,
            count: anomalies.length,
            data: anomalies
        });
    } catch (error: any) {
        log.error('Anomaly detection error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao detectar anomalias' });
    }
});

// --- Insights Endpoints ---

// Get cash flow insights
router.post('/insights/cash-flow', validateBody(CashFlowBodySchema), async (req: Request, res: Response) => {
    try {
        const { accounts, transactions, period } = req.body;

        if (!accounts || !transactions) {
            return res.status(400).json({ error: 'Accounts and transactions are required' });
        }

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date)
        }));

        const insights = await bankingService.generateCashFlowInsights(
            accounts,
            parsedTransactions,
            period || 'month'
        );

        res.json({
            success: true,
            data: insights
        });
    } catch (error: any) {
        log.error('Cash flow insights error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao gerar insights' });
    }
});

// Get chart data for cash flow visualization
router.post('/insights/chart-data', validateBody(ChartDataBodySchema), async (req: Request, res: Response) => {
    try {
        const { transactions, groupBy } = req.body;

        if (!transactions || !Array.isArray(transactions)) {
            return res.status(400).json({ error: 'Transactions array is required' });
        }

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date)
        }));

        const chartData = bankingService.getCashFlowChartData(parsedTransactions, groupBy || 'month');

        res.json({
            success: true,
            data: chartData
        });
    } catch (error: any) {
        log.error('Chart data error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao gerar dados do gráfico' });
    }
});

// --- Reconciliation Endpoints ---

// Get reconciliation suggestions
router.post('/reconcile/suggest', validateBody(ReconcileSuggestBodySchema), async (req: Request, res: Response) => {
    try {
        const { bankLines, invoices } = req.body;

        if (!bankLines || !invoices) {
            return res.status(400).json({ error: 'Bank lines and invoices are required' });
        }

        const suggestions = await bankingService.suggestReconciliation(bankLines, invoices);

        res.json({
            success: true,
            count: suggestions.length,
            data: suggestions
        });
    } catch (error: any) {
        log.error('Reconciliation suggestion error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao sugerir conciliação' });
    }
});

// Save reconciliation (legacy: requires invoiceId)
router.post('/reconcile/save', validateUserApiKey, validateBody(ReconcileSaveBodySchema), async (req: Request, res: Response) => {
    try {
        const { lineId, invoiceId } = req.body;
        const userApiKey = req.headers['dolapikey'] as string;

        if (!lineId || !invoiceId) {
            return res.status(400).json({ error: 'Line ID and Invoice ID are required' });
        }

        const success = await bankingService.saveReconciliation(lineId, invoiceId, userApiKey);

        res.json({
            success,
            message: success ? 'Conciliação salva com sucesso' : 'Falha ao salvar conciliação'
        });
    } catch (error: any) {
        log.error('Save reconciliation error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao salvar conciliação' });
    }
});

// Toggle reconciliation state of a bank line — persists directly to Dolibarr
router.post('/reconcile/toggle', validateUserApiKey, validateBody(ReconcileToggleBodySchema), async (req: Request, res: Response) => {
    try {
        const { accountId, lineId, reconciled } = req.body;
        const userApiKey = req.headers['dolapikey'] as string;

        if (!accountId || !lineId || typeof reconciled !== 'boolean') {
            return res.status(400).json({ error: 'accountId, lineId and reconciled (boolean) are required' });
        }

        const success = await dolibarrService.reconcileBankLine(accountId, lineId, reconciled, userApiKey);

        res.json({
            success,
            message: success ? 'Conciliação atualizada com sucesso' : 'Falha ao atualizar conciliação'
        });
    } catch (error: any) {
        log.error('Toggle reconciliation error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao atualizar conciliação' });
    }
});

// Calculate dynamic balance
router.post('/balance/calculate', validateBody(BalanceCalculateBodySchema), async (req: Request, res: Response) => {
    try {
        const { initialBalance, transactions } = req.body;

        if (initialBalance === undefined || !transactions) {
            return res.status(400).json({ error: 'Initial balance and transactions are required' });
        }

        const parsedTransactions = transactions.map((t: any) => ({
            ...t,
            date: new Date(t.date)
        }));

        const result = bankingService.calculateDynamicBalance(initialBalance, parsedTransactions);

        res.json({
            success: true,
            data: result
        });
    } catch (error: any) {
        log.error('Balance calculation error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Falha ao calcular saldo' });
    }
});

export default router;
