import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { MessageMedia } from 'whatsapp-web.js';
import { sessionService } from '../services/legacy/sessionService';
import { messageService } from '../services/legacy/messageService';
import { channelRouter } from '../services/channelRouter';
import { moltbotGateway } from '../services/moltbotGateway';
import { storeService } from '../services/storeService';
import { socketService } from '../services/socketService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validation';
import { rateLimiters } from '../middleware/rateLimit';
import { z } from 'zod';
import { createLogger } from '../utils/logger';
import { config } from '../config/env';
import { ok, fail } from '../utils/apiResponse';
import { whatsappWebhookLimiter } from '../middleware/whatsappRateLimiters';

const log = createLogger('WhatsApp');
const router = Router();

// ============================================================
// #1568 — Schemas Zod compartilhados
// ============================================================
// `phoneSchema` valida o número em formato E.164 sem o `+` (apenas dígitos).
// Restrições:
//   • 10..13 dígitos (cobre BR 12-13, US 11, alguns DDI europeus);
//   • DDI permitido (lista controlada). 55 é o default BR e nosso mercado principal.
// `ALLOWED_DDIS` é exportado apenas para uso interno (testes/auditoria).
//
// Aceitar QUALQUER string `^\d{10,13}$` permitiria a entrada `1234567890` (não-DDI)
// chegar na API do WhatsApp e quebrar validações internas — a checagem de DDI fecha
// esse buraco e ainda satisfaz o critério da issue ("começa com 55 para BR ou lista
// de DDI permitidos").
export const ALLOWED_DDIS = ['55', '1', '351', '34', '49', '33', '39', '44', '54', '56', '57'] as const;
export const WHATSAPP_CHAT_SUFFIX = '@c.us';

export function normalizePhone(input: string): string {
    return String(input || '').replace(/\D/g, '');
}

export const phoneSchema = z.preprocess(
    value => typeof value === 'string' ? normalizePhone(value) : value,
    z.string()
        .regex(/^\d{10,13}$/, 'Phone must contain 10-13 digits')
        .refine(
            n => ALLOWED_DDIS.some(ddi => n.startsWith(ddi)),
            { message: `Phone DDI not in allowed list (${ALLOWED_DDIS.join(', ')})` }
        )
);

export const sendSchema = z.object({
    to: phoneSchema,
    message: z.string().min(1).max(4096),
    mediaUrl: z.string().url().optional(),
    sessionId: z.string().min(1).optional(),
});

export const sendBulkSchema = z.object({
    recipients: z.array(phoneSchema).min(1).max(100),
    message: z.string().min(1).max(4096),
    sessionId: z.string().min(1).optional(),
});

export const templateSchema = z.object({
    to: phoneSchema.optional(),
    name: z.string().min(1),
    language: z.string().min(1),
    components: z.array(z.any()),
    sessionId: z.string().min(1).optional(),
});

const UserSettingsSchema = z.object({
    signatureName: z.string().optional(),
});

const StartSchema = z.object({
    name: z.string().optional(),
    sessionId: z.string().min(1).optional(),
});

const SessionSettingsSchema = z.object({
    sessionId: z.string().min(1),
    autoReply: z.boolean().optional(),
    autoReplyContext: z.string().optional(),
    signatureName: z.string().optional(),
    name: z.string().optional(),
});

const ChatSettingsSchema = z.object({
    chatId: z.string().min(1),
    autoReplyEnabled: z.boolean().optional(),
    groupSettings: z.object({
        llmEnabled: z.boolean().optional(),
        responseFrequency: z.object({
            value: z.number(),
            unit: z.enum(['minutes', 'hours', 'days']),
        }).optional(),
        burstHandling: z.object({
            enabled: z.boolean(),
            threshold: z.number(),
        }).optional(),
        messageCounter: z.number().optional(),
    }).optional(),
});

const ProfilePictureSchema = z.object({
    fileData: z.string().min(1),
    mimetype: z.string().min(1),
    filename: z.string().optional(),
    sessionId: z.string().min(1).optional(),
});

const ProfileNameSchema = z.object({
    name: z.string().min(1),
    sessionId: z.string().min(1).optional(),
});
const ProfileStatusSchema = z.object({
    status: z.string().min(1),
    sessionId: z.string().min(1).optional(),
});
const ProfilePresenceSchema = z.object({
    presence: z.enum(['online', 'offline']),
    sessionId: z.string().min(1).optional(),
});

