import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { schedulerService } from '../services/schedulerService';
import { dolibarrService } from '../services/dolibarrService';
import { emailService } from '../services/emailService';
import { messageService } from '../services/legacy/messageService';
import { eventRouter } from '../services/eventRouter';
import { config } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('Webhook');
const router = Router();

// Comparação em tempo constante (evita timing attack).
function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

/**
 * Protege os endpoints públicos de webhook (/trigger e /dolibarr/*) com um segredo
 * compartilhado OPCIONAL (header x-webhook-secret). Se WEBHOOK_SECRET não estiver
 * configurado, passa direto (compat — zero regressão). Quando configurado, bloqueia
 * chamadas anônimas (qualquer um podia disparar WhatsApp via /trigger).
 */
function requireWebhookSecret(req: Request, res: Response, next: NextFunction) {
    if (!config.webhookSecret) {
        // Em produção, falhar fechado: endpoint público sem secret aceitaria chamadas anônimas.
        if (process.env.NODE_ENV === 'production') {
            log.warn('Webhook bloqueado: WEBHOOK_SECRET não configurado em produção');
            return res.status(503).json({ error: 'Webhook secret not configured' });
        }
        return next(); // dev/test: compat
    }
    const provided = (req.headers['x-webhook-secret'] as string) || '';
    if (!safeEqual(provided, config.webhookSecret)) {
        log.warn('Webhook bloqueado: x-webhook-secret ausente/inválido');
        return res.status(401).json({ error: 'Unauthorized webhook' });
    }
    next();
}

// --- Webhook Receiver (Generic) ---

