import { Router } from 'express';
import { z } from 'zod';
import { aiService } from '../services/aiService';
import type { ChatMessage } from '../services/aiService';
import { dolibarrService } from '../services/dolibarr';
import { chatSessionService } from '../services/chatSessionService';
import { runWithToolContext } from '../services/agentTools';
import { extractToolCall } from '../services/aiService';
import { requireDolibarrLogin, requireDolibarrAdmin } from '../middleware/authMiddleware';
import { agentActivityService } from '../services/agentActivityService';
import { agentBootstrapConfigStore } from '../services/agentBootstrapConfigStore';
import { aiJobService } from '../services/aiJobService';
import { jobState } from '../agent/jobState';
import { financialAnalysisStore } from '../services/financialAnalysisStore';
import { voiceConfigStore } from '../services/voiceConfigStore';
import { minimaxService } from '../services/minimaxService';
import { createLogger } from '../utils/logger';
import { verifyDeeplink } from '../utils/deeplinkToken';
import { asyncHandler } from '../utils/asyncHandler';
// AppError (#1566): a issue sugere `new AppError('Mensagem', 400, 'CODE')` (msg primeiro),
// mas a classe real do projeto (middleware/errorHandler.ts) usa `new AppError(statusCode,
// code, message)` — status e code primeiro. Mantemos a assinatura REAL da classe para
// consistência com o resto do codebase; o errorHandler global renderiza o envelope
// { success:false, error:{ code, message, details? } } independentemente da ordem.
import { AppError } from '../middleware/errorHandler';
import { ok } from '../utils/apiResponse';

const log = createLogger('AI');
const router = Router();

// aiLimiter (#320): aplicado GLOBALMENTE no mount de `/api/ai` em server.ts
// (`app.use('/api/ai', aiLimiter, aiRoutes)`), com `skip: GET`. Isso cobre TODOS os
// POST/PUT/DELETE de `/ai/*` com um único contador (max=20/min). NÃO repetimos o
// limiter por-rota aqui: aplicá-lo de novo dobraria o consumo (limite efetivo cairia
// pela metade, quebrando o critério "21ª chamada → 429").

// Histórico do LLM (papel + texto). Tipagem compartilhada entre o schema, a montagem
// do contexto e a chamada de `aiService.generateReply` (que recebe `ChatMessage[]`).
type HistoryItem = ChatMessage;

// Debug routes — exigem login; execute-tool exige admin (executa ferramentas arbitrárias).
// Antes ficavam ANTES do requireDolibarrLogin global = expostas sem autenticação (furo de segurança).
router.post('/debug/extract-tool', requireDolibarrLogin, asyncHandler(async (req, res, next) => {
    const { text } = req.body;
    if (!text) return next(new AppError(400, 'BAD_REQUEST', 'Missing text'));
    const result = extractToolCall(text);
    return ok(res, { extracted: result, input: text });
}));

router.post('/debug/execute-tool', requireDolibarrLogin, requireDolibarrAdmin, asyncHandler(async (req, res) => {
    const { tool, args } = req.body;
    if (!tool) throw new AppError(400, 'BAD_REQUEST', 'Missing tool');
    // Rota admin-only (requireDolibarrAdmin): roda sob contexto de admin explícito, senão o gate
    // #1498 (DEV_TOOLS restritas a admin) negaria tools legítimas de diagnóstico do próprio admin.
    const { executeTool, runWithToolContext } = require('../services/agentTools');
    const result = await runWithToolContext({ isAdmin: true }, () => executeTool(tool, args || {}));
    return ok(res, { tool, args, result: result.substring(0, 2000) });
}));