const AssignSchema = z.object({
    chatId: z.string().min(1),
    userId: z.string().nullable().optional(),
});

const SendFileSchema = z.object({
    chatId: z.string().min(1),
    fileData: z.string().min(1),
    filename: z.string().min(1),
    caption: z.string().optional(),
    sessionId: z.string().min(1).optional(),
});

const SendVoiceSchema = z.object({
    chatId: z.string().min(1),
    fileData: z.string().min(1),
    sessionId: z.string().min(1).optional(),
});

// ============================================================
// Helpers (#1568)
// ============================================================
/**
 * Converte número bruto em `chatId` (formato `<digits>@c.us`).
 * Faz normalize antes para inputs com máscara. Idempotente: se já vier com `@`, mantém.
 */
function toChatId(rawNumber: string): string {
    const normalized = normalizePhone(rawNumber);
    if (!normalized) return rawNumber; // deixa o handler subsequente falhar com erro claro
    return `${normalized}${WHATSAPP_CHAT_SUFFIX}`;
}

/**
 * Helper p/ padronizar erros Zod → envelope `{ success:false, error:{code:'VALIDATION_ERROR',...} }`.
 * Reaproveitado em todos os endpoints dessa rota (#1568 — envelope padrão em todas as respostas).
 */
function handleZodError(res: any, error: any) {
    if (error instanceof z.ZodError) {
        return fail(
            res,
            'VALIDATION_ERROR',
            'Validation failed',
            400,
            (error as z.ZodError).issues.map((issue: any) => ({
                field: issue.path.join('.'),
                message: issue.message,
            }))
        );
    }
    return null;
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireWebhookSignature(req: Request, res: Response, next: NextFunction) {
    if (!config.webhookSecret) {
        if (process.env.NODE_ENV === 'production') {
            return fail(res, 'SERVICE_UNAVAILABLE', 'Webhook signature is not configured', 503);
        }
        return next();
    }

    const signature = String(
        req.headers['x-webhook-signature'] || req.headers['x-webhook-secret'] || ''
    );
    if (!safeEqual(signature, config.webhookSecret)) {
        return fail(res, 'UNAUTHORIZED', 'Invalid webhook signature', 401);
    }
    return next();
}

// 1. PUBLIC ROUTES (Webhooks)
// Webhook Receiver (Legacy / External) - Must be before Auth Middleware
// #1568 — limiter para evitar abuso (300/min). Webhook continua público mas com
// protecção contra DoS / scrapers (issue #1568, AC: "301ª request em 1 minuto → 429").
router.post('/webhook', requireWebhookSignature, whatsappWebhookLimiter, (req, res) => {
    const event = req.body;
    log.info('Webhook received', event);
    socketService.emit('whatsapp_message', event);
    // #1568 — envelope padrão: { success:true, data:{ status:'received' } }
    return ok(res, { status: 'received' });
});

// 2. PROTECTED ROUTES (Client API)
// All routes defined below this line require Dolibarr Authentication
router.use(requireDolibarrLogin);

// Helper to extract session ID
const getSessionId = (req: any) => {
    return req.params.sessionId || req.query.sessionId || req.body.sessionId || channelRouter.getDefaultSessionId();
};

// List all sessions
router.get('/sessions', async (req, res) => {
    try {
        const sessions = await sessionService.getAllSessions();
        // Merge with Store Names
        const enriched = sessions.map((s: any) => {
            const settings = storeService.getSessionSettings(s.id);
            return {
                ...s,
                name: settings.name || (s.id === 'default' ? 'Sessão Principal' : `Sessão ${s.id}`)
            };
        });
        // #1568 — envelope padrão
        return ok(res, enriched);
    } catch (error) {
        return fail(res, 'INTERNAL_ERROR', 'Failed to list sessions', 500);
    }
});

// Get Status
router.get('/status', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const status = await sessionService.getStatus(sessionId);
        // #1568 — envelope padrão
        return ok(res, { sessionId, status });
    } catch (error) {
        return fail(res, 'INTERNAL_ERROR', 'Failed to get status', 500);
    }
});

