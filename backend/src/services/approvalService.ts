/**
 * Approval Service
 *
 * Gerencia fila de aprovação para automações bancárias.
 * Todas as ações de alto risco passam por conferência antes de execução.
 *
 * Persistência: arquivo JSON (mesmo padrão do storeService — atomicWriteSync), então
 * a fila SOBREVIVE a restart (antes era 100% em memória — #36). Inclui TTL para ações
 * pendentes (expiram se não revisadas) e retenção/cap do histórico.
 */

import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { socketService } from './socketService';
import { interApiService } from './interApiService';
import { itauApiService } from './itauApiService';
import { messageService } from './legacy/messageService';
import { dolibarrService } from './dolibarrService';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('ApprovalService');

// ===== Types =====

export type ActionType =
    | 'pagar_boleto'
    | 'enviar_pix'
    | 'baixar_fatura'
    | 'enviar_documento'
    | 'aprovar_reconciliacao'
    | 'consulta_saldo';

export type ActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface PendingAction {
    id: string;
    type: ActionType;
    banco?: 'inter' | 'itau';
    payload: any;
    description: string;           // Descrição legível da ação
    riskLevel: 'low' | 'medium' | 'high';
    requestedBy: string;           // ID ou nome do usuário
    requestedAt: Date;
    status: ActionStatus;
    reviewedBy?: string;
    reviewedAt?: Date;
    rejectionReason?: string;
    executedAt?: Date;
    result?: any;
    error?: string;
    // Campos para notificação WhatsApp
    notifyOnComplete?: {
        sessionId: string;
        chatId: string;
    };
}

const TERMINAL: ActionStatus[] = ['rejected', 'executed', 'failed'];

// TTL/retention — configuráveis por env.
const PENDING_TTL_MS = (Number(process.env.APPROVAL_PENDING_TTL_HOURS) || 24) * 3600 * 1000;
const HISTORY_RETENTION_MS = (Number(process.env.APPROVAL_HISTORY_RETENTION_DAYS) || 30) * 86400 * 1000;
const HISTORY_MAX = 1000;

const DEFAULT_STORE_PATH = path.join(__dirname, '../../data/approvals.json');

// ===== Approval Service =====

export class ApprovalService {
    private actions: Map<string, PendingAction> = new Map();
    private storePath: string;

    constructor(storePath: string = DEFAULT_STORE_PATH) {
        this.storePath = storePath;
        this.load();
    }

    // ===== Persistência =====

    private load(): void {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(this.storePath)) return;

