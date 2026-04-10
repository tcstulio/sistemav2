/**
 * Approval Service
 * 
 * Gerencia fila de aprovação para automações bancárias
 * Todas as ações de alto risco passam por conferência antes de execução
 */

import { v4 as uuidv4 } from 'uuid';
import { socketService } from './socketService';
import { interApiService } from './interApiService';
import { itauApiService } from './itauApiService';
import { messageService } from './legacy/messageService';
import { dolibarrService } from './dolibarrService';
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

// ===== In-Memory Storage =====
// TODO: Migrar para banco de dados em produção

const pendingActions: Map<string, PendingAction> = new Map();
const actionHistory: PendingAction[] = [];

// ===== Approval Service =====

class ApprovalService {

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

        pendingActions.set(action.id, action);

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
        let actions = Array.from(pendingActions.values());

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
        return pendingActions.get(actionId) ||
            actionHistory.find(a => a.id === actionId) ||
            null;
    }

    /**
     * Aprova uma ação e executa automaticamente
     */
    async approveAction(actionId: string, approvedBy: string): Promise<{
        success: boolean;
        result?: any;
        error?: string;
    }> {
        const action = pendingActions.get(actionId);

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

        log.info(`Ação aprovada: ${actionId} por ${approvedBy}`);

        // Executar a ação
        try {
            const result = await this.executeAction(action);
            action.status = 'executed';
            action.executedAt = new Date();
            action.result = result;

            // Mover para histórico
            this.moveToHistory(action);

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

            // Mover para histórico mesmo com erro
            this.moveToHistory(action);

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
        const action = pendingActions.get(actionId);

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

        // Mover para histórico
        this.moveToHistory(action);

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
        let history = [...actionHistory];

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
        const pending = Array.from(pendingActions.values()).filter(a => a.status === 'pending').length;
        const approved = actionHistory.filter(a => a.status === 'approved').length;
        const rejected = actionHistory.filter(a => a.status === 'rejected').length;
        const executed = actionHistory.filter(a => a.status === 'executed').length;
        const failed = actionHistory.filter(a => a.status === 'failed').length;

        return { pending, approved, rejected, executed, failed };
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

    private moveToHistory(action: PendingAction): void {
        pendingActions.delete(action.id);
        actionHistory.push(action);

        // Manter apenas últimos 1000 registros em memória
        if (actionHistory.length > 1000) {
            actionHistory.shift();
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
