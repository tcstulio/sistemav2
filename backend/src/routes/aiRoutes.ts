import { Router } from 'express';
import { aiService } from '../services/aiService';
import { chatSessionService } from '../services/chatSessionService';
import { runWithToolContext } from '../services/agentTools';
import { extractToolCall } from '../services/aiService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { agentActivityService } from '../services/agentActivityService';
import { aiJobService } from '../services/aiJobService';
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

// Núcleo do chat: enriquece o contexto, roda o agente (com tool-calls) e salva a sessão.
// Usado pela rota síncrona E pela assíncrona (job em background). Lança em erro; quem chama trata.
async function runChatReply(body: any, user: any): Promise<{ reply: string; sessionId?: string; usage?: any; contextWindow?: any }> {
        const { history, context, image, module, sessionId } = GenerateReplySchema.parse(body);

        let enrichedContext = context || '';
        let permissionProfile: import('../services/userPermissionsService').UserPermissionProfile | null = null;
        const isAdmin = user?.admin === '1' || user?.admin === 1 || user?.admin === true;

        if (user) {
            const userIdentity = [
                `\n[SISTEMA] Identidade do usuário:`,
                `- Login: ${user.login || 'desconhecido'}`,
                `- Nome: ${[user.firstname, user.lastname].filter(Boolean).join(' ') || user.login || 'desconhecido'}`,
                `- Email: ${user.email || 'não informado'}`,
                `- Cargo: ${user.job || 'não informado'}`,
                `- Admin: ${isAdmin ? 'Sim' : 'Não'}`,
                `- ID Dolibarr: ${user.id || 'não informado'}`,
            ].join('\n');
            enrichedContext += userIdentity;

            if (user.id) {
                try {
                    const { userPermissionsService } = require('../services/userPermissionsService');
                    permissionProfile = await userPermissionsService.getProfile(String(user.id));
                    const permContext = await userPermissionsService.getProfileForContext(String(user.id));
                    enrichedContext += '\n\n' + permContext;
                } catch (e: any) {
                    log.warn('Failed to load user permissions context', e.message);
                }
            }
        }

        const toolCalls: Array<{ tool: string; args: Record<string, any>; result: string; duration: number }> = [];
        const toolListener = (tool: string, args: Record<string, any>, result: string, duration: number) => {
            toolCalls.push({ tool, args, result: result.slice(0, 2000), duration });
            try {
                const userData = user?.userData;
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
        };

        const result = await runWithToolContext({
            listener: sessionId && module === 'chat' ? toolListener : null,
            userId: String(user?.id || ''),
            userLogin: user?.login || 'unknown',
            isAdmin,
            permissionProfile,
        }, async () => {
            return aiService.generateReply(history as any || [], enrichedContext, image, module);
        });

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

        return { reply: result.text, sessionId, usage: result.usage, contextWindow: result.contextWindow };
}

// Mapeia erros do agente para a resposta HTTP (compartilhado pelas rotas).
function mapAiError(error: any, res: any) {
    log.error('Generate Reply Error', { error: error.message, stack: error.stack });
    if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
    }
    const fullMessage = `${error?.message || ''} ${error?.response?.data?.error?.message || ''}`;
    if (fullMessage.includes('API key expired') || fullMessage.includes('API_KEY_INVALID')) {
        return res.status(401).json({ error: 'A chave da API do Google Gemini expirou. Por favor, atualize o arquivo .env com uma nova chave.' });
    }
    res.status(500).json({ error: error.message });
}

// Síncrono (compat): segura a conexão até o agente terminar. Sujeito ao timeout de borda (524)
// em jobs longos via túnel — por isso o chat usa a versão assíncrona abaixo.
router.post('/generate-reply', async (req, res) => {
    try {
        const out = await runChatReply(req.body, (req as any).user);
        res.json(out);
    } catch (error: any) {
        mapAiError(error, res);
    }
});

// ASSÍNCRONO: enfileira o job e responde NA HORA com jobId (mata o 524). O agente roda em
// background até concluir, sem limite de tempo; o cliente faz polling de GET /jobs/:id.
router.post('/generate-reply-async', (req, res) => {
    try {
        GenerateReplySchema.parse(req.body); // valida cedo → 400 imediato
        const user = (req as any).user;
        const body = req.body;
        const jobId = aiJobService.enqueue(() => runChatReply(body, user), body?.module || 'chat');
        res.status(202).json({ jobId, status: 'queued' });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Polling do status/resultado de um job do assistente.
router.get('/jobs/:id', (req, res) => {
    const job = aiJobService.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job não encontrado ou expirado.' });
    if (job.status === 'done') return res.json({ status: 'done', ...(job.result || {}) });
    if (job.status === 'error') return res.json({ status: 'error', error: job.error });
    res.json({ status: job.status, queueAhead: job.queueAhead });
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
        const userId = String((req as any).user?.id || (req as any).user?.login || 'unknown');
        const { firstMessage } = req.body;
        const session = chatSessionService.createSession(userId, firstMessage);
        res.json({ success: true, data: session });
    } catch (error: any) {
        log.error('Create session error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.get('/sessions', (req, res) => {
    try {
        const { limit } = req.query;
        const isAdmin = (req as any).user?.admin === '1' || (req as any).user?.admin === 1;
        const userId = String((req as any).user?.id || (req as any).user?.login || 'unknown');
        const sessions = chatSessionService.getSessions(isAdmin ? undefined : userId, limit ? parseInt(limit as string) : 50);
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
        const isAdmin = (req as any).user?.admin === '1' || (req as any).user?.admin === 1;
        const userId = String((req as any).user?.id || (req as any).user?.login || 'unknown');
        if (!isAdmin && session.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        res.json({ data: session });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/sessions', (req, res) => {
    try {
        const isAdmin = (req as any).user?.admin === '1' || (req as any).user?.admin === 1;
        const userId = String((req as any).user?.id || (req as any).user?.login || 'unknown');
        const count = isAdmin
            ? chatSessionService.deleteAllSessions()
            : chatSessionService.deleteSessionsByUser(userId);
        res.json({ success: true, deletedCount: count });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/sessions/:id', (req, res) => {
    try {
        const session = chatSessionService.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        const isAdmin = (req as any).user?.admin === '1' || (req as any).user?.admin === 1;
        const userId = String((req as any).user?.id || (req as any).user?.login || 'unknown');
        if (!isAdmin && session.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const success = chatSessionService.deleteSession(req.params.id);
        res.json({ success });
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