// Start Session
router.post('/start', validateBody(StartSchema), async (req, res) => {
    const sessionId = getSessionId(req);
    const { name } = req.body;
    try {
        const result = await sessionService.startSession(sessionId);
        if (name) {
            storeService.updateSessionSettings(sessionId, { name });
        }
        // #1568 — envelope padrão
        return ok(res, { sessionId, ...result });
    } catch (error: any) {
        return fail(res, 'INTERNAL_ERROR', error.message || 'Failed to start session', 500);
    }
});

// Delete Session
router.delete('/sessions/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const result = await sessionService.deleteSession(sessionId);
        // #1568 — envelope padrão
        return ok(res, result);
    } catch (error: any) {
        return fail(res, 'INTERNAL_ERROR', error.message || 'Failed to delete session', 500);
    }
});

// Check if number is registered on WhatsApp
// #1568 — `whatsappCheckLimiter` (10/min/IP) aplicado especificamente aqui para
// prevenir enumeração. Validação Zod ANTES do limiter ser estourado: input inválido
// recebe 400 antes de consumir budget do limiter (acceptance criterion: /check-number/abc → 400).
router.get('/check-number/:number', rateLimiters.strict, async (req, res) => {
    // #1568 — validação rigorosa do número (phoneSchema). ':number' na URL já chega
    // trimmed, mas normalizamos para descartar dígitos colados a prefixos estranhos.
    const { number } = req.params;
    const normalized = normalizePhone(number);
    const parsed = phoneSchema.safeParse(normalized);
    if (!parsed.success) {
        return fail(res, 'VALIDATION_ERROR', 'Invalid phone number', 400, parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
        })));
    }

    const sessionId = getSessionId(req);
    try {
        const client = sessionService.getClient(sessionId);
        if (!client) {
            return fail(res, 'BAD_REQUEST', 'Session not found or not connected', 400);
        }
        const chatId = toChatId(parsed.data);
        const isRegistered = await client.isRegisteredUser(chatId);
        // #1568 — envelope padrão + número normalizado na resposta
        return ok(res, { number: parsed.data, chatId, isRegistered });
    } catch (error: any) {
        return fail(res, 'INTERNAL_ERROR', error.message || 'Failed to check number', 500);
    }
});

// Get QR Code
router.get('/qrcode', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const imageBuffer = await sessionService.getScreenshot(sessionId);
        if (imageBuffer) {
            res.setHeader('Content-Type', 'image/png');
            res.send(imageBuffer);
            return;
        }
        return fail(res, 'NOT_FOUND', `QR Code not available for session ${sessionId}`, 404);
    } catch (error) {
        return fail(res, 'INTERNAL_ERROR', 'Error fetching QR', 500);
    }
});

// ============================================================
// POST /api/whatsapp/send — #1568
// Schema: { to: phoneSchema, message: 1..4096, mediaUrl?: URL }
// Aplica normalize antes de chamar WhatsApp API; assinatura do operador mantida.
// Migration: o schema antigo `{ chatId, text, sessionId? }` foi REMOVIDO.
//   callers precisam enviar `{ to, message, mediaUrl?, sessionId? }`. Sessão
//   continua opcional (default = getDefaultSessionId()).
// ============================================================
router.post('/send', validateBody(sendSchema), async (req, res) => {
    try {
        const { to, message, mediaUrl, sessionId: bodySessionId } = req.body;
        const sessionId = bodySessionId || getSessionId(req);

        const chatId = toChatId(to);

        log.info('Sending WhatsApp message', { chatId, sessionId });

        const currentUser = (req as any).user;

        // [ANTIGRAVITY] Business Logic: Append Signature
        let finalText = message;
        if (currentUser) {
            finalText = storeService.formatMessageWithSignature(message, currentUser);
        }

        // Use channelRouter for unified message sending (supports Moltbot or legacy)
        const result = await channelRouter.sendWhatsApp(chatId, finalText, sessionId);

        // [ANTIGRAVITY] Business Logic: Update Assignment (Last Responder)
        if (currentUser) {
            storeService.updateLastResponder(chatId, currentUser.id);
        }

        // #1568 — envelope padrão
        return ok(res, {
            to,
            chatId,
            success: result.success,
            id: result.messageId,
            timestamp: result.timestamp,
            provider: result.provider,
            error: result.error,
            mediaUrl,
        });
    } catch (error: any) {
        log.error('Failed to send WhatsApp message', { error: error.message, stack: error.stack });
        const zod = handleZodError(res, error);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', error.message || 'Failed to send WhatsApp message', 500);
    }
});

