import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
        mkdirSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
}));

vi.mock('../utils/atomicWrite', () => ({
    atomicWriteSync: vi.fn(),
}));

vi.mock('../../services/legacy/messageService', () => ({
    messageService: {
        sendText: vi.fn(),
    },
}));

vi.mock('../../services/emailService', () => ({
    emailService: {
        sendEmail: vi.fn(),
    },
}));

vi.mock('../../services/socketService', () => ({
    socketService: {
        emit: vi.fn(),
    },
}));

import fs from 'fs';
import { schedulerService } from '../../services/schedulerService';
import { messageService } from '../../services/legacy/messageService';
import { emailService } from '../../services/emailService';
import { socketService } from '../../services/socketService';

describe('SchedulerService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        (schedulerService as any).data = {
            messages: [],
            templates: [],
            confirmations: {},
            automationRules: [],
            logs: [],
            chatFlows: [],
            activeFlows: {},
        };
        (schedulerService as any).intervalId = null;
        (schedulerService as any).messagesSentPerSession = new Map();
        (schedulerService as any).lastMinuteReset = Date.now();
    });

    afterEach(() => {
        schedulerService.stopWorker();
        vi.useRealTimers();
    });

    describe('scheduleMessage', () => {
        it('creates a scheduled message', () => {
            const msg = schedulerService.scheduleMessage({
                chatId: '5511@c.us',
                sessionId: 'sess1',
                message: 'Hello',
                scheduledAt: Date.now() + 60000,
            });

            expect(msg.id).toMatch(/^msg_/);
            expect(msg.status).toBe('pending');
            expect(msg.channel).toBe('whatsapp');
            expect(msg.type).toBe('once');
            expect(socketService.emit).toHaveBeenCalledWith('scheduler_created', msg);
        });

        it('creates email channel message', () => {
            const msg = schedulerService.scheduleMessage({
                chatId: 'test@test.com',
                sessionId: 'acc1',
                channel: 'email',
                subject: 'Test',
                message: '<p>Hello</p>',
                scheduledAt: Date.now() + 60000,
            });

            expect(msg.channel).toBe('email');
            expect(msg.subject).toBe('Test');
        });
    });

    describe('scheduleBroadcast', () => {
        it('schedules messages for multiple contacts', async () => {
            const messages = await schedulerService.scheduleBroadcast({
                sessionId: 'sess1',
                chatIds: ['5511@c.us', '5522@c.us', '5533@c.us'],
                message: 'Broadcast!',
                delayBetween: 2000,
            });

            expect(messages).toHaveLength(3);
            expect(messages[0].type).toBe('broadcast');
            expect(messages[1].scheduledAt - messages[0].scheduledAt).toBe(2000);
        });
    });

    describe('getBroadcastDetails', () => {
        it('returns null for non-existent broadcast', () => {
            expect(schedulerService.getBroadcastDetails('nonexistent')).toBeNull();
        });

        it('returns broadcast details', async () => {
            const messages = await schedulerService.scheduleBroadcast({
                sessionId: 's1',
                chatIds: ['a@c.us', 'b@c.us'],
                message: 'Test',
            });

            const broadcastId = messages[0].metadata?.broadcastId!;
            const details = schedulerService.getBroadcastDetails(broadcastId);

            expect(details?.totalCount).toBe(2);
            expect(details?.pending).toBe(2);
            expect(details?.sent).toBe(0);
        });
    });

    describe('getBroadcasts', () => {
        it('returns empty list', () => {
            expect(schedulerService.getBroadcasts()).toEqual([]);
        });

        it('returns broadcast summary', async () => {
            await schedulerService.scheduleBroadcast({
                sessionId: 's1',
                chatIds: ['a@c.us'],
                message: 'Test',
            });

            const broadcasts = schedulerService.getBroadcasts();
            expect(broadcasts).toHaveLength(1);
            expect(broadcasts[0].status).toBe('pending');
        });
    });

    describe('scheduleConfirmation', () => {
        it('creates confirmation message', () => {
            const msg = schedulerService.scheduleConfirmation({
                chatId: '5511@c.us',
                sessionId: 'sess1',
                message: 'Confirm?',
                timeoutMinutes: 30,
                onConfirm: 'callback_url',
            });

            expect(msg.type).toBe('confirmation');
            expect(msg.metadata?.awaitingResponse).toBe(true);
        });
    });

    describe('scheduleReminder', () => {
        it('creates recurring reminder', () => {
            const msg = schedulerService.scheduleReminder({
                chatId: '5511@c.us',
                sessionId: 'sess1',
                message: 'Reminder!',
                firstSendAt: Date.now() + 3600000,
                recurrence: { interval: 1, unit: 'hours' },
            });

            expect(msg.type).toBe('reminder');
            expect(msg.metadata?.recurrence?.interval).toBe(1);
        });
    });

    describe('cancelMessage', () => {
        it('cancels a pending message', () => {
            const msg = schedulerService.scheduleMessage({
                chatId: '5511@c.us',
                sessionId: 's1',
                message: 'Test',
                scheduledAt: Date.now() + 60000,
            });

            expect(schedulerService.cancelMessage(msg.id)).toBe(true);
            expect(schedulerService.getPending()).toHaveLength(0);
        });

        it('returns false for non-pending message', () => {
            const msg = schedulerService.scheduleMessage({
                chatId: '5511@c.us',
                sessionId: 's1',
                message: 'Test',
                scheduledAt: Date.now() + 60000,
            });

            (msg as any).status = 'sent';
            expect(schedulerService.cancelMessage(msg.id)).toBe(false);
        });

        it('returns false for unknown message', () => {
            expect(schedulerService.cancelMessage('unknown')).toBe(false);
        });
    });

    describe('getPending', () => {
        it('filters by session', () => {
            schedulerService.scheduleMessage({ chatId: 'a', sessionId: 's1', message: 'A', scheduledAt: 1 });
            schedulerService.scheduleMessage({ chatId: 'b', sessionId: 's2', message: 'B', scheduledAt: 1 });

            expect(schedulerService.getPending('s1')).toHaveLength(1);
            expect(schedulerService.getPending()).toHaveLength(2);
        });
    });

    describe('getHistory', () => {
        it('returns sorted and filtered history', () => {
            schedulerService.scheduleMessage({ chatId: 'a', sessionId: 's1', message: 'A', scheduledAt: 100 });
            schedulerService.scheduleMessage({ chatId: 'b', sessionId: 's1', message: 'B', scheduledAt: 200 });

            const history = schedulerService.getHistory({ sessionId: 's1', limit: 1 });
            expect(history).toHaveLength(1);
            expect(history[0].scheduledAt).toBe(200);
        });
    });

    describe('confirmations', () => {
        it('returns null when no confirmation', () => {
            expect(schedulerService.checkConfirmation('5511@c.us')).toBeNull();
        });

        it('returns confirmation when active', () => {
            (schedulerService as any).data.confirmations['5511@c.us'] = {
                messageId: 'm1',
                callback: 'cb',
                expiresAt: Date.now() + 3600000,
            };

            const conf = schedulerService.checkConfirmation('5511@c.us');
            expect(conf?.callback).toBe('cb');
        });

        it('expires old confirmations', () => {
            (schedulerService as any).data.confirmations['5511@c.us'] = {
                messageId: 'm1',
                callback: 'cb',
                expiresAt: Date.now() - 1000,
            };

            expect(schedulerService.checkConfirmation('5511@c.us')).toBeNull();
        });

        it('handles confirmation response accepted', () => {
            (schedulerService as any).data.confirmations['5511@c.us'] = {
                messageId: 'm1',
                callback: 'cb',
                expiresAt: Date.now() + 3600000,
            };

            const result = schedulerService.handleConfirmationResponse('5511@c.us', true);
            expect(result).toBe('cb');
            expect(schedulerService.checkConfirmation('5511@c.us')).toBeNull();
        });

        it('handles confirmation response rejected', () => {
            (schedulerService as any).data.confirmations['5511@c.us'] = {
                messageId: 'm1',
                callback: 'cb',
                expiresAt: Date.now() + 3600000,
            };

            const result = schedulerService.handleConfirmationResponse('5511@c.us', false);
            expect(result).toBe('cb');
        });

        it('returns null when no confirmation to handle', () => {
            expect(schedulerService.handleConfirmationResponse('unknown', true)).toBeNull();
        });
    });

    describe('templates', () => {
        it('creates a template', () => {
            const tpl = schedulerService.createTemplate({
                name: 'Test Template',
                content: 'Hello {{name}}!',
            });

            expect(tpl.id).toMatch(/^tpl_/);
            expect(tpl.channel).toBe('whatsapp');
        });

        it('gets all templates', () => {
            schedulerService.createTemplate({ name: 'T1', content: 'C1' });
            schedulerService.createTemplate({ name: 'T2', content: 'C2' });
            expect(schedulerService.getTemplates()).toHaveLength(2);
        });

        it('gets template by id', () => {
            const tpl = schedulerService.createTemplate({ name: 'T1', content: 'C1' });
            expect(schedulerService.getTemplate(tpl.id)).toBeDefined();
            expect(schedulerService.getTemplate('unknown')).toBeUndefined();
        });

        it('deletes a template', () => {
            const tpl = schedulerService.createTemplate({ name: 'T1', content: 'C1' });
            expect(schedulerService.deleteTemplate(tpl.id)).toBe(true);
            expect(schedulerService.getTemplates()).toHaveLength(0);
        });

        it('returns false deleting unknown template', () => {
            expect(schedulerService.deleteTemplate('unknown')).toBe(false);
        });

        it('renders template with variables', () => {
            const tpl = schedulerService.createTemplate({
                name: 'Render',
                content: 'Hello {{name}}, your order {{order}} is ready.',
            });

            const rendered = schedulerService.renderTemplate(tpl.id, { name: 'John', order: '123' });
            expect(rendered).toBe('Hello John, your order 123 is ready.');
        });

        it('returns null for unknown template', () => {
            expect(schedulerService.renderTemplate('unknown', {})).toBeNull();
        });
    });

    describe('automation rules', () => {
        it('creates a rule', () => {
            const rule = schedulerService.createRule({
                name: 'Test Rule',
                event: 'invoice_created',
                sessionId: 's1',
                message: 'New invoice',
            });

            expect(rule.id).toMatch(/^rule_/);
            expect(rule.enabled).toBe(true);
        });

        it('gets all rules', () => {
            schedulerService.createRule({ name: 'R1', event: 'invoice_created', sessionId: 's1' });
            expect(schedulerService.getRules().length).toBeGreaterThan(0);
        });

        it('toggles a rule', () => {
            const rule = schedulerService.createRule({ name: 'R1', event: 'invoice_paid', sessionId: 's1' });
            expect(schedulerService.toggleRule(rule.id)).toBe(true);
            expect(rule.enabled).toBe(false);
        });

        it('toggles unknown rule returns false', () => {
            expect(schedulerService.toggleRule('unknown')).toBe(false);
        });

        it('deletes a rule', () => {
            const rule = schedulerService.createRule({ name: 'R1', event: 'invoice_overdue', sessionId: 's1' });
            expect(schedulerService.deleteRule(rule.id)).toBe(true);
        });

        it('returns false deleting unknown rule', () => {
            expect(schedulerService.deleteRule('unknown')).toBe(false);
        });

        it('updates a rule', () => {
            const rule = schedulerService.createRule({ name: 'R1', event: 'ticket_created', sessionId: 's1' });
            const updated = schedulerService.updateRule(rule.id, { name: 'Updated', message: 'New msg' });
            expect(updated?.name).toBe('Updated');
            expect(updated?.message).toBe('New msg');
        });

        it('returns null updating unknown rule', () => {
            expect(schedulerService.updateRule('unknown', { name: 'X' })).toBeNull();
        });
    });

    describe('message logs', () => {
        it('adds a log', () => {
            const log = schedulerService.addLog({
                messageId: 'm1',
                chatId: '5511@c.us',
                sessionId: 's1',
                type: 'scheduled',
                status: 'sent',
                message: 'Test',
            });

            expect(log.id).toMatch(/^log_/);
            expect(log.sentAt).toBeDefined();
        });

        it('adds log without sentAt for non-sent', () => {
            const log = schedulerService.addLog({
                messageId: 'm1',
                chatId: '5511@c.us',
                sessionId: 's1',
                type: 'broadcast',
                status: 'failed',
                message: 'Test',
                error: 'Error',
            });

            expect(log.sentAt).toBeUndefined();
            expect(log.error).toBe('Error');
        });

        it('trims logs over 1000', () => {
            for (let i = 0; i < 1005; i++) {
                (schedulerService as any).data.logs.push({ id: `l${i}`, createdAt: i });
            }

            schedulerService.addLog({
                messageId: 'm', chatId: 'c', sessionId: 's', type: 'webhook', status: 'pending', message: 'x',
            });

            expect((schedulerService as any).data.logs.length).toBeLessThanOrEqual(1001);
        });

        it('gets logs with filters', () => {
            schedulerService.addLog({ messageId: 'm1', chatId: 'c', sessionId: 's1', type: 'scheduled', status: 'sent', message: 'A' });
            schedulerService.addLog({ messageId: 'm2', chatId: 'c', sessionId: 's2', type: 'chatbot', status: 'failed', message: 'B' });

            expect(schedulerService.getLogs({ sessionId: 's1' })).toHaveLength(1);
            expect(schedulerService.getLogs({ type: 'chatbot' })).toHaveLength(1);
            expect(schedulerService.getLogs({ status: 'sent' })).toHaveLength(1);
            expect(schedulerService.getLogs({ limit: 1 })).toHaveLength(1);
        });

        it('filters logs by since timestamp', () => {
            schedulerService.addLog({ messageId: 'm1', chatId: 'c', sessionId: 's', type: 'scheduled', status: 'sent', message: 'A' });
            vi.advanceTimersByTime(1000);
            const futureLog = schedulerService.addLog({ messageId: 'm2', chatId: 'c', sessionId: 's', type: 'scheduled', status: 'sent', message: 'B' });

            const filtered = schedulerService.getLogs({ since: futureLog.createdAt - 1 });
            expect(filtered).toHaveLength(1);
        });
    });

    describe('chatbot flows', () => {
        const flowSteps = [
            { id: 'step1', message: 'Welcome', waitForResponse: true, options: [{ keywords: ['yes'], nextStepId: 'step2', response: 'Great!' }], defaultNextStepId: 'step2' },
            { id: 'step2', message: 'Thanks', waitForResponse: false },
        ];

        it('creates a flow', () => {
            const flow = schedulerService.createFlow({
                name: 'Test Flow',
                triggerKeywords: ['start'],
                sessionId: 's1',
                steps: flowSteps,
            });

            expect(flow.id).toMatch(/^flow_/);
            expect(flow.triggerKeywords).toEqual(['start']);
            expect(flow.enabled).toBe(true);
        });

        it('gets all flows', () => {
            schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: [] });
            expect(schedulerService.getFlows()).toHaveLength(1);
        });

        it('gets flow by id', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: [] });
            expect(schedulerService.getFlow(flow.id)).toBeDefined();
            expect(schedulerService.getFlow('unknown')).toBeUndefined();
        });

        it('toggles a flow', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: [] });
            expect(schedulerService.toggleFlow(flow.id)).toBe(true);
            expect(flow.enabled).toBe(false);
        });

        it('deletes a flow', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: [] });
            expect(schedulerService.deleteFlow(flow.id)).toBe(true);
        });

        it('checkFlowTrigger matches keywords', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['start', 'begin'], sessionId: 's1', steps: flowSteps });

            expect(schedulerService.checkFlowTrigger('s1', 'I want to start')).toBe(flow);
            expect(schedulerService.checkFlowTrigger('s1', 'no match')).toBeNull();
        });

        it('checkFlowTrigger skips disabled flows', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['start'], sessionId: 's1', steps: flowSteps });
            flow.enabled = false;
            expect(schedulerService.checkFlowTrigger('s1', 'start')).toBeNull();
        });

        it('startFlow returns first step', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: flowSteps });
            const step = schedulerService.startFlow('5511@c.us', flow);
            expect(step?.id).toBe('step1');
        });

        it('startFlow returns null for empty steps', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: [] });
            expect(schedulerService.startFlow('5511@c.us', flow)).toBeNull();
        });

        it('getActiveFlow returns null when no active flow', () => {
            expect(schedulerService.getActiveFlow('unknown')).toBeNull();
        });

        it('getActiveFlow returns null when flow deleted', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: flowSteps });
            schedulerService.startFlow('5511@c.us', flow);
            schedulerService.deleteFlow(flow.id);
            expect(schedulerService.getActiveFlow('5511@c.us')).toBeNull();
        });

        it('getActiveFlow returns null when step not found', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: flowSteps });
            schedulerService.startFlow('5511@c.us', flow);
            (schedulerService as any).data.activeFlows['5511@c.us'].currentStepId = 'nonexistent';
            expect(schedulerService.getActiveFlow('5511@c.us')).toBeNull();
        });

        it('processFlowResponse matches option keyword', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: flowSteps });
            schedulerService.startFlow('5511@c.us', flow);

            const result = schedulerService.processFlowResponse('5511@c.us', 'yes');
            expect(result.nextStep?.id).toBe('step2');
            expect(result.response).toBe('Great!');
            expect(result.endFlow).toBe(false);
        });

        it('processFlowResponse uses default next step', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: flowSteps });
            schedulerService.startFlow('5511@c.us', flow);

            const result = schedulerService.processFlowResponse('5511@c.us', 'something else');
            expect(result.nextStep?.id).toBe('step2');
        });

        it('processFlowResponse ends when no default and no match', () => {
            const stepsNoDefault = [
                { id: 'step1', message: 'Q', waitForResponse: true, options: [{ keywords: ['yes'], nextStepId: 'step2' }] },
            ];
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: stepsNoDefault });
            schedulerService.startFlow('5511@c.us', flow);

            const result = schedulerService.processFlowResponse('5511@c.us', 'no match');
            expect(result.endFlow).toBe(true);
            expect(result.nextStep).toBeNull();
        });

        it('processFlowResponse ends when option next step not found', () => {
            const steps = [
                { id: 'step1', message: 'Q', waitForResponse: true, options: [{ keywords: ['yes'], nextStepId: 'nonexistent' }] },
            ];
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: steps });
            schedulerService.startFlow('5511@c.us', flow);

            const result = schedulerService.processFlowResponse('5511@c.us', 'yes');
            expect(result.endFlow).toBe(true);
        });

        it('processFlowResponse returns end when no active flow', () => {
            const result = schedulerService.processFlowResponse('unknown', 'test');
            expect(result.endFlow).toBe(true);
        });

        it('endFlow removes active flow', () => {
            const flow = schedulerService.createFlow({ name: 'F1', triggerKeywords: ['a'], sessionId: 's1', steps: flowSteps });
            schedulerService.startFlow('5511@c.us', flow);
            schedulerService.endFlow('5511@c.us');
            expect(schedulerService.getActiveFlow('5511@c.us')).toBeNull();
        });
    });

    describe('worker', () => {
        it('starts worker', () => {
            schedulerService.startWorker();
            expect((schedulerService as any).intervalId).not.toBeNull();
        });

        it('skips if already running', () => {
            schedulerService.startWorker();
            schedulerService.startWorker();
        });

        it('stops worker', () => {
            schedulerService.startWorker();
            schedulerService.stopWorker();
            expect((schedulerService as any).intervalId).toBeNull();
        });

        it('does nothing when stopping non-running worker', () => {
            schedulerService.stopWorker();
        });
    });

    describe('processQueue', () => {
        it('sends WhatsApp messages', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'sent1' } as any);

            schedulerService.scheduleMessage({
                chatId: '5511@c.us',
                sessionId: 's1',
                message: 'Hello!',
                scheduledAt: Date.now() - 1000,
            });

            await (schedulerService as any).processQueue();

            expect(messageService.sendText).toHaveBeenCalled();
            expect(socketService.emit).toHaveBeenCalledWith('scheduler_sent', expect.any(Object));
        });

        it('sends email messages', async () => {
            (emailService.sendEmail as any).mockResolvedValue({} as any);

            schedulerService.scheduleMessage({
                chatId: 'test@test.com',
                sessionId: 'acc1',
                channel: 'email',
                subject: 'Test',
                message: '<p>Body</p>',
                scheduledAt: Date.now() - 1000,
            });

            await (schedulerService as any).processQueue();

            expect(emailService.sendEmail).toHaveBeenCalled();
        });

        it('handles send failure', async () => {
            (messageService.sendText as any).mockRejectedValue(new Error('Send failed'));

            schedulerService.scheduleMessage({
                chatId: '5511@c.us',
                sessionId: 's1',
                message: 'Fail',
                scheduledAt: Date.now() - 1000,
            });

            await (schedulerService as any).processQueue();

            expect(socketService.emit).toHaveBeenCalledWith('scheduler_failed', expect.any(Object));
        });

        it('handles recurring reminders', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            schedulerService.scheduleReminder({
                chatId: '5511@c.us',
                sessionId: 's1',
                message: 'Repeat!',
                firstSendAt: Date.now() - 1000,
                recurrence: { interval: 1, unit: 'hours' },
            });

            await (schedulerService as any).processQueue();

            const pending = schedulerService.getPending();
            expect(pending.length).toBe(1);
            expect(pending[0].type).toBe('reminder');
        });

        it('handles recurring reminders with days unit', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            schedulerService.scheduleReminder({
                chatId: '5511@c.us',
                sessionId: 's1',
                message: 'Daily!',
                firstSendAt: Date.now() - 1000,
                recurrence: { interval: 1, unit: 'days' },
            });

            await (schedulerService as any).processQueue();
            expect(schedulerService.getPending()).toHaveLength(1);
        });

        it('handles recurring reminders with minutes unit', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'r1' } as any);

            schedulerService.scheduleReminder({
                chatId: '5511@c.us',
                sessionId: 's1',
                message: 'Minutely!',
                firstSendAt: Date.now() - 1000,
                recurrence: { interval: 5, unit: 'minutes' },
            });

            await (schedulerService as any).processQueue();
            expect(schedulerService.getPending()).toHaveLength(1);
        });

        it('creates confirmation after sending', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'c1' } as any);

            schedulerService.scheduleConfirmation({
                chatId: '5511@c.us',
                sessionId: 's1',
                message: 'Confirm?',
                onConfirm: 'callback_url',
            });

            await (schedulerService as any).processQueue();

            const conf = schedulerService.checkConfirmation('5511@c.us');
            expect(conf).not.toBeNull();
            expect(conf?.callback).toBe('callback_url');
        });

        it('rate limits per session', async () => {
            (messageService.sendText as any).mockResolvedValue({ id: 'x' } as any);

            for (let i = 0; i < 35; i++) {
                schedulerService.scheduleMessage({
                    chatId: `chat${i}@c.us`,
                    sessionId: 's1',
                    message: `Msg ${i}`,
                    scheduledAt: Date.now() - 1000,
                });
            }

            await (schedulerService as any).processQueue();

            const sent = (schedulerService as any).data.messages.filter((m: any) => m.status === 'sent').length;
            expect(sent).toBe(30);
        });
    });

    describe('getStats', () => {
        it('returns stats', () => {
            const stats = schedulerService.getStats();
            expect(stats).toHaveProperty('total');
            expect(stats).toHaveProperty('pending');
            expect(stats).toHaveProperty('templates');
            expect(stats).toHaveProperty('automationRules');
        });
    });

    describe('parseCSVContacts', () => {
        it('parses phone numbers from CSV', () => {
            const csv = `phone,name\n11999999999,John\n21988888888,Jane`;

            const result = schedulerService.parseCSVContacts(csv);
            expect(result).toHaveLength(2);
            expect(result[0]).toBe('5511999999999@c.us');
            expect(result[1]).toBe('5521988888888@c.us');
        });

        it('skips header rows', () => {
            const csv = `telefone\n11999999999`;
            const result = schedulerService.parseCSVContacts(csv);
            expect(result).toHaveLength(1);
        });

        it('handles 10-digit numbers', () => {
            const csv = `phone\n9999999999`;
            const result = schedulerService.parseCSVContacts(csv);
            expect(result[0]).toBe('559999999999@c.us');
        });

        it('removes duplicates', () => {
            const csv = `phone\n11999999999\n11999999999`;
            const result = schedulerService.parseCSVContacts(csv);
            expect(result).toHaveLength(1);
        });

        it('skips short numbers', () => {
            const csv = `phone\n123`;
            const result = schedulerService.parseCSVContacts(csv);
            expect(result).toHaveLength(0);
        });

        it('handles semicolon delimiter', () => {
            const csv = `phone;name\n11999999999;John`;
            const result = schedulerService.parseCSVContacts(csv);
            expect(result).toHaveLength(1);
        });

        it('keeps numbers already with country code', () => {
            const csv = `phone\n5511999999999`;
            const result = schedulerService.parseCSVContacts(csv);
            expect(result[0]).toBe('5511999999999@c.us');
        });

        it('skips empty lines', () => {
            const csv = `\n\n11999999999\n\n`;
            const result = schedulerService.parseCSVContacts(csv);
            expect(result).toHaveLength(1);
        });
    });
});