// Protect AI Routes
router.use(requireDolibarrLogin);

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
        const llmHistory: HistoryItem[] = isChatSession
            ? serverMessages.map(m => ({ role: m.role, parts: m.content }))
            : (history || []);

        let enrichedContext = context || '';
        let permissionProfile: import('../services/userPermissionsService').UserPermissionProfile | null = null;
        let profileLoadFailed = false; // #1514: perfil DEVERIA existir mas não carregou (fail-closed p/ escrita)
        const isAdmin = user?.admin === '1' || user?.admin === 1 || user?.admin === true;

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
                    // #1514: perfil DEVERIA existir (usuário logado) mas falhou a carregar → sinaliza p/
                    // o executeTool negar escrita real fail-closed (senão, sem perfil e readOnly falsy,
                    // um logado escreveria sem checagem de permissão).
                    profileLoadFailed = true;
                }
            } else {
                // Usuário logado mas SEM id Dolibarr resolvível → o perfil não pode ser carregado.
                // Mesmo tratamento fail-closed (não-admin não escreve até o perfil existir). #1514.
                if (!isAdmin) profileLoadFailed = true;
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
                profileLoadFailed,
            }, async () => {
                // #1499: passa o `isAdmin` do req.user explicitamente para aiService
                // (além de já propagar via runWithToolContext acima). Garante que o
                // filtro de DEV_TOOLS (#1498) usa o papel real do chamador, mesmo se
                // futuramente algum caller esquecer o runWithToolContext.
                return aiService.generateReply(llmHistory, enrichedContext, allImages.length ? allImages : undefined, module, isAdmin);
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

// Converte erros do agente/serviço em AppError para o errorHandler global renderizar no
// envelope. Substitui o antigo `mapAiError` (que escrevia direto em res). ZodError NÃO é
// mapeado aqui: quem chama decide se repassa o ZodError cru (→ errorHandler 400) ou converte.
function toAppError(error: unknown): AppError {
    const err = error as Error & { response?: { data?: { error?: { message?: string } } } };
    const baseMsg = err?.message || 'Falha desconhecida';
    const upstream = err?.response?.data?.error?.message || '';
    log.error('Generate Reply Error', { error: baseMsg, stack: err?.stack });
    const fullMessage = `${baseMsg} ${upstream}`.trim();
    if (/API key expired|API_KEY_INVALID/i.test(fullMessage)) {
        return new AppError(401, 'AI_KEY_EXPIRED', 'A chave da API do Google Gemini expirou. Por favor, atualize o arquivo .env com uma nova chave.');
    }
    return new AppError(500, 'AI_INTERNAL', fullMessage);
}

// Síncrono (compat): segura a conexão até o agente terminar. Sujeito ao timeout de borda (524)
// em jobs longos via túnel — por isso o chat usa a versão assíncrona abaixo.
router.post('/generate-reply', asyncHandler(async (req, res) => {
    // issue #1151: persiste a msg do usuário ANTES de rodar o agente.
    persistUserTurnIfChat(req.body);
    // runChatReply pode lançar ZodError (→ repassa cru p/ errorHandler 400) ou erro de
    // agente (→ toAppError mapeia 401 p/ chave expirada, 500 caso contrário).
    const out = await runChatReply(req.body, (req as any).user)
        .catch(err => { throw (err instanceof z.ZodError ? err : toAppError(err)); });
    return ok(res, out);
}));

// ASSÍNCRONO: enfileira o job e responde NA HORA com jobId (mata o 524). O agente roda em
// background até concluir, sem limite de tempo; o cliente faz polling de GET /jobs/:id.
router.post('/generate-reply-async', asyncHandler(async (req, res) => {
    // valida cedo → ZodError vira 400 pelo errorHandler; o resultado tipado alimenta o job.
    const body = GenerateReplySchema.parse(req.body);
    const user = (req as any).user;
    // issue #1151: persiste a msg do usuário ANTES do enqueue (ordem = ordem de ENVIO),
    // não após o job concluir. Assim msgs concorrentes não invertem ordem na tabela.
    persistUserTurnIfChat(req.body);
    // #1011: repassa o jobId ao runChatReply para que cada tool-call atualize o
    // heartbeat. O closure lê `jobId` no microtask (após o assign abaixo retornar).
    let jobId = '';
    jobId = aiJobService.enqueue(() => runChatReply(body, user, jobId), body.module);
    // #1578: inicializa o jobState com o contexto do usuário, para que o
    // agentCompletionNotifier saiba para quem enviar o notify_person no fim
    // do job (quando a aba estiver oculta). tabHidden começa false — o cliente
    // reporta o estado real via POST /api/chat/jobs/:id/visibility.
    jobState.init(jobId, {
        userId: String(user?.id || ''),
        userLogin: user?.login,
        userName: [user?.firstname, user?.lastname].filter(Boolean).join(' ') || user?.login,
        label: body.module,
    });
    // 202 Accepted: job enfileirado (não há helper p/ 202 em apiResponse; envelope manual).
    return res.status(202).json({ success: true, data: { jobId, status: 'queued' } });
}));

// Polling do status/resultado de um job do assistente.
// #1012: TTL persistido — job expirado devolve 404 { reason: 'expired' }; job vivo inclui
// alive=true para o cliente distinguir do término normal.
router.get('/jobs/:id', asyncHandler(async (req, res, next) => {
    const lookup = aiJobService.get(req.params.id);
    if (!lookup.ok) {
        if (lookup.reason === 'expired') return next(new AppError(404, 'JOB_EXPIRED', 'Job expirado.'));
        return next(new AppError(404, 'JOB_NOT_FOUND', 'Job não encontrado.'));
    }
    const job = lookup.job;
    if (job.status === 'done') return ok(res, { status: 'done', alive: true, ...(job.result || {}) });
    if (job.status === 'error') return ok(res, { status: 'error', alive: true, error: job.error });
    return ok(res, { status: job.status, alive: true, queueAhead: lookup.queueAhead });
}));

// Resolve um deeplink de prefill (HITL #57 Peça 2/3): o frontend manda o token, o backend
// verifica HMAC + expiração e devolve { kind, data }. Genérico por 'kind' (create_ticket,
// create_customer, edit_customer, ...) — a HMAC já garante que o token foi emitido por nós.
router.get('/prefill', asyncHandler(async (req, res, next) => {
    const token = String(req.query.token || '');
    const payload = verifyDeeplink<Record<string, string>>(token);
    if (!payload) {
        return next(new AppError(400, 'INVALID_DEEPLINK', 'Link inválido ou expirado. Peça ao agente para gerar um novo.'));
    }
    return ok(res, { kind: payload.kind, data: payload.data, expiresAt: payload.exp });
}));

router.post('/analyze-system', asyncHandler(async (req, res) => {
    const { query } = AnalyzeSystemSchema.parse(req.body);
    const result = await aiService.analyzeSystem(query, '../src', 'system_analysis');
    return ok(res, { result });
}));

const AnalyzeSentimentSchema = z.object({
    text: z.string()
});

router.post('/analyze-sentiment', asyncHandler(async (req, res) => {
    const { text } = AnalyzeSentimentSchema.parse(req.body);
    const result = await aiService.analyzeSentiment(text, 'chat');
    return ok(res, result);
}));

const ExtractCustomerSchema = z.object({
    text: z.string()
});

router.post('/extract/customer', asyncHandler(async (req, res) => {
    const { text } = ExtractCustomerSchema.parse(req.body);
    const result = await aiService.extractCustomerInfo(text, 'chat');
    return ok(res, { result });
}));

const ExtractReceiptSchema = z.object({
    image: z.string()
});

router.post('/extract/receipt', asyncHandler(async (req, res) => {
    const { image } = ExtractReceiptSchema.parse(req.body);
    const result = await aiService.extractReceiptData(image, 'banking');
    return ok(res, { result });
}));

// issue #1566: refino de `z.any()` — `data` é um payload opaco passado ao LLM (contrato
// variável por origem). `z.unknown()` preserva a semântica do `z.any()` (aceita ausente
// e qualquer valor) sem recorrer a `any`. TODO: tipar conforme contrato do caller quando estabilizar.
const AnalyzeFinancialSchema = z.object({
    data: z.unknown()
});

router.post('/analyze/financial', asyncHandler(async (req, res) => {
    const { data } = AnalyzeFinancialSchema.parse(req.body);
    const result = await aiService.analyzeFinancialHealth(data, 'banking');
    return ok(res, { result });
}));

// issue #1566: refino de `z.any()` — `log` é um log/opaco de API passado ao LLM. Mesma
// justificativa de `data` acima. TODO: tipar conforme contrato do caller quando estabilizar.
const FixApiCallSchema = z.object({
    log: z.unknown()
});

router.post('/fix/api-call', asyncHandler(async (req, res) => {
    const { log } = FixApiCallSchema.parse(req.body);
    const result = await aiService.fixApiCall(log, 'system_analysis');
    return ok(res, { result });
}));

const GenerateCodeSchema = z.object({
    endpoint: z.string(),
    method: z.string(),
    description: z.string().optional()
});

router.post('/generate/code', asyncHandler(async (req, res) => {
    const { endpoint, method, description } = GenerateCodeSchema.parse(req.body);
    const result = await aiService.generateCode(endpoint, method, description, 'system_analysis');
    return ok(res, { result });
}));

// --- NEW ROUTES ---

// Audio Transcription
const TranscribeAudioSchema = z.object({
    audio: z.string(),
    mimeType: z.string().optional()
});

router.post('/transcribe-audio', asyncHandler(async (req, res) => {
    const { audio, mimeType } = TranscribeAudioSchema.parse(req.body);
    const transcription = await aiService.transcribeAudio(audio, mimeType || 'audio/ogg', 'chat');
    return ok(res, { transcription });
}));

const AnalyzePdfSchema = z.object({
    pdf: z.string(),
    question: z.string().optional()
});

router.post('/analyze/pdf', asyncHandler(async (req, res) => {
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
    return ok(res, { result: result.text });
}));

// Draft Collection Email
// issue #1566: refino de `z.any()` — `customer` é um objeto opaco vindo do Dolibarr
// (contrato variável por entidade). `z.unknown()` preserva a semântica (aceita qualquer
// valor, inclusive ausente) sem recorrer a `any`. TODO: tipar conforme contrato Dolibarr
// quando estabilizar (ex.: z.object({ id: z.number(), name: z.string() }).passthrough()).
const DraftEmailSchema = z.object({
    customer: z.unknown(),
    amount: z.number()
});

router.post('/draft/collection-email', asyncHandler(async (req, res) => {
    const { customer, amount } = DraftEmailSchema.parse(req.body);
    const result = await aiService.draftCollectionEmail(customer, amount, 'banking');
    return ok(res, { result });
}));

// Sales Forecast
// issue #1566: refino de `z.any()` — `invoices` é um array de objetos opacos (faturas
// Dolibarr); `context` é um hint opaco. `z.array(z.unknown())` e `z.unknown()` preservam
// a semântica do `z.any()` sem usar `any`. TODO: tipar `invoices` conforme contrato
// Dolibarr (FacInvoice) quando estabilizar.
const SalesForecastSchema = z.object({
    invoices: z.array(z.unknown()),
    context: z.unknown().optional()
});

router.post('/analyze/sales-forecast', asyncHandler(async (req, res) => {
    const { invoices, context } = SalesForecastSchema.parse(req.body);
    // We pass context if the service supports it, or just invoices.
    // For now, service logic infers from dates, but we keep the route flexible.
    const result = await aiService.generateSalesForecast(invoices, context, 'banking');
    return ok(res, { result });
}));

// #908/#915: forecast ASSÍNCRONO (job + polling), mesmo padrão do chat. A geração do GLM é lenta
// e com variância alta (60-90s típico, cauda >120s); segurar a conexão síncrona estourava o
// timeout de cliente/túnel. Aqui enfileiramos e respondemos na hora com jobId; o cliente faz
// polling de GET /jobs/:id. O resultado vem em job.result (a string JSON do forecast).
router.post('/analyze/sales-forecast-async', asyncHandler(async (req, res) => {
    const { invoices, context } = SalesForecastSchema.parse(req.body);
    const jobId = aiJobService.enqueue(
        async () => ({ result: await aiService.generateSalesForecast(invoices, context, 'banking') }),
        'forecast'
    );
    // 202 Accepted (envelope manual — não há helper p/ 202 em apiResponse).
    return res.status(202).json({ success: true, data: { jobId, status: 'queued' } });
}));

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

// Helper (NÃO é handler): salva config de automação e mapeia erros de store em AppError.
// Mantém os handlers livres de try/catch (critério #1566). Erros de disco/upstream viram
// 500 sanitizado pelo errorHandler; o detail fica apenas no log (não vaza p/ o cliente).
function saveAutomationConfigOrThrow(updates: z.infer<typeof AutomationConfigSchema>) {
    try {
        return financialAnalysisStore.saveAutomationConfig(updates);
    } catch (err: any) {
        log.error('Falha ao salvar configuração de automação', { error: err.message, stack: err.stack });
        throw new AppError(500, 'FINANCIAL_AUTOMATION_SAVE', 'Falha ao salvar configuração de automação');
    }
}

router.get('/analyze/financial-analysis/latest', asyncHandler(async (req, res) => {
    void req;
    const analysis = financialAnalysisStore.getAnalysis();
    return ok(res, analysis);
}));

router.get('/analyze/financial-analysis/automation-config', asyncHandler(async (req, res) => {
    void req;
    const config = financialAnalysisStore.getAutomationConfig();
    return ok(res, config);
}));

router.put('/analyze/financial-analysis/automation-config', asyncHandler(async (req, res) => {
    const updates = AutomationConfigSchema.parse(req.body); // ZodError → errorHandler (400)
    return ok(res, saveAutomationConfigOrThrow(updates));
}));

// Customer Sentiment Analysis
// issue #1566: refino de `z.any()` — `customer` é opaco (Dolibarr); `invoices` é array
// opaco. Mesma justificativa dos schemas acima. TODO: tipar conforme contrato Dolibarr.
const CustomerSentimentSchema = z.object({
    customer: z.unknown(),
    invoices: z.array(z.unknown())
});

router.post('/analyze/customer-sentiment', asyncHandler(async (req, res) => {
    const { customer, invoices } = CustomerSentimentSchema.parse(req.body);
    const result = await aiService.analyzeCustomerSentiment(customer, invoices, 'banking');
    return ok(res, { result });
}));

// Audit Proposal
// issue #1566: refino de `z.any()` — `proposal` é um objeto opaco passado ao LLM.
// TODO: tipar conforme contrato Dolibarr (Propal) quando estabilizar.
const AuditProposalSchema = z.object({
    proposal: z.unknown()
});

router.post('/audit/proposal', asyncHandler(async (req, res) => {
    const { proposal } = AuditProposalSchema.parse(req.body);
    const result = await aiService.auditProposal(proposal, 'proposals');
    return ok(res, { result });
}));

// Audit Project
// issue #1566: refino de `z.any()` — `project`, `tasks`, `invoices` são objetos/arrays
// opacos vindos do Dolibarr. TODO: tipar conforme contrato Dolibarr (Project + Tasks).
const AuditProjectSchema = z.object({
    project: z.unknown(),
    tasks: z.array(z.unknown()).optional(),
    invoices: z.array(z.unknown()).optional()
});

router.post('/audit/project', asyncHandler(async (req, res) => {
    const { project, tasks, invoices } = AuditProjectSchema.parse(req.body);
    const result = await aiService.auditProject(project, tasks, invoices, 'proposals');
    return ok(res, { result });
}));

// Analyze System Logs
// issue #1566: refino de `z.any()` — `logs` é um array de entradas de log opacas
// (contrato variável por fonte). TODO: tipar conforme contrato do caller quando estabilizar.
const AnalyzeLogsSchema = z.object({
    logs: z.array(z.unknown())
});

router.post('/analyze/logs', asyncHandler(async (req, res) => {
    const { logs } = AnalyzeLogsSchema.parse(req.body);
    const result = await aiService.analyzeSystemLogs(logs, 'system_analysis');
    return ok(res, { result });
}));

// Analyze Monthly Report
const AnalyzeReportSchema = z.object({
    data: z.unknown()
});

router.post('/analyze/monthly-report', asyncHandler(async (req, res) => {
    const { data } = AnalyzeReportSchema.parse(req.body);
    const result = await aiService.analyzeMonthlyReport(data, 'system_analysis');
    return ok(res, { result });
}));

// --- Chat Session Routes ---

router.post('/sessions', asyncHandler(async (req, res) => {
    const userId = String((req as any).user?.id || (req as any).user?.login || 'unknown');
    const { firstMessage } = req.body as { firstMessage?: string };
    const session = chatSessionService.createSession(userId, firstMessage);
    return ok(res, session);
}));

router.get('/sessions', asyncHandler(async (req, res) => {
    const { limit } = req.query;
    const isAdmin = (req as any).user?.admin === '1' || (req as any).user?.admin === 1;
    const userId = String((req as any).user?.id || (req as any).user?.login || 'unknown');
    const sessions = chatSessionService.getSessions(isAdmin ? undefined : userId, limit ? parseInt(limit as string) : 50);
    return ok(res, sessions, { count: sessions.length });
}));

router.get('/sessions/:id', asyncHandler(async (req, res, next) => {
    const session = chatSessionService.getSession(req.params.id);
    if (!session) return next(new AppError(404, 'SESSION_NOT_FOUND', 'Session not found'));
    const isAdmin = (req as any).user?.admin === '1' || (req as any).user?.admin === 1;
    const userId = String((req as any).user?.id || (req as any).user?.login || 'unknown');
    if (!isAdmin && session.userId !== userId) return next(new AppError(403, 'ACCESS_DENIED', 'Access denied'));
    return ok(res, session);
}));

router.delete('/sessions', asyncHandler(async (req, res) => {
    const isAdmin = (req as any).user?.admin === '1' || (req as any).user?.admin === 1;
    const userId = String((req as any).user?.id || (req as any).user?.login || 'unknown');
    const count = isAdmin
        ? chatSessionService.deleteAllSessions()
        : chatSessionService.deleteSessionsByUser(userId);
    return ok(res, { deletedCount: count });
}));

router.delete('/sessions/:id', asyncHandler(async (req, res, next) => {
    const session = chatSessionService.getSession(req.params.id);
    if (!session) return next(new AppError(404, 'SESSION_NOT_FOUND', 'Session not found'));
    const isAdmin = (req as any).user?.admin === '1' || (req as any).user?.admin === 1;
    const userId = String((req as any).user?.id || (req as any).user?.login || 'unknown');
    if (!isAdmin && session.userId !== userId) return next(new AppError(403, 'ACCESS_DENIED', 'Access denied'));
    const success = chatSessionService.deleteSession(req.params.id);
    return ok(res, { deleted: success });
}));

router.get('/sessions-stats', asyncHandler(async (req, res) => {
    void req;
    const stats = chatSessionService.getStats();
    return ok(res, stats);
}));

router.get('/agent/activity', requireDolibarrLogin, asyncHandler(async (req, res) => {
    const { userId, entityType, action, limit, since } = req.query;
    const activities = agentActivityService.getActivities({
        userId: userId as string,
        entityType: entityType as string,
        action: action as string,
        limit: limit ? parseInt(limit as string) : 50,
        since: since ? parseInt(since as string) : undefined,
    });
    const stats = agentActivityService.getStats();
    return ok(res, { activities, stats });
}));

// ===========================================
// Config da sessão automática do agente (#300 item 3) — o que o resumo
// proativo reúne ao abrir a conversa. Leitura por qualquer logado; escrita admin.
// ===========================================

router.get('/agent/bootstrap-config', requireDolibarrLogin, asyncHandler(async (req, res) => {
    void req;
    return ok(res, agentBootstrapConfigStore.getConfig());
}));

const BootstrapConfigSchema = z.object({
    enabled: z.boolean().optional(),
    includeTasks: z.boolean().optional(),
    includeAgenda: z.boolean().optional(),
    includeFinancial: z.boolean().optional(),
    extraInstruction: z.string().max(2000).optional(),
});

router.put('/agent/bootstrap-config', requireDolibarrAdmin, asyncHandler(async (req, res) => {
    const patch = BootstrapConfigSchema.parse(req.body);
    return ok(res, agentBootstrapConfigStore.updateConfig(patch));
}));

// ===========================================
// VOZ do agente (TTS MiniMax) — #938
// ===========================================

// Config org-wide da voz (voiceId/speed), editável pelo admin na tela de Automações.
router.get('/voice/config', requireDolibarrLogin, asyncHandler(async (req, res) => {
    void req;
    return ok(res, voiceConfigStore.get());
}));

const VoiceConfigSchema = z.object({
    voiceId: z.string().min(1).max(120).optional(),
    speed: z.number().min(0.5).max(2).optional(),
});

router.put('/voice/config', requireDolibarrAdmin, asyncHandler(async (req, res) => {
    const patch = VoiceConfigSchema.parse(req.body);
    return ok(res, voiceConfigStore.update(patch));
}));

// Lista as vozes pt disponíveis (get_voice funciona mesmo sem saldo de TTS). Cache 1h.
let voicesCache: { at: number; list: { voiceId: string; name: string }[] } | null = null;
router.get('/voice/voices', requireDolibarrLogin, asyncHandler(async (req, res) => {
    void req;
    if (!voicesCache || Date.now() - voicesCache.at > 3600_000) {
        // Falha de upstream (MiniMax) → 502 (serviço externo). ZodError n/a aqui.
        const list = await minimaxService.listVoices(true)
            .catch(err => { throw new AppError(502, 'VOICE_UPSTREAM', (err as Error)?.message || 'Falha no serviço de vozes'); });
        voicesCache = { at: Date.now(), list };
    }
    return ok(res, { voices: voicesCache.list });
}));

// TTS: texto -> URL de áudio (mp3 hospedado ~24h). Voz do body ou a configurada.
const TtsSchema = z.object({
    text: z.string().min(1).max(10000),
    voiceId: z.string().min(1).max(120).optional(),
});

router.post('/voice/tts', requireDolibarrLogin, asyncHandler(async (req, res) => {
    const { text, voiceId } = TtsSchema.parse(req.body); // ZodError → errorHandler (400 VALIDATION_ERROR)
    // saldo insuficiente (1008) e afins viram 402 p/ o front cair no fallback do navegador.
    const { url } = await minimaxService.generateSpeech(text, voiceId ? { voiceId } : undefined)
        .catch(err => {
            const msg = String((err as Error)?.message || '');
            const status = /insufficient balance|1008/i.test(msg) ? 402 : 502;
            const code = status === 402 ? 'INSUFFICIENT_BALANCE' : 'TTS_UPSTREAM';
            throw new AppError(status, code, msg);
        });
    return ok(res, { url });
}));

export default router;
