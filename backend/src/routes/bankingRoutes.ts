import { Router, Request, Response } from 'express';
import { bankingService, CSVFormat } from '../services/bankingService';
import multer from 'multer';
import { createLogger } from '../utils/logger';
import { createFileFilter, validateFileUpload, containsExecutableCode, sanitizeFilename } from '../utils/fileValidation';
import { requireDolibarrLogin } from '../middleware/authMiddleware';

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

// --- Import Endpoints ---

// Import OFX file
router.post('/import/ofx', upload.single('file'), async (req: Request, res: Response) => {
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
router.post('/import/csv', upload.single('file'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const content = req.file.buffer.toString('utf-8');

        // Get format from body or use auto-detection
        let format: CSVFormat;
        if (req.body.format) {
            try {
                format = JSON.parse(req.body.format);
            } catch {
                return res.status(400).json({ error: 'Formato CSV inválido: JSON mal formatado' });
            }
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
router.post('/import/auto', upload.single('file'), async (req: Request, res: Response) => {
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
router.post('/analyze/categorize', async (req: Request, res: Response) => {
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
router.post('/analyze/anomalies', async (req: Request, res: Response) => {
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
router.post('/insights/cash-flow', async (req: Request, res: Response) => {
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
router.post('/insights/chart-data', async (req: Request, res: Response) => {
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
router.post('/reconcile/suggest', async (req: Request, res: Response) => {
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

// Save reconciliation
router.post('/reconcile/save', async (req: Request, res: Response) => {
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

// Calculate dynamic balance
router.post('/balance/calculate', async (req: Request, res: Response) => {
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
