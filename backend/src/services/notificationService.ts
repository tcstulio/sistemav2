import { createLogger } from '../utils/logger';
import { socketService } from './socketService';
import { channelRouter } from './channelRouter';
import { uiConfigService } from './uiConfigService';
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
    | 'security' | 'otp'
    | 'stock.low'
    | 'payment.received'
    | 'custom';

/**
 * #1407 — Eventos críticos que FURAM o gate de quietHours por design. Senhas, OTPs e
 * ações do agente (que podem precisar de confirmação imediata do usuário) não podem
 * ser adiadas para o fim da janela silenciada. Para que um evento novo entre neste
 * conjunto, basta adicioná-lo aqui — o caller continua usando `notificationService.
 * create()` normalmente; o gate central detecta e despacha na hora.
 */
export const CRITICAL_EVENTS: ReadonlySet<NotificationEvent> = new Set<NotificationEvent>([
    'security',
    'otp',
    'agent.action',
]);

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

/**
 * #1407 — Item enfileirado pelo gate central de `dispatch()`. Cada (notification, channel)
 * que cair em janela silenciada vira uma entrada separada para que canais diferentes
 * possam ter regras independentes (ex.: whatsapp pode estar silenciado às 23h mas
 * email não). `scheduledFor` é o instante em que o canal PODE sair (calculado por
 * `uiConfigService.nextQuietHoursEnd`); `originalDueAt` preserva o instante em que
 * o caller chamou `create()` — útil p/ auditoria/métrica.
 */
export interface ScheduledDispatchItem {
    id: string;
    notification: Notification;
    channel: NotificationChannel;
    scheduledFor: number;   // timestamp ms em que o canal pode sair da fila
    originalDueAt: number;  // timestamp ms original em que a chamada entrou
}

