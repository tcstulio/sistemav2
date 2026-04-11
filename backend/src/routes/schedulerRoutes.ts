import { Router, Request, Response } from 'express';
import { schedulerService } from '../services/schedulerService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { createLogger } from '../utils/logger';

const log = createLogger('Scheduler');
const router = Router();

// Protect all scheduler routes
router.use(requireDolibarrLogin);

// --- Schedule a single message ---

router.post('/schedule', async (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, scheduledAt, type, metadata, channel, subject } = req.body;

        if (!chatId || !sessionId || !message) {
            return res.status(400).json({ error: 'Missing required fields: chatId, sessionId, message' });
        }

        // Parse scheduledAt (can be ISO string, timestamp, or relative like "+5m", "+1h")
        let scheduleTime: number;
        if (typeof scheduledAt === 'string' && scheduledAt.startsWith('+')) {
            // Relative time: +5m, +1h, +2d
            const match = scheduledAt.match(/^\+(\d+)([mhd])$/);
            if (!match) {
                return res.status(400).json({ error: 'Invalid relative time format. Use +5m, +1h, +2d' });
            }
            const [, num, unit] = match;
            let ms = parseInt(num);
            if (unit === 'h') ms *= 60;
            if (unit === 'd') ms *= 60 * 24;
            ms *= 60 * 1000;
            scheduleTime = Date.now() + ms;
        } else if (typeof scheduledAt === 'string') {
            scheduleTime = new Date(scheduledAt).getTime();
        } else if (typeof scheduledAt === 'number') {
            scheduleTime = scheduledAt;
        } else {
            scheduleTime = Date.now(); // Send immediately
        }

        const msg = schedulerService.scheduleMessage({
            chatId,
            sessionId,
            channel,
            subject,
            message,
            scheduledAt: scheduleTime,
            type: type || 'once',
            metadata
        });

        res.json({
            success: true,
            data: msg,
            scheduledFor: new Date(scheduleTime).toISOString()
        });

    } catch (error: any) {
        log.error('Schedule error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message });
    }
});

// --- Schedule broadcast to multiple contacts ---

router.post('/broadcast', async (req: Request, res: Response) => {
    try {
        const { sessionId, chatIds, message, scheduledAt, delayBetween, channel, subject } = req.body;

        if (!sessionId || !chatIds || !Array.isArray(chatIds) || chatIds.length === 0 || !message) {
            return res.status(400).json({ error: 'Missing required fields: sessionId, chatIds (array), message' });
        }

        let scheduleTime: number | undefined;
        if (scheduledAt) {
            scheduleTime = typeof scheduledAt === 'string' ? new Date(scheduledAt).getTime() : scheduledAt;
        }

        const messages = await schedulerService.scheduleBroadcast({
            sessionId,
            chatIds,
            channel,
            subject,
            message,
            scheduledAt: scheduleTime,
            delayBetween: delayBetween || 3000
        });

        res.json({
            success: true,
            count: messages.length,
            broadcastId: messages[0]?.metadata?.broadcastId,
            data: messages
        });

    } catch (error: any) {
        log.error('Broadcast error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message });
    }
});

// --- Schedule confirmation request ---

router.post('/confirmation', async (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, timeoutMinutes, onConfirm, onReject } = req.body;

        if (!chatId || !sessionId || !message) {
            return res.status(400).json({ error: 'Missing required fields: chatId, sessionId, message' });
        }

        const msg = schedulerService.scheduleConfirmation({
            chatId,
            sessionId,
            message,
            timeoutMinutes: timeoutMinutes || 60,
            onConfirm,
            onReject
        });

        res.json({
            success: true,
            data: msg,
            expiresAt: new Date(Date.now() + (timeoutMinutes || 60) * 60 * 1000).toISOString()
        });

    } catch (error: any) {
        log.error('Confirmation error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message });
    }
});

// --- Schedule recurring reminder ---

