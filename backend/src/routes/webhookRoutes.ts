import { Router, Request, Response } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { schedulerService } from '../services/schedulerService';
import { dolibarrService } from '../services/dolibarrService';
import { emailService } from '../services/emailService';
import { messageService } from '../services/legacy/messageService';
import { logger } from '../utils/logger';

const log = logger.child('WebhookRoutes');
const router = Router();

// --- Webhook Receiver (Generic) ---

router.post('/trigger', async (req: Request, res: Response) => {
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
        log.error('Trigger error', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Dolibarr Specific Webhooks ---

router.post('/dolibarr/invoice', async (req: Request, res: Response) => {
    try {
        const { invoiceId, action, sessionId } = req.body;

        if (!invoiceId) {
            return res.status(400).json({ error: 'Missing invoiceId' });
        }

        const invoice = await dolibarrService.getInvoice(invoiceId);
        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const customer = await dolibarrService.getThirdParty(invoice.socid);
        const phone = customer?.phone || customer?.phone_mobile;
        const email = customer?.email;

        const customerName = customer?.name || 'Cliente';
        const invoiceRef = invoice.ref || invoiceId;
        const total = invoice.total_ttc ? `R$ ${parseFloat(invoice.total_ttc).toFixed(2)}` : '';

        // Fetch active rules for this event
        const eventBefore = `invoice_${action}`;
        const activeRules = schedulerService.getRules().filter(r => r.event === eventBefore && r.enabled);

        if (activeRules.length === 0) {
            log.info(`No active rules for ${eventBefore}`);
            return res.json({ success: true, action, message: 'No active rules' });
        }

        const variables = {
            customerName,
            ref: invoiceRef,
            total
        };

        const messages: string[] = [];

        for (const rule of activeRules) {
            // Determine destination based on channel
            let destinationId = '';
            if (rule.channel === 'email') {
                if (!email) {
                    log.info(`Skipping email rule ${rule.name}: No email for customer ${invoice.socid}`);
                    continue;
                }
                destinationId = email;
            } else {
                if (!phone) {
                    log.info(`Skipping whatsapp rule ${rule.name}: No phone for customer ${invoice.socid}`);
                    continue;
                }
                destinationId = phone.replace(/\D/g, '') + '@c.us';
            }
            let finalText = rule.message || '';

            // Re-use scheduler template logic if we had a public method, but for now simple replace
            if (rule.templateId) {
                const rendered = schedulerService.renderTemplate(rule.templateId, variables);
                if (rendered) finalText = rendered;
            } else {
                // Simple interpolation
                for (const [key, val] of Object.entries(variables)) {
                    finalText = finalText.replace(new RegExp(`{{${key}}}`, 'g'), val);
                }
            }

            if (!finalText) continue;

            const msgSessionId = rule.sessionId || sessionId || 'default';
            const msg = schedulerService.scheduleMessage({
                chatId: destinationId,
                sessionId: msgSessionId,
                channel: rule.channel, // Pass channel
                subject: rule.subject, // Pass subject
                message: finalText,
                scheduledAt: Date.now() + (rule.delay ? rule.delay * 60 * 1000 : 0)
            });
            messages.push(msg.id);

            // Log the webhook trigger
            schedulerService.addLog({
                messageId: msg.id,
                chatId: destinationId,
                sessionId: msgSessionId,
                type: 'webhook',
                status: 'pending',
                message: finalText,
                metadata: { event: eventBefore, ruleId: rule.id, ruleName: rule.name, invoiceRef }
            });
        }

        res.json({ success: true, action, invoiceRef, messageIds: messages });

    } catch (error: any) {
        log.error('Dolibarr invoice error', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/dolibarr/ticket', async (req: Request, res: Response) => {
    try {
        const { ticketId, action, sessionId } = req.body;

        if (!ticketId) {
            return res.status(400).json({ error: 'Missing ticketId' });
        }

        const ticket = await dolibarrService.getTicket(ticketId);
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        let phone = null;
        let email = null;
        if (ticket.fk_soc) {
            const customer = await dolibarrService.getThirdParty(ticket.fk_soc);
            phone = customer?.phone || customer?.phone_mobile;
            email = customer?.email;
        }

        const ticketRef = ticket.ref || ticketId;

        // Fetch active rules for this event
        const eventBefore = `ticket_${action}`;
        const activeRules = schedulerService.getRules().filter(r => r.event === eventBefore && r.enabled);

        if (activeRules.length === 0) {
            log.info(`No active rules for ${eventBefore}`);
            return res.json({ success: true, action, message: 'No active rules' });
        }

        const variables = {
            ref: ticketRef,
            subject: ticket.subject || ''
        };

        const messages: string[] = [];

        for (const rule of activeRules) {
            // Determine destination based on channel
            let destinationId = '';
            if (rule.channel === 'email') {
                if (!email) {
                    log.info(`Skipping email rule ${rule.name}: No email for ticket customer`);
                    continue;
                }
                destinationId = email;
            } else {
                if (!phone) {
                    log.info(`Skipping whatsapp rule ${rule.name}: No phone for ticket customer`);
                    continue;
                }
                destinationId = phone.replace(/\D/g, '') + '@c.us';
            }
            let finalText = rule.message || '';

            if (rule.templateId) {
                const rendered = schedulerService.renderTemplate(rule.templateId, variables);
                if (rendered) finalText = rendered;
            } else {
                for (const [key, val] of Object.entries(variables)) {
                    finalText = finalText.replace(new RegExp(`{{${key}}}`, 'g'), val);
                }
            }

            if (!finalText) continue;

            const msgSessionId = rule.sessionId || sessionId || 'default';
            const msg = schedulerService.scheduleMessage({
                chatId: destinationId,
                sessionId: msgSessionId,
                channel: rule.channel,
                subject: rule.subject,
                message: finalText,
                scheduledAt: Date.now() + (rule.delay ? rule.delay * 60 * 1000 : 0)
            });
            messages.push(msg.id);

            // Log the webhook trigger
            schedulerService.addLog({
                messageId: msg.id,
                chatId: destinationId,
                sessionId: msgSessionId,
                type: 'webhook',
                status: 'pending',
                message: finalText,
                metadata: { event: eventBefore, ruleId: rule.id, ruleName: rule.name, ticketRef }
            });
        }

        res.json({ success: true, action, ticketRef, messageIds: messages });

    } catch (error: any) {
        log.error('Dolibarr ticket error', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/dolibarr/order', async (req: Request, res: Response) => {
    try {
        const { orderId, action, sessionId } = req.body;

        if (!orderId) {
            return res.status(400).json({ error: 'Missing orderId' });
        }

        const order = await dolibarrService.getOrder(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const customer = await dolibarrService.getThirdParty(order.socid);
        const phone = customer?.phone || customer?.phone_mobile;
        const email = customer?.email;

        const customerName = customer?.name || 'Cliente';
        const orderRef = order.ref || orderId;
        const total = order.total_ttc ? `R$ ${parseFloat(order.total_ttc).toFixed(2)}` : '';

        // Fetch active rules for this event
        const eventName = `order_${action}`;
        const activeRules = schedulerService.getRules().filter(r => r.event === eventName && r.enabled);

        if (activeRules.length === 0) {
            log.info(`No active rules for ${eventName}`);
            return res.json({ success: true, action, message: 'No active rules' });
        }

        const variables = {
            customerName,
            ref: orderRef,
            total
        };

        const messages: string[] = [];

        for (const rule of activeRules) {
            // Determine destination based on channel
            let destinationId = '';
            if (rule.channel === 'email') {
                if (!email) {
                    log.info(`Skipping email rule ${rule.name}: No email for customer ${order.socid}`);
                    continue;
                }
                destinationId = email;
            } else {
                if (!phone) {
                    log.info(`Skipping whatsapp rule ${rule.name}: No phone for customer ${order.socid}`);
                    continue;
                }
                destinationId = phone.replace(/\D/g, '') + '@c.us';
            }
            let finalText = rule.message || '';

            if (rule.templateId) {
                const rendered = schedulerService.renderTemplate(rule.templateId, variables);
                if (rendered) finalText = rendered;
            } else {
                for (const [key, val] of Object.entries(variables)) {
                    finalText = finalText.replace(new RegExp(`{{${key}}}`, 'g'), val);
                }
            }

            if (!finalText) continue;

            const msgSessionId = rule.sessionId || sessionId || 'default';
            const msg = schedulerService.scheduleMessage({
                chatId: destinationId, // Use resolved destination
                sessionId: msgSessionId,
                channel: rule.channel,
                subject: rule.subject,
                message: finalText,
                scheduledAt: Date.now() + (rule.delay ? rule.delay * 60 * 1000 : 0)
            });
            messages.push(msg.id);

            // Log the webhook trigger
            schedulerService.addLog({
                messageId: msg.id,
                chatId: destinationId,
                sessionId: msgSessionId,
                type: 'webhook',
                status: 'pending',
                message: finalText,
                metadata: { event: eventName, ruleId: rule.id, ruleName: rule.name, orderRef }
            });
        }

        res.json({ success: true, action, orderRef, messageIds: messages });

    } catch (error: any) {
        log.error('Dolibarr order error', error);
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
            // Simple interpolation
            for (const [key, val] of Object.entries(variables)) {
                renderedMessage = renderedMessage.replace(new RegExp(`{{${key}}}`, 'g'), val);
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
        log.error('Test error', error);
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
                    finalText = finalText.replace(new RegExp(`{{${key}}}`, 'g'), val);
                }
            }

            if (!finalText) continue;

            const msgSessionId = rule.sessionId || sessionId || 'default';

            // Actually schedule the message if a real phone is provided
            if (mockPhone) {
                const msg = schedulerService.scheduleMessage({
                    chatId,
                    sessionId: msgSessionId,
                    message: finalText,
                    scheduledAt: Date.now() + (rule.delay ? rule.delay * 60 * 1000 : 0)
                });

                schedulerService.addLog({
                    messageId: msg.id,
                    chatId,
                    sessionId: msgSessionId,
                    type: 'webhook',
                    status: 'pending',
                    message: finalText,
                    metadata: { event, ruleId: rule.id, ruleName: rule.name, simulated: true }
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

