import { Router } from 'express';
import { aiService } from '../services/aiService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { createLogger } from '../utils/logger';
import { verifyDeeplink } from '../utils/deeplinkToken';

const log = createLogger('AI');
const router = Router();

// Protect AI Routes
router.use(requireDolibarrLogin);

import { z } from 'zod';

// Schema
const GenerateReplySchema = z.object({
    history: z.array(z.object({
        role: z.enum(['user', 'model', 'system']),
        parts: z.string()
    })).optional(),
    context: z.string().optional(),
    image: z.string().optional(), // Base64 image for multimodal chat
    module: z.string().default('chat')
});

const AnalyzeSystemSchema = z.object({
    query: z.string()
});

router.post('/generate-reply', async (req, res) => {
    try {
        const { history, context, image, module } = GenerateReplySchema.parse(req.body);
        const reply = await aiService.generateReply(history as any || [], context || '', image, module);
        res.json({ reply });
    } catch (error: any) {
        log.error('Generate Reply Error', { error: error.message, stack: error.stack });

        // Handle Validation Errors
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }

        // Handle Google API Errors
        const errorMessage = error?.message || '';
        const errorBody = error?.response?.data?.error?.message || ''; // Axios style
        const fullMessage = `${errorMessage} ${errorBody}`;

        if (fullMessage.includes('API key expired') || fullMessage.includes('API_KEY_INVALID')) {
            return res.status(401).json({ error: 'A chave da API do Google Gemini expirou. Por favor, atualize o arquivo .env com uma nova chave.' });
        }

        res.status(500).json({ error: error.message });
    }
});

// Resolve um deeplink de prefill (HITL #57 Peça 2): o frontend manda o token,
// o backend verifica HMAC + expiração e devolve só os dados para pré-preencher a tela.
router.get('/ticket-prefill', (req, res) => {
    const token = String(req.query.token || '');
    const payload = verifyDeeplink<Record<string, string>>(token, 'create_ticket');
    if (!payload) {
        return res.status(400).json({ error: 'Link inválido ou expirado. Peça ao agente para gerar um novo.' });
    }
    res.json({ data: payload.data, expiresAt: payload.exp });
});

router.post('/analyze-system', async (req, res) => {
    try {
        const { query } = AnalyzeSystemSchema.parse(req.body);
        const result = await aiService.analyzeSystem(query);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

const AnalyzeSentimentSchema = z.object({
    text: z.string()
});

router.post('/analyze-sentiment', async (req, res) => {
    try {
        const { text } = AnalyzeSentimentSchema.parse(req.body);
        const result = await aiService.analyzeSentiment(text);
        res.json(result);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

const ExtractCustomerSchema = z.object({
    text: z.string()
});

router.post('/extract/customer', async (req, res) => {
    try {
        const { text } = ExtractCustomerSchema.parse(req.body);
        const result = await aiService.extractCustomerInfo(text);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});



const ExtractReceiptSchema = z.object({
    image: z.string()
});

router.post('/extract/receipt', async (req, res) => {
    try {
        const { image } = ExtractReceiptSchema.parse(req.body);
        const result = await aiService.extractReceiptData(image);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});


const AnalyzeFinancialSchema = z.object({
    data: z.any()
});

router.post('/analyze/financial', async (req, res) => {
    try {
        const { data } = AnalyzeFinancialSchema.parse(req.body);
        const result = await aiService.analyzeFinancialHealth(data);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

const FixApiCallSchema = z.object({
    log: z.any()
});

router.post('/fix/api-call', async (req, res) => {
    try {
        const { log } = FixApiCallSchema.parse(req.body);
        const result = await aiService.fixApiCall(log);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

const GenerateCodeSchema = z.object({
    endpoint: z.string(),
    method: z.string(),
    description: z.string().optional()
});

router.post('/generate/code', async (req, res) => {
    try {
        const { endpoint, method, description } = GenerateCodeSchema.parse(req.body);
        const result = await aiService.generateCode(endpoint, method, description);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// --- NEW ROUTES ---

// Audio Transcription
const TranscribeAudioSchema = z.object({
    audio: z.string(),
    mimeType: z.string().optional()
});

router.post('/transcribe-audio', async (req, res) => {
    try {
        const { audio, mimeType } = TranscribeAudioSchema.parse(req.body);
        const transcription = await aiService.transcribeAudio(audio, mimeType || 'audio/ogg');
        res.json({ transcription });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Draft Collection Email
const DraftEmailSchema = z.object({
    customer: z.any(),
    amount: z.number()
});

router.post('/draft/collection-email', async (req, res) => {
    try {
        const { customer, amount } = DraftEmailSchema.parse(req.body);
        const result = await aiService.draftCollectionEmail(customer, amount);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Sales Forecast
const SalesForecastSchema = z.object({
    invoices: z.array(z.any()),
    context: z.any().optional()
});

router.post('/analyze/sales-forecast', async (req, res) => {
    try {
        const { invoices, context } = SalesForecastSchema.parse(req.body);
        // We pass context if the service supports it, or just invoices.
        // For now, service logic infers from dates, but we keep the route flexible.
        const result = await aiService.generateSalesForecast(invoices, context);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Customer Sentiment Analysis
const CustomerSentimentSchema = z.object({
    customer: z.any(),
    invoices: z.array(z.any())
});

router.post('/analyze/customer-sentiment', async (req, res) => {
    try {
        const { customer, invoices } = CustomerSentimentSchema.parse(req.body);
        const result = await aiService.analyzeCustomerSentiment(customer, invoices);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Audit Proposal
const AuditProposalSchema = z.object({
    proposal: z.any()
});

router.post('/audit/proposal', async (req, res) => {
    try {
        const { proposal } = AuditProposalSchema.parse(req.body);
        const result = await aiService.auditProposal(proposal);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Audit Project
const AuditProjectSchema = z.object({
    project: z.any(),
    tasks: z.array(z.any()).optional(),
    invoices: z.array(z.any()).optional()
});

router.post('/audit/project', async (req, res) => {
    try {
        const { project, tasks, invoices } = AuditProjectSchema.parse(req.body);
        const result = await aiService.auditProject(project, tasks, invoices);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Analyze System Logs
const AnalyzeLogsSchema = z.object({
    logs: z.array(z.any())
});

router.post('/analyze/logs', async (req, res) => {
    try {
        const { logs } = AnalyzeLogsSchema.parse(req.body);
        const result = await aiService.analyzeSystemLogs(logs);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Analyze Monthly Report
const AnalyzeReportSchema = z.object({
    data: z.any()
});

router.post('/analyze/monthly-report', async (req, res) => {
    try {
        const { data } = AnalyzeReportSchema.parse(req.body);
        const result = await aiService.analyzeMonthlyReport(data);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

export default router;
