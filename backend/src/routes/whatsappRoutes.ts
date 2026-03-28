import { Router } from 'express';
import { MessageMedia } from 'whatsapp-web.js';
import { sessionService } from '../services/sessionService';
import { messageService } from '../services/messageService';
import { storeService } from '../services/storeService';
import { socketService } from '../services/socketService'; // Webhook needs this
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { channelRouter } from '../services/channelRouter';
import { FEATURES } from '../config/features';

const log = logger.child('WhatsAppRoutes');
const router = Router();
const DEFAULT_SESSION = 'default';

// 1. PUBLIC ROUTES (Webhooks)
// Webhook Receiver (Legacy / External) - Must be before Auth Middleware
router.post('/webhook', (req, res) => {
    const event = req.body;
    log.info('Webhook received', event);
    socketService.emit('whatsapp_message', event);
    res.json({ status: 'received' });
});

// 2. PROTECTED ROUTES (Client API)
// All routes defined below this line require Dolibarr Authentication
router.use(requireDolibarrLogin);

// Helper to extract session ID
const getSessionId = (req: any) => {
    return req.params.sessionId || req.query.sessionId || req.body.sessionId || DEFAULT_SESSION;
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

// Check if number is registered on WhatsApp
router.get('/check-number/:number', async (req, res) => {
    const sessionId = getSessionId(req);
    const { number } = req.params;
    try {
        const client = sessionService.getClient(sessionId);
        if (!client) {
            return res.status(400).json({ error: 'Session not found or not connected' });
        }
        const formattedId = number.includes('@') ? number : `${number}@c.us`;
        const isRegistered = await client.isRegisteredUser(formattedId);
        res.json({ number, isRegistered, chatId: formattedId });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
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

// Send Message
router.post('/send', async (req, res) => {
    try {
        const { chatId, text, sessionId } = z.object({
            chatId: z.string().min(1),
            text: z.string().min(1),
            sessionId: z.string().optional()
        }).parse(req.body);

        log.info('Sending WhatsApp message', { chatId, sessionId });

        const targetSession = sessionId || getSessionId(req);
        const currentUser = (req as any).user;

        // [ANTIGRAVITY] Business Logic: Append Signature
        let finalText = text;
        if (currentUser) {
            finalText = storeService.formatMessageWithSignature(text, currentUser);
        }

        // Use channelRouter for unified message sending (supports Moltbot or legacy)
        const result = await channelRouter.sendWhatsApp(chatId, finalText, targetSession);

        // [ANTIGRAVITY] Business Logic: Update Assignment (Last Responder)
        if (currentUser) {
            storeService.updateLastResponder(chatId, currentUser.id);
        }

        res.json({
            success: result.success,
            id: result.messageId,
            timestamp: result.timestamp,
            provider: result.provider,
            error: result.error
        });
    } catch (error: any) {
        log.error('Failed to send WhatsApp message', { error: error.message, stack: error.stack });
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
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
        const chats = await messageService.getChats(sessionId);

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
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

// Get Messages
router.get('/messages/:chatId', async (req, res) => {
    const sessionId = getSessionId(req);
    try {
        const { chatId } = req.params;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const messages = await messageService.getMessages(sessionId, chatId, limit);
        res.json(messages);
    } catch (error: any) {
        log.error(`Error fetching messages for ${req.params.chatId}`, error);
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
        log.error('Send Voice Error', error);
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
