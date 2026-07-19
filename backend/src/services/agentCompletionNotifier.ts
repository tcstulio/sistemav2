/**
 * #1578 — Notificador de conclusão do agente.
 *
 * Assina o `aiJobService.onTransition` para saber quando um job do assistente
 * termina (status done/error). Aí decide se dispara `notify_person`:
 *
 *   - job NÃO trackeado no jobState  → ignora (não é um job de chat do #1578).
 *   - userId ausente no jobState     → ignora (não há recipient).
 *   - usuário em opt-out             → silencia (UX: "respeitar opt-out").
 *   - aba do cliente VISÍVEL         → silencia (UX: usuário está olhando).
 *   - aba OCULTA + opt-in            → dispara notify_person com resumo de 1 linha:
 *                                      'Pronto: <ação final>'.
 *
 * Toda decisão é logada estruturadamente (enviado/silenciado/motivo) — critério
 * de aceite: "Logs estruturados registram decisão".
 *
 * O `notified` no jobState atua como dedupe: uma vez decidido, o job não é
 * reavaliado (defesa contra double-fire do EventEmitter em cenários edge).
 *
 * Persistência: o agentCompletionNotifier é stateless — lê jobState (em memória)
 * + userNotifyPrefsStore (JSON) no momento da transição. Não mantém estado nem
 * fila; é um "executor reativo" disparado pelo aiJobService.
 */

import { createLogger } from '../utils/logger';
import { aiJobService } from './aiJobService';
import type { AiJob, AiJobStatus, AiJobTransition } from './aiJobService';
import { jobState } from '../agent/jobState';
import { userNotifyPrefsStore } from './userNotifyPrefsStore';
import { notificationService } from './notificationService';

const log = createLogger('AgentCompletionNotifier');

/** Status terminais que disparam a avaliação de notificação (#1578). */
const TERMINAL: ReadonlySet<AiJobStatus> = new Set<AiJobStatus>(['done', 'error']);

/** Teto p/ o summary de 1 linha (evita notificação "livro"). Alinhado ao exemplo. */
const SUMMARY_MAX = 140;

/**
 * Constrói o resumo de 1 linha a partir do resultado/erro do job.
 * Exemplos:
 *   - done com reply "Criei a proposta #123 para ACME.\nOutros detalhes..."
 *     → "Pronto: Criei a proposta #123 para ACME."
 *   - error com message "API timeout"
 *     → "Pronto (com erro): API timeout"
 *   - done sem reply (resultado opaco)
 *     → "Pronto: chat"  (fallback p/ o label do job)
 */
export function buildSummary(job: AiJob): string {
    if (job.status === 'error') {
        const raw = (job.error || 'falha ao processar').trim();
        const firstLine = raw.split('\n').map(s => s.trim()).filter(Boolean)[0] || 'falha';
        return `Pronto (com erro): ${firstLine.slice(0, SUMMARY_MAX)}`;
    }
    // done: resultado de chat é { reply, sessionId, ... }. Usa primeira linha da reply.
    const result = job.result as { reply?: string } | string | undefined;
    const reply: string | undefined =
        (result && typeof result === 'object' && typeof result.reply === 'string')
            ? result.reply
            : (typeof result === 'string' ? result : undefined);
    if (reply) {
        const firstLine =
            reply.trim().split('\n').map(s => s.trim()).filter(Boolean)[0] || 'concluído';
        return `Pronto: ${firstLine.slice(0, SUMMARY_MAX)}`;
    }
    // Fallback: usa o label (módulo do chat). Garante 1 linha útil mesmo sem reply.
    return `Pronto: ${job.label || 'job concluído'}`;
}

/**
 * Decide e executa a notificação para uma transição terminal.
 * Exportado (com underscore) para teste direto sem depender do EventEmitter.
 */
export async function handleTransition(e: AiJobTransition): Promise<void> {
    if (!TERMINAL.has(e.to)) return;

    const state = jobState.get(e.jobId);
    if (!state) return; // job não trackeado — não é um job de chat do #1578.

    if (state.notified) return; // dedupe: decisão já foi tomada.

    const userId = state.userId;
    if (!userId) {
        log.debug('Transição terminal sem userId no jobState — pulando.', { jobId: e.jobId });
        jobState.markNotified(e.jobId);
        return;
    }

    // Opt-out: silencioso. Marca notified para não reavaliar.
    if (userNotifyPrefsStore.isOptedOut(userId)) {
        log.info('Notificação silenciada (opt-out).', { jobId: e.jobId, userId });
        jobState.markNotified(e.jobId);
        return;
    }

    // Aba visível: silencioso (UX silenciosa quando o usuário está olhando).
    if (!state.tabHidden) {
        log.info('Notificação silenciada (aba visível).', { jobId: e.jobId, userId });
        jobState.markNotified(e.jobId);
        return;
    }

    // Aba oculta + opt-in → dispara notify_person.
    const summary = buildSummary(e.job);
    try {
        await notificationService.notifyPerson({
            event: 'agent.action',
            title: 'Assistente concluído',
            message: summary,
            channels: ['in-app'],
            recipient: userId,
            recipientName: state.userName,
            senderId: 'agent',
            senderName: 'Marciano',
        });
        jobState.markNotified(e.jobId);
        log.info('Notificação enviada.', { jobId: e.jobId, userId, summary });
    } catch (err: any) {
        // Marca mesmo em falha — não retentar é melhor que spam. Log estruturado.
        jobState.markNotified(e.jobId);
        log.error('Falha ao notificar conclusão.', {
            jobId: e.jobId,
            userId,
            error: err?.message || String(err),
        });
    }
}

let started = false;
let unsubscribe: (() => void) | null = null;

export const agentCompletionNotifier = {
    /**
     * Conecta o handler ao aiJobService. Idempotente — chamar 2x é no-op.
     * Deve ser chamado UMA vez no boot do servidor (server.ts).
     */
    start(): void {
        if (started) return;
        unsubscribe = aiJobService.onTransition(handleTransition);
        started = true;
        log.info('AgentCompletionNotifier iniciado.');
    },

    /** Desconecta o handler (shutdown/testes). */
    stop(): void {
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
        started = false;
    },

    /** Apenas para testes — expõe estado interno. */
    _isStarted(): boolean {
        return started;
    },
};
