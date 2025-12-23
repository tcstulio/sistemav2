import { Router, Request, Response } from 'express';
import { bankingService, CSVFormat } from '../services/bankingService';
import multer from 'multer';

const router = Router();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.ofx', '.qfx', '.csv', '.txt'];
        const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de arquivo não suportado. Use OFX, QFX ou CSV.'));
        }
    }
});

// --- Import Endpoints ---

// Import OFX file
router.post('/import/ofx', upload.single('file'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const content = req.file.buffer.toString('utf-8');
        const result = bankingService.parseOFX(content);

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
        console.error('[BankingRoutes] OFX import error:', error);
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
        const format: CSVFormat = req.body.format ? JSON.parse(req.body.format) : {
            dateColumn: req.body.dateColumn || 'date',
            amountColumn: req.body.amountColumn || 'amount',
            descriptionColumn: req.body.descriptionColumn || 'description',
            delimiter: req.body.delimiter || ',',
            hasHeader: req.body.hasHeader !== 'false'
        };

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
        console.error('[BankingRoutes] CSV import error:', error);
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
        console.error('[BankingRoutes] Auto import error:', error);
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
        console.error('[BankingRoutes] Categorization error:', error);
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
        console.error('[BankingRoutes] Anomaly detection error:', error);
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
        console.error('[BankingRoutes] Cash flow insights error:', error);
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
        console.error('[BankingRoutes] Chart data error:', error);
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
        console.error('[BankingRoutes] Reconciliation suggestion error:', error);
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
        console.error('[BankingRoutes] Save reconciliation error:', error);
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
        console.error('[BankingRoutes] Balance calculation error:', error);
        res.status(500).json({ error: error.message || 'Falha ao calcular saldo' });
    }
});

export default router;
