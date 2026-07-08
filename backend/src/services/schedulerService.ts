import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { messageService } from './legacy/messageService';
import { emailService } from './emailService'; // New
import { socketService } from './socketService';
import { logger } from '../utils/logger';
import { config } from '../config/env';
import { uiConfigService } from './uiConfigService';

const log = logger.child('SchedulerService');

// --- Interfaces ---

export interface ScheduledMessage {
    id: string;
    chatId: string;
    sessionId: string;
    channel: 'whatsapp' | 'email'; // New
    subject?: string; // New (for email)
    message: string;
    scheduledAt: number; // timestamp ms
    type: 'once' | 'reminder' | 'broadcast' | 'confirmation';
    status: 'pending' | 'sent' | 'cancelled' | 'failed';
    createdAt: number;
    sentAt?: number;
    error?: string;
    metadata?: {
        // For confirmations
        confirmationCallback?: string;
        confirmationTimeout?: number; // minutes
        awaitingResponse?: boolean;
        // For recurring reminders
        recurrence?: {
            interval: number;
            unit: 'minutes' | 'hours' | 'days';
            nextRun?: number;
        };
        // For templates
        templateId?: string;
        variables?: Record<string, string>;
        // For broadcasts
        broadcastId?: string;
        delayBetween?: number; // ms
    };
}

export interface MessageTemplate {
    id: string;
    name: string;
    channel?: 'whatsapp' | 'email'; // New
    subject?: string; // New
    content: string; // Supports {{variable}} syntax
    category: 'reminder' | 'news' | 'confirmation' | 'general';
    createdAt: number;
}

// --- Automation Rules ---

export interface AutomationRule {
    id: string;
    name: string;
    event: 'invoice_created' | 'invoice_paid' | 'invoice_overdue' | 'ticket_created' | 'ticket_closed' | 'ticket_updated' | 'order_created' | 'custom';
    enabled: boolean;
    channel: 'whatsapp' | 'email'; // New
    sessionId: string;
    templateId?: string;
    subject?: string; // New
    message?: string;
    delay?: number; // minutes after event
    conditions?: {
        field: string;
        operator: 'equals' | 'contains' | 'greater' | 'less';
        value: string;
    }[];
    createdAt: number;
}

// --- Message Logs ---

export interface MessageLog {
    id: string;
    messageId: string;
    chatId: string;
    channel?: 'whatsapp' | 'email'; // New
    sessionId: string;
    type: 'scheduled' | 'broadcast' | 'reminder' | 'confirmation' | 'chatbot' | 'webhook';
    status: 'pending' | 'sent' | 'failed' | 'cancelled';
    message: string;
    error?: string;
    createdAt: number;
    sentAt?: number;
    metadata?: Record<string, any>;
}

// --- Chatbot Flows ---

export interface ChatFlowStep {
    id: string;
    message: string;
    waitForResponse: boolean;
    options?: {
        keywords: string[]; // Words that trigger this option
        nextStepId: string;
        response?: string; // Optional immediate response
    }[];
    defaultNextStepId?: string; // If no option matches
    action?: {
        type: 'send_template' | 'call_webhook' | 'end_flow';
        templateId?: string;
        webhookUrl?: string;
    };
}

export interface ChatFlow {
    id: string;
    name: string;
    triggerKeywords: string[]; // Keywords that start this flow
    enabled: boolean;
    sessionId: string;
    steps: ChatFlowStep[];
    createdAt: number;
}

// --- Active Flow Sessions ---

interface ActiveFlowSession {
    flowId: string;
    currentStepId: string;
    startedAt: number;
    data: Record<string, any>; // Collected data
}

interface SchedulerStore {
    messages: ScheduledMessage[];
    templates: MessageTemplate[];
    confirmations: {
        [chatId: string]: {
            messageId: string;
            callback: string;
            expiresAt: number;
        };
    };
    // New: Persisted automation rules
    automationRules: AutomationRule[];
    // New: Message logs for history/analytics
    logs: MessageLog[];
    // New: Chatbot flows
    chatFlows: ChatFlow[];
    // New: Active flow sessions per chat
    activeFlows: {
        [chatId: string]: ActiveFlowSession;
    };
}

// --- Constants ---

const STORE_PATH = path.join(__dirname, '../../data/scheduler_store.json');
const CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
const MAX_MESSAGES_PER_MINUTE = 30;

// --- Service ---