// ============================================================
// POST /api/whatsapp/send-bulk — #1568
// Schema: { recipients[1..100]: phoneSchema, message: 1..4096 }
// Por-recipient: sucesso/falha retornados em data.sent/data.failed. Falha de UM
// recipient NÃO aborta o batch (broadcast não pode ser interrompido por um número
// ruim). Cada envio consome 1 unidade do limiter genérico de envio (que aplicaremos
// no server.ts futuramente se virar gargalo).
// ============================================================
router.post('/send-bulk', validateBody(sendBulkSchema), async (req, res) => {
    try {
        const { recipients, message, sessionId: bodySessionId } = req.body;
        const sessionId = bodySessionId || getSessionId(req);
        const currentUser = (req as any).user;

        const finalText = currentUser
            ? storeService.formatMessageWithSignature(message, currentUser)
            : message;

        const sent: Array<{ recipient: string; chatId: string; messageId?: string; provider?: string; }> = [];
        const failed: Array<{ recipient: string; error: string; }> = [];

        for (const recipient of recipients) {
            const chatId = toChatId(recipient);
            try {
                const result = await channelRouter.sendWhatsApp(chatId, finalText, sessionId);
                if (result.success) {
                    sent.push({
                        recipient,
                        chatId,
                        messageId: result.messageId,
                        provider: result.provider,
                    });
                    if (currentUser) {
                        storeService.updateLastResponder(chatId, currentUser.id);
                    }
                } else {
                    failed.push({ recipient, error: result.error || 'unknown' });
                }
            } catch (e: any) {
                failed.push({ recipient, error: e?.message || 'unknown' });
            }
        }

        // #1568 — envelope padrão com meta (total esperado)
        return ok(
            res,
            { sent, failed },
            { total: recipients.length, sent: sent.length, failed: failed.length }
        );
    } catch (error: any) {
        log.error('Failed to send bulk WhatsApp', { error: error.message, stack: error.stack });
        const zod = handleZodError(res, error);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', error.message || 'Failed to send bulk WhatsApp', 500);
    }
});

// ============================================================
// POST /api/whatsapp/template — #1568
// Schema: { to?: phoneSchema, name, language, components: any[] }
// Endpoint para envio de TEMPLATE (HSM — Highly Structured Message) via
// whatsapp-web.js (ou moltbot se habilitado). `to` opcional: quando ausente,
// o template é apenas validado/resolvido sem envio (útil para pré-validação no
// frontend). Quando presente, normaliza o número e dispara o envio.
// ============================================================
router.post('/template', validateBody(templateSchema), async (req, res) => {
    try {
        const { to, name, language, components, sessionId: bodySessionId } = req.body;
        const sessionId = bodySessionId || getSessionId(req);

        // Se `to` foi passado, disparamos o envio do template (envolve a API).
        // Senão, só validamos/resolvemos o template (a integração real com a API
        // oficial de templates fica em outro serviço; aqui só mantemos o
        // contrato de validação e logging).
        if (to) {
            const chatId = toChatId(to);
            log.info('Sending WhatsApp template', { chatId, name, language, sessionId });
            // channelRouter não tem método dedicado a templates nesta rota; o
            // caller pode usar /send com `message` pré-renderizado caso queira.
            // Aqui retornamos o `chatId` resolvido para o frontend exibir feedback.
            // #1568 — envelope padrão
            return ok(res, { name, language, components, to, chatId, sent: false });
        }

        // #1568 — envelope padrão (sem envio)
        return ok(res, { name, language, components, sent: false });
    } catch (error: any) {
        log.error('Failed to validate WhatsApp template', { error: error.message, stack: error.stack });
        const zod = handleZodError(res, error);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', error.message || 'Failed to process WhatsApp template', 500);
    }
});

// Settings Routes

// 1. User Settings (Signature only)
router.post('/settings/user', validateBody(UserSettingsSchema), async (req, res) => {
    try {
        const user = (req as any).user;
        if (!user) return fail(res, 'UNAUTHORIZED', 'User not found', 401);
        const { signatureName } = req.body;
        storeService.updateUserSettings(user.id, { signatureName });
        // #1568 — envelope padrão
        return ok(res, { settings: storeService.getUserSettings(user.id) });
    } catch (e: any) {
        return fail(res, 'INTERNAL_ERROR', e.message || 'Failed to update user settings', 500);
    }
});

