import { createLogger } from '../utils/logger';
import { notificationService, NotificationEvent } from './notificationService';
import { renderTemplate } from './notificationTemplates';
import { schedulerService } from './schedulerService';

const log = createLogger('EventRouter');

export interface EventData {
    entityId?: string;
    entityType?: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    ref?: string;
    amount?: string;
    date?: string;
    subject?: string;
    description?: string;
    senderName?: string;
    [key: string]: any;
}

function mapEventToNotificationEvent(event: string): NotificationEvent {
    const known: Record<string, NotificationEvent> = {
        'invoice_created': 'invoice.created',
        'invoice_paid': 'invoice.paid',
        'invoice_overdue': 'invoice.overdue',
        'order_created': 'order.created',
        'order_validated': 'order.validated',
        'proposal_sent': 'proposal.sent',
        'proposal_accepted': 'proposal.accepted',
        'ticket_created': 'ticket.created',
        'ticket_assigned': 'ticket.assigned',
        'task_completed': 'task.completed',
        'stock_low': 'stock.low',
        'payment_received': 'payment.received',
        'agent_action': 'agent.action',
    };
    return known[event] || 'custom';
}

function getPriority(event: string): 'low' | 'medium' | 'high' {
    if (event.includes('overdue') || event.includes('stock_low')) return 'high';
    if (event.includes('created') || event.includes('ticket')) return 'medium';
    return 'low';
}

function generateTitle(event: string, data: EventData): string {
    const titles: Record<string, string> = {
        'invoice_created': `Fatura ${data.ref || ''} criada`,
        'invoice_paid': `Fatura ${data.ref || ''} paga`,
        'invoice_overdue': `Fatura ${data.ref || ''} vencida`,
        'order_created': `Pedido ${data.ref || ''} criado`,
        'order_validated': `Pedido ${data.ref || ''} validado`,
        'proposal_sent': `Proposta ${data.ref || ''} enviada`,
        'proposal_accepted': `Proposta ${data.ref || ''} aceita`,
        'ticket_created': `Novo ticket: ${data.subject || ''}`,
        'ticket_assigned': `Ticket atribuído: ${data.subject || ''}`,
        'task_completed': `Tarefa concluída: ${data.ref || ''}`,
    };
    return titles[event] || `Evento: ${event}`;
}

class EventRouter {
    async processEvent(event: string, data: EventData): Promise<void> {
        const notifEvent = mapEventToNotificationEvent(event);

        try {
            const templateMessage = renderTemplate(event, 'in-app', {
                ref: data.ref || '',
                nome: data.customerName || '',
                amount: data.amount || '',
                date: data.date || '',
                customer: data.customerName || '',
                subject: data.subject || '',
                description: data.description || '',
                label: data.ref || '',
                project: '',
                product: '',
                qty: '',
                min: '',
            });

            await notificationService.create({
                event: notifEvent,
                title: generateTitle(event, data),
                message: templateMessage || data.description || `${event}: ${data.ref || data.entityId || ''}`,
                channels: ['in-app'],
                priority: getPriority(event),
                entityType: data.entityType,
                entityId: data.entityId,
                senderName: data.senderName,
                recipientName: data.customerName,
                recipientPhone: data.customerPhone,
                recipientEmail: data.customerEmail,
            });
        } catch (e) {
            log.error(`Failed to create notification for ${event}`, e);
        }

        const rules = schedulerService.getRules().filter(r => r.event === event && r.enabled);
        if (rules.length === 0) return;

        const templateVars: Record<string, string> = {};
        for (const [key, val] of Object.entries(data)) {
            if (typeof val === 'string' || typeof val === 'number') {
                templateVars[key] = String(val);
            }
        }
        templateVars.customerName = data.customerName || '';
        templateVars.ref = data.ref || '';
        templateVars.total = data.amount || '';

        for (const rule of rules) {
            try {
                let message = rule.message || '';
                if (rule.templateId) {
                    const rendered = schedulerService.renderTemplate(rule.templateId, templateVars);
                    if (rendered) message = rendered;
                } else {
                    for (const [key, val] of Object.entries(templateVars)) {
                        message = message.replaceAll(`{{${key}}}`, val);
                    }
                }

                if (!message) continue;

                const destination = rule.channel === 'email'
                    ? data.customerEmail
                    : data.customerPhone?.replace(/\D/g, '') + '@c.us';

                if (!destination) {
                    log.debug(`Skipping rule ${rule.name}: no destination`);
                    continue;
                }

                // #1439 — resolve sessionId com precedência (rule > uiConfig > unset→resolveSession)
                // e propaga a fonte ('rule' | 'config' | 'unset') p/ o log de auditoria.
                const { sessionId: resolvedSessionId, source: sessionIdSource } = schedulerService.resolveRuleSessionId(rule);

                const msg = schedulerService.scheduleMessage({
                    chatId: destination,
                    sessionId: resolvedSessionId,
                    channel: rule.channel,
                    subject: rule.subject,
                    message,
                    scheduledAt: Date.now() + (rule.delay ? rule.delay * 60 * 1000 : 0),
                });

                schedulerService.addLog({
                    messageId: msg.id,
                    chatId: destination,
                    sessionId: resolvedSessionId,
                    channel: rule.channel,
                    type: 'webhook',
                    status: 'pending',
                    message: message.substring(0, 200),
                    metadata: { event, ruleId: rule.id, ruleName: rule.name, sessionIdSource },
                });

                log.info(`Rule ${rule.name}: scheduled message to ${destination} (sessionIdSource=${sessionIdSource})`);
            } catch (e) {
                log.error(`Failed to execute rule ${rule.name}`, e);
            }
        }
    }
}

export const eventRouter = new EventRouter();
