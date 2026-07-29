/**
 * #1037 — Singleton em memória que rastreia sub-agentes ativos por sessão.
 *
 * Responsabilidades:
 *   1. **Concorrência:** mantém um `Set` de sub-agentes ativos por `sessionId`. A tool
 *      `delegate` consulta `canAcquire()` antes de spawnar; `acquire()`/`release()`
 *      marcam o ciclo de vida de cada sub-agente. Quando o count atinge
 *      `MAX_CONCURRENT_SUBAGENTS`, novas aquisições falham.
 *   2. **Métrica:** incrementa `delegationTotal` por sessão a cada delegação e loga um
 *      WARNING quando o pai delega mais de `MAX_DELEGATIONS_PER_TASK` vezes na mesma
 *      tarefa (suspeita de loop).
 *
 * É um SINGLETON em memória (estado global do processo). Testes resetam o estado via
 * `resetSubAgentManager()` no `beforeEach`. Sessões não recebem TTL automático aqui —
 * quem orquestra a sessão (loop do agente / handler do job) chama `resetSession()` ao
 * encerrar; o foco deste módulo é o tracking correto, não a coleta de lixo.
 */
import { createLogger } from '../utils/logger';
import { MAX_CONCURRENT_SUBAGENTS, MAX_DELEGATIONS_PER_TASK } from './config';

const log = createLogger('SubAgentManager');

/** Estado por sessão: sub-agentes ativos + contador de delegações. */
interface SessionState {
    activeSubAgents: Set<string>;
    delegationTotal: number;
}

export class SubAgentManager {
    private readonly sessions = new Map<string, SessionState>();

    /** Garante que a sessão exista no Map, criando estado zerado se preciso. */
    private ensure(sessionId: string): SessionState {
        let state = this.sessions.get(sessionId);
        if (!state) {
            state = { activeSubAgents: new Set(), delegationTotal: 0 };
            this.sessions.set(sessionId, state);
        }
        return state;
    }

    /** Número de sub-agentes ATIVOS na sessão. */
    activeCount(sessionId: string): number {
        return this.sessions.get(sessionId)?.activeSubAgents.size ?? 0;
    }

    /**
     * Indica se ainda há capacidade para um novo sub-agente na sessão (count <
     * MAX_CONCURRENT_SUBAGENTS). Leitura pura — NÃO reserva o slot. A tool `delegate`
     * chama isto antes de despachar para devolver o erro amigável cedo.
     */
    canAcquire(sessionId: string): boolean {
        return this.activeCount(sessionId) < MAX_CONCURRENT_SUBAGENTS;
    }

    /**
     * Registra um sub-agente ativo na sessão. Retorna `true` se adquirido, `false` se o
     * limite de concorrência já foi atingido (fail-closed — não excede o teto). É
     * idempotente quanto ao `subAgentId` (re-acusar o mesmo id não incrementa o count).
     */
    acquire(sessionId: string, subAgentId: string): boolean {
        const state = this.ensure(sessionId);
        if (state.activeSubAgents.has(subAgentId)) return true;
        if (state.activeSubAgents.size >= MAX_CONCURRENT_SUBAGENTS) return false;
        state.activeSubAgents.add(subAgentId);
        return true;
    }

    /** Libera um sub-agente ativo da sessão (ciclo de vida encerrado). */
    release(sessionId: string, subAgentId: string): void {
        this.sessions.get(sessionId)?.activeSubAgents.delete(subAgentId);
    }

    /**
     * Incrementa o contador de delegações da sessão e retorna o novo total. Loga um
     * WARNING quando o total ultrapassa `MAX_DELEGATIONS_PER_TASK` (suspeita de loop de
     * delegação pelo pai na mesma tarefa).
     */
    incrementDelegation(sessionId: string): number {
        const state = this.ensure(sessionId);
        state.delegationTotal += 1;
        if (state.delegationTotal > MAX_DELEGATIONS_PER_TASK) {
            log.warn(
                `Sessão "${sessionId}" delegou ${state.delegationTotal}x na mesma tarefa (acima de ${MAX_DELEGATIONS_PER_TASK}) — possível loop de delegação.`,
            );
        }
        return state.delegationTotal;
    }

    /** Total acumulado de delegações na sessão (métrica `delegation_total`). */
    delegationCount(sessionId: string): number {
        return this.sessions.get(sessionId)?.delegationTotal ?? 0;
    }

    /** Descarta todo o estado de uma sessão (ativos + contador). Chamar ao fim da tarefa. */
    resetSession(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    /** Descarta TODAS as sessões (uso principal: testes determinísticos). */
    resetAll(): void {
        this.sessions.clear();
    }
}

/** Instância singleton do processo. */
let singleton: SubAgentManager | null = null;

/** Acessa o singleton de `SubAgentManager`, criando-o na primeira chamada. */
export function getSubAgentManager(): SubAgentManager {
    if (!singleton) singleton = new SubAgentManager();
    return singleton;
}

/**
 * Descarta o singleton atual. A próxima chamada a `getSubAgentManager()` cria uma
 * instância nova e zerada. Uso principal: isolar testes que inspecionam contadores.
 */
export function resetSubAgentManager(): void {
    singleton = null;
}