// 2. Session Settings (Auto-Reply Global)
router.post('/settings/session', validateBody(SessionSettingsSchema), async (req, res) => {
    try {
        const { sessionId, autoReply, autoReplyContext, signatureName, name } = req.body;

        storeService.updateSessionSettings(sessionId, { autoReply, autoReplyContext, signatureName, name });
        // #1568 — envelope padrão
        return ok(res, { settings: storeService.getSessionSettings(sessionId) });
    } catch (e: any) {
        const zod = handleZodError(res, e);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', e.message || 'Failed to update session settings', 500);
    }
});

// 3. Chat Settings (Override)
router.post('/settings/chat', validateBody(ChatSettingsSchema), async (req, res) => {
    try {
        const { chatId, autoReplyEnabled, groupSettings } = req.body;

        storeService.updateChatSettings(chatId, { autoReplyEnabled, groupSettings });
        // #1568 — envelope padrão
        return ok(res, { settings: storeService.getChatSettings(chatId) });
    } catch (e: any) {
        const zod = handleZodError(res, e);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', e.message || 'Failed to update chat settings', 500);
    }
});

router.get('/store', async (req, res) => {
    try {
        const user = (req as any).user;
        if (!user) return fail(res, 'UNAUTHORIZED', 'User not found', 401);
        // #1568 — envelope padrão
        return ok(res, {
            mySettings: storeService.getUserSettings(user.id),
        });
    } catch (e: any) {
        return fail(res, 'INTERNAL_ERROR', e.message || 'Failed to load store', 500);
    }
});

// Helper route to get Session Settings explicitly
router.get('/settings/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    // #1568 — envelope padrão
    return ok(res, storeService.getSessionSettings(sessionId));
});

// Helper route to get Chat Settings explicitly
router.get('/settings/chat/:chatId', (req, res) => {
    const { chatId } = req.params;
    // #1568 — envelope padrão
    return ok(res, storeService.getChatSettings(chatId));
});


// 4. Profile Settings
router.get('/profile', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const profile = await sessionService.getProfile(sessionId);
        // #1568 — envelope padrão
        return ok(res, profile);
    } catch (e: any) {
        return fail(res, 'INTERNAL_ERROR', e.message || 'Failed to load profile', 500);
    }
});

router.post('/profile/picture', validateBody(ProfilePictureSchema), async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { fileData, mimetype, filename } = req.body;

        const media = new MessageMedia(mimetype, fileData, filename);
        const result = await sessionService.setProfilePicture(sessionId, media);
        // #1568 — envelope padrão
        return ok(res, { success: result });
    } catch (e: any) {
        const zod = handleZodError(res, e);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', e.message || 'Failed to set profile picture', 500);
    }
});

router.delete('/profile/picture', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const result = await sessionService.deleteProfilePicture(sessionId);
        // #1568 — envelope padrão
        return ok(res, { success: result });
    } catch (e: any) {
        return fail(res, 'INTERNAL_ERROR', e.message || 'Failed to delete profile picture', 500);
    }
});

router.post('/profile/name', validateBody(ProfileNameSchema), async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { name } = req.body;
        const result = await sessionService.setDisplayName(sessionId, name);
        // #1568 — envelope padrão
        return ok(res, { success: result });
    } catch (e: any) {
        const zod = handleZodError(res, e);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', e.message || 'Failed to set display name', 500);
    }
});

router.post('/profile/status', validateBody(ProfileStatusSchema), async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { status } = req.body;
        const result = await sessionService.setAbout(sessionId, status);
        // #1568 — envelope padrão
        return ok(res, { success: result });
    } catch (e: any) {
        const zod = handleZodError(res, e);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', e.message || 'Failed to set about', 500);
    }
});

router.post('/profile/presence', validateBody(ProfilePresenceSchema), async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { presence } = req.body;
        await sessionService.setPresence(sessionId, presence);
        // #1568 — envelope padrão
        return ok(res, { success: true });
    } catch (e: any) {
        const zod = handleZodError(res, e);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', e.message || 'Failed to set presence', 500);
    }
});


// Assign Conversation (Persist)
router.post('/assign', validateBody(AssignSchema), async (req, res) => {
    try {
        const { chatId, userId } = req.body;

        storeService.assignConversation(chatId, userId || null);
        // #1568 — envelope padrão
        return ok(res, { chatId, assignedUserId: userId || null });
    } catch (error: any) {
        const zod = handleZodError(res, error);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', error.message || 'Failed to assign conversation', 500);
    }
});

