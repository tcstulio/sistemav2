import { Router } from 'express';
import { notificationService } from '../services/notificationService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { createLogger } from '../utils/logger';

const log = createLogger('NotificationRoutes');
const router = Router();

router.use(requireDolibarrLogin);

router.get('/', (req, res) => {
    try {
        const userId = (req as any).user?.id || (req as any).user?.login;
        const limit = Number(req.query.limit) || 50;
        const offset = Number(req.query.offset) || 0;
        const notifications = notificationService.getForUser(userId, limit, offset);
        const unreadCount = notificationService.getUnreadCount();
        res.json({ notifications, unreadCount });
    } catch (e: any) {
        log.error('GET /notifications error', e.message);
        res.status(500).json({ error: e.message });
    }
});

router.get('/stats', (_req, res) => {
    try {
        const stats = notificationService.getStats();
        res.json(stats);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/:id/read', (req, res) => {
    try {
        const ok = notificationService.markAsRead(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/read-all', (_req, res) => {
    try {
        const count = notificationService.markAllAsRead();
        res.json({ success: true, count });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const ok = notificationService.delete(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/send', async (req, res) => {
    try {
        const userId = (req as any).user?.id || (req as any).user?.login;
        const userName = [((req as any).user?.firstname || ''), ((req as any).user?.lastname || '')].join(' ').trim() || (req as any).user?.login;

        const { event, title, message, channels, priority, recipientName, recipientPhone, recipientEmail, entityType, entityId } = req.body;

        if (!title || !message) return res.status(400).json({ error: 'title and message required' });

        const notification = await notificationService.create({
            event: event || 'custom',
            title,
            message,
            channels: channels || ['in-app'],
            priority: priority || 'medium',
            recipientName,
            recipientPhone,
            recipientEmail,
            senderId: userId,
            senderName: userName,
            entityType,
            entityId,
        });

        res.json({ success: true, notification });
    } catch (e: any) {
        log.error('POST /notifications/send error', e.message);
        res.status(500).json({ error: e.message });
    }
});

export default router;