router.post('/reminder', async (req: Request, res: Response) => {
    try {
        const { chatId, sessionId, message, firstSendAt, interval, unit } = req.body;

        if (!chatId || !sessionId || !message || !interval || !unit) {
            return res.status(400).json({
                error: 'Missing required fields: chatId, sessionId, message, interval, unit (minutes|hours|days)'
            });
        }

        if (!['minutes', 'hours', 'days'].includes(unit)) {
            return res.status(400).json({ error: 'Invalid unit. Use: minutes, hours, or days' });
        }

        let scheduleTime = Date.now();
        if (firstSendAt) {
            scheduleTime = typeof firstSendAt === 'string' ? new Date(firstSendAt).getTime() : firstSendAt;
        }

        const msg = schedulerService.scheduleReminder({
            chatId,
            sessionId,
            message,
            firstSendAt: scheduleTime,
            recurrence: { interval, unit }
        });

        res.json({
            success: true,
            data: msg,
            recurrence: { interval, unit }
        });

    } catch (error: any) {
        log.error('Reminder error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message });
    }
});

// --- Get pending messages ---

router.get('/pending', (req: Request, res: Response) => {
    try {
        const sessionId = req.query.sessionId as string;
        const pending = schedulerService.getPending(sessionId);

        res.json({
            count: pending.length,
            data: pending
        });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Get message history ---

router.get('/history', (req: Request, res: Response) => {
    try {
        const { sessionId, status, limit } = req.query;

        const history = schedulerService.getHistory({
            sessionId: sessionId as string,
            status: status as any,
            limit: limit ? parseInt(limit as string) : 50
        });

        res.json({
            count: history.length,
            data: history
        });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Cancel a scheduled message ---

router.delete('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const success = schedulerService.cancelMessage(id);

        if (success) {
            res.json({ success: true, message: `Message ${id} cancelled` });
        } else {
            res.status(404).json({ error: 'Message not found or already processed' });
        }

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Get stats ---

router.get('/stats', (req: Request, res: Response) => {
    try {
        const stats = schedulerService.getStats();
        res.json(stats);

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Templates ---

router.post('/templates', (req: Request, res: Response) => {
    try {
        const { name, content, category, channel, subject } = req.body;

        if (!name || !content) {
            return res.status(400).json({ error: 'Missing required fields: name, content' });
        }

        const template = schedulerService.createTemplate({ name, content, category, channel, subject });
        res.json({ success: true, data: template });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/templates', (req: Request, res: Response) => {
    try {
        const templates = schedulerService.getTemplates();
        res.json({ count: templates.length, data: templates });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/templates/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const success = schedulerService.deleteTemplate(id);

        if (success) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Template not found' });
        }

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Send using template ---

router.post('/send-template', async (req: Request, res: Response) => {
    try {
        const { templateId, chatId, sessionId, variables, scheduledAt } = req.body;

        if (!templateId || !chatId || !sessionId) {
            return res.status(400).json({ error: 'Missing required fields: templateId, chatId, sessionId' });
        }

        const message = schedulerService.renderTemplate(templateId, variables || {});
        if (!message) {
            return res.status(404).json({ error: 'Template not found' });
        }

        let scheduleTime = Date.now();
        if (scheduledAt) {
            scheduleTime = typeof scheduledAt === 'string' ? new Date(scheduledAt).getTime() : scheduledAt;
        }

        const msg = schedulerService.scheduleMessage({
            chatId,
            sessionId,
            message,
            scheduledAt: scheduleTime,
            metadata: { templateId, variables }
        });

        res.json({ success: true, data: msg });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- Import CSV for Broadcast ---

router.post('/import-csv', async (req: Request, res: Response) => {
    try {
        const { csvContent, sessionId, message, scheduledAt, delayBetween } = req.body;

        if (!csvContent || !sessionId || !message) {
            return res.status(400).json({
                error: 'Missing required fields: csvContent (string with CSV data), sessionId, message'
            });
        }

        // Parse CSV to extract phone numbers
        const chatIds = schedulerService.parseCSVContacts(csvContent);

        if (chatIds.length === 0) {
            return res.status(400).json({ error: 'No valid phone numbers found in CSV' });
        }

        // Create broadcast
        let scheduleTime: number | undefined;
        if (scheduledAt) {
            scheduleTime = typeof scheduledAt === 'string' ? new Date(scheduledAt).getTime() : scheduledAt;
        }

        const messages = await schedulerService.scheduleBroadcast({
            sessionId,
            chatIds,
            message,
            scheduledAt: scheduleTime,
            delayBetween: delayBetween || 3000
        });

        res.json({
            success: true,
            contactsFound: chatIds.length,
            broadcastId: messages[0]?.metadata?.broadcastId,
            count: messages.length
        });

    } catch (error: any) {
        log.error('CSV Import error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message });
    }
});

// --- Broadcasts ---

router.get('/broadcasts', (req: Request, res: Response) => {
    try {
        const broadcasts = schedulerService.getBroadcasts();
        res.json({ count: broadcasts.length, data: broadcasts });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/broadcasts/:id', (req: Request, res: Response) => {
    try {
        const details = schedulerService.getBroadcastDetails(req.params.id);
        if (details) {
            res.json(details);
        } else {
            res.status(404).json({ error: 'Broadcast not found' });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