router.post('/trigger', requireWebhookSecret, async (req: Request, res: Response) => {
    try {
        const { event, sessionId, chatId, message, templateId, variables, delay } = req.body;

        if (!sessionId || !chatId) {
            return res.status(400).json({ error: 'Missing required fields: sessionId, chatId' });
        }

        let finalMessage = message;

        // Use template if provided
        if (templateId && !message) {
            finalMessage = schedulerService.renderTemplate(templateId, variables || {});
            if (!finalMessage) {
                return res.status(404).json({ error: 'Template not found' });
            }
        }

        if (!finalMessage) {
            return res.status(400).json({ error: 'Missing message or templateId' });
        }

        // Schedule with optional delay
        const scheduledAt = delay ? Date.now() + (delay * 60 * 1000) : Date.now();

        const msg = schedulerService.scheduleMessage({
            chatId,
            sessionId,
            message: finalMessage,
            scheduledAt,
            metadata: { templateId, variables }
        });

        log.info(`Triggered: ${event || 'manual'} -> ${chatId}`);

        res.json({
            success: true,
            event: event || 'manual',
            messageId: msg.id,
            scheduledFor: new Date(scheduledAt).toISOString()
        });

    } catch (error: any) {
        log.error('Trigger error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message });
    }
});

// --- Dolibarr Specific Webhooks (delegated to eventRouter) ---

router.post('/dolibarr/invoice', requireWebhookSecret, async (req: Request, res: Response) => {
    try {
        const { invoiceId, action } = req.body;
        if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId' });

        const invoice = await dolibarrService.getInvoice(invoiceId);
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

        const customer = invoice.socid ? await dolibarrService.getThirdParty(invoice.socid) : null;

        await eventRouter.processEvent(`invoice_${action || 'created'}`, {
            entityId: invoiceId,
            entityType: 'invoice',
            customerName: customer?.name,
            customerPhone: customer?.phone || customer?.phone_mobile,
            customerEmail: customer?.email,
            ref: invoice.ref || invoiceId,
            amount: invoice.total_ttc ? `R$ ${parseFloat(invoice.total_ttc).toFixed(2)}` : '',
            date: invoice.date_limite ? new Date(invoice.date_limite * 1000).toLocaleDateString('pt-BR') : '',
        });

        res.json({ success: true, action, ref: invoice.ref || invoiceId });
    } catch (error: any) {
        log.error('Dolibarr invoice webhook error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.post('/dolibarr/ticket', requireWebhookSecret, async (req: Request, res: Response) => {
    try {
        const { ticketId, action } = req.body;
        if (!ticketId) return res.status(400).json({ error: 'Missing ticketId' });

        const ticket = await dolibarrService.getTicket(ticketId);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        const customer = ticket.fk_soc ? await dolibarrService.getThirdParty(ticket.fk_soc) : null;

        await eventRouter.processEvent(`ticket_${action || 'created'}`, {
            entityId: ticketId,
            entityType: 'ticket',
            customerName: customer?.name,
            customerPhone: customer?.phone || customer?.phone_mobile,
            customerEmail: customer?.email,
            ref: ticket.ref || ticketId,
            subject: ticket.subject || '',
        });

        res.json({ success: true, action, ref: ticket.ref || ticketId });
    } catch (error: any) {
        log.error('Dolibarr ticket webhook error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.post('/dolibarr/order', requireWebhookSecret, async (req: Request, res: Response) => {
    try {
        const { orderId, action } = req.body;
        if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

        const order = await dolibarrService.getOrder(orderId);
        if (!order) return res.status(404).json({ error: 'Order not found' });

        const customer = order.socid ? await dolibarrService.getThirdParty(order.socid) : null;

        await eventRouter.processEvent(`order_${action || 'created'}`, {
            entityId: orderId,
            entityType: 'order',
            customerName: customer?.name,
            customerPhone: customer?.phone || customer?.phone_mobile,
            customerEmail: customer?.email,
            ref: order.ref || orderId,
            amount: order.total_ttc ? `R$ ${parseFloat(order.total_ttc).toFixed(2)}` : '',
        });

        res.json({ success: true, action, ref: order.ref || orderId });
    } catch (error: any) {
        log.error('Dolibarr order webhook error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// --- Protected routes (require authentication) ---
router.use(requireDolibarrLogin);

// --- Automation Rules (persisted) ---

router.get('/rules', (req: Request, res: Response) => {
    const rules = schedulerService.getRules();
    res.json({ count: rules.length, data: rules });
});

router.post('/rules', (req: Request, res: Response) => {
    try {
        const { name, event, sessionId, templateId, message, delay, conditions, channel, subject } = req.body;
        if (!name || !event || !sessionId) {
            return res.status(400).json({ error: 'Missing required fields: name, event, sessionId' });
        }
        const rule = schedulerService.createRule({ name, event, sessionId, templateId, message, delay, conditions, channel, subject });
        res.json({ success: true, data: rule });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/rules/:id', (req: Request, res: Response) => {
    const success = schedulerService.deleteRule(req.params.id);
    if (success) res.json({ success: true });
    else res.status(404).json({ error: 'Rule not found' });
});

router.put('/rules/:id', (req: Request, res: Response) => {
    try {
        const { name, message, delay, templateId, sessionId, conditions, channel, subject } = req.body;
        const rule = schedulerService.updateRule(req.params.id, { name, message, delay, templateId, sessionId, conditions, channel, subject });
        if (rule) res.json({ success: true, data: rule });
        else res.status(404).json({ error: 'Rule not found' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/rules/:id/toggle', (req: Request, res: Response) => {
    const success = schedulerService.toggleRule(req.params.id);
    if (success) {
        const rule = schedulerService.getRules().find(r => r.id === req.params.id);
        res.json({ success: true, enabled: rule?.enabled });
    } else res.status(404).json({ error: 'Rule not found' });
});

// --- Logs ---

router.get('/logs', (req: Request, res: Response) => {
    const { sessionId, type, status, limit, since } = req.query;
    const logs = schedulerService.getLogs({
        sessionId: sessionId as string,
        type: type as any,
        status: status as any,
        limit: limit ? parseInt(limit as string) : 50,
        since: since ? parseInt(since as string) : undefined
    });
    res.json({ count: logs.length, data: logs });
});

// --- Chatbot Flows ---

router.get('/flows', (req: Request, res: Response) => {
    const flows = schedulerService.getFlows();
    res.json({ count: flows.length, data: flows });
});

router.post('/flows', (req: Request, res: Response) => {
    try {
        const { name, triggerKeywords, sessionId, steps } = req.body;
        if (!name || !triggerKeywords || !sessionId || !steps) {
            return res.status(400).json({ error: 'Missing required fields: name, triggerKeywords, sessionId, steps' });
        }
        const flow = schedulerService.createFlow({ name, triggerKeywords, sessionId, steps });
        res.json({ success: true, data: flow });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/flows/:id', (req: Request, res: Response) => {
    try {
        const { name, triggerKeywords, initialMessage } = req.body;
        const updated = schedulerService.updateFlow(req.params.id, { name, triggerKeywords, initialMessage });
        if (updated) res.json({ success: true, data: updated });
        else res.status(404).json({ error: 'Flow not found' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/flows/:id', (req: Request, res: Response) => {
    const success = schedulerService.deleteFlow(req.params.id);
    if (success) res.json({ success: true });
    else res.status(404).json({ error: 'Flow not found' });
});

router.patch('/flows/:id/toggle', (req: Request, res: Response) => {
    const success = schedulerService.toggleFlow(req.params.id);
    if (success) {
        const flow = schedulerService.getFlow(req.params.id);
        res.json({ success: true, enabled: flow?.enabled });
    } else res.status(404).json({ error: 'Flow not found' });
});

// --- Test/Dry-Run Endpoints ---

// Test a rule with optional real execution
router.post('/rules/:id/test', async (req: Request, res: Response) => {
    try {
        const { target } = req.body; // Optional target for real sending
        const rule = schedulerService.getRules().find(r => r.id === req.params.id);
        if (!rule) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        // Mock data based on event type
        const mockVariables: Record<string, Record<string, string>> = {
            'invoice_created': { customerName: 'João Silva', ref: 'FAC2024-0001', total: 'R$ 1.500,00' },
            'invoice_paid': { customerName: 'João Silva', ref: 'FAC2024-0001', total: 'R$ 1.500,00' },
            'invoice_overdue': { customerName: 'João Silva', ref: 'FAC2024-0001', total: 'R$ 1.500,00' },
            'ticket_created': { ref: 'TK2024-0001', subject: 'Suporte Técnico - Teste' },
            'ticket_closed': { ref: 'TK2024-0001', subject: 'Suporte Técnico - Teste' },
            'ticket_updated': { ref: 'TK2024-0001', subject: 'Suporte Técnico - Teste' },
            'order_created': { customerName: 'João Silva', ref: 'PED2024-0001', total: 'R$ 2.000,00' }
        };

        const variables = mockVariables[rule.event] || { customerName: 'Cliente Teste', ref: 'REF-001', total: 'R$ 100,00' };

        let renderedMessage = rule.message || '';

        // Use template if available
            if (rule.templateId) {
                const rendered = schedulerService.renderTemplate(rule.templateId, variables);
                if (rendered) renderedMessage = rendered;
            } else {
                for (const [key, val] of Object.entries(variables)) {
                    renderedMessage = renderedMessage.replaceAll(`{{${key}}}`, val);
                }
            }

            let sentResult = null;
        if (target) {
            log.info(`Sending real message for rule ${rule.name} to ${target}`);
            if (rule.channel === 'email') {
                await emailService.sendEmail(rule.sessionId, target, rule.subject || 'Teste de Automação', renderedMessage);
                sentResult = 'Email sent';
            } else {
                const chatId = target.includes('@') ? target : `${target.replace(/\D/g, '')}@c.us`;
                await messageService.sendText(rule.sessionId, chatId, renderedMessage);
                sentResult = 'WhatsApp sent';
            }
        }

        res.json({
            success: true,
            dryRun: !target,
            rule: {
                id: rule.id,
                name: rule.name,
                event: rule.event,
                enabled: rule.enabled,
                sessionId: rule.sessionId
            },
            mockVariables: variables,
            renderedMessage,
            delay: rule.delay || 0,
            wouldSendTo: '5511999999999@c.us (mock)',
            realSend: sentResult
        });
    } catch (error: any) {
        log.error('Test error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: error.message });
    }
});

// Simulate an event (for testing automation flow)
router.post('/simulate', async (req: Request, res: Response) => {
    try {
        const { event, mockPhone, sessionId } = req.body;

        if (!event) {
            return res.status(400).json({ error: 'Missing event type' });
        }

        // Get rules for this event
        const activeRules = schedulerService.getRules().filter(r => r.event === event && r.enabled);

        if (activeRules.length === 0) {
            return res.json({ success: false, message: `No active rules for event: ${event}` });
        }

        // Mock data
        const mockVariables: Record<string, Record<string, string>> = {
            'invoice_created': { customerName: 'Simulação Cliente', ref: 'SIM-FAC-001', total: 'R$ 999,00' },
            'invoice_paid': { customerName: 'Simulação Cliente', ref: 'SIM-FAC-001', total: 'R$ 999,00' },
            'invoice_overdue': { customerName: 'Simulação Cliente', ref: 'SIM-FAC-001', total: 'R$ 999,00' },
            'ticket_created': { ref: 'SIM-TK-001', subject: 'Ticket de Simulação' },
            'ticket_closed': { ref: 'SIM-TK-001', subject: 'Ticket de Simulação' },
            'ticket_updated': { ref: 'SIM-TK-001', subject: 'Ticket de Simulação' },
            'order_created': { customerName: 'Simulação Cliente', ref: 'SIM-PED-001', total: 'R$ 1.999,00' }
        };

        const variables = mockVariables[event] || {};
        const chatId = mockPhone ? `${mockPhone.replace(/\D/g, '')}@c.us` : '5511999999999@c.us';

        const results: any[] = [];

        for (const rule of activeRules) {
            let finalText = rule.message || '';

            if (rule.templateId) {
                const rendered = schedulerService.renderTemplate(rule.templateId, variables);
                if (rendered) finalText = rendered;
            } else {
                for (const [key, val] of Object.entries(variables)) {
                    finalText = finalText.replaceAll(`{{${key}}}`, val);
                }
            }

            if (!finalText) continue;

            // #1439 — resolve o sessionId com a mesma precedência do eventRouter (rule > uiConfig > unset).
            // O `sessionId` vindo do body da requisição (parâmetro do simulate) é um override de teste:
            // só vale quando a regra NÃO tem sessionId próprio e o admin não configurou um default global —
            // preservando a regra explícita como autoridade máxima e a config como default institucional.
            const { sessionId: resolvedSessionId, source: sessionIdSource } = schedulerService.resolveRuleSessionId(rule);
            const finalSessionId = resolvedSessionId || sessionId || '';

            if (mockPhone) {
                const msg = schedulerService.scheduleMessage({
                    chatId,
                    sessionId: finalSessionId,
                    message: finalText,
                    scheduledAt: Date.now() + (rule.delay ? rule.delay * 60 * 1000 : 0)
                });

                schedulerService.addLog({
                    messageId: msg.id,
                    chatId,
                    sessionId: finalSessionId,
                    type: 'webhook',
                    status: 'pending',
                    message: finalText,
                    metadata: { event, ruleId: rule.id, ruleName: rule.name, simulated: true, sessionIdSource }
                });

                results.push({ ruleId: rule.id, ruleName: rule.name, messageId: msg.id, scheduled: true });
            } else {
                results.push({ ruleId: rule.id, ruleName: rule.name, renderedMessage: finalText, scheduled: false });
            }
        }

        res.json({
            success: true,
            event,
            chatId,
            rulesMatched: activeRules.length,
            results
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get available variables for each event type
router.get('/variables', (req: Request, res: Response) => {
    res.json({
        invoice_created: ['{{customerName}}', '{{ref}}', '{{total}}'],
        invoice_paid: ['{{customerName}}', '{{ref}}', '{{total}}'],
        invoice_overdue: ['{{customerName}}', '{{ref}}', '{{total}}'],
        ticket_created: ['{{ref}}', '{{subject}}'],
        ticket_closed: ['{{ref}}', '{{subject}}'],
        ticket_updated: ['{{ref}}', '{{subject}}'],
        order_created: ['{{customerName}}', '{{ref}}', '{{total}}'],
        custom: ['{{customerName}}', '{{ref}}', '{{total}}', '{{subject}}']
    });
});

export default router;

