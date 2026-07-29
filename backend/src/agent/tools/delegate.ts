/**
 * #1037 — Tool `delegate`: ponto de entrada público da delegação de sub-agentes.
 *
 * Responsável por aplicar o guard rail de CONCORRÊNCIA de forma amigável: antes de
 * despachar para `runSubAgent`, pré-checa a capacidade da sessão e devolve a mensagem
 * de erro explícita (não lança — o caller do loop trata o retorno como string). Os
 * demais guard rails (profundidade, resumo, métrica) vivem em `runSubAgent`.
 *
 * Mapeia os erros tipados de `runSubAgent` para mensagens de texto, de modo que o loop
 * do agente receba sempre um `string` (contrato das tools) em vez de uma exceção.
 */
import { createLogger } from '../../utils/logger';
import {
    CONCURRENT_SUBAGENTS_EXCEEDED_MSG,
    DELEGATION_DEPTH_EXCEEDED_MSG,
} from '../config';
import { getSubAgentManager } from '../subAgentManager';
import {
    runSubAgent,
    DelegationDepthExceededError,
    ConcurrentSubAgentsExceededError,
    type RunSubAgentOptions,
} from '../runSubAgent';

const log = createLogger('DelegateTool');

export interface DelegateToolOptions extends RunSubAgentOptions {
    // Mesma superfície de RunSubAgentOptions (sessionId, task, parentDepth, subAgentId,
    // run). Mantido como alias nominal para o chamador (loop do agente) referenciar a
    // tool `delegate` com tipos próprios.
}

/**
 * Executa a tool `delegate`. Retorna SEMPRE uma string:
 *   - o resumo do sub-agente (truncado) em caso de sucesso;
 *   - uma mensagem de erro explícita quando um guard rail bloqueia (concorrência ou
 *     profundidade) — o LLM lê a razão e decide o próximo passo.
 */
export async function delegateTool(opts: DelegateToolOptions): Promise<string> {
    const manager = getSubAgentManager();

    // Guard rail (2): concorrência — pré-checa e devolve o erro amigável cedo.
    if (!manager.canAcquire(opts.sessionId)) {
        log.warn(
            `delegate bloqueado por concorrência: ${manager.activeCount(opts.sessionId)} ativos (sessão="${opts.sessionId}").`,
        );
        return CONCURRENT_SUBAGENTS_EXCEEDED_MSG;
    }

    try {
        const result = await runSubAgent(opts);
        return result.summary;
    } catch (e) {
        if (e instanceof DelegationDepthExceededError) {
            return DELEGATION_DEPTH_EXCEEDED_MSG;
        }
        if (e instanceof ConcurrentSubAgentsExceededError) {
            return CONCURRENT_SUBAGENTS_EXCEEDED_MSG;
        }
        throw e;
    }
}
