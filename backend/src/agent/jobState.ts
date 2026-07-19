/**
 * #1578 — Estado por job do assistente (camada complementar ao aiJobService).
 *
 * O `aiJobService` mantém o registry CANÔNICO dos jobs (status, resultado, TTL,
 * persistência). Aqui mora o estado EFÊMERO que só faz sentido enquanto o job
 * está vivo e o cliente (frontend) está conectado:
 *
 *   - `tabHidden`:        a aba do navegador onde o chat roda está OCULTA
 *                         (document.hidden=true)? O cliente reporta via
 *                         POST /api/chat/jobs/:id/visibility. Usado pelo
 *                         agentCompletionNotifier para decidir se dispara
 *                         notify_person no fim do job.
 *   - `userId`/`userName`: contexto do usuário que disparou o job, repassado
 *                         ao notify_person (recipient/senderName).
 *   - `notified`:         dedupe — marca que a notificação de término já foi
 *                         decida (enviada ou silenciada) para o job, evitando
 *                         double-fire caso o EventEmitter emita duas vezes
 *                         (defesa-em-profundidade).
 *
 * Não é persistido (em memória): jobState é estado de UX do cliente, sem
 * valor após restart. O aiJobService continua sendo a fonte durável.
 *
 * Convenções:
 *   - `init` é idempotente: cria se ausente, faz MERGE (overlay) se existente.
 *     Nunca sobrescreve `notified` (uma vez decidido, fica decidido).
 *   - `setVisibility` retorna false se o job não existe (caller responde 404).
 *   - `clear` é idempotente (chamar em job inexistente é no-op).
 */

import { createLogger } from '../utils/logger';

const log = createLogger('JobState');

export interface JobState {
    jobId: string;
    /** True quando a aba do cliente está OCULTA (document.hidden). Default false. */
    tabHidden: boolean;
    /** ID Dolibarr do usuário que disparou o job (recipient do notify_person). */
    userId?: string;
    /** Login (apenas para logs estruturados). */
    userLogin?: string;
    /** Nome de exibição do usuário (para o "to" da notificação). */
    userName?: string;
    /** Hint curto da origem (ex.: módulo do chat). Opcional, apenas para logs. */
    label?: string;
    /** Dedupe: a notificação de término já foi decidida (enviada ou silenciada). */
    notified?: boolean;
}

const states = new Map<string, JobState>();

export const jobState = {
    /**
     * Cria ou atualiza o estado de um job. Idempotente — faz MERGE sobre o
     * estado atual, preservando `notified` (decisão de notificação é definitiva).
     */
    init(jobId: string, init?: Partial<Omit<JobState, 'jobId' | 'notified'>>): void {
        if (!jobId) {
            log.warn('init chamado com jobId vazio — ignorado.');
            return;
        }
        const cur = states.get(jobId);
        const base: JobState = cur ?? { jobId, tabHidden: false };
        const next: JobState = {
            ...base,
            ...init,
            jobId,
            // notified nunca é sobrescrito por init (apenas por markNotified).
            notified: base.notified,
        };
        states.set(jobId, next);
    },

    /**
     * Atualiza a flag de visibilidade da aba. Retorna true se o job existia
     * (e foi atualizado); false caso contrário (caller responde 404).
     */
    setVisibility(jobId: string, tabHidden: boolean): boolean {
        const cur = states.get(jobId);
        if (!cur) return false;
        cur.tabHidden = tabHidden;
        return true;
    },

    /** Marca o job como "notificação já decidida" (dedupe). */
    markNotified(jobId: string): void {
        const cur = states.get(jobId);
        if (cur) cur.notified = true;
    },

    /** Snapshot do estado atual (ou undefined se job não trackeado). */
    get(jobId: string): JobState | undefined {
        return states.get(jobId);
    },

    /** Remove o estado do job (após término/TTL). Idempotente. */
    clear(jobId: string): void {
        states.delete(jobId);
    },

    /** Apenas para testes — limpa todo o registry. */
    _clearAllForTests(): void {
        states.clear();
    },
};
