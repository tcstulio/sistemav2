import { Router } from 'express';
import { aiService } from '../services/aiService';
import { chatSessionService } from '../services/chatSessionService';
import { setToolCallListener } from '../services/agentTools';
import { extractToolCall } from '../services/aiService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { agentActivityService } from '../services/agentActivityService';
import { createLogger } from '../utils/logger';
import { verifyDeeplink } from '../utils/deeplinkToken';

const log = createLogger('AI');
const router = Router();

// Debug routes (no auth required)
router.post('/debug/extract-tool', (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });
    const result = extractToolCall(text);
    res.json({ extracted: result, input: text });
});

router.post('/debug/execute-tool', async (req, res) => {
    const { tool, args } = req.body;
    if (!tool) return res.status(400).json({ error: 'Missing tool' });
    try {
        const { executeTool } = require('../services/agentTools');
        const result = await executeTool(tool, args || {});
        res.json({ tool, args, result: result.substring(0, 2000) });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

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
    module: z.string().default('chat'),
    sessionId: z.string().optional()
});

const AnalyzeSystemSchema = z.object({
    query: z.string()
});

router.post('/generate-reply', async (req, res) => {
    try {
        const { history, context, image, module, sessionId } = GenerateReplySchema.parse(req.body);

        const user = (req as any).user;
        let enrichedContext = context || '';
        if (user) {
            const userIdentity = [
                `\n[SISTEMA] Identidade do usuário:`,
                `- Login: ${user.login || 'desconhecido'}`,
                `- Nome: ${[user.firstname, user.lastname].filter(Boolean).join(' ') || user.login || 'desconhecido'}`,
                `- Email: ${user.email || 'não informado'}`,
                `- Cargo: ${user.job || 'não informado'}`,
                `- Admin: ${user.admin ? 'Sim' : 'Não'}`,
                `- ID Dolibarr: ${user.id || 'não informado'}`,
            ].join('\n');
            enrichedContext += userIdentity;

            if (user.id) {
                try {
                    const { userPermissionsService } = require('../services/userPermissionsService');
                    const permContext = await userPermissionsService.getProfileForContext(String(user.id));
                    enrichedContext += '\n\n' + permContext;
                } catch (e: any) {
                    log.warn('Failed to load user permissions context', e.message);
                }
            }
        }

        const toolCalls: Array<{ tool: string; args: Record<string, any>; result: string; duration: number }> = [];
        if (sessionId && module === 'chat') {
            setToolCallListener((tool, args, result, duration) => {
                toolCalls.push({ tool, args, result: result.slice(0, 2000), duration });
                try {
                    const userData = (req as any).user?.userData;
                    agentActivityService.record({
                        userId: userData?.id || 'unknown',
                        userName: userData?.name || userData?.login || 'unknown',
                        tool,
                        args,
                        result: result.slice(0, 500),
                        durationMs: duration,
                        isError: result.toLowerCase().includes('error') || result.toLowerCase().includes('erro'),
                    });
                } catch { /* ignore activity logging errors */ }
            });
        }

        const result = await aiService.generateReply(history as any || [], enrichedContext, image, module);

        setToolCallListener(null);

        if (sessionId && module === 'chat') {
            try {
                const lastUserMsg = (history || []).filter((h: any) => h.role === 'user').pop();
                if (lastUserMsg) {
                    chatSessionService.addMessage(sessionId, {
                        role: 'user',
                        content: lastUserMsg.parts,
                        metadata: { hasImage: !!image }
                    });
                }
                chatSessionService.addMessage(sessionId, {
                    role: 'model',
                    content: result.text,
                    metadata: { provider: 'auto', toolCalls: toolCalls.length > 0 ? toolCalls : undefined, usage: result.usage }
                });
            } catch (sessionErr: any) {
                log.warn('Failed to save chat session message', { error: sessionErr.message });
            }
        }

        res.json({ reply: result.text, sessionId, usage: result.usage });
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

// Resolve um deeplink de prefill (HITL #57 Peça 2/3): o frontend manda o token, o backend
// verifica HMAC + expiração e devolve { kind, data }. Genérico por 'kind' (create_ticket,
// create_customer, edit_customer, ...) — a HMAC já garante que o token foi emitido por nós.
router.get('/prefill', (req, res) => {
    const token = String(req.query.token || '');
    const payload = verifyDeeplink<Record<string, string>>(token);
    if (!payload) {
        return res.status(400).json({ error: 'Link inválido ou expirado. Peça ao agente para gerar um novo.' });
    }
    res.json({ kind: payload.kind, data: payload.data, expiresAt: payload.exp });
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

const AnalyzePdfSchema = z.object({
    pdf: z.string(),
    question: z.string().optional()
});

router.post('/analyze/pdf', async (req, res) => {
    try {
        const { pdf, question } = AnalyzePdfSchema.parse(req.body);
        const pdfBuffer = Buffer.from(pdf, 'base64');
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(pdfBuffer);
        const text = data.text.substring(0, 15000);

        const prompt = `Analise o conteúdo deste documento PDF e responda à pergunta do usuário.

Conteúdo do PDF:
${text}

${question ? `Pergunta: ${question}` : 'Faça um resumo dos pontos principais do documento.'}`;

        const result = await aiService.generateReply(
            [{ role: 'user' as const, parts: prompt }],
            'Você é um assistente especializado em análise de documentos.',
            undefined,
            'chat'
        );
        res.json({ result: result.text });
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

// --- Chat Session Routes ---

router.post('/sessions', (req, res) => {
    try {
        const userLogin = (req as any).user?.login || 'unknown';
        const { firstMessage } = req.body;
        const session = chatSessionService.createSession(userLogin, firstMessage);
        res.json({ success: true, data: session });
    } catch (error: any) {
        log.error('Create session error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.get('/sessions', (req, res) => {
    try {
        const { limit } = req.query;
        const sessions = chatSessionService.getSessions(undefined, limit ? parseInt(limit as string) : 50);
        res.json({ count: sessions.length, data: sessions });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/sessions/:id', (req, res) => {
    try {
        const session = chatSessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json({ data: session });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/sessions/:id', (req, res) => {
    try {
        const success = chatSessionService.deleteSession(req.params.id);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Session not found' });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/sessions-stats', (req, res) => {
    try {
        const stats = chatSessionService.getStats();
        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/agent/activity', requireDolibarrLogin, (req, res) => {
    try {
        const { userId, entityType, action, limit, since } = req.query;
        const activities = agentActivityService.getActivities({
            userId: userId as string,
            entityType: entityType as string,
            action: action as string,
            limit: limit ? parseInt(limit as string) : 50,
            since: since ? parseInt(since as string) : undefined,
        });
        const stats = agentActivityService.getStats();
        res.json({ activities, stats });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
