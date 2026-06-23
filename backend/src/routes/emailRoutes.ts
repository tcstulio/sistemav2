import { Router } from 'express';
import { emailService } from '../services/emailService';
import { emailStoreService } from '../services/emailStoreService';
import { z } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { createLogger } from '../utils/logger';

const log = createLogger('Email');
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

        const newId = emailStoreService.addAccount({ ...data, id: '' } as any);
        res.json({ success: true, id: newId });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.put('/accounts/:id', (req, res) => {
    try {
        const { id } = req.params;
        const schema = z.object({
            name: z.string().optional(),
            email: z.string().email().optional(),
            imapHost: z.string().optional(),
            imapPort: z.number().optional(),
            imapUser: z.string().optional(),
            imapPassword: z.string().optional(),
            imapTls: z.boolean().optional(),
            smtpHost: z.string().optional(),
            smtpPort: z.number().optional(),
            smtpUser: z.string().optional(),
            smtpPassword: z.string().optional(),
            smtpSecure: z.boolean().optional(),
            signature: z.string().optional()
        });

        const data = schema.parse(req.body);
        emailStoreService.updateAccount(id, data);
        res.json({ success: true });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.delete('/accounts/:id', (req, res) => {
    const { id } = req.params;
    emailStoreService.deleteAccount(id);
    res.json({ success: true });
});

// --- Test Connection ---

router.post('/test-connection', async (req, res) => {
    try {
        const schema = z.object({
            type: z.enum(['imap', 'smtp']),
            config: z.object({
                host: z.string(),
                port: z.number(),
                user: z.string(),
                password: z.string(),
                secure: z.boolean().optional(),
                tls: z.boolean().optional()
            }),
            accountId: z.string().optional()
        });

        const { type, config, accountId } = schema.parse(req.body);

        // If password is empty and accountId provided, use saved password
        let password = config.password;
        if (!password && accountId) {
            const account = emailStoreService.getAccount(accountId);
            if (account) {
                password = type === 'imap' ? account.imapPassword : account.smtpPassword;
            }
        }

        if (type === 'imap') {
            const result = await emailService.testImapConnection({
                imapHost: config.host,
                imapPort: config.port,
                imapUser: config.user,
                imapPassword: password,
                imapTls: config.tls ?? true
            });
            res.json(result);
        } else {
            const result = await emailService.testSmtpConnection({
                smtpHost: config.host,
                smtpPort: config.port,
                smtpUser: config.user,
                smtpPassword: password,
                smtpSecure: config.secure ?? true
            });
            res.json(result);
        }
    } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// --- Templates (MUST be before /:accountId to avoid param collision) ---

router.get('/templates', (req, res) => {
    const templates = emailStoreService.getTemplates();
    res.json(templates);
});

router.post('/templates', (req, res) => {
    try {
        const schema = z.object({
            name: z.string(),
            subject: z.string(),
            body: z.string()
        });
        const data = schema.parse(req.body);
        const user = (req as any).user;
        const id = emailStoreService.addTemplate({ ...data, createdBy: user?.id || 'unknown' });
        res.json({ success: true, id });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.put('/templates/:id', (req, res) => {
    try {
        const { id } = req.params;
        const schema = z.object({
            name: z.string().optional(),
            subject: z.string().optional(),
            body: z.string().optional()
        });
        const data = schema.parse(req.body);
        emailStoreService.updateTemplate(id, data);
        res.json({ success: true });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.delete('/templates/:id', (req, res) => {
    const { id } = req.params;
    emailStoreService.deleteTemplate(id);
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
            to: z.string(),
            subject: z.string(),
            htmlBody: z.string(),
            cc: z.string().optional(),
            bcc: z.string().optional(),
            inReplyTo: z.string().optional(),
            references: z.string().optional(),
            attachments: z.array(z.object({
                filename: z.string(),
                content: z.string(),
                encoding: z.literal('base64').optional().default('base64'),
                contentType: z.string().optional()
            })).optional()
        });

        const { accountId, to, subject, htmlBody, cc, bcc, attachments } = schema.parse(req.body);

        const info = await emailService.sendEmail(accountId, to, subject, htmlBody, attachments, cc, bcc);
        res.json(info);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Unread Count ---

router.get('/:accountId/unread-count', async (req, res) => {
    const { accountId } = req.params;
    const folder = req.query.folder as string || 'INBOX';

    try {
        const count = await emailService.getUnreadCount(accountId, folder);
        res.json({ count });
    } catch (error: any) {
        // Conta inexistente é erro do cliente (accountId inválido / nenhuma conta configurada),
        // não falha do servidor: degrada para 404 em vez de 500 (endpoint é polled pelo badge).
        if (error?.message === 'Account not found') {
            return res.status(404).json({ error: 'Account not found' });
        }
        res.status(500).json({ error: error.message });
    }
});

// --- Search ---

router.get('/:accountId/search', async (req, res) => {
    const { accountId } = req.params;
    const q = req.query.q as string;
    const folder = req.query.folder as string || 'INBOX';
    const searchIn = req.query.searchIn as string || 'all';
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

    if (!q) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    try {
        const results = await emailService.searchMessages(accountId, folder, q, searchIn, limit);
        res.json(results);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Flags (Bulk Actions) ---

router.post('/:accountId/flags', async (req, res) => {
    const { accountId } = req.params;
    try {
        const schema = z.object({
            folder: z.string(),
            uids: z.array(z.number()),
            action: z.enum(['addFlags', 'delFlags']),
            flags: z.array(z.string())
        });

        const { folder, uids, action, flags } = schema.parse(req.body);

        if (action === 'addFlags') {
            await emailService.addFlags(accountId, folder, uids, flags);
        } else {
            await emailService.delFlags(accountId, folder, uids, flags);
        }

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Delete Messages ---

router.post('/:accountId/delete', async (req, res) => {
    const { accountId } = req.params;
    try {
        const schema = z.object({
            folder: z.string(),
            uids: z.array(z.number())
        });

        const { folder, uids } = schema.parse(req.body);
        await emailService.deleteMessages(accountId, folder, uids);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Move Messages ---

router.post('/:accountId/move', async (req, res) => {
    const { accountId } = req.params;
    try {
        const schema = z.object({
            sourceFolder: z.string(),
            uids: z.array(z.number()),
            destinationFolder: z.string()
        });

        const { sourceFolder, uids, destinationFolder } = schema.parse(req.body);
        await emailService.moveMessages(accountId, sourceFolder, uids, destinationFolder);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Metadata & Automations ---

// Assign Thread
router.post('/assign', (req, res) => {
    try {
        const schema = z.object({
            threadId: z.string(),
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

// Update Thread Settings
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

// Update User Settings
router.post('/settings/user', (req, res) => {
    try {
        const user = (req as any).user;
        if (!user) return res.status(401).json({ error: 'User not found' });

        const schema = z.object({
            signature: z.string().optional(),
            pollInterval: z.number().optional()
        });
        const data = schema.parse(req.body);

        emailStoreService.updateUserSettings(user.id, data);
        res.json({ success: true });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Get User Store
router.get('/store', (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'User not found' });

    const settings = emailStoreService.getUserSettings(user.id);
    res.json({ userSettings: settings });
});

export default router;
