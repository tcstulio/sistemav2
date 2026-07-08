import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { notificationService } from '../services/notificationService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { userPermissionsService } from '../services/userPermissionsService';
import { uiConfigService } from '../services/uiConfigService';
import { externalChannelsOf, getWhatsappAllowlist, whatsappDestinationAllowed } from '../utils/actionGuards';
import { createLogger } from '../utils/logger';

const log = createLogger('NotificationRoutes');
const router = Router();

// Rate-limit anti-abuso do disparo MANUAL de notificações (defense-in-depth da rota órfã).
const sendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { error: 'Muitos envios em pouco tempo. Aguarde um instante.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.use(requireDolibarrLogin);

router.get('/', (req, res) => {
    try {
        const userId = (req as any).user?.id || (req as any).user?.login;
        const limit = Math.min(Number(req.query.limit) || 50, 100);
        const offset = Number(req.query.offset) || 0;
        const notifications = notificationService.getForUser(userId, limit, offset);
        const unreadCount = notificationService.getUnreadCount(userId);
        // Deriva scope: 'personal' quando recipient === userId logado; 'system' nos demais.
        // Retrocompatível: campos anteriores não são removidos.
        const notificationsWithScope = notifications.map(n => ({
            ...n,
            scope: (n.recipient && n.recipient === userId) ? 'personal' : 'system' as 'personal' | 'system',
        }));
        res.json({ notifications: notificationsWithScope, unreadCount });
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
        const userId = (req as any).user?.id || (req as any).user?.login;
        const ok = notificationService.markAsRead(req.params.id, userId);
        if (!ok) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/read-all', (req, res) => {
    try {
        const userId = (req as any).user?.id || (req as any).user?.login;
        const count = notificationService.markAllAsRead(userId);
        res.json({ success: true, count });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Limpar TODAS as notificações pessoais do usuário (corrige o "Limpar" que era no-op).
router.delete('/', (req, res) => {
    try {
        const userId = (req as any).user?.id || (req as any).user?.login;
        const count = notificationService.deleteAllForUser(userId);
        res.json({ success: true, count });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const userId = (req as any).user?.id || (req as any).user?.login;
        const ok = notificationService.delete(req.params.id, userId);
        if (!ok) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/send', sendLimiter, async (req, res) => {
    try {
        const user = (req as any).user || {};
        const userId = user.id || user.login;
        const userName = [(user.firstname || ''), (user.lastname || '')].join(' ').trim() || user.login;

        const { event, title, message, channels, priority, recipientName, recipientPhone, recipientEmail, entityType, entityId } = req.body;

        if (!title || !message) return res.status(400).json({ error: 'title and message required' });

        // GOVERNANÇA A1 (docs/PLANO_GOVERNANCA_ACAO.md): este é o único disparo MANUAL de notificação e
        // furava a trava de canais externos (lida só no taskNotificationService). Canais externos
        // (WhatsApp/e-mail) passam a exigir: (1) trava global ligada; (2) permissão do chamador — admin
        // já a tem no profile, então não há bypass da trava; (3) destino na allowlist quando o admin a
        // configurar (#1200; allowlist vazia = permite tudo → nenhuma mudança de comportamento hoje).
        // Canal in-app segue livre (reversível/benigno).
        const external = externalChannelsOf(channels);
        if (external.length > 0) {
            const cfg = uiConfigService.get();
            if (!cfg.taskNotificationsExternalEnabled) {
                return res.status(403).json({ error: 'Canais externos (WhatsApp/e-mail) estão desativados nas configurações.' });
            }
            const profile = await userPermissionsService.getProfile(String(userId));
            const agent = profile?.agent || ({} as any);
            if (external.includes('whatsapp') && !agent.canSendWhatsapp) {
                return res.status(403).json({ error: 'Sem permissão para enviar WhatsApp.' });
            }
            if (external.includes('email') && !agent.canSendEmail) {
                return res.status(403).json({ error: 'Sem permissão para enviar e-mail.' });
            }
            if (external.includes('whatsapp') && !whatsappDestinationAllowed(recipientPhone, getWhatsappAllowlist(cfg))) {
                return res.status(403).json({ error: `Destino de WhatsApp ${recipientPhone} não está na allowlist configurada pelo admin.` });
            }
        }

        const safeTitle = String(title).slice(0, 255);
        const safeMessage = String(message).slice(0, 1000);

        const notification = await notificationService.create({
            event: event || 'custom',
            title: safeTitle,
            message: safeMessage,
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

// Trigger backend reload

// Trigger backend reload 2

// Trigger backend reload 3