class SchedulerService {
    private data: SchedulerStore;
    private intervalId: NodeJS.Timeout | null = null;
    // Rate limiting per session (account)
    private messagesSentPerSession: Map<string, number> = new Map();
    private lastMinuteReset: number = Date.now();

    constructor() {
        this.data = {
            messages: [],
            templates: [],
            confirmations: {},
            automationRules: [],
            logs: [],
            chatFlows: [],
            activeFlows: {}
        };
        this.load();
        this.initDefaultRules();
    }

    private initDefaultRules() {
        const defaults = [
            {
                name: 'Fatura Criada',
                event: 'invoice_created',
                message: "Olá {{customerName}}! 📋\\n\\nUma nova fatura foi gerada:\\n📌 Ref: {{ref}}\\n💰 Valor: {{total}}\\n\\nQualquer dúvida, estamos à disposição!",
                channel: 'whatsapp',
                subject: ''
            },
            {
                name: 'Fatura Paga',
                event: 'invoice_paid',
                message: "Olá {{customerName}}! ✅\\n\\nRecebemos o pagamento da fatura {{ref}}.\\n\\nObrigado pela confiança!",
                channel: 'whatsapp',
                subject: ''
            },
            {
                name: 'Fatura Vencida',
                event: 'invoice_overdue',
                message: "Olá {{customerName}}! ⚠️\\n\\nLembramos que a fatura {{ref}} ({{total}}) está vencida.\\n\\nPodemos ajudar com alguma questão?",
                channel: 'whatsapp',
                subject: ''
            },
            {
                name: 'Chamado Aberto',
                event: 'ticket_created',
                message: "Olá! 🎫\\n\\nSeu chamado foi aberto com sucesso:\\n📌 Ref: {{ref}}\\n📝 {{subject}}\\n\\nEm breve entraremos em contato!",
                channel: 'whatsapp',
                subject: ''
            },
            {
                name: 'Chamado Fechado',
                event: 'ticket_closed',
                message: "Olá! ✅\\n\\nSeu chamado {{ref}} foi finalizado.\\n\\nAgradecemos o contato!",
                channel: 'whatsapp',
                subject: ''
            },
            {
                name: 'Chamado Atualizado',
                event: 'ticket_updated',
                message: "Olá! 📝\\n\\nHouve uma atualização no chamado {{ref}}.\\n\\nAcompanhe pelo sistema ou responda aqui.",
                channel: 'whatsapp',
                subject: ''
            },
            {
                name: 'Pedido Criado',
                event: 'order_created',
                message: "Olá {{customerName}}! 🛒\\n\\nSeu pedido foi registrado com sucesso!\\n📌 Ref: {{ref}}\\n💰 Valor: {{total}}\\n\\nEm breve entraremos em contato!",
                channel: 'whatsapp',
                subject: ''
            },
            // Email Defaults
            {
                name: 'Email: Fatura Criada',
                event: 'invoice_created',
                message: "<p>Olá <strong>{{customerName}}</strong>,</p><p>Uma nova fatura foi gerada para você.</p><ul><li>Ref: {{ref}}</li><li>Valor: {{total}}</li></ul><p>Atenciosamente,<br>Equipe</p>",
                channel: 'email',
                subject: 'Nova Fatura Disponível - {{ref}}'
            },
            {
                name: 'Email: Pedido Confirmado',
                event: 'order_created',
                message: "<p>Olá <strong>{{customerName}}</strong>,</p><p>Recebemos seu pedido com sucesso!</p><h2>Detalhes do Pedido</h2><ul><li>Referência: {{ref}}</li><li>Total: {{total}}</li></ul><p>Obrigado pela preferência.</p>",
                channel: 'email',
                subject: 'Confirmação de Pedido #{{ref}}'
            }
        ] as const;

        let added = false;
        defaults.forEach(def => {
            const exists = this.data.automationRules.some(r => r.event === def.event && r.channel === (def.channel || 'whatsapp'));
            if (!exists) {
                this.createRule({
                    name: def.name,
                    event: def.event as any,
                    channel: (def.channel as 'whatsapp' | 'email') || 'whatsapp',
                    sessionId: 'default', // Will need to be updated by user for email
                    message: def.message,
                    subject: def.subject,
                    delay: 0
                });
                added = true;
            }
        });

        if (added) log.info('Default rules initialized');
    }

