import { Router } from 'express';
import { emailService } from '../services/emailService';
import { emailStoreService } from '../services/emailStoreService';
import { z } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';

const router = Router();

// Protect all routes
router.use(requireDolibarrLogin);

// --- Accounts ---

router.get('/accounts', (req, res) => {
    const accounts = emailStoreService.getAllAccounts();
    // Return without passwords
    const safeAccounts = accounts.map(a => {
        const { imapPassword, smtpPassword, ...safe } = a;
        return safe;
    });
    res.json(safeAccounts);
});

router.post('/accounts', (req, res) => {
    try {
        const schema = z.object({
            name: z.string(),
            email: z.string().email(),
            imapHost: z.string(),
            imapPort: z.number(),
            imapUser: z.string(),
            imapPassword: z.string(),
            imapTls: z.boolean(),
            smtpHost: z.string(),
            smtpPort: z.number(),
            smtpUser: z.string(),
            smtpPassword: z.string(),
            smtpSecure: z.boolean(),
            signature: z.string().optional()
        });

        const data = schema.parse(req.body);

        // ID generation moved to service
        const newId = emailStoreService.addAccount({ ...data, id: '' } as any); // Service generates ID
        res.json({ success: true, id: newId });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.delete('/accounts/:id', (req, res) => {
    const { id } = req.params;
    emailStoreService.deleteAccount(id);
    res.json({ success: true });
});

// --- Operations ---

router.get('/:accountId/folders', async (req, res) => {
    const { accountId } = req.params;
    try {
        const boxes = await emailService.getFolders(accountId);
        res.json(boxes);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:accountId/messages', async (req, res) => {
    const { accountId } = req.params;
    const folder = req.query.folder as string || 'INBOX';
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

    try {
        const messages = await emailService.getMessages(accountId, folder, limit);
        res.json(messages);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:accountId/messages/:uid/body', async (req, res) => {
    const { accountId, uid } = req.params;
    const folder = req.query.folder as string || 'INBOX';

    try {
        const body = await emailService.getMessageBody(accountId, folder, parseInt(uid));
        res.json(body);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/send', async (req, res) => {
    try {
        const schema = z.object({
            accountId: z.string(),
            to: z.string().email(),
            subject: z.string(),
            htmlBody: z.string(),
            attachments: z.array(z.object({
                filename: z.string(),
                content: z.string(), // Base64
                encoding: z.literal('base64').optional().default('base64'),
                contentType: z.string().optional()
            })).optional()
        });

        const { accountId, to, subject, htmlBody, attachments } = schema.parse(req.body);

        const info = await emailService.sendEmail(accountId, to, subject, htmlBody, attachments);
        res.json(info);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Metadata & Automations ---

// Assign Thread
router.post('/assign', (req, res) => {
    try {
        const schema = z.object({
            threadId: z.string(), // MessageID or a hash representing the thread
            userId: z.string().nullable()
        });
        const { threadId, userId } = schema.parse(req.body);

        emailStoreService.assignThread(threadId, userId);
        res.json({ success: true });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Get Assignment
router.get('/assign/:threadId', (req, res) => {
    const { threadId } = req.params;
    const userId = emailStoreService.getAssignment(threadId);
    res.json({ userId: userId || null });
});

// Update Thread Settings (Auto-Reply, etc)
router.post('/settings/thread', (req, res) => {
    try {
        const schema = z.object({
            threadId: z.string(),
            settings: z.any()
        });
        const { threadId, settings } = schema.parse(req.body);

        emailStoreService.updateThreadSettings(threadId, settings);
        res.json({ success: true });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Get Thread Settings
router.get('/settings/thread/:threadId', (req, res) => {
    const { threadId } = req.params;
    const settings = emailStoreService.getThreadSettings(threadId);
    res.json(settings);
});

// Update User Settings (Signature)
router.post('/settings/user', (req, res) => {
    try {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ error: 'User not found' });

        const schema = z.object({
            signature: z.string().optional()
        });
        const { signature } = schema.parse(req.body);

        emailStoreService.updateUserSettings(user.id, { signature });
        res.json({ success: true });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Get User Store (Settings)
router.get('/store', (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'User not found' });

    const settings = emailStoreService.getUserSettings(user.id);
    res.json({ userSettings: settings });
});

export default router;
