import { Router } from 'express';
import { sessionService } from '../services/sessionService';
import { messageService } from '../services/messageService';
import { storeService } from '../services/storeService';
import { socketService } from '../services/socketService'; // Webhook needs this
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { z } from 'zod';

const router = Router();
const DEFAULT_SESSION = 'default';

// 1. PUBLIC ROUTES (Webhooks)
// Webhook Receiver (Legacy / External) - Must be before Auth Middleware
router.post('/webhook', (req, res) => {
    const event = req.body;
    console.log('Webhook received:', JSON.stringify(event, null, 2));
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
    try {
        const result = await sessionService.startSession(sessionId);
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

        const targetSession = sessionId || getSessionId(req);
        const currentUser = (req as any).user;

        // [ANTIGRAVITY] Business Logic: Append Signature
        let finalText = text;
        if (currentUser) {
            finalText = storeService.formatMessageWithSignature(text, currentUser);
        }

        const result = await messageService.sendText(targetSession, chatId, finalText);

        // [ANTIGRAVITY] Business Logic: Update Assignment (Last Responder)
        if (currentUser) {
            storeService.updateLastResponder(chatId, currentUser.id);
        }

        res.json(result);
    } catch (error: any) {
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
        console.error(`[WhatsApp Route] Error fetching messages for ${req.params.chatId}:`, error);
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
        const result = await messageService.sendFile(targetSession, chatId, fileData, filename, caption);
        res.json(result);
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
        const result = await messageService.sendVoice(targetSession, chatId, fileData);
        res.json(result);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        console.error("Send Voice Error:", error);
        res.status(500).json({ error: error.message || 'Failed to send voice' });
    }
});

// Send Voice NATIVE (Test)
router.post('/send-voice-native', async (req, res) => {
    try {
        const { chatId, fileData, sessionId } = z.object({
            chatId: z.string().min(1),
            fileData: z.string().min(1),
            sessionId: z.string().optional()
        }).parse(req.body);

        const targetSession = sessionId || getSessionId(req);
        // Uses the same service method, as it now encapsulates native logic
        const result = await messageService.sendVoice(targetSession, chatId, fileData);
        res.json(result);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message || 'Failed to send voice native' });
    }
});

export default router;