    // --- Persistence ---

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(STORE_PATH)) {
                const content = fs.readFileSync(STORE_PATH, 'utf-8');
                const parsed = JSON.parse(content);
                this.data = {
                    messages: parsed.messages || [],
                    templates: parsed.templates || [],
                    confirmations: parsed.confirmations || {},
                    automationRules: this.dedupRulesById(parsed.automationRules || []),
                    logs: parsed.logs || [],
                    chatFlows: parsed.chatFlows || [],
                    activeFlows: parsed.activeFlows || {}
                };
                log.info(`Loaded ${this.data.messages.length} messages, ${this.data.templates.length} templates, ${this.data.automationRules.length} rules, ${this.data.chatFlows.length} flows`);
            }
        } catch (error) {
            log.error('Load Error', error);
        }
    }

    private save() {
        try {
            atomicWriteSync(STORE_PATH, this.data);
        } catch (error) {
            log.error('Save Error', error);
        }
    }

    // --- Worker ---

    startWorker() {
        if (this.intervalId) {
            log.info('Worker already running');
            return;
        }

        log.info(`Starting worker (check every ${CHECK_INTERVAL_MS / 1000}s)`);
        this.intervalId = setInterval(() => this.processQueue(), CHECK_INTERVAL_MS);

        // Also run immediately
        this.processQueue();
    }

    stopWorker() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            log.info('Worker stopped');
        }
    }

    get isRunning(): boolean {
        return this.intervalId !== null;
    }

    async processQueue() {
        // #1204 — Kill-switch da UI: pausa o envio de mensagens agendadas (WhatsApp/e-mail) sem
        // derrubar o backend. Checado a CADA tick (sem cache): religar o switch volta a processar
        // no próximo ciclo, sem restart.
        if (!uiConfigService.get().automationSwitches.schedulerEnabled) {
            log.info('processQueue pausado pela UI (schedulerEnabled=false)');
            return;
        }

        const now = Date.now();

        // Reset rate limit counters every minute
        if (now - this.lastMinuteReset > 60000) {
            this.messagesSentPerSession.clear();
            this.lastMinuteReset = now;
        }

        // Get pending messages that are due
        const pending = this.data.messages.filter(
            m => m.status === 'pending' && m.scheduledAt <= now
        );

        if (pending.length === 0) return;

        log.info(`Processing ${pending.length} pending messages`);

        for (const msg of pending) {
            // Rate limiting per session
            const sessionCount = this.messagesSentPerSession.get(msg.sessionId) || 0;
            if (sessionCount >= MAX_MESSAGES_PER_MINUTE) {
                log.warn(`Rate limit reached for session ${msg.sessionId}, skipping`);
                continue; // Skip this message but continue with others from different sessions
            }

            await this.sendScheduledMessage(msg);
        }
    }

    private async sendScheduledMessage(msg: ScheduledMessage) {
        try {
            log.info(`Sending to ${msg.chatId}: "${msg.message.substring(0, 50)}..."`);

            if (msg.channel === 'email') {
                await emailService.sendEmail(msg.sessionId, msg.chatId, msg.subject || 'Notificação', msg.message);
            } else {
                await messageService.sendText(msg.sessionId, msg.chatId, msg.message);
            }

            // Update status
            msg.status = 'sent';
            msg.sentAt = Date.now();

            // Increment per-session counter
            const currentCount = this.messagesSentPerSession.get(msg.sessionId) || 0;
            this.messagesSentPerSession.set(msg.sessionId, currentCount + 1);

            // Handle recurrence
            if (msg.type === 'reminder' && msg.metadata?.recurrence) {
                const { interval, unit } = msg.metadata.recurrence;
                let nextRunMs = interval;
                if (unit === 'hours') nextRunMs *= 60 * 60 * 1000;
                else if (unit === 'days') nextRunMs *= 24 * 60 * 60 * 1000;
                else nextRunMs *= 60 * 1000; // minutes

                // Create next occurrence
                this.scheduleMessage({
                    chatId: msg.chatId,
                    sessionId: msg.sessionId,
                    message: msg.message,
                    scheduledAt: Date.now() + nextRunMs,
                    type: 'reminder',
                    metadata: msg.metadata
                });
            }

            // Handle confirmations
            if (msg.type === 'confirmation' && msg.metadata?.confirmationCallback) {
                this.data.confirmations[msg.chatId] = {
                    messageId: msg.id,
                    callback: msg.metadata.confirmationCallback,
                    expiresAt: Date.now() + (msg.metadata.confirmationTimeout || 60) * 60 * 1000
                };
            }

            // Emit event
            socketService.emit('scheduler_sent', {
                id: msg.id,
                chatId: msg.chatId,
                status: 'sent'
            });

            this.save();

        } catch (error: any) {
            log.error(`Failed to send ${msg.id}: ${error.message}`);
            msg.status = 'failed';
            msg.error = error.message;
            this.save();

            socketService.emit('scheduler_failed', {
                id: msg.id,
                chatId: msg.chatId,
                error: error.message
            });
        }
    }

    // --- Public API ---

    /**
     * Schedule a single message
     */
    scheduleMessage(params: {
        chatId: string;
        sessionId: string;
        channel?: 'whatsapp' | 'email';
        subject?: string;
        message: string;
        scheduledAt: number;
        type?: ScheduledMessage['type'];
        metadata?: ScheduledMessage['metadata'];
    }): ScheduledMessage {
        const msg: ScheduledMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            chatId: params.chatId,
            sessionId: params.sessionId,
            channel: params.channel || 'whatsapp',
            subject: params.subject,
            message: params.message,
            scheduledAt: params.scheduledAt,
            type: params.type || 'once',
            status: 'pending',
            createdAt: Date.now(),
            metadata: params.metadata
        };

        this.data.messages.push(msg);
        this.save();

        log.info(`Scheduled message ${msg.id} for ${new Date(msg.scheduledAt).toISOString()}`);

        socketService.emit('scheduler_created', msg);

        return msg;
    }

    /**
     * Schedule a broadcast to multiple contacts
     */
    async scheduleBroadcast(params: {
        sessionId: string;
        chatIds: string[];
        channel?: 'whatsapp' | 'email';
        subject?: string;
        message: string;
        scheduledAt?: number;
        delayBetween?: number;
    }): Promise<ScheduledMessage[]> {
        // Defesa em profundidade: limita destinatários por broadcast (anti-spam em massa).
        // A rota já valida via Zod, mas o serviço é chamado de outros pontos (ex.: agente).
        if (params.chatIds.length > config.schedulerMaxBroadcast) {
            throw new Error(`Broadcast excede o limite de ${config.schedulerMaxBroadcast} destinatários (recebidos: ${params.chatIds.length})`);
        }

        const broadcastId = `broadcast_${Date.now()}`;
        const baseTime = params.scheduledAt || Date.now();
        const delay = params.delayBetween || 3000; // 3s default

        const messages: ScheduledMessage[] = [];

        for (let i = 0; i < params.chatIds.length; i++) {
            const msg = this.scheduleMessage({
                chatId: params.chatIds[i],
                sessionId: params.sessionId,
                channel: params.channel,
                subject: params.subject,
                message: params.message,
                scheduledAt: baseTime + (i * delay),
                type: 'broadcast',
                metadata: { broadcastId, delayBetween: delay }
            });
            messages.push(msg);
        }

        log.info(`Created broadcast ${broadcastId} with ${messages.length} messages`);

        return messages;
    }

    /**
     * Get details of a broadcast (all messages in a broadcast)
     */
    getBroadcastDetails(broadcastId: string): {
        broadcastId: string;
        totalCount: number;
        pending: number;
        sent: number;
        failed: number;
        cancelled: number;
        messages: ScheduledMessage[];
    } | null {
        const messages = this.data.messages.filter(m => m.metadata?.broadcastId === broadcastId);

        if (messages.length === 0) return null;

        return {
            broadcastId,
            totalCount: messages.length,
            pending: messages.filter(m => m.status === 'pending').length,
            sent: messages.filter(m => m.status === 'sent').length,
            failed: messages.filter(m => m.status === 'failed').length,
            cancelled: messages.filter(m => m.status === 'cancelled').length,
            messages: messages.sort((a, b) => a.scheduledAt - b.scheduledAt)
        };
    }

    /**
     * Get list of all broadcasts
     */
    getBroadcasts(): { broadcastId: string; count: number; status: string; createdAt: number }[] {
        const broadcastIds = new Set<string>();
        this.data.messages.forEach(m => {
            if (m.metadata?.broadcastId) broadcastIds.add(m.metadata.broadcastId);
        });

        return Array.from(broadcastIds).map(id => {
            const msgs = this.data.messages.filter(m => m.metadata?.broadcastId === id);
            const pending = msgs.filter(m => m.status === 'pending').length;
            const sent = msgs.filter(m => m.status === 'sent').length;
            const failed = msgs.filter(m => m.status === 'failed').length;

            let status = 'pending';
            if (pending === 0 && failed === 0) status = 'completed';
            else if (pending === 0 && failed > 0) status = 'completed_with_errors';
            else if (sent > 0) status = 'in_progress';

            return {
                broadcastId: id,
                count: msgs.length,
                status,
                createdAt: msgs[0]?.createdAt || 0
            };
        }).sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * Schedule a confirmation request
     */
    scheduleConfirmation(params: {
        chatId: string;
        sessionId: string;
        message: string;
        timeoutMinutes?: number;
        onConfirm?: string;
        onReject?: string;
    }): ScheduledMessage {
        return this.scheduleMessage({
            chatId: params.chatId,
            sessionId: params.sessionId,
            message: params.message,
            scheduledAt: Date.now(), // Send immediately
            type: 'confirmation',
            metadata: {
                confirmationCallback: params.onConfirm || params.onReject,
                confirmationTimeout: params.timeoutMinutes || 60,
                awaitingResponse: true
            }
        });
    }

    /**
     * Schedule a recurring reminder
     */
    scheduleReminder(params: {
        chatId: string;
        sessionId: string;
        message: string;
        firstSendAt: number;
        recurrence: {
            interval: number;
            unit: 'minutes' | 'hours' | 'days';
        };
    }): ScheduledMessage {
        return this.scheduleMessage({
            chatId: params.chatId,
            sessionId: params.sessionId,
            message: params.message,
            scheduledAt: params.firstSendAt,
            type: 'reminder',
            metadata: { recurrence: params.recurrence }
        });
    }

    /**
     * Cancel a scheduled message
     */
    cancelMessage(id: string): boolean {
        const msg = this.data.messages.find(m => m.id === id);
        if (msg && msg.status === 'pending') {
            msg.status = 'cancelled';
            this.save();
            log.info(`Cancelled message ${id}`);
            return true;
        }
        return false;
    }

    /**
     * Get pending messages
     */
    getPending(sessionId?: string): ScheduledMessage[] {
        return this.data.messages.filter(m =>
            m.status === 'pending' &&
            (!sessionId || m.sessionId === sessionId)
        );
    }

    /**
     * Get message history
     */
    getHistory(options?: {
        sessionId?: string;
        status?: ScheduledMessage['status'];
        limit?: number;
    }): ScheduledMessage[] {
        let result = [...this.data.messages];

        if (options?.sessionId) {
            result = result.filter(m => m.sessionId === options.sessionId);
        }
        if (options?.status) {
            result = result.filter(m => m.status === options.status);
        }

        // Sort by scheduledAt descending
        result.sort((a, b) => b.scheduledAt - a.scheduledAt);

        if (options?.limit) {
            result = result.slice(0, options.limit);
        }

        return result;
    }

    /**
     * Check if a chat has a pending confirmation
     */
    checkConfirmation(chatId: string): { messageId: string; callback: string } | null {
        const conf = this.data.confirmations[chatId];
        if (!conf) return null;

        // Check if expired
        if (Date.now() > conf.expiresAt) {
            delete this.data.confirmations[chatId];
            this.save();
            return null;
        }

        return conf;
    }

    /**
     * Handle confirmation response
     */
    handleConfirmationResponse(chatId: string, isConfirmed: boolean): string | null {
        const conf = this.data.confirmations[chatId];
        if (!conf) return null;

        delete this.data.confirmations[chatId];
        this.save();

        log.info(`Confirmation ${isConfirmed ? 'accepted' : 'rejected'} for ${chatId}`);

        return conf.callback;
    }

    // --- Templates ---

    createTemplate(params: {
        name: string;
        content: string;
        channel?: 'whatsapp' | 'email';
        subject?: string;
        category?: MessageTemplate['category'];
    }): MessageTemplate {
        const template: MessageTemplate = {
            id: `tpl_${Date.now()}`,
            name: params.name,
            content: params.content,
            channel: params.channel || 'whatsapp',
            subject: params.subject,
            category: params.category || 'general',
            createdAt: Date.now()
        };

        this.data.templates.push(template);
        this.save();

        return template;
    }

    getTemplates(): MessageTemplate[] {
        return this.data.templates;
    }

    getTemplate(id: string): MessageTemplate | undefined {
        return this.data.templates.find(t => t.id === id);
    }

    deleteTemplate(id: string): boolean {
        const idx = this.data.templates.findIndex(t => t.id === id);
        if (idx >= 0) {
            this.data.templates.splice(idx, 1);
            this.save();
            return true;
        }
        return false;
    }

    updateTemplate(id: string, updates: {
        name?: string;
        content?: string;
        category?: MessageTemplate['category'];
        channel?: 'whatsapp' | 'email';
        subject?: string;
    }): MessageTemplate | null {
        const tpl = this.data.templates.find(t => t.id === id);
        if (!tpl) return null;
        if (updates.name !== undefined) tpl.name = updates.name;
        if (updates.content !== undefined) tpl.content = updates.content;
        if (updates.category !== undefined) tpl.category = updates.category;
        if (updates.channel !== undefined) tpl.channel = updates.channel;
        if (updates.subject !== undefined) tpl.subject = updates.subject;
        this.save();
        log.info(`Updated template: ${tpl.name}`);
        return tpl;
    }

    /**
     * Render a template with variables
     */
    renderTemplate(templateId: string, variables: Record<string, string>): string | null {
        const template = this.getTemplate(templateId);
        if (!template) return null;

        let content = template.content;
        for (const [key, value] of Object.entries(variables)) {
            content = content.replaceAll(`{{${key}}}`, value);
        }

        return content;
    }

    // --- Stats ---

    getStats() {
        const messages = this.data.messages;
        const logs = this.data.logs;
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;

        return {
            total: messages.length,
            pending: messages.filter(m => m.status === 'pending').length,
            sent: messages.filter(m => m.status === 'sent').length,
            failed: messages.filter(m => m.status === 'failed').length,
            cancelled: messages.filter(m => m.status === 'cancelled').length,
            templates: this.data.templates.length,
            pendingConfirmations: Object.keys(this.data.confirmations).length,
            // New stats
            automationRules: this.data.automationRules.length,
            activeRules: this.data.automationRules.filter(r => r.enabled).length,
            chatFlows: this.data.chatFlows.length,
            activeFlowSessions: Object.keys(this.data.activeFlows).length,
            logsTotal: logs.length,
            logsSentToday: logs.filter(l => l.status === 'sent' && l.sentAt && l.sentAt > oneDayAgo).length,
            logsFailedToday: logs.filter(l => l.status === 'failed' && l.createdAt > oneDayAgo).length
        };
    }

    // --- Automation Rules ---

    /**
     * Gera um id de regra único. `Date.now()` sozinho colide quando várias
     * regras são criadas no mesmo milissegundo (ex.: seed initDefaultRules),
     * gerando chaves React duplicadas no frontend (#823). Por isso, se o id
     * base já existir, anexamos um sufixo incremental.
     */
    private generateRuleId(): string {
        const base = `rule_${Date.now()}`;
        let id = base;
        let suffix = 1;
        while (this.data.automationRules.some(r => r.id === id)) {
            id = `${base}_${suffix++}`;
        }
        return id;
    }

    /** Remove regras com id duplicado mantendo a primeira ocorrência (#823). */
    private dedupRulesById(rules: AutomationRule[]): AutomationRule[] {
        const seen = new Set<string>();
        const out: AutomationRule[] = [];
        for (const rule of rules) {
            if (rule && !seen.has(rule.id)) {
                seen.add(rule.id);
                out.push(rule);
            }
        }
        return out;
    }

    createRule(params: {
        name: string;
        event: AutomationRule['event'];
        channel?: 'whatsapp' | 'email';
        sessionId: string;
        templateId?: string;
        subject?: string;
        message?: string;
        delay?: number;
        conditions?: AutomationRule['conditions'];
    }): AutomationRule {
        const rule: AutomationRule = {
            id: this.generateRuleId(),
            name: params.name,
            event: params.event,
            enabled: true,
            channel: params.channel || 'whatsapp',
            sessionId: params.sessionId,
            templateId: params.templateId,
            subject: params.subject,
            message: params.message,
            delay: params.delay,
            conditions: params.conditions,
            createdAt: Date.now()
        };

        this.data.automationRules.push(rule);
        this.save();
        log.info(`Created automation rule: ${rule.name}`);

        return rule;
    }

    getRules(): AutomationRule[] {
        return this.data.automationRules;
    }

    toggleRule(id: string): boolean {
        const rule = this.data.automationRules.find(r => r.id === id);
        if (rule) {
            rule.enabled = !rule.enabled;
            this.save();
            return true;
        }
        return false;
    }

    deleteRule(id: string): boolean {
        const idx = this.data.automationRules.findIndex(r => r.id === id);
        if (idx >= 0) {
            this.data.automationRules.splice(idx, 1);
            this.save();
            return true;
        }
        return false;
    }

    updateRule(id: string, updates: {
        name?: string;
        message?: string;
        delay?: number;
        templateId?: string;
        channel?: 'whatsapp' | 'email';
        subject?: string;
        sessionId?: string;
        conditions?: AutomationRule['conditions'];
    }): AutomationRule | null {
        const rule = this.data.automationRules.find(r => r.id === id);
        if (!rule) return null;

        if (updates.name !== undefined) rule.name = updates.name;
        if (updates.message !== undefined) rule.message = updates.message;
        if (updates.delay !== undefined) rule.delay = updates.delay;
        if (updates.templateId !== undefined) rule.templateId = updates.templateId;
        if (updates.channel !== undefined) rule.channel = updates.channel;
        if (updates.subject !== undefined) rule.subject = updates.subject;
        if (updates.sessionId !== undefined) rule.sessionId = updates.sessionId;
        if (updates.conditions !== undefined) rule.conditions = updates.conditions;

        this.save();
        log.info(`Updated automation rule: ${rule.name}`);
        return rule;
    }

    // --- Message Logs ---

    addLog(params: {
        messageId: string;
        chatId: string;
        sessionId: string;
        channel?: 'whatsapp' | 'email';
        type: MessageLog['type'];
        status: MessageLog['status'];
        message: string;
        error?: string;
        metadata?: Record<string, any>;
    }): MessageLog {
        const log: MessageLog = {
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            messageId: params.messageId,
            chatId: params.chatId,
            sessionId: params.sessionId,
            channel: params.channel,
            type: params.type,
            status: params.status,
            message: params.message,
            error: params.error,
            createdAt: Date.now(),
            sentAt: params.status === 'sent' ? Date.now() : undefined,
            metadata: params.metadata
        };

        this.data.logs.push(log);

        // Keep only last 1000 logs to prevent unlimited growth
        if (this.data.logs.length > 1000) {
            this.data.logs = this.data.logs.slice(-1000);
        }

        this.save();
        return log;
    }

    getLogs(options?: {
        sessionId?: string;
        type?: MessageLog['type'];
        status?: MessageLog['status'];
        limit?: number;
        since?: number; // timestamp
    }): MessageLog[] {
        let result = [...this.data.logs];

        if (options?.sessionId) {
            result = result.filter(l => l.sessionId === options.sessionId);
        }
        if (options?.type) {
            result = result.filter(l => l.type === options.type);
        }
        if (options?.status) {
            result = result.filter(l => l.status === options.status);
        }
        if (options?.since) {
            result = result.filter(l => l.createdAt >= options.since!);
        }

        // Sort by createdAt descending
        result.sort((a, b) => b.createdAt - a.createdAt);

        if (options?.limit) {
            result = result.slice(0, options.limit);
        }

        return result;
    }

    // --- Chatbot Flows ---

    createFlow(params: {
        name: string;
        triggerKeywords: string[];
        sessionId: string;
        steps: ChatFlowStep[];
    }): ChatFlow {
        const flow: ChatFlow = {
            id: `flow_${Date.now()}`,
            name: params.name,
            triggerKeywords: params.triggerKeywords.map(k => k.toLowerCase()),
            enabled: true,
            sessionId: params.sessionId,
            steps: params.steps,
            createdAt: Date.now()
        };

        this.data.chatFlows.push(flow);
        this.save();
        log.info(`Created chatbot flow: ${flow.name}`);

        return flow;
    }

    getFlows(): ChatFlow[] {
        return this.data.chatFlows;
    }

    getFlow(id: string): ChatFlow | undefined {
        return this.data.chatFlows.find(f => f.id === id);
    }

    toggleFlow(id: string): boolean {
        const flow = this.data.chatFlows.find(f => f.id === id);
        if (flow) {
            flow.enabled = !flow.enabled;
            this.save();
            return true;
        }
        return false;
    }

    deleteFlow(id: string): boolean {
        const idx = this.data.chatFlows.findIndex(f => f.id === id);
        if (idx >= 0) {
            this.data.chatFlows.splice(idx, 1);
            this.save();
            return true;
        }
        return false;
    }

    updateFlow(id: string, updates: {
        name?: string;
        triggerKeywords?: string[];
        initialMessage?: string;
    }): ChatFlow | null {
        const flow = this.data.chatFlows.find(f => f.id === id);
        if (!flow) return null;
        if (updates.name !== undefined) flow.name = updates.name;
        if (updates.triggerKeywords !== undefined) {
            flow.triggerKeywords = updates.triggerKeywords.map(k => k.toLowerCase());
        }
        if (updates.initialMessage !== undefined && flow.steps.length > 0) {
            flow.steps[0] = { ...flow.steps[0], message: updates.initialMessage };
        }
        this.save();
        log.info(`Updated flow: ${flow.name}`);
        return flow;
    }

    /**
     * Check if message triggers a flow
     */
    checkFlowTrigger(sessionId: string, message: string): ChatFlow | null {
        const lowerMsg = message.toLowerCase().trim();

        for (const flow of this.data.chatFlows) {
            if (!flow.enabled || flow.sessionId !== sessionId) continue;

            for (const keyword of flow.triggerKeywords) {
                if (lowerMsg.includes(keyword)) {
                    return flow;
                }
            }
        }

        return null;
    }

    /**
     * Start a flow for a chat
     */
    startFlow(chatId: string, flow: ChatFlow): ChatFlowStep | null {
        if (flow.steps.length === 0) return null;

        const firstStep = flow.steps[0];

        this.data.activeFlows[chatId] = {
            flowId: flow.id,
            currentStepId: firstStep.id,
            startedAt: Date.now(),
            data: {}
        };

        this.save();
        log.info(`Started flow ${flow.name} for ${chatId}`);

        return firstStep;
    }

    /**
     * Get active flow for a chat
     */
    getActiveFlow(chatId: string): { flow: ChatFlow; currentStep: ChatFlowStep } | null {
        const session = this.data.activeFlows[chatId];
        if (!session) return null;

        const flow = this.data.chatFlows.find(f => f.id === session.flowId);
        if (!flow) {
            delete this.data.activeFlows[chatId];
            return null;
        }

        const currentStep = flow.steps.find(s => s.id === session.currentStepId);
        if (!currentStep) {
            delete this.data.activeFlows[chatId];
            return null;
        }

        return { flow, currentStep };
    }

    /**
     * Process user response in active flow
     */
    processFlowResponse(chatId: string, response: string): { nextStep: ChatFlowStep | null; endFlow: boolean; response?: string } {
        const active = this.getActiveFlow(chatId);
        if (!active) return { nextStep: null, endFlow: true };

        const { flow, currentStep } = active;
        const lowerResponse = response.toLowerCase().trim();

        // Check options
        if (currentStep.options) {
            for (const option of currentStep.options) {
                for (const keyword of option.keywords) {
                    if (lowerResponse.includes(keyword.toLowerCase())) {
                        const nextStep = flow.steps.find(s => s.id === option.nextStepId);

                        if (nextStep) {
                            this.data.activeFlows[chatId].currentStepId = nextStep.id;
                            this.save();
                            return { nextStep, endFlow: false, response: option.response };
                        } else {
                            this.endFlow(chatId);
                            return { nextStep: null, endFlow: true, response: option.response };
                        }
                    }
                }
            }
        }

        // Default path
        if (currentStep.defaultNextStepId) {
            const nextStep = flow.steps.find(s => s.id === currentStep.defaultNextStepId);
            if (nextStep) {
                this.data.activeFlows[chatId].currentStepId = nextStep.id;
                this.save();
                return { nextStep, endFlow: false };
            }
        }

        // No match, end flow
        this.endFlow(chatId);
        return { nextStep: null, endFlow: true };
    }

    /**
     * End active flow
     */
    endFlow(chatId: string) {
        delete this.data.activeFlows[chatId];
        this.save();
        log.info(`Ended flow for ${chatId}`);
    }

    // --- CSV Import ---

    parseCSVContacts(csvContent: string): string[] {
        const lines = csvContent.split('\n');
        const chatIds: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('phone') || trimmed.startsWith('telefone')) continue;

            // Extract first column (phone)
            const parts = trimmed.split(/[,;]/);
            let phone = parts[0].replace(/\D/g, '');

            // Ensure Brazilian format
            if (phone.length === 11 && !phone.startsWith('55')) {
                phone = '55' + phone;
            } else if (phone.length === 10) {
                phone = '55' + phone;
            }

            if (phone.length >= 12) {
                chatIds.push(phone + '@c.us');
            }
        }

        return [...new Set(chatIds)]; // Remove duplicates
    }
}

export const schedulerService = new SchedulerService();
