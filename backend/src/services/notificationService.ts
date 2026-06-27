import { createLogger } from '../utils/logger';
import { socketService } from './socketService';
import { channelRouter } from './channelRouter';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const log = createLogger('Notification');

export type NotificationChannel = 'in-app' | 'whatsapp' | 'email';
export type NotificationPriority = 'low' | 'medium' | 'high';
export type NotificationEvent =
    | 'invoice.created' | 'invoice.overdue' | 'invoice.paid'
    | 'order.validated' | 'order.created'
    | 'proposal.sent' | 'proposal.accepted'
    | 'ticket.created' | 'ticket.assigned'
    | 'task.assigned' | 'task.acceptance_pending' | 'task.acceptance_overdue' | 'task.deadline_reminder' | 'task.overdue' | 'task.stalled' | 'task.completed' | 'task.comment'
    | 'agent.action'
    | 'stock.low'
    | 'payment.received'
    | 'custom';

export interface Notification {
    id: string;
    event: NotificationEvent;
    title: string;
    message: string;
    channels: NotificationChannel[];
    priority: NotificationPriority;
    recipient?: string;
    recipientName?: string;
    recipientPhone?: string;
    recipientEmail?: string;
    senderId?: string;
    senderName?: string;
    entityType?: string;
    entityId?: string;
    linkTo?: string;
    read: boolean;
    readBy?: string[];
    deletedBy?: string[];
    createdAt: number;
    deliveredTo: NotificationChannel[];
    failedChannels: string[];
}

interface NotificationStore {
    notifications: Notification[];
}

const STORE_PATH = path.join(__dirname, '../../data/notifications.json');
const MAX_NOTIFICATIONS = 1000;

class NotificationService {

    private static readonly ENTITY_ROUTE_MAP: Record<string, string> = {
        invoice: 'invoices',
        order: 'orders',
        proposal: 'proposals',
        ticket: 'tickets',
        product: 'products',
        task: 'tasks',
        'opencode-task': 'tasks',
        project: 'projects',
        supplier_order: 'suppliers',
        supplier_invoice: 'supplier_invoices',
        expense_report: 'expense_report_payments',
        contract: 'contracts',
        shipment: 'shipments',
        intervention: 'interventions',
    };