            const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
            const arr: any[] = Array.isArray(parsed?.actions) ? parsed.actions : [];
            for (const a of arr) {
                this.actions.set(a.id, {
                    ...a,
                    requestedAt: new Date(a.requestedAt),
                    reviewedAt: a.reviewedAt ? new Date(a.reviewedAt) : undefined,
                    executedAt: a.executedAt ? new Date(a.executedAt) : undefined,
                });
            }
            log.info(`Aprovações carregadas: ${this.actions.size}`);
        } catch (error) {
            log.error('Load Error', error);
        }
    }

    private save(): void {
        try {
            atomicWriteSync(this.storePath, { actions: Array.from(this.actions.values()) });
        } catch (error) {
            log.error('Save Error', error);
        }
    }

    /**
     * Expira ações pendentes antigas (TTL) e remove histórico velho/excedente.
     * Roda sob demanda (nas leituras/escritas) — barato para o volume esperado.
     */
    private cleanup(): void {
        const now = Date.now();
        let changed = false;

        for (const action of this.actions.values()) {
            if (action.status === 'pending' && now - new Date(action.requestedAt).getTime() > PENDING_TTL_MS) {
                action.status = 'failed';
                action.error = 'Expirada por TTL (não revisada a tempo)';
                action.reviewedAt = new Date();
                changed = true;
                log.warn(`Ação expirada por TTL: ${action.id}`);
            }
        }

        // Retenção: remove terminais antigas.
        for (const [id, action] of this.actions) {
            if (TERMINAL.includes(action.status)) {
                const ts = new Date(action.reviewedAt || action.executedAt || action.requestedAt).getTime();
                if (now - ts > HISTORY_RETENTION_MS) {
                    this.actions.delete(id);
                    changed = true;
                }
            }
        }

        // Cap do histórico: mantém apenas as HISTORY_MAX terminais mais recentes.
        const terminal = Array.from(this.actions.values())
            .filter(a => TERMINAL.includes(a.status))
            .sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());
        if (terminal.length > HISTORY_MAX) {
            for (const a of terminal.slice(0, terminal.length - HISTORY_MAX)) {
                this.actions.delete(a.id);
                changed = true;
            }
        }

        if (changed) this.save();
    }

    /**
     * Cria uma nova ação pendente na fila de aprovação
     */
    async createPendingAction(params: {
        type: ActionType;
        banco?: 'inter' | 'itau';
        payload: any;
        description: string;
        requestedBy: string;
    }): Promise<PendingAction> {
        const action: PendingAction = {
            id: uuidv4(),
            type: params.type,
            banco: params.banco,
            payload: params.payload,
            description: params.description,
            riskLevel: this.getRiskLevel(params.type),
            requestedBy: params.requestedBy,
            requestedAt: new Date(),
            status: 'pending',
        };

        this.actions.set(action.id, action);
        this.save();

        // Emitir evento via Socket.io para notificar aprovadores
        socketService.emit('approval_pending', {
            action,
            message: `Nova ação pendente: ${action.description}`,
        });

        log.info(`Ação criada: ${action.id} - ${action.description}`);

        return action;
    }

    /**
     * Lista ações pendentes com filtros opcionais
     */
    async getPendingActions(filters?: {
        type?: ActionType;
        banco?: 'inter' | 'itau';
        status?: ActionStatus;
    }): Promise<PendingAction[]> {
        this.cleanup();
        let actions = Array.from(this.actions.values());

        if (filters?.type) {
            actions = actions.filter(a => a.type === filters.type);
        }
        if (filters?.banco) {
            actions = actions.filter(a => a.banco === filters.banco);
        }
        if (filters?.status) {
            actions = actions.filter(a => a.status === filters.status);
        } else {
            // Por padrão, mostrar apenas pendentes
            actions = actions.filter(a => a.status === 'pending');
        }

        return actions.sort((a, b) =>
            new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
        );
    }

    /**
     * Obtém detalhes de uma ação específica
     */
    async getActionById(actionId: string): Promise<PendingAction | null> {
        return this.actions.get(actionId) || null;
    }

    /**
     * Aprova uma ação e executa automaticamente
     */
    async approveAction(actionId: string, approvedBy: string): Promise<{
        success: boolean;
        result?: any;
        error?: string;
    }> {
        const action = this.actions.get(actionId);

        if (!action) {
            return { success: false, error: 'Ação não encontrada' };
        }

        if (action.status !== 'pending') {
            return { success: false, error: `Ação já foi ${action.status}` };
        }

        // Marcar como aprovada
        action.status = 'approved';
        action.reviewedBy = approvedBy;
        action.reviewedAt = new Date();
        this.save();

        log.info(`Ação aprovada: ${actionId} por ${approvedBy}`);

        // Executar a ação
        try {
            const result = await this.executeAction(action);
            action.status = 'executed';
            action.executedAt = new Date();
            action.result = result;
            this.save();

            // Emitir evento de sucesso
            socketService.emit('approval_executed', {
                actionId,
                success: true,
                result,
            });

            return { success: true, result };
        } catch (error: any) {
            action.status = 'failed';
            action.error = error.message;
            this.save();

            // Emitir evento de erro
            socketService.emit('approval_failed', {
                actionId,
                error: error.message,
            });

            return { success: false, error: error.message };
        }
    }

    /**
     * Rejeita uma ação
     */
    async rejectAction(actionId: string, rejectedBy: string, reason?: string): Promise<{
        success: boolean;
        error?: string;
    }> {
        const action = this.actions.get(actionId);

        if (!action) {
            return { success: false, error: 'Ação não encontrada' };
        }

        if (action.status !== 'pending') {
            return { success: false, error: `Ação já foi ${action.status}` };
        }

        action.status = 'rejected';
        action.reviewedBy = rejectedBy;
        action.reviewedAt = new Date();
        action.rejectionReason = reason;
        this.save();

        // Emitir evento
        socketService.emit('approval_rejected', {
            actionId,
            rejectedBy,
            reason,
        });

        log.info(`Ação rejeitada: ${actionId} por ${rejectedBy}. Motivo: ${reason}`);

        return { success: true };
    }

    /**
     * Obtém histórico de ações com filtros
     */
    async getActionHistory(filters?: {
        startDate?: Date;
        endDate?: Date;
        type?: ActionType;
        status?: ActionStatus;
        limit?: number;
    }): Promise<PendingAction[]> {
        this.cleanup();
        // Histórico = ações terminais (não-pendentes).
        let history = Array.from(this.actions.values()).filter(a => a.status !== 'pending');

        if (filters?.startDate) {
            history = history.filter(a => new Date(a.requestedAt) >= filters.startDate!);
        }
        if (filters?.endDate) {
            history = history.filter(a => new Date(a.requestedAt) <= filters.endDate!);
        }
        if (filters?.type) {
            history = history.filter(a => a.type === filters.type);
        }
        if (filters?.status) {
            history = history.filter(a => a.status === filters.status);
        }

        // Ordenar por data (mais recente primeiro)
        history.sort((a, b) =>
            new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
        );

        // Aplicar limite
        if (filters?.limit) {
            history = history.slice(0, filters.limit);
        }

        return history;
    }

    /**
     * Obtém estatísticas de aprovação
     */
    async getStats(): Promise<{
        pending: number;
        approved: number;
        rejected: number;
        executed: number;
        failed: number;
    }> {
        this.cleanup();
        const all = Array.from(this.actions.values());
        const count = (s: ActionStatus) => all.filter(a => a.status === s).length;
        return {
            pending: count('pending'),
            approved: count('approved'),
            rejected: count('rejected'),
            executed: count('executed'),
            failed: count('failed'),
        };
    }

    // ===== Private Methods =====

    private getRiskLevel(type: ActionType): 'low' | 'medium' | 'high' {
        switch (type) {
            case 'pagar_boleto':
            case 'enviar_pix':
                return 'high';
            case 'baixar_fatura':
            case 'aprovar_reconciliacao':
                return 'medium';
            case 'enviar_documento':
            case 'consulta_saldo':
                return 'low';
            default:
                return 'medium';
        }
    }

    private async executeAction(action: PendingAction): Promise<any> {
        log.info(`Executando ação: ${action.type}`);

        let result: any;
        switch (action.type) {
            case 'pagar_boleto':
                result = await this.executePagarBoleto(action);
                break;
            case 'enviar_pix':
                result = await this.executeEnviarPix(action);
                break;
            case 'baixar_fatura':
                result = await this.executeBaixarFatura(action);
                break;
            case 'enviar_documento':
                result = await this.executeEnviarDocumento(action);
                break;
            case 'aprovar_reconciliacao':
                result = await this.executeReconciliacao(action);
                break;
            case 'consulta_saldo':
                result = await this.executeConsultaSaldo(action);
                break;
            default:
                throw new Error(`Tipo de ação desconhecido: ${action.type}`);
        }

        // Notificar solicitante via WhatsApp se configurado
        if (action.notifyOnComplete) {
            await this.notifyRequester(action, result);
        }

        return result;
    }

    private async executePagarBoleto(action: PendingAction): Promise<any> {
        const { banco, payload } = action;

        if (banco === 'inter') {
            return interApiService.pagarBoleto(payload);
        } else if (banco === 'itau') {
            return itauApiService.pagarBoleto(payload);
        } else {
            throw new Error('Banco não especificado para pagamento');
        }
    }

    private async executeEnviarPix(action: PendingAction): Promise<any> {
        const { banco, payload } = action;

        if (banco === 'inter') {
            return interApiService.enviarPix(payload);
        } else if (banco === 'itau') {
            return itauApiService.enviarPix(payload);
        } else {
            throw new Error('Banco não especificado para PIX');
        }
    }

    private async executeBaixarFatura(action: PendingAction): Promise<any> {
        // TODO: Implementar integração com Dolibarr para baixar fatura
        const { payload } = action;
        log.info('Baixando fatura', payload);
        return { success: true, message: 'Fatura baixada (simulado)' };
    }

    private async executeEnviarDocumento(action: PendingAction): Promise<any> {
        const { payload } = action;
        const { sessionId, chatId, fileData, filename, caption } = payload;

        return messageService.sendFile(sessionId, chatId, fileData, filename, caption);
    }

    private async executeReconciliacao(action: PendingAction): Promise<any> {
        const { payload } = action;
        const { lineId, invoiceId, userApiKey } = payload;

        // TODO: Implementar reconciliação real quando API Dolibarr disponível
        log.info(`Reconciliando linha ${lineId} com fatura ${invoiceId}`);
        return { success: true, message: `Reconciliação ${lineId} → ${invoiceId} aplicada` };
    }

    private async executeConsultaSaldo(action: PendingAction): Promise<any> {
        const { banco } = action;

        if (banco === 'inter') {
            return interApiService.getSaldo();
        } else if (banco === 'itau') {
            return itauApiService.getSaldo();
        } else {
            throw new Error('Banco não especificado para consulta de saldo');
        }
    }

    private async notifyRequester(action: PendingAction, result: any): Promise<void> {
        if (!action.notifyOnComplete) return;

        const { sessionId, chatId } = action.notifyOnComplete;
        let message = '';

        if (action.status === 'executed') {
            message = `✅ *Ação Aprovada e Executada*\n\n` +
                `📋 ${action.description}\n` +
                `⏰ Aprovado em: ${new Date().toLocaleString('pt-BR')}`;

            if (result?.transactionId) {
                message += `\n🔗 ID: ${result.transactionId}`;
            }
        } else if (action.status === 'rejected') {
            message = `❌ *Ação Rejeitada*\n\n` +
                `📋 ${action.description}\n` +
                `💬 Motivo: ${action.rejectionReason || 'Não informado'}`;
        }

        try {
            await messageService.sendText(sessionId, chatId, message);
            log.info(`Notificação enviada para ${chatId}`);
        } catch (e: any) {
            log.error(`Falha ao notificar: ${e.message}`);
        }
    }
}

export const approvalService = new ApprovalService();
