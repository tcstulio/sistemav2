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
            htmlBody: z.string()
        });

        const { accountId, to, subject, htmlBody } = schema.parse(req.body);

        const info = await emailService.sendEmail(accountId, to, subject, htmlBody);
        res.json(info);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
