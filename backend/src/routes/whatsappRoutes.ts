import { Router } from 'express';
import { MessageMedia } from 'whatsapp-web.js';
import { sessionService } from '../services/legacy/sessionService';
import { messageService } from '../services/legacy/messageService';
import { channelRouter } from '../services/channelRouter';
import { moltbotGateway } from '../services/moltbotGateway';
import { storeService } from '../services/storeService';
import { socketService } from '../services/socketService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { z } from 'zod';
import { createLogger } from '../utils/logger';
import { FEATURES } from '../config/features';
import { ok, fail } from '../utils/apiResponse';
import { whatsappCheckLimiter, webhookLimiter } from '../middleware/whatsappRateLimiters';
import {
    phoneSchema,
    sendSchema,
    sendBulkSchema,
    templateSchema,
    normalizePhone
} from './whatsappSchemas';

const log = createLogger('WhatsApp');
const router = Router();
const DEFAULT_SESSION = 'default';

// 1. PUBLIC ROUTES (Webhooks)
// Webhook Receiver (Legacy / External) - Must be before Auth Middleware.
// `webhookLimiter` (300/min) impede abuso sem impactar rajadas legítimas (#1568).
router.post('/webhook', webhookLimiter, (req, res) => {
    const event = req.body;
    log.info('Webhook received', event);
    socketService.emit('whatsapp_message', event);
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
        res.json(enriched);
    } catch (error) {
        res.status(500).json({ error: 'Failed to list sessions' });
    }
});

// Get Status
router.get('/status', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const status = await sessionService.getStatus(sessionId);
        res.json({ sessionId, status }); // sessionService.getStatus returns string, we wrap it
    } catch (error) {
        res.status(500).json({ error: 'Failed to get status' });
    }
});

