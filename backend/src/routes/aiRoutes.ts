import { Router } from 'express';
import { aiService } from '../services/aiService';
import { dolibarrService } from '../services/dolibarr';
import { chatSessionService } from '../services/chatSessionService';
import { runWithToolContext, executeTool } from '../services/agentTools';
import { extractToolCall } from '../services/aiService';
import { requireDolibarrLogin, requireDolibarrAdmin } from '../middleware/authMiddleware';
import { agentActivityService } from '../services/agentActivityService';
import { agentBootstrapConfigStore } from '../services/agentBootstrapConfigStore';
import { aiJobService } from '../services/aiJobService';
import { financialAnalysisStore } from '../services/financialAnalysisStore';
import { voiceConfigStore } from '../services/voiceConfigStore';
import { minimaxService } from '../services/minimaxService';
import { createLogger } from '../utils/logger';
import { verifyDeeplink } from '../utils/deeplinkToken';

const log = createLogger('AI');
const router = Router();

// #1500: derive `isAdmin` boolean a partir do que o middleware de auth (protoSession.userData
// ou dolibarrService.getUserByKey) carregou em `req.user`. Dolibarr devolve `admin` como
// string `'0'|'1'`, mas algumas queries trazem number `0|1`; toleramos ambos. Se vier
// `undefined`/ausente, default seguro = false (não-admin) — a política DEV_TOOLS de #1498
// só libera as 13 ferramentas de dev/robô quando isAdmin === true.
function resolveIsAdmin(user: any): boolean {
    if (!user) return false;
    const a = user.admin;
    return a === '1' || a === 1 || a === true;
}

// #1500: wrapper que executa uma função dentro de um `runWithToolContext` com `isAdmin` (e o
// mínimo de userId/userLogin) propagado a partir de `req.user`. Garante que TODA chamada a
// `aiService.*` veja o flag correto — sem isso, aiService.generateReply cai no prompt
// não-admin (sem DEV_TOOLS) mesmo para admin autenticado, e executeTool recusa/bypassa
// errado no /debug/execute-tool.
function withUserToolContext<T>(user: any, fn: () => Promise<T>): Promise<T> {
    return runWithToolContext({
        userId: user?.id ? String(user.id) : '',
        userLogin: user?.login || 'unknown',
        isAdmin: resolveIsAdmin(user),
    }, fn);
}

// Debug routes — exigem login; execute-tool exige admin (executa ferramentas arbitrárias).
// Antes ficavam ANTES do requireDolibarrLogin global = expostas sem autenticação (furo de segurança).
router.post('/debug/extract-tool', requireDolibarrLogin, (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });
    const result = extractToolCall(text);
    res.json({ extracted: result, input: text });
});

router.post('/debug/execute-tool', requireDolibarrLogin, requireDolibarrAdmin, async (req, res) => {
    const { tool, args } = req.body;
    if (!tool) return res.status(400).json({ error: 'Missing tool' });
    const user = (req as any).user;
    try {
        // #1500: propaga isAdmin no contexto para que executeTool consulte `ctx.isAdmin`
        // (gate de DEV_TOOLS de #1498) — sem o wrapper, o gate vê undefined e recusa
        // mesmo para o admin do `requireDolibarrAdmin` lá em cima.
        const result = await withUserToolContext(user, () => executeTool(tool, args || {}));
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
    // issue #1151: DTO mínimo do chat = { sessionId, message }. O `history` vindo do
    // cliente passou a ser ignorado na montagem do contexto (o servidor é autoritativo);
    // mantemos o campo aceito (opcional) só como hint de compat p/ clientes antigos.
    message: z.string().optional(),
    history: z.array(z.object({
        role: z.enum(['user', 'model', 'system']),
        parts: z.string()
    })).optional(),
    context: z.string().optional(),
    image: z.string().optional(), // Base64 image for multimodal chat (1ª imagem; compat)
    images: z.array(z.string()).max(6).optional(), // #947: múltiplas imagens
    module: z.string().default('chat'),
    sessionId: z.string().optional()
});

const AnalyzeSystemSchema = z.object({
    query: z.string()
});

// issue #1151: persiste a msg do usuário na sessão ANTES de enfileirar o job (e antes
// de o agente rodar). Assim a ordem em chat_messages reflete a ordem de ENVIO, e o
// contexto do LLM — lido do servidor via getMessages — já inclui a msg corrente. O
// `history` enviado pelo cliente é ignorado na montagem do contexto (servidor autoritativo).
// Chamada por ambas as rotas (síncrona e assíncrona); tolerante a erros de parse.
function persistUserTurnIfChat(body: any): { sessionId?: string; userMessage?: string; hasImage: boolean } {
    let parsed: z.infer<typeof GenerateReplySchema>;
    try {
        parsed = GenerateReplySchema.parse(body);
    } catch {
        return { hasImage: false };
    }
    const { sessionId, module, message, image, images, history } = parsed;
    const allImages = (images && images.length) ? images : (image ? [image] : []);
    if (!sessionId || module !== 'chat') {
        return { hasImage: allImages.length > 0 };
    }
    // Novo DTO mínimo: `message`. Fallback (compat): última entrada user do history.
    let userMessage = message;
    if (!userMessage && Array.isArray(history) && history.length > 0) {
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'user') { userMessage = history[i].parts; break; }
        }
    }
    if (userMessage) {
        try {
            chatSessionService.addMessage(sessionId, {
                role: 'user',
                content: userMessage,
                metadata: { hasImage: allImages.length > 0 }
            });
        } catch (sessionErr: any) {
            log.warn('Failed to persist user message before enqueue', { error: sessionErr.message });
        }
    }
    return { sessionId, userMessage, hasImage: allImages.length > 0 };
}