const STORE_PATH = path.join(__dirname, '../../data/notifications.json');
const MAX_NOTIFICATIONS = 1000;
// #1407 — granularidade do auto-drain da fila de quietHours. 60s é suficiente para
// alertas humanos (não perdemos precisão de minuto na abertura da janela) e mantém
// o custo de timers desprezível.
const SCHEDULED_DISPATCH_TICK_MS = 60_000;
// #1407 — trava defensiva contra memory leak. Se a fila passar deste tamanho, é
// config maluca (silêncio 24h) — melhor descartar o item mais antigo do que travar
// o processo. Cada entrada é pequena (ref + canal + 2 timestamps) mas o limite é
// folgado para cobrir picos.
const SCHEDULED_DISPATCH_MAX = 5_000;

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

    /**
     * #1407 — Fila de envios adiados pelo gate de quietHours. Cada item carrega o canal
     * (whatsapp/email) que foi bloqueado e o `scheduledFor` calculado via
     * `uiConfigService.nextQuietHoursEnd()`. A fila é drenada por `tickScheduledDispatch()`
     * chamado em (a) cada `create()` lazy (no início, antes de processar a notificação
     * nova — se algo ficou pronto enquanto esperávamos, despacha antes); (b) um
     * `setInterval` de 60s quando há itens pendentes (auto-drain para janelas que
     * abrem sem nova chamada).
     */
    private scheduledDispatch: ScheduledDispatchItem[] = [];
    private scheduledDispatchTimer: NodeJS.Timeout | null = null;

    /**
     * #1407 — Tamanho atual da fila de quietHours (exposto p/ testes/diagnóstico).
     * `0` ⇒ sem diferidos pendentes; `>0` ⇒ há itens aguardando abertura de janela.
     */
    getScheduledDispatchSize(): number {
        return this.scheduledDispatch.length;
    }

    /**
     * #1407 — Inspeção da fila de quietHours p/ teste/diagnóstico. Devolve um
     * espelho raso do estado (cada item é `JSON.parse(JSON.stringify(...))` para
     * que mutações externas não afetem o estado interno).
     */
    getScheduledDispatchSnapshot(): ScheduledDispatchItem[] {
        return this.scheduledDispatch.map((it) => JSON.parse(JSON.stringify(it)));
    }

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

        // #1407 — Lazy drain da fila de quietHours: se algum item ficou pronto enquanto
        // esperávamos (ex.: criamos uma notificação nova e a janela abriu nesse meio
        // tempo), despacha antes de tentar o canal novo. `await` para que o caller
        // observe um estado de fila consistente quando `create()` resolve. O próprio
        // `tickScheduledDispatch` engole erros internos (provider lança → item vai
        // p/ failedChannels ou é re-enfileirado), então não propaga falha p/ cá.
        await this.tickScheduledDispatch();

        for (const channel of channels) {
            try {
                const status = await this.dispatch(notification, channel);
                if (status === 'delivered') {
                    if (!notification.deliveredTo.includes(channel)) {
                        notification.deliveredTo.push(channel);
                    }
                }
                // 'deferred' → canal NÃO entra em deliveredTo (só entra quando o drain
                // chamar `dispatch()` de novo e o provider aceitar).
            } catch (e: any) {
                log.error(`Failed to deliver via ${channel}: ${e.message}`);
                if (!notification.failedChannels.includes(channel)) {
                    notification.failedChannels.push(channel);
                }
            }
        }

        this.save();
        log.info(`Notification created: [${notification.event}] ${notification.title} → ${channels.join(',')} (from=${notification.senderId || 'system'}, to=${notification.recipient || 'broadcast'})`);
        return notification;
    }

    /**
     * #1407 — Despacho central de UMA notificação em UM canal. É o gargalo único por
     * onde passam todos os canais externos (cron/agendamento/agentTools/taskNotification):
     * a única coisa que muda entre os callers é o que entra em `create()`; a partir
     * daí, o gate fica aqui e a config de quietHours passa a valer uniformemente.
     *
     * Comportamento:
     *   - `in-app` → sempre entrega (canal benigno/reversível).
     *   - Evento crítico (security/otp/agent.action) → fura o gate (bypass documentado).
     *   - Canal externo (whatsapp/email) em quiet hours → enfileira em `scheduledDispatch`
     *     para sair no fim da janela; devolve `'deferred'`.
     *   - Caso contrário → chama o provider; devolve `'delivered'`.
     *
     * Retorna o status para o caller:
     *   - `'delivered'` → provider chamado com sucesso; canal PODE entrar em `deliveredTo`.
     *   - `'deferred'`  → canal entrou na fila `scheduledDispatch`; NÃO entra em `deliveredTo`
     *                       (só entra quando o drain chamar `dispatch()` de novo e o provider
     *                       aceitar).
     * Erros do provider lançam normalmente (caller adiciona o canal a `failedChannels`).
     */
    async dispatch(notification: Notification, channel: NotificationChannel): Promise<'delivered' | 'deferred'> {
        // in-app é benigno (reversível): nunca bloqueia.
        if (channel === 'in-app') {
            this.deliverInApp(notification);
            return 'delivered';
        }

        // Eventos críticos furam o gate (security/otp/agent.action) — não podemos adiar
        // uma senha, um OTP ou uma confirmação de ação do agente.
        if (CRITICAL_EVENTS.has(notification.event)) {
            await this.deliverByChannel(notification, channel);
            return 'delivered';
        }

        // Gate de quietHours por canal externo (whatsapp/email). in-app já saiu acima.
        if (uiConfigService.isWithinQuietHours(channel)) {
            this.enqueueScheduledDispatch(notification, channel);
            return 'deferred';
        }

        await this.deliverByChannel(notification, channel);
        return 'delivered';
    }

    /**
     * Roteia `notification` para o provider correto do `channel`. Equivalente ao antigo
     * `deliver()` (que não centralizava o gate); aqui é privado e usado apenas pelo
     * `dispatch()` quando o gate libera o envio.
     */
    private async deliverByChannel(notification: Notification, channel: NotificationChannel): Promise<void> {
        switch (channel) {
            case 'in-app':
                this.deliverInApp(notification);
                return;
            case 'whatsapp':
                await this.deliverWhatsApp(notification);
                return;
            case 'email':
                await this.deliverEmail(notification);
                return;
        }
    }

    /**
     * #1407 — Enfileira (notification, channel) na fila de quietHours. Defensivo contra
     * memory leak: se a fila passar de `SCHEDULED_DISPATCH_MAX`, descarta o item mais
     * antigo (logando) — em produção isso indica config maluca (silêncio 24h ou
     * janela absurda); é melhor perder um envio do que travar o processo. Garante
     * que o timer de auto-drain está armado.
     */
    private enqueueScheduledDispatch(notification: Notification, channel: NotificationChannel): void {
        const now = new Date();
        const scheduledFor = uiConfigService.nextQuietHoursEnd(channel, now);
        const item: ScheduledDispatchItem = {
            id: `qd_${crypto.randomUUID()}`,
            notification,
            channel,
            scheduledFor: scheduledFor.getTime(),
            originalDueAt: now.getTime(),
        };
        if (this.scheduledDispatch.length >= SCHEDULED_DISPATCH_MAX) {
            log.warn(`scheduledDispatch overflow (>${SCHEDULED_DISPATCH_MAX}); descartando item mais antigo`);
            this.scheduledDispatch.shift();
        }
        this.scheduledDispatch.push(item);
        log.info('notification.quietHours.deferred', {
            canal: channel,
            scheduledFor: new Date(item.scheduledFor).toISOString(),
            originalDueAt: new Date(item.originalDueAt).toISOString(),
            event: notification.event,
            notificationId: notification.id,
        });
        this.armScheduledDispatchTimer();
    }

    /**
     * #1407 — Arma o `setInterval` de auto-drain SOMENTE se há itens pendentes e
     * o timer ainda não está ativo. Quando a fila zera, cancela o timer (evita
     * manter um interval rodando à toa). Granularidade 60s (constante).
     */
    private armScheduledDispatchTimer(): void {
        if (this.scheduledDispatchTimer || this.scheduledDispatch.length === 0) return;
        this.scheduledDispatchTimer = setInterval(() => {
            this.tickScheduledDispatch().catch((e) => log.error('tickScheduledDispatch timer', e));
        }, SCHEDULED_DISPATCH_TICK_MS);
        // não bloqueia o processo (unref se existir — best-effort).
        if (typeof (this.scheduledDispatchTimer as any).unref === 'function') {
            (this.scheduledDispatchTimer as any).unref();
        }
    }

    /**
     * #1407 — Cancela o `setInterval` de auto-drain quando a fila zera. Idempotente.
     */
    private cancelScheduledDispatchTimer(): void {
        if (this.scheduledDispatchTimer) {
            clearInterval(this.scheduledDispatchTimer);
            this.scheduledDispatchTimer = null;
        }
    }

    /**
     * #1407 — Drena a fila de quietHours: para cada item cujo `scheduledFor` já passou
     * (now >= scheduledFor), chama o `dispatch()` de novo. Se o gate liberar (a janela
     * abriu de fato), o canal entra em `deliveredTo`; se o gate ainda bloquear
     * (caso patológico: relógio voltou, ou regra mudou e ficou mais restritiva),
     * o item volta para a fila com o novo `scheduledFor` ou é descartado conforme
     * o limite. Nunca lança — todos os erros são logados e o drain continua.
     *
     * Chamado em (a) lazy (no início de cada `create()`); (b) auto-drain por timer
     * (60s) enquanto há itens pendentes.
     */
    async tickScheduledDispatch(): Promise<void> {
        if (this.scheduledDispatch.length === 0) {
            this.cancelScheduledDispatchTimer();
            return;
        }
        const now = Date.now();
        const remaining: ScheduledDispatchItem[] = [];
        for (const item of this.scheduledDispatch) {
            if (item.scheduledFor > now) {
                remaining.push(item); // ainda não é hora
                continue;
            }
            // janela aberta: tentar de novo. Se o gate liberar, o canal entra em deliveredTo.
            try {
                const status = await this.dispatch(item.notification, item.channel);
                if (status === 'deferred') {
                    // Regra mudou no meio (ou ainda silenciado por outro motivo). Recoloca
                    // com novo scheduledFor calculado a partir de agora.
                    const newScheduledFor = uiConfigService.nextQuietHoursEnd(item.channel, new Date(now));
                    if (newScheduledFor.getTime() <= now) {
                        // A janela de fato abriu (regra desabilitada) mas o gate ainda
                        // segurou — improvável, mas defensivo: descarta e loga.
                        log.warn('quietHours drain: item deferred sem novo scheduledFor válido; descartando', {
                            notificationId: item.notification.id,
                            canal: item.channel,
                        });
                        continue;
                    }
                    remaining.push({
                        ...item,
                        scheduledFor: newScheduledFor.getTime(),
                    });
                } else {
                    // 'delivered' → sucesso. Garante que o canal entra em deliveredTo.
                    if (!item.notification.deliveredTo.includes(item.channel)) {
                        item.notification.deliveredTo.push(item.channel);
                    }
                }
            } catch (e: any) {
                log.error(`tickScheduledDispatch dispatch failed: ${e?.message || e}`, {
                    notificationId: item.notification.id,
                    canal: item.channel,
                });
                if (!item.notification.failedChannels.includes(item.channel)) {
                    item.notification.failedChannels.push(item.channel);
                }
            }
        }
        this.scheduledDispatch = remaining;
        if (remaining.length === 0) {
            this.cancelScheduledDispatchTimer();
        }
    }

    private deliverInApp(notification: Notification) {
        socketService.emit('notification', {
            id: notification.id,
            type: notification.event,
            event: notification.event,
            title: notification.title,
            message: notification.message,
            priority: notification.priority,
            linkTo: notification.linkTo,
            senderId: notification.senderId,
            senderName: notification.senderName,
            recipient: notification.recipient,
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
        recipient?: string;
        recipientName?: string;
        recipientPhone?: string;
        recipientEmail?: string;
        senderId?: string;
        senderName?: string;
        entityType?: string;
        entityId?: string;
    }): Promise<Notification> {
        const notification = await this.create(params);
        // #1004: garante a persistência em disco ANTES de retornar. A ferramenta notify_person
        // devolve uma confirmação ao usuário; sem o flush, uma reinicialização rápida (ex.: nodemon)
        // poderia perder a notificação antes do debounce (1s) gravar — parecendo "não chegou".
        await this.flush();
        return notification;
    }

    /** Força a gravação pendente em disco (flush do debounce de save). */
    async flush(): Promise<void> {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        await this.performSave();
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
