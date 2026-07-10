import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { socketService } from './socketService';
import { atomicWriteSync } from '../utils/atomicWrite';
import { classifyTool, ActionDomain, ActionReversibility } from '../config/actionCatalog';

const log = createLogger('AgentActivity');

/** Origem do pedido que disparou a ação (robô-de-negócio F0.1). */
export type RequestedVia = 'chat' | 'task' | 'cron' | 'system' | 'unknown';

export interface AgentActivity {
    id: string;
    userId: string;
    userName: string;
    tool: string;
    action: string;
    entityType?: string;
    entityId?: string;
    description: string;
    result: 'success' | 'error';
    durationMs: number;
    createdAt: number;
    // F0.1/F0.3 (#1234): dimensões de governança do robô-de-negócio (via catálogo de ações).
    domain?: ActionDomain;
    reversibility?: ActionReversibility;
    requestedVia?: RequestedVia;
}

interface ActivityStore {
    activities: AgentActivity[];
}

const STORE_PATH = path.join(__dirname, '../../data/agent_activity.json');
const MAX_ACTIVITIES = 1000;

class AgentActivityService {
    private data: ActivityStore;

    constructor() {
        this.data = { activities: [] };
        this.load();
    }

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(STORE_PATH)) {
                this.data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
            }
            log.info(`Loaded ${this.data.activities.length} agent activities`);
        } catch (e) {
            log.error('Load error', e);
        }
    }

    private save() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            atomicWriteSync(STORE_PATH, this.data); // escrita atômica: evita arquivo truncado em crash
        } catch (e) {
            log.error('Save error', e);
        }
    }

    record(params: {
        userId: string;
        userName: string;
        tool: string;
        args?: Record<string, any>;
        result?: string;
        durationMs?: number;
        isError?: boolean;
        requestedVia?: RequestedVia;
    }): AgentActivity {
        const { tool, args = {}, result = '', durationMs = 0, isError = false, userId, userName, requestedVia } = params;

        // F0.1/F0.3 (#1234): classifica a ação p/ tagear domínio/reversibilidade na trilha.
        const klass = classifyTool(tool);

        const activity: AgentActivity = {
            id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            userId,
            userName,
            tool,
            action: this.inferAction(tool, args),
            entityType: this.inferEntityType(tool, args),
            entityId: this.inferEntityId(tool, args),
            description: this.buildDescription(tool, args, userName),
            result: isError ? 'error' : 'success',
            durationMs,
            createdAt: Date.now(),
            domain: klass.domain,
            reversibility: klass.reversibility,
            requestedVia: requestedVia || 'unknown',
        };

        this.data.activities.unshift(activity);
        if (this.data.activities.length > MAX_ACTIVITIES) {
            this.data.activities = this.data.activities.slice(0, MAX_ACTIVITIES);
        }
        this.save();

        socketService.emit('agent_activity', activity);

        return activity;
    }

    getActivities(options?: {
        userId?: string;
        entityType?: string;
        action?: string;
        limit?: number;
        since?: number;
    }): AgentActivity[] {
        let result = [...this.data.activities];

        if (options?.userId) result = result.filter(a => a.userId === options.userId);
        if (options?.entityType) result = result.filter(a => a.entityType === options.entityType);
        if (options?.action) result = result.filter(a => a.action === options.action);
        if (options?.since) result = result.filter(a => a.createdAt >= (options.since || 0));

        const limit = options?.limit || 50;
        return result.slice(0, limit);
    }

    getStats() {
        const total = this.data.activities.length;
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const today = this.data.activities.filter(a => a.createdAt >= oneDayAgo);
        const byTool: Record<string, number> = {};
        const byUser: Record<string, number> = {};
        for (const a of today) {
            byTool[a.tool] = (byTool[a.tool] || 0) + 1;
            byUser[a.userName] = (byUser[a.userName] || 0) + 1;
        }
        return {
            total,
            today: today.length,
            successToday: today.filter(a => a.result === 'success').length,
            errorToday: today.filter(a => a.result === 'error').length,
            byTool,
            byUser,
        };
    }

    private inferAction(tool: string, args: Record<string, any>): string {
        if (tool.startsWith('create_')) return 'create';
        if (tool.startsWith('update_') || tool.startsWith('edit_')) return 'update';
        if (tool.startsWith('delete_') || tool.startsWith('remove_')) return 'delete';
        if (tool.startsWith('validate_')) return 'validate';
        if (tool.startsWith('list_') || tool === 'search' || tool === 'search_code') return 'read';
        if (tool.startsWith('notify_') || tool === 'send_whatsapp') return 'notify';
        if (tool === 'create_invoice' || tool === 'create_order' || tool === 'create_proposal') return 'create';
        return 'action';
    }

    private inferEntityType(tool: string, args: Record<string, any>): string {
        if (tool.includes('invoice')) return 'invoice';
        if (tool.includes('order')) return 'order';
        if (tool.includes('proposal')) return 'proposal';
        if (tool.includes('customer') || tool.includes('thirdparty')) return 'customer';
        if (tool.includes('ticket')) return 'ticket';
        if (tool.includes('task')) return 'task';
        if (tool.includes('project')) return 'project';
        if (tool.includes('product')) return 'product';
        if (tool.includes('contact')) return 'contact';
        if (tool.includes('supplier')) return 'supplier';
        return args.entityType || 'unknown';
    }

    private inferEntityId(tool: string, args: Record<string, any>): string {
        return args.id || args.invoiceId || args.orderId || args.proposalId || args.customerId ||
            args.ticketId || args.taskId || args.projectId || args.productId || args.contactId ||
            args.supplierId || args.entityId || '';
    }

    private buildDescription(tool: string, args: Record<string, any>, userName: string): string {
        const entity = this.inferEntityType(tool, args);
        const action = this.inferAction(tool, args);
        const id = this.inferEntityId(tool, args) || (args.ref ? `#${args.ref}` : '');
        const name = args.name || args.label || args.subject || '';

        if (tool === 'send_whatsapp') return `Enviou WhatsApp para ${args.phone || args.chatId || 'destinatário'}`;
        if (tool === 'notify_team') return `Notificou equipe: ${(args.message || '').substring(0, 80)}`;
        if (tool === 'notify_person') return `Notificou ${args.recipientName || args.recipient || 'alguém'}`;

        const actionLabels: Record<string, string> = {
            create: 'Criou', update: 'Atualizou', delete: 'Removeu',
            validate: 'Validou', read: 'Consultou', notify: 'Notificou', action: 'Executou',
        };
        const entityLabels: Record<string, string> = {
            invoice: 'fatura', order: 'pedido', proposal: 'proposta',
            customer: 'cliente', ticket: 'ticket', task: 'tarefa',
            project: 'projeto', product: 'produto', contact: 'contato',
            supplier: 'fornecedor', unknown: 'registro',
        };

        const act = actionLabels[action] || 'Executou';
        const ent = entityLabels[entity] || entity;
        const parts = [`${act} ${ent}`];
        if (id) parts.push(id);
        if (name) parts.push(`— ${name}`);

        return parts.join(' ');
    }
}

export const agentActivityService = new AgentActivityService();