// Start Session
router.post('/start', async (req, res) => {
    const sessionId = getSessionId(req);
    const { name } = req.body;
    try {
        const result = await sessionService.startSession(sessionId);
        if (name) {
            storeService.updateSessionSettings(sessionId, { name });
        }
        res.json({ sessionId, ...result });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete Session
router.delete('/sessions/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const result = await sessionService.deleteSession(sessionId);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Check if number is registered on WhatsApp.
// `whatsappCheckLimiter` (10/min) — mais restritivo que o geral, pois este
// endpoint é oráculo de enumeração (alvo de scraping de listas de números).
// Validação Zod do `:number` (formato + DDI) retorna 400 antes de bater no
// provider (#1568).
router.get('/check-number/:number', whatsappCheckLimiter, async (req, res) => {
    const sessionId = getSessionId(req);
    const rawNumber = req.params.number;
    try {
        const number = phoneSchema.parse(rawNumber);
        const client = sessionService.getClient(sessionId);
        if (!client) {
            return fail(res, 'SESSION_NOT_FOUND', 'Session not found or not connected', 400);
        }
        // Normalização defensiva — remove qualquer caractere não-numérico que
        // tenha passado pelo schema (item 5 da issue #1568).
        const normalized = normalizePhone(number);
        const formattedId = normalized.includes('@') ? normalized : `${normalized}@c.us`;
        const isRegistered = await client.isRegisteredUser(formattedId);
        return ok(res, {
            number: normalized,
            isRegistered,
            chatId: formattedId
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return fail(res, 'VALIDATION_ERROR', 'Número de telefone inválido', 400, error.issues);
        }
        log.error('check-number failed', { error: error.message, rawNumber });
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
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
        } else {
            res.status(404).send(`QR Code not available for session ${sessionId}`);
        }
    } catch (error) {
        res.status(500).send('Error fetching QR');
    }
});

// Send Message (#1568 — validação Zod via sendSchema).
// Aceita `to` (número de telefone válido), `message` (1-4096 chars) e
// `mediaUrl` opcional. O número é normalizado e formatado como chatId antes
// de chegar ao provider.
router.post('/send', async (req, res) => {
    try {
        const { to, message, mediaUrl, sessionId } = sendSchema.parse(req.body);

        // Normaliza número e monta o chatId no formato do WhatsApp.
        const normalized = normalizePhone(to);
        const chatId = `${normalized}@c.us`;

        log.info('Sending WhatsApp message', { chatId, sessionId });

        const targetSession = sessionId || getSessionId(req);
        const currentUser = (req as any).user;

        // [ANTIGRAVITY] Business Logic: Append Signature
        let finalText = message;
        if (currentUser) {
            finalText = storeService.formatMessageWithSignature(message, currentUser);
        }

        // Use channelRouter for unified message sending (supports Moltbot or legacy)
        const result = await channelRouter.sendWhatsApp(chatId, finalText, targetSession);

        // [ANTIGRAVITY] Business Logic: Update Assignment (Last Responder)
        if (currentUser) {
            storeService.updateLastResponder(chatId, currentUser.id);
        }

        if (!result.success) {
            return fail(res, 'SEND_FAILED', result.error || 'Falha ao enviar mensagem', 502, {
                provider: result.provider
            });
        }
        return ok(res, {
            id: result.messageId,
            timestamp: result.timestamp,
            provider: result.provider,
            mediaUrl
        });
    } catch (error: any) {
        log.error('Failed to send WhatsApp message', { error: error.message, stack: error.stack });
        if (error instanceof z.ZodError) {
            return fail(res, 'VALIDATION_ERROR', 'Erro de validação', 400, error.issues);
        }
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// Send Bulk (#1568) — envia a mesma mensagem para múltiplos destinatários.
// Limite de 100 destinatários por request (sendBulkSchema). Resposta contém
// o detalhe por destinatário para o cliente reportingar falhas individuais.
router.post('/send-bulk', async (req, res) => {
    try {
        const { recipients, message, sessionId } = sendBulkSchema.parse(req.body);

        const targetSession = sessionId || getSessionId(req);
        const currentUser = (req as any).user;

        let finalText = message;
        if (currentUser) {
            finalText = storeService.formatMessageWithSignature(message, currentUser);
        }

        const results = [];
        let succeeded = 0;
        let failed = 0;
        for (const recipient of recipients) {
            const normalized = normalizePhone(recipient);
            const chatId = `${normalized}@c.us`;
            try {
                const r = await channelRouter.sendWhatsApp(chatId, finalText, targetSession);
                if (currentUser && r.success) {
                    storeService.updateLastResponder(chatId, currentUser.id);
                }
                results.push({ to: normalized, success: r.success, id: r.messageId, error: r.error });
                if (r.success) { succeeded++; } else { failed++; }
            } catch (err: any) {
                results.push({ to: normalized, success: false, error: err.message });
                failed++;
            }
        }

        return ok(res, {
            total: recipients.length,
            succeeded,
            failed,
            results
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return fail(res, 'VALIDATION_ERROR', 'Erro de validação', 400, error.issues);
        }
        log.error('Failed to send WhatsApp bulk', { error: error.message });
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// Send Template (#1568) — valida payload do template (templateSchema).
// Se `to` estiver presente, dispara a mensagem para o destinatário; caso
// contrário, apenas valida o payload (pré-validação de template).
router.post('/template', async (req, res) => {
    try {
        const { name, language, components, to, sessionId } = templateSchema.parse(req.body);

        const targetSession = sessionId || getSessionId(req);

        // Sem destinatário: apenas confirma que o payload do template é válido.
        if (!to) {
            return ok(res, { validated: true, name, language, componentsCount: components.length });
        }

        const normalized = normalizePhone(to);
        const chatId = `${normalized}@c.us`;

        // Serialização simples do template — provider legado não tem API de
        // template nativa, então renderizamos como texto estruturado.
        const rendered = `[template:${name}|lang:${language}] ${JSON.stringify(components)}`;
        const result = await channelRouter.sendWhatsApp(chatId, rendered, targetSession);

        if (!result.success) {
            return fail(res, 'SEND_FAILED', result.error || 'Falha ao enviar template', 502, {
                provider: result.provider
            });
        }
        return ok(res, {
            id: result.messageId,
            timestamp: result.timestamp,
            provider: result.provider,
            template: { name, language }
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return fail(res, 'VALIDATION_ERROR', 'Erro de validação', 400, error.issues);
        }
        log.error('Failed to send WhatsApp template', { error: error.message });
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// Settings Routes

// 1. User Settings (Signature only)
router.post('/settings/user', async (req, res) => {
    try {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ error: 'User not found' });
        const { signatureName } = req.body;
        storeService.updateUserSettings(user.id, { signatureName });
        res.json({ success: true, settings: storeService.getUserSettings(user.id) });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// 2. Session Settings (Auto-Reply Global)
router.post('/settings/session', async (req, res) => {
    try {
        const { sessionId, autoReply, autoReplyContext, signatureName, name } = z.object({
            sessionId: z.string().min(1),
            autoReply: z.boolean().optional(),
            autoReplyContext: z.string().optional(),
            signatureName: z.string().optional(),
            name: z.string().optional()
        }).parse(req.body);

        storeService.updateSessionSettings(sessionId, { autoReply, autoReplyContext, signatureName, name });
        res.json({ success: true, settings: storeService.getSessionSettings(sessionId) });
    } catch (e: any) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: e.issues });
        }
        res.status(500).json({ error: e.message });
    }
});

// 3. Chat Settings (Override)
router.post('/settings/chat', async (req, res) => {
    try {
        const { chatId, autoReplyEnabled, groupSettings } = z.object({
            chatId: z.string().min(1),
            autoReplyEnabled: z.boolean().optional(),
            groupSettings: z.object({
                llmEnabled: z.boolean().optional(),
                responseFrequency: z.object({
                    value: z.number(),
                    unit: z.enum(['minutes', 'hours', 'days'])
                }).optional(),
                burstHandling: z.object({
                    enabled: z.boolean(),
                    threshold: z.number()
                }).optional(),
                messageCounter: z.number().optional()
            }).optional()
        }).parse(req.body);

        storeService.updateChatSettings(chatId, { autoReplyEnabled, groupSettings });
        res.json({ success: true, settings: storeService.getChatSettings(chatId) });
    } catch (e: any) {
        if (e instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: e.issues });
        }
        res.status(500).json({ error: e.message });
    }
});

router.get('/store', async (req, res) => {
    try {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ error: 'User not found' });
        res.json({
            mySettings: storeService.getUserSettings(user.id),
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Helper route to get Session Settings explicitly
router.get('/settings/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    res.json(storeService.getSessionSettings(sessionId));
});

// Helper route to get Chat Settings explicitly
router.get('/settings/chat/:chatId', (req, res) => {
    const { chatId } = req.params;
    res.json(storeService.getChatSettings(chatId));
});


// 4. Profile Settings
router.get('/profile', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const profile = await sessionService.getProfile(sessionId);
        res.json(profile);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/profile/picture', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { fileData, mimetype, filename } = z.object({
            fileData: z.string().min(1),
            mimetype: z.string().min(1),
            filename: z.string().optional()
        }).parse(req.body);

        const media = new MessageMedia(mimetype, fileData, filename);
        const result = await sessionService.setProfilePicture(sessionId, media);
        res.json({ success: result });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/profile/picture', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const result = await sessionService.deleteProfilePicture(sessionId);
        res.json({ success: result });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/profile/name', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
        const result = await sessionService.setDisplayName(sessionId, name);
        res.json({ success: result });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/profile/status', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { status } = z.object({ status: z.string().min(1) }).parse(req.body);
        const result = await sessionService.setAbout(sessionId, status);
        res.json({ success: result });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/profile/presence', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { presence } = z.object({ presence: z.enum(['online', 'offline']) }).parse(req.body);
        await sessionService.setPresence(sessionId, presence);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});


// Assign Conversation (Persist)
router.post('/assign', async (req, res) => {
    try {
        const { chatId, userId } = z.object({
            chatId: z.string().min(1),
            userId: z.string().nullable().optional()
        }).parse(req.body);

        storeService.assignConversation(chatId, userId || null);
        res.json({ success: true, chatId, assignedUserId: userId || null });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
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

        res.json(enrichedChats);
    } catch (error: any) {
        // Conversations is read-only; return empty list on any error
        // (session not found, not ready, or wwebjs internal store not loaded yet)
        log.warn('Conversations unavailable', { sessionId, reason: error.message?.slice(0, 100) });
        return res.json([]);
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

        res.json(messages);
    } catch (error: any) {
        log.error('Error fetching messages', { chatId: req.params.chatId, error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Failed to fetch messages' });
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
        } else {
            res.status(404).json({ error: 'Media not found' });
        }
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch media' });
    }
});

// Send File
router.post('/send-file', async (req, res) => {
    try {
        const { chatId, fileData, filename, caption, sessionId } = z.object({
            chatId: z.string().min(1),
            fileData: z.string().min(1), // Base64
            filename: z.string().min(1),
            caption: z.string().optional(),
            sessionId: z.string().optional()
        }).parse(req.body);

        const targetSession = sessionId || getSessionId(req);

        // Use channelRouter for unified file sending
        const result = await channelRouter.sendWhatsAppFile(chatId, fileData, filename, caption, targetSession);

        res.json({
            success: result.success,
            id: result.messageId,
            provider: result.provider,
            error: result.error
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: 'Failed to send file' });
    }
});

// Send Voice
router.post('/send-voice', async (req, res) => {
    try {
        const { chatId, fileData, sessionId } = z.object({
            chatId: z.string().min(1),
            fileData: z.string().min(1),
            sessionId: z.string().optional()
        }).parse(req.body);

        const targetSession = sessionId || getSessionId(req);

        // Use channelRouter for unified voice sending
        const result = await channelRouter.sendWhatsAppVoice(chatId, fileData, targetSession);

        res.json({
            success: result.success,
            id: result.messageId,
            provider: result.provider,
            error: result.error
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        log.error('Send Voice Error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message || 'Failed to send voice' });
    }
});

// Send Voice NATIVE (Test) - Uses channelRouter
router.post('/send-voice-native', async (req, res) => {
    try {
        const { chatId, fileData, sessionId } = z.object({
            chatId: z.string().min(1),
            fileData: z.string().min(1),
            sessionId: z.string().optional()
        }).parse(req.body);

        const targetSession = sessionId || getSessionId(req);
        const result = await channelRouter.sendWhatsAppVoice(chatId, fileData, targetSession);

        res.json({
            success: result.success,
            id: result.messageId,
            provider: result.provider,
            error: result.error
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message || 'Failed to send voice native' });
    }
});

export default router;