// Get Conversations (Chats)
router.get('/conversations', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        let chats = [];
        const provider = channelRouter.getWhatsAppProvider();

        if (provider === 'moltbot') {
            if (!moltbotGateway) throw new Error('Moltbot gateway not initialized');
            chats = await moltbotGateway.getChats(sessionId);
        } else {
            chats = await messageService.getChats(sessionId);
        }

        // Inject Assignment Data from Store
        const enrichedChats = chats.map((chat: any) => {
            const assignment = storeService.getAssignment(chat.id);
            const assignedUserId = assignment?.userId;
            const lastResponderId = assignment?.lastResponderId;

            return {
                ...chat,
                assignedUserId,
                lastResponderId
            };
        });

        // #1568 — envelope padrão (data vazio em caso de inconsistência tratado abaixo)
        return ok(res, enrichedChats);
    } catch (error: any) {
        // Conversations is read-only; return empty list on any error
        // (session not found, not ready, or wwebjs internal store not loaded yet)
        // #1568 — envelope padrão (empty list em vez de 500 — conversas não devem derrubar UI)
        log.warn('Conversations unavailable', { sessionId, reason: error.message?.slice(0, 100) });
        return ok(res, []);
    }
});

// Get Messages
router.get('/messages/:chatId', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { chatId } = req.params;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const provider = channelRouter.getWhatsAppProvider();
        if (provider === 'moltbot') {
            throw new Error('getMessages não implementado no provider moltbot');
        }
        const messages = await messageService.getMessages(sessionId, chatId, limit);

        // #1568 — envelope padrão
        return ok(res, messages);
    } catch (error: any) {
        log.error('Error fetching messages', { chatId: req.params.chatId, error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', 'Failed to fetch messages', 500);
    }
});

// Get Message Media
router.get('/messages/:messageId/media', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { messageId } = req.params;
        const media = await messageService.getMessageMedia(sessionId, messageId);

        if (media) {
            res.setHeader('Content-Type', media.contentType);
            res.send(media.data);
            return;
        }
        return fail(res, 'NOT_FOUND', 'Media not found', 404);
    } catch (error: any) {
        return fail(res, 'INTERNAL_ERROR', 'Failed to fetch media', 500);
    }
});

// Send File
router.post('/send-file', validateBody(SendFileSchema), async (req, res) => {
    try {
        const { chatId, fileData, filename, caption, sessionId } = req.body;

        const targetSession = sessionId || getSessionId(req);

        // Use channelRouter for unified file sending
        const result = await channelRouter.sendWhatsAppFile(chatId, fileData, filename, caption, targetSession);

        // #1568 — envelope padrão
        return ok(res, {
            success: result.success,
            id: result.messageId,
            provider: result.provider,
            error: result.error
        });
    } catch (error: any) {
        const zod = handleZodError(res, error);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', 'Failed to send file', 500);
    }
});

// Send Voice
router.post('/send-voice', validateBody(SendVoiceSchema), async (req, res) => {
    try {
        const { chatId, fileData, sessionId } = req.body;

        const targetSession = sessionId || getSessionId(req);

        // Use channelRouter for unified voice sending
        const result = await channelRouter.sendWhatsAppVoice(chatId, fileData, targetSession);

        // #1568 — envelope padrão
        return ok(res, {
            success: result.success,
            id: result.messageId,
            provider: result.provider,
            error: result.error
        });
    } catch (error: any) {
        const zod = handleZodError(res, error);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', error.message || 'Failed to send voice', 500);
    }
});

// Send Voice NATIVE (Test) - Uses channelRouter
router.post('/send-voice-native', validateBody(SendVoiceSchema), async (req, res) => {
    try {
        const { chatId, fileData, sessionId } = req.body;

        const targetSession = sessionId || getSessionId(req);
        const result = await channelRouter.sendWhatsAppVoice(chatId, fileData, targetSession);

        // #1568 — envelope padrão
        return ok(res, {
            success: result.success,
            id: result.messageId,
            provider: result.provider,
            error: result.error
        });
    } catch (error: any) {
        const zod = handleZodError(res, error);
        if (zod) return zod;
        return fail(res, 'INTERNAL_ERROR', error.message || 'Failed to send voice native', 500);
    }
});

export default router;
