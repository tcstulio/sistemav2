import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { requireDolibarrLogin as requireAuth } from '../middleware/authMiddleware';
import { schedulerService } from '../services/schedulerService';
import { dolibarrService } from '../services/dolibarrService';
import { emailService } from '../services/emailService';
import { messageService } from '../services/legacy/messageService';
import { eventRouter } from '../services/eventRouter';
import { config } from '../config/env';
import { createLogger } from '../utils/logger';
import { fail, ok } from '../utils/apiResponse';

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
            return fail(res, 'WEBHOOK_NOT_CONFIGURED', 'Webhook secret not configured', 503);
        }
        return next(); // dev/test: compat
    }
    const provided = (req.headers['x-webhook-secret'] as string) || '';
    if (!safeEqual(provided, config.webhookSecret)) {
        log.warn('Webhook bloqueado: x-webhook-secret ausente/inválido');
        return fail(res, 'UNAUTHORIZED', 'Unauthorized webhook', 401);
    }
    next();
}

function validatePattern(pattern: unknown): string | undefined {
    if (pattern === undefined) return undefined;
    if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 200) {
        return 'Pattern must be a non-empty string of at most 200 characters';
    }
    if (!/^[a-zA-Z0-9_\-.:/\\*?+()[\]\\]+$/.test(pattern)) {
        return 'Pattern contains unsupported characters';
    }
    if (/(\([^)]*[+*][^)]*\))[+*?]|\.\*\.\*/.test(pattern)) {
        return 'Pattern contains unsafe constructs';
    }
    try {
        new RegExp(pattern);
    } catch {
        return 'Pattern is not a valid regular expression';
    }
    return undefined;
}