// Núcleo do chat: enriquece o contexto, roda o agente (com tool-calls) e salva a sessão.
// Usado pela rota síncrona E pela assíncrona (job em background). Lança em erro; quem chama trata.
// `jobId` (#1011): quando chamado via job assíncrono, cada tool-call emitida pelo agente vira
// um sinal de progresso (aiJobService.reportProgress) — atualiza o heartbeat p/ o cliente
// detectar liveness via GET /api/ai-jobs/:id/status sem baixar o resultado parcial.
async function runChatReply(body: any, user: any, jobId?: string): Promise<{ reply: string; sessionId?: string; usage?: any; contextWindow?: any; model?: string; fellBack?: boolean }> {
        const { history, context, image, images, module, sessionId } = GenerateReplySchema.parse(body);
        // #947: normaliza p/ array (aceita `images` novo OU `image` antigo).
        const allImages = (images && images.length) ? images : (image ? [image] : []);

        // issue #1151: contexto do LLM vem do SERVIDOR (chatSessionService.getMessages),
        // nunca do `history` do cliente. A msg do usuário já foi persistida antes do
        // enqueue (persistUserTurnIfChat), então getMessages já a inclui. Para chamadas
        // sem sessionId (legado/debug) mantemos o history do cliente como era.
        const isChatSession = !!(sessionId && module === 'chat');
        const serverMessages = isChatSession ? chatSessionService.getMessages(sessionId!) : [];
        const llmHistory: Array<{ role: 'user' | 'model' | 'system'; parts: string }> = isChatSession
            ? serverMessages.map(m => ({ role: m.role, parts: m.content }))
            : (history as any || []);

        let enrichedContext = context || '';
        let permissionProfile: import('../services/userPermissionsService').UserPermissionProfile | null = null;
        const isAdmin = resolveIsAdmin(user);

        enrichedContext += `\n[SISTEMA] Data e hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

        // ID Dolibarr do usuário. Fallback (#300): quando o perfil não traz o id mas
        // temos login/email, resolve via Dolibarr — senão list_user_tasks etc. falham.
        let dolibarrUserId = user?.id ? String(user.id) : '';
        if (user && !dolibarrUserId && (user.login || user.email)) {
            try {
                const resolved = await dolibarrService.findUserByLoginOrEmail(user.login || user.email);
                if (resolved?.id) {
                    dolibarrUserId = String(resolved.id);
                    log.info(`ID Dolibarr resolvido por ${user.login ? 'login' : 'email'} p/ o agente: ${dolibarrUserId}`);
                }
            } catch (e: any) {
                log.warn('Falha ao resolver ID Dolibarr por login/email', e?.message);
            }
        }

        if (user) {
            const userIdentity = [
                `\n[SISTEMA] Identidade do usuário:`,
                `- Login: ${user.login || 'desconhecido'}`,
                `- Nome: ${[user.firstname, user.lastname].filter(Boolean).join(' ') || user.login || 'desconhecido'}`,
                `- Email: ${user.email || 'não informado'}`,
                `- Cargo: ${user.job || 'não informado'}`,
                `- Admin: ${isAdmin ? 'Sim' : 'Não'}`,
                `- ID Dolibarr: ${dolibarrUserId || 'não informado'}`,
            ].join('\n');
            enrichedContext += userIdentity;

            if (dolibarrUserId) {
                try {
                    const { userPermissionsService } = require('../services/userPermissionsService');
                    permissionProfile = await userPermissionsService.getProfile(dolibarrUserId);
                    const permContext = await userPermissionsService.getProfileForContext(dolibarrUserId);
                    enrichedContext += '\n\n' + permContext;
                } catch (e: any) {
                    log.warn('Failed to load user permissions context', e.message);
                }
            }
        }

        const toolCalls: Array<{ tool: string; args: Record<string, any>; result: string; duration: number }> = [];
        const toolListener = (tool: string, args: Record<string, any>, result: string, duration: number) => {
            toolCalls.push({ tool, args, result: result.slice(0, 2000), duration });
            // #1011: cada tool-call = sinal de progresso -> atualiza o heartbeat do job.
            if (jobId) {
                try { aiJobService.reportProgress(jobId); } catch { /* best-effort */ }
            }
            try {
                agentActivityService.record({
                    userId: user?.id || dolibarrUserId || '',
                    userName: [user?.firstname, user?.lastname].filter(Boolean).join(' ') || user?.login || 'Agente',
                    tool,
                    args,
                    result: result.slice(0, 500),
                    durationMs: duration,
                    isError: result.toLowerCase().includes('error') || result.toLowerCase().includes('erro'),
                    requestedVia: 'chat', // F0.1 (#1234): origem do pedido — o agente/chat é interativo
                });
            } catch { /* ignore activity logging errors */ }
        };

        let result;
        try {
            result = await runWithToolContext({
                listener: isChatSession ? toolListener : null,
                userId: dolibarrUserId,
                userLogin: user?.login || 'unknown',
                isAdmin,
                permissionProfile,
            }, async () => {
                return aiService.generateReply(llmHistory as any, enrichedContext, allImages.length ? allImages : undefined, module);
            });
        } catch (agentErr: any) {
            // issue #1151: erro no job → persiste uma msg de erro na sessão para não
            // deixar o turno mudo (o usuário já está gravado pelo persist pré-enqueue).
            if (isChatSession) {
                try {
                    chatSessionService.addMessage(sessionId!, {
                        role: 'model',
                        content: `[Erro ao processar] ${agentErr?.message || 'Falha desconhecida'}`,
                        metadata: { provider: 'auto', error: true }
                    });
                } catch (sessionErr: any) {
                    log.warn('Failed to persist error message in session', { error: sessionErr.message });
                }
            }
            throw agentErr;
        }

        // issue #1151: só persiste a RESPOSTA do assistente aqui. A msg do usuário já
        // foi gravada antes do enqueue (ordem de ENVIO). Mantém metadata das tools usadas.
        if (isChatSession) {
            try {
                chatSessionService.addMessage(sessionId!, {
                    role: 'model',
                    content: result.text,
                    metadata: { provider: 'auto', toolCalls: toolCalls.length > 0 ? toolCalls : undefined, usage: result.usage }
                });
            } catch (sessionErr: any) {
                log.warn('Failed to save chat session message', { error: sessionErr.message });
            }
        }

        return { reply: result.text, sessionId, usage: result.usage, contextWindow: result.contextWindow, model: result.model, fellBack: result.fellBack };
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
        // issue #1151: persiste a msg do usuário ANTES de rodar o agente.
        persistUserTurnIfChat(req.body);
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
        // issue #1151: persiste a msg do usuário ANTES do enqueue (ordem = ordem de ENVIO),
        // não após o job concluir. Assim msgs concorrentes não invertem ordem na tabela.
        persistUserTurnIfChat(body);
        // #1011: repassa o jobId ao runChatReply para que cada tool-call atualize o
        // heartbeat. O closure lê `jobId` no microtask (após o assign abaixo retornar).
        let jobId = '';
        jobId = aiJobService.enqueue(() => runChatReply(body, user, jobId), body?.module || 'chat');
        res.status(202).json({ jobId, status: 'queued' });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Polling do status/resultado de um job do assistente.
// #1012: TTL persistido — job expirado devolve 404 { reason: 'expired' }; job vivo inclui
// alive=true para o cliente distinguir do término normal.
router.get('/jobs/:id', (req, res) => {
    const lookup = aiJobService.get(req.params.id);
    if (!lookup.ok) {
        if (lookup.reason === 'expired') return res.status(404).json({ reason: 'expired' });
        return res.status(404).json({ error: 'Job não encontrado.' });
    }
    const job = lookup.job;
    if (job.status === 'done') return res.json({ status: 'done', alive: true, ...(job.result || {}) });
    if (job.status === 'error') return res.json({ status: 'error', alive: true, error: job.error });
    res.json({ status: job.status, alive: true, queueAhead: lookup.queueAhead });
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
        const user = (req as any).user;
        // #1500: propaga isAdmin (e userId/userLogin) para o tool-context — aiService
        // consulta `getToolContext().isAdmin` em helpers como confirmationBlock (#1408).
        const result = await withUserToolContext(user, () =>
            aiService.analyzeSystem(query, '../src', 'system_analysis')
        );
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () => aiService.analyzeSentiment(text, 'chat'));
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () => aiService.extractCustomerInfo(text, 'chat'));
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () => aiService.extractReceiptData(image, 'banking'));
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () => aiService.analyzeFinancialHealth(data, 'banking'));
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () => aiService.fixApiCall(log, 'system_analysis'));
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () =>
            aiService.generateCode(endpoint, method, description, 'system_analysis')
        );
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const transcription = await withUserToolContext(user, () =>
            aiService.transcribeAudio(audio, mimeType || 'audio/ogg', 'chat')
        );
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

        const user = (req as any).user;
        // #1500: aiService.generateReply consulta `getToolContext().isAdmin` para
        // escolher getToolsPrompt({ isAdmin }) — sem o wrapper, mesmo um admin autenticado
        // aqui recebe prompt NÃO-admin (sem DEV_TOOLS de #1498). Propagação obrigatória.
        const result = await withUserToolContext(user, () =>
            aiService.generateReply(
                [{ role: 'user' as const, parts: prompt }],
                'Você é um assistente especializado em análise de documentos.',
                undefined,
                'chat'
            )
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () =>
            aiService.draftCollectionEmail(customer, amount, 'banking')
        );
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () =>
            aiService.generateSalesForecast(invoices, context, 'banking')
        );
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// #908/#915: forecast ASSÍNCRONO (job + polling), mesmo padrão do chat. A geração do GLM é lenta
// e com variância alta (60-90s típico, cauda >120s); segurar a conexão síncrona estourava o
// timeout de cliente/túnel. Aqui enfileiramos e respondemos na hora com jobId; o cliente faz
// polling de GET /jobs/:id. O resultado vem em job.result (a string JSON do forecast).
// #1500: o job roda FORA do contexto de tool (aiJobService usa seu próprio AsyncLocalStorage),
// então embrulhamos a chamada em withUserToolContext ANTES de chamar aiService — assim o
// `getToolContext().isAdmin` dentro do aiService vê o valor correto do usuário.
router.post('/analyze/sales-forecast-async', (req, res) => {
    try {
        const { invoices, context } = SalesForecastSchema.parse(req.body);
        const user = (req as any).user;
        const jobId = aiJobService.enqueue(
            () => withUserToolContext(user, () =>
                aiService.generateSalesForecast(invoices, context, 'banking')
            ).then(result => ({ result })),
            'forecast'
        );
        res.status(202).json({ jobId, status: 'queued' });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Financial Analysis (issue #490) — persisted snapshot + automation config
const AutomationConfigSchema = z.object({
    enabled: z.boolean().optional(),
    schedule: z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59)
    }).optional(),
    lastRunAt: z.string().nullable().optional(),
    lastRunStatus: z.string().nullable().optional()
}).refine(data => data.enabled !== undefined || data.schedule !== undefined || data.lastRunAt !== undefined || data.lastRunStatus !== undefined, {
    message: 'At least one of enabled, schedule, lastRunAt or lastRunStatus must be provided'
});

router.get('/analyze/financial-analysis/latest', (req, res) => {
    try {
        const analysis = financialAnalysisStore.getAnalysis();
        res.status(200).json(analysis);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/analyze/financial-analysis/automation-config', (req, res) => {
    try {
        const config = financialAnalysisStore.getAutomationConfig();
        res.status(200).json(config);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/analyze/financial-analysis/automation-config', (req, res) => {
    let updates;
    try {
        updates = AutomationConfigSchema.parse(req.body);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        return res.status(500).json({ error: error.message });
    }

    try {
        const config = financialAnalysisStore.saveAutomationConfig(updates);
        return res.status(200).json(config);
    } catch (err: any) {
        log.error('Falha ao salvar configuração de automação', { error: err.message, stack: err.stack });
        return res.status(500).json({ error: 'Falha ao salvar configuração de automação', details: err.message });
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () =>
            aiService.analyzeCustomerSentiment(customer, invoices, 'banking')
        );
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () => aiService.auditProposal(proposal, 'proposals'));
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () =>
            aiService.auditProject(project, tasks, invoices, 'proposals')
        );
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () => aiService.analyzeSystemLogs(logs, 'system_analysis'));
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
        const user = (req as any).user;
        // #1500: isAdmin propagado via context — ver /analyze-system.
        const result = await withUserToolContext(user, () => aiService.analyzeMonthlyReport(data, 'system_analysis'));
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

// ===========================================
// Config da sessão automática do agente (#300 item 3) — o que o resumo
// proativo reúne ao abrir a conversa. Leitura por qualquer logado; escrita admin.
// ===========================================

router.get('/agent/bootstrap-config', requireDolibarrLogin, (_req, res) => {
    try {
        res.json(agentBootstrapConfigStore.getConfig());
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

const BootstrapConfigSchema = z.object({
    enabled: z.boolean().optional(),
    includeTasks: z.boolean().optional(),
    includeAgenda: z.boolean().optional(),
    includeFinancial: z.boolean().optional(),
    extraInstruction: z.string().max(2000).optional(),
});

router.put('/agent/bootstrap-config', requireDolibarrAdmin, (req, res) => {
    try {
        const patch = BootstrapConfigSchema.parse(req.body);
        res.json(agentBootstrapConfigStore.updateConfig(patch));
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Config inválida', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// VOZ do agente (TTS MiniMax) — #938
// ===========================================

// Config org-wide da voz (voiceId/speed), editável pelo admin na tela de Automações.
router.get('/voice/config', requireDolibarrLogin, (_req, res) => {
    res.json(voiceConfigStore.get());
});

const VoiceConfigSchema = z.object({
    voiceId: z.string().min(1).max(120).optional(),
    speed: z.number().min(0.5).max(2).optional(),
});

router.put('/voice/config', requireDolibarrAdmin, (req, res) => {
    try {
        const patch = VoiceConfigSchema.parse(req.body);
        res.json(voiceConfigStore.update(patch));
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Config inválida', details: error.issues });
        }
        res.status(500).json({ error: error.message });
    }
});

// Lista as vozes pt disponíveis (get_voice funciona mesmo sem saldo de TTS). Cache 1h.
let voicesCache: { at: number; list: { voiceId: string; name: string }[] } | null = null;
router.get('/voice/voices', requireDolibarrLogin, async (_req, res) => {
    try {
        if (!voicesCache || Date.now() - voicesCache.at > 3600_000) {
            const list = await minimaxService.listVoices(true);
            voicesCache = { at: Date.now(), list };
        }
        res.json({ voices: voicesCache.list });
    } catch (error: any) {
        res.status(502).json({ error: error.message });
    }
});

// TTS: texto -> URL de áudio (mp3 hospedado ~24h). Voz do body ou a configurada.
const TtsSchema = z.object({
    text: z.string().min(1).max(10000),
    voiceId: z.string().min(1).max(120).optional(),
});

router.post('/voice/tts', requireDolibarrLogin, async (req, res) => {
    try {
        const { text, voiceId } = TtsSchema.parse(req.body);
        const { url } = await minimaxService.generateSpeech(text, voiceId ? { voiceId } : undefined);
        res.json({ url });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Payload inválido', details: error.issues });
        }
        // saldo insuficiente (1008) e afins viram 402 p/ o front cair no fallback do navegador
        const msg = String(error?.message || '');
        const status = /insufficient balance|1008/i.test(msg) ? 402 : 502;
        res.status(status).json({ error: msg });
    }
});

export default router;