    private resolveLinkTo(params: { linkTo?: string; entityType?: string; entityId?: string }): string | undefined {
        if (params.linkTo) return params.linkTo;
        if (!params.entityType) return undefined;
        const route = NotificationService.ENTITY_ROUTE_MAP[params.entityType];
        if (!route) return undefined;
        if (!params.entityId) return route;
        const ids = params.entityId.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length === 1) return `${route}/${ids[0]}`;
        return route;
    }
    private data: NotificationStore;

    constructor() {
        this.data = { notifications: [] };
        this.load();
    }

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(STORE_PATH)) {
                const content = fs.readFileSync(STORE_PATH, 'utf-8');
                this.data = JSON.parse(content);
            }
            log.info(`Loaded ${this.data.notifications.length} notifications`);
        } catch (e) {
            log.error('Load error', e);
        }
    }

    private saveTimeout: NodeJS.Timeout | null = null;
    
    private async performSave() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            
            // Expurgo por tempo (30 dias) em vez de limite estrito de quantidade
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            this.data.notifications = this.data.notifications.filter(n => n.createdAt > thirtyDaysAgo);

            // Escrita atômica assíncrona
            const tmpPath = STORE_PATH + '.tmp';
            await fs.promises.writeFile(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
            await fs.promises.rename(tmpPath, STORE_PATH);
        } catch (e) {
            log.error('Save error', e);
        }
    }

    private save() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            this.performSave().catch(e => log.error('performSave async error', e));
        }, 1000); // 1s debounce
    }

    async create(params: {
        event: NotificationEvent;
        title: string;
        message: string;
        channels?: NotificationChannel[];
        priority?: NotificationPriority;
        recipient?: string;
        recipientName?: string;
        recipientPhone?: string;
        recipientEmail?: string;
        senderId?: string;
        senderName?: string;
        entityType?: string;
        entityId?: string;
        linkTo?: string;
    }): Promise<Notification> {
        const channels = params.channels || ['in-app'];
        const notification: Notification = {
            id: `notif_${crypto.randomUUID()}`,
            event: params.event,
            title: params.title,
            message: params.message,
            channels,
            priority: params.priority || 'medium',
            recipient: params.recipient,
            recipientName: params.recipientName,
            recipientPhone: params.recipientPhone,
            recipientEmail: params.recipientEmail,
            senderId: params.senderId,
            senderName: params.senderName,
            entityType: params.entityType,
            entityId: params.entityId,
            linkTo: this.resolveLinkTo(params),
            read: false,
            createdAt: Date.now(),
            deliveredTo: [],
            failedChannels: [],
        };

        this.data.notifications.unshift(notification);
        this.save();

        for (const channel of channels) {
            try {
                await this.deliver(notification, channel);
                notification.deliveredTo.push(channel);
            } catch (e: any) {
                log.error(`Failed to deliver via ${channel}: ${e.message}`);
                notification.failedChannels.push(channel);
            }
        }

        this.save();
        log.info(`Notification created: [${notification.event}] ${notification.title} → ${channels.join(',')}`);
        return notification;
    }

    private async deliver(notification: Notification, channel: NotificationChannel): Promise<void> {
        switch (channel) {
            case 'in-app':
                this.deliverInApp(notification);
                break;
            case 'whatsapp':
                await this.deliverWhatsApp(notification);
                break;
            case 'email':
                await this.deliverEmail(notification);
                break;
        }
    }

    private deliverInApp(notification: Notification) {
        socketService.emit('notification', {
            id: notification.id,
            type: notification.event,
            title: notification.title,
            message: notification.message,
            priority: notification.priority,
            linkTo: notification.linkTo,
            senderName: notification.senderName,
            createdAt: notification.createdAt,
        });
    }

    private async deliverWhatsApp(notification: Notification): Promise<void> {
        const phone = notification.recipientPhone;
        if (!phone) {
            throw new Error('No phone number for WhatsApp delivery');
        }
        const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        await channelRouter.sendWhatsApp(chatId, notification.message);
    }

    private async deliverEmail(notification: Notification): Promise<void> {
        const email = notification.recipientEmail;
        if (!email) {
            throw new Error('No email for email delivery');
        }
        await channelRouter.sendEmail(
            email,
            notification.title,
            notification.message
        );
    }

    async notifyTeam(params: {
        event: NotificationEvent;
        title: string;
        message: string;
        priority?: NotificationPriority;
        senderName?: string;
        entityType?: string;
        entityId?: string;
        linkTo?: string;
    }): Promise<Notification> {
        return this.create({
            ...params,
            channels: ['in-app'],
        });
    }

    async notifyPerson(params: {
        event: NotificationEvent;
        title: string;
        message: string;
        channels: NotificationChannel[];
        recipientName?: string;
        recipientPhone?: string;
        recipientEmail?: string;
        senderName?: string;
        entityType?: string;
        entityId?: string;
    }): Promise<Notification> {
        return this.create(params);
    }

    /** A notificação é visível para este usuário? (regra única reusada na listagem e no isolamento) */
    private isVisibleTo(n: Notification, userId?: string): boolean {
        if (!userId) return true;
        if (n.deletedBy && n.deletedBy.includes(userId)) return false;
        return (
            !n.recipient ||
            n.recipient === userId ||
            n.recipient === 'team' ||
            n.recipient === 'all' ||
            n.event === 'agent.action' ||
            n.event === 'stock.low' ||
            n.event === 'custom'
        );
    }

    getForUser(userId: string, limit?: number, offset?: number): Notification[] {
        const result = this.data.notifications.filter(n => this.isVisibleTo(n, userId));
        const start = offset || 0;
        const end = start + (limit || 50);
        
        // Retorna com a flag `read` computada para o usuário logado
        return result.slice(start, end).map(n => ({
            ...n,
            read: n.recipient === userId ? n.read : (n.readBy ? n.readBy.includes(userId) : n.read)
        }));
    }

    /** TODAS as notificações (admin) — sem filtro de visibilidade. Usado pela Central de Eventos. (#519) */
    getAll(limit?: number, offset?: number): Notification[] {
        const start = offset || 0;
        const end = start + (limit || 50);
        return this.data.notifications.slice(start, end);
    }

    getById(id: string): Notification | undefined {
        return this.data.notifications.find(n => n.id === id);
    }

    /** Marca como lida. Se userId for dado, só age se a notificação for visível a ele (isolamento). */
    markAsRead(id: string, userId?: string): boolean {
        const notif = this.data.notifications.find(n => n.id === id);
        if (notif && this.isVisibleTo(notif, userId)) {
            if (notif.recipient === userId || !userId) {
                notif.read = true;
            } else {
                if (!notif.readBy) notif.readBy = [];
                if (!notif.readBy.includes(userId)) notif.readBy.push(userId);
            }
            this.save();
            return true;
        }
        return false;
    }

    /** Marca todas como lidas. Com userId, só as visíveis a ele (não toca as dos outros). */
    markAllAsRead(userId?: string): number {
        let count = 0;
        for (const n of this.data.notifications) {
            if (this.isVisibleTo(n, userId)) {
                if (n.recipient === userId && !n.read) {
                    n.read = true;
                    count++;
                } else if (userId && (!n.readBy || !n.readBy.includes(userId))) {
                    if (!n.readBy) n.readBy = [];
                    n.readBy.push(userId);
                    count++;
                }
            }
        }
        if (count > 0) this.save();
        return count;
    }

    /** Apaga uma notificação. Com userId, só se for visível a ele. */
    delete(id: string, userId?: string): boolean {
        const idx = this.data.notifications.findIndex(n => n.id === id);
        if (idx >= 0 && this.isVisibleTo(this.data.notifications[idx], userId)) {
            const notif = this.data.notifications[idx];
            if (notif.recipient === userId || !userId) {
                this.data.notifications.splice(idx, 1);
            } else {
                if (!notif.deletedBy) notif.deletedBy = [];
                if (!notif.deletedBy.includes(userId)) notif.deletedBy.push(userId);
            }
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Apaga as notificações pessoais e marca as compartilhadas como deletadas pelo usuário.
     */
    deleteAllForUser(userId: string): number {
        let removed = 0;
        this.data.notifications = this.data.notifications.filter(n => {
            if (!this.isVisibleTo(n, userId)) return true;
            if (n.recipient === userId) {
                removed++;
                return false;
            } else {
                if (!n.deletedBy) n.deletedBy = [];
                if (!n.deletedBy.includes(userId)) {
                    n.deletedBy.push(userId);
                    removed++;
                }
                return true;
            }
        });
        if (removed > 0) this.save();
        return removed;
    }

    getUnreadCount(userId?: string): number {
        return this.data.notifications.filter(n => {
            if (!this.isVisibleTo(n, userId)) return false;
            if (n.recipient === userId) return !n.read;
            if (userId && n.readBy) return !n.readBy.includes(userId);
            return !n.read;
        }).length;
    }

    getStats() {
        const total = this.data.notifications.length;
        const unread = this.data.notifications.filter(n => !n.read).length;
        const byEvent: Record<string, number> = {};
        for (const n of this.data.notifications) {
            byEvent[n.event] = (byEvent[n.event] || 0) + 1;
        }
        return { total, unread, byEvent };
    }
}

export const notificationService = new NotificationService();