router.post('/receive/:source', requireWebhookSecret, async (req: Request, res: Response) => {
    try {
        await eventRouter.processEvent(req.params.source, req.body);
        return ok(res, { received: true, source: req.params.source });
    } catch (error: any) {
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Webhook Receiver (Generic) ---

router.post('/trigger', requireAuth, requireWebhookSecret, async (req: Request, res: Response) => {
    try {
        const { event, sessionId, chatId, message, templateId, variables, delay } = req.body;

        if (!sessionId || !chatId) {
            return fail(res, 'BAD_REQUEST', 'Missing required fields: sessionId, chatId', 400);
        }

        let finalMessage = message;

        // Use template if provided
        if (templateId && !message) {
            finalMessage = schedulerService.renderTemplate(templateId, variables || {});
            if (!finalMessage) {
                return fail(res, 'NOT_FOUND', 'Template not found', 404);
            }
        }

        if (!finalMessage) {
            return fail(res, 'BAD_REQUEST', 'Missing message or templateId', 400);
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

        return ok(res, {
            event: event || 'manual',
            messageId: msg.id,
            scheduledFor: new Date(scheduledAt).toISOString()
        });

    } catch (error: any) {
        log.error('Trigger error', { error: error.message, stack: error.stack });
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Dolibarr Specific Webhooks (delegated to eventRouter) ---

router.post('/dolibarr/invoice', requireAuth, requireWebhookSecret, async (req: Request, res: Response) => {
    try {
        const { invoiceId, action } = req.body;
        if (!invoiceId) return fail(res, 'BAD_REQUEST', 'Missing invoiceId', 400);

        const invoice = await dolibarrService.getInvoice(invoiceId);
        if (!invoice) return fail(res, 'NOT_FOUND', 'Invoice not found', 404);

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

        return ok(res, { action, ref: invoice.ref || invoiceId });
    } catch (error: any) {
        log.error('Dolibarr invoice webhook error', { error: error.message });
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

router.post('/dolibarr/ticket', requireAuth, requireWebhookSecret, async (req: Request, res: Response) => {
    try {
        const { ticketId, action } = req.body;
        if (!ticketId) return fail(res, 'BAD_REQUEST', 'Missing ticketId', 400);

        const ticket = await dolibarrService.getTicket(ticketId);
        if (!ticket) return fail(res, 'NOT_FOUND', 'Ticket not found', 404);

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

        return ok(res, { action, ref: ticket.ref || ticketId });
    } catch (error: any) {
        log.error('Dolibarr ticket webhook error', { error: error.message });
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

router.post('/dolibarr/order', requireAuth, requireWebhookSecret, async (req: Request, res: Response) => {
    try {
        const { orderId, action } = req.body;
        if (!orderId) return fail(res, 'BAD_REQUEST', 'Missing orderId', 400);

        const order = await dolibarrService.getOrder(orderId);
        if (!order) return fail(res, 'NOT_FOUND', 'Order not found', 404);

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

        return ok(res, { action, ref: order.ref || orderId });
    } catch (error: any) {
        log.error('Dolibarr order webhook error', { error: error.message });
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// --- Automation Rules (persisted) ---

router.get('/rules', requireAuth, (req: Request, res: Response) => {
    const rules = schedulerService.getRules();
    return ok(res, rules, { count: rules.length });
});

router.post('/rules', requireAuth, (req: Request, res: Response) => {
    try {
        const { name, event, sessionId, templateId, message, delay, conditions, channel, subject } = req.body;
        if (!name || !event || !sessionId) {
            return fail(res, 'BAD_REQUEST', 'Missing required fields: name, event, sessionId', 400);
        }
        const pattern = conditions?.pattern;
        const patternError = validatePattern(pattern);
        if (patternError) {
            return fail(res, 'INVALID_PATTERN', patternError, 400);
        }
        const rule = schedulerService.createRule({ name, event, sessionId, templateId, message, delay, conditions, channel, subject });
        return ok(res, rule);
    } catch (error: any) {
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

router.delete('/rules/:id', requireAuth, (req: Request, res: Response) => {
    const success = schedulerService.deleteRule(req.params.id);
    if (success) return ok(res, { deleted: true });
    return fail(res, 'NOT_FOUND', 'Rule not found', 404);
});

router.put('/rules/:id', requireAuth, (req: Request, res: Response) => {
    try {
        const { name, message, delay, templateId, sessionId, conditions, channel, subject } = req.body;
        const patternError = validatePattern(conditions?.pattern);
        if (patternError) {
            return fail(res, 'INVALID_PATTERN', patternError, 400);
        }
        const rule = schedulerService.updateRule(req.params.id, { name, message, delay, templateId, sessionId, conditions, channel, subject });
        if (rule) return ok(res, rule);
        return fail(res, 'NOT_FOUND', 'Rule not found', 404);
    } catch (error: any) {
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

router.patch('/rules/:id/toggle', requireAuth, (req: Request, res: Response) => {
    const success = schedulerService.toggleRule(req.params.id);
    if (success) {
        const rule = schedulerService.getRules().find(r => r.id === req.params.id);
        return ok(res, { enabled: rule?.enabled });
    }
    return fail(res, 'NOT_FOUND', 'Rule not found', 404);
});

// --- Logs ---

router.get('/logs', requireAuth, (req: Request, res: Response) => {
    const { sessionId, type, status, limit, since } = req.query;
    const logs = schedulerService.getLogs({
        sessionId: sessionId as string,
        type: type as any,
        status: status as any,
        limit: limit ? parseInt(limit as string) : 50,
        since: since ? parseInt(since as string) : undefined
    });
    return ok(res, logs, { count: logs.length });
});

// --- Chatbot Flows ---

router.get('/flows', requireAuth, (req: Request, res: Response) => {
    const flows = schedulerService.getFlows();
    return ok(res, flows, { count: flows.length });
});

router.post('/flows', requireAuth, (req: Request, res: Response) => {
    try {
        const { name, triggerKeywords, sessionId, steps } = req.body;
        if (!name || !triggerKeywords || !sessionId || !steps) {
            return fail(res, 'BAD_REQUEST', 'Missing required fields: name, triggerKeywords, sessionId, steps', 400);
        }
        const flow = schedulerService.createFlow({ name, triggerKeywords, sessionId, steps });
        return ok(res, flow);
    } catch (error: any) {
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

router.put('/flows/:id', requireAuth, (req: Request, res: Response) => {
    try {
        const { name, triggerKeywords, initialMessage } = req.body;
        const updated = schedulerService.updateFlow(req.params.id, { name, triggerKeywords, initialMessage });
        if (updated) return ok(res, updated);
        return fail(res, 'NOT_FOUND', 'Flow not found', 404);
    } catch (error: any) {
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

router.delete('/flows/:id', requireAuth, (req: Request, res: Response) => {
    const success = schedulerService.deleteFlow(req.params.id);
    if (success) return ok(res, { deleted: true });
    return fail(res, 'NOT_FOUND', 'Flow not found', 404);
});

router.patch('/flows/:id/toggle', requireAuth, (req: Request, res: Response) => {
    const success = schedulerService.toggleFlow(req.params.id);
    if (success) {
        const flow = schedulerService.getFlow(req.params.id);
        return ok(res, { enabled: flow?.enabled });
    }
    return fail(res, 'NOT_FOUND', 'Flow not found', 404);
});

// --- Test/Dry-Run Endpoints ---

// Test a rule with optional real execution
router.post('/rules/:id/test', requireAuth, async (req: Request, res: Response) => {
    try {
        const { target } = req.body; // Optional target for real sending
        const rule = schedulerService.getRules().find(r => r.id === req.params.id);
        if (!rule) {
            return fail(res, 'NOT_FOUND', 'Rule not found', 404);
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

        return ok(res, {
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
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// Simulate an event (for testing automation flow)
router.post('/simulate', requireAuth, async (req: Request, res: Response) => {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
        return fail(res, 'NOT_FOUND', 'Route not found', 404);
    }

    try {
        const { event, mockPhone, sessionId } = req.body;

        if (!event) {
            return fail(res, 'BAD_REQUEST', 'Missing event type', 400);
        }

        // Get rules for this event
        const activeRules = schedulerService.getRules().filter(r => r.event === event && r.enabled);

        if (activeRules.length === 0) {
            return ok(res, { matched: false, message: `No active rules for event: ${event}` });
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

        return ok(res, {
            event,
            chatId,
            rulesMatched: activeRules.length,
            results
        });
    } catch (error: any) {
        return fail(res, 'INTERNAL_ERROR', error.message, 500);
    }
});

// Get available variables for each event type
router.get('/variables', requireAuth, (req: Request, res: Response) => {
    return ok(res, {
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

