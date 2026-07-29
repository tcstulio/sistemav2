/**
 * #1037 — Primitiva de baixo nível que executa um sub-agente sob os guard rails.
 *
 * Esta é a fronteira onde os limites de SEGURANÇA são aplicados:
 *
 *   1. **Profundidade:** rejeita com `DelegationDepthExceededError` quando
 *      `parentDepth >= MAX_DELEGATION_DEPTH` — um sub-agente no nível máximo NÃO pode
 *      delegar novamente (corta recursão infinita).
 *   2. **Concorrência:** adquire um slot no `SubAgentManager` antes de rodar e libera
 *      no fim (finally). Se o limite de ativos já foi atingido, lança
 *      `ConcurrentSubAgentsExceededError` (defesa em profundidade — a tool `delegate`
 *      também pré-checa e devolve a mensagem amigável).
 *   3. **Resumo:** o resultado bruto é truncado para `MAX_DELEGATION_SUMMARY_LENGTH`
 *      chars e um WARNING é logado quando excedido — evita inchar o contexto do pai.
 *   4. **Métrica:** incrementa `delegationTotal` da sessão a cada execução.
 *
 * O trabalho real do sub-agente (chamada do loop LLM) é injetável via `run` — assim os
 * guard rails são testáveis de forma determinística, sem depender de um provider LLM.
 * A integração com o loop real é feita por quem invoca `runSubAgent` (tool `delegate` /
 * orquestrador do job).
 */
import { createLogger } from '../utils/logger';
import {
    MAX_DELEGATION_DEPTH,
    MAX_DELEGATION_SUMMARY_LENGTH,
    DELEGATION_DEPTH_EXCEEDED_MSG,
    CONCURRENT_SUBAGENTS_EXCEEDED_MSG,
} from './config';
import { getSubAgentManager } from './subAgentManager';

const log = createLogger('RunSubAgent');

export interface RunSubAgentOptions {
    /** Sessão que originou a delegação (chave de tracking no `SubAgentManager`). */
    sessionId: string;
    /** Tarefa/prompt delegada ao sub-agente. */
    task: string;
    /**
     * Profundidade do PAI. O sub-agente roda em `parentDepth + 1`. Default `0` (raiz).
     * Valores >= `MAX_DELEGATION_DEPTH` são rejeitados.
     */
    parentDepth?: number;
    /**
     * Identificador estável do sub-agente para tracking de concorrência. Quando omitido,
     * um id único é gerado (default).
     */
    subAgentId?: string;
    /**
     * Executor do trabalho do sub-agente. Recebe `(task, currentDepth)` e devolve o
     * resultado bruto (string). Default: passthrough que devolve a própria task —
     * suficiente para exercitar os guard rails isoladamente.
     */
    run?: (task: string, currentDepth: number) => Promise<string>;
}

export interface RunSubAgentResult {
    /** Resumo já truncado para no máximo `MAX_DELEGATION_SUMMARY_LENGTH` chars. */
    summary: string;
    /** Profundidade em que o sub-agente rodou (`parentDepth + 1`). */
    depth: number;
    /** `true` quando o resultado bruto excedeu o limite e foi truncado. */
    truncated: boolean;
}

/** Lançada quando a profundidade máxima de delegação é excedida. */
export class DelegationDepthExceededError extends Error {
    constructor() {
        super(DELEGATION_DEPTH_EXCEEDED_MSG);
        this.name = 'DelegationDepthExceededError';
    }
}

/** Lançada quando o limite de sub-agentes concorrentes foi atingido. */
export class ConcurrentSubAgentsExceededError extends Error {
    constructor() {
        super(CONCURRENT_SUBAGENTS_EXCEEDED_MSG);
        this.name = 'ConcurrentSubAgentsExceededError';
    }
}

/**
 * Trunca o resumo bruto para `MAX_DELEGATION_SUMMARY_LENGTH` chars, logando um WARNING
 * quando o original excede o limite. Usa elipse (1 char) reservada no fim para sinalizar
 * o corte mantendo o comprimento <= limite.
 */
function truncateSummary(raw: string): { summary: string; truncated: boolean } {
    const text = String(raw ?? '');
    if (text.length <= MAX_DELEGATION_SUMMARY_LENGTH) {
        return { summary: text, truncated: false };
    }
    log.warn(
        `Resumo de sub-agente excedeu ${MAX_DELEGATION_SUMMARY_LENGTH} chars (${text.length}) — truncado.`,
    );
    const ellipsis = '…';
    return {
        summary: text.slice(0, MAX_DELEGATION_SUMMARY_LENGTH - ellipsis.length) + ellipsis,
        truncated: true,
    };
}

/** Gera um id de sub-agente único (quando o caller não fornece um). */
function generateSubAgentId(sessionId: string, depth: number): string {
    return `sub-${sessionId}-${depth}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Executa um sub-agente sob os guard rails de profundidade, concorrência, resumo e
 * métrica. Ver fluxo no cabeçalho do módulo. O slot de concorrência é sempre liberado
 * no `finally`, mesmo em caso de erro no `run`.
 */
export async function runSubAgent(opts: RunSubAgentOptions): Promise<RunSubAgentResult> {
    const sessionId = opts.sessionId;
    const parentDepth = opts.parentDepth ?? 0;

    // Guard rail (1): profundidade máxima — corta recursão infinita.
    if (parentDepth >= MAX_DELEGATION_DEPTH) {
        log.warn(
            `Delegação rejeitada por profundidade: parentDepth=${parentDepth} >= máximo ${MAX_DELEGATION_DEPTH} (sessão="${sessionId}").`,
        );
        throw new DelegationDepthExceededError();
    }

    const depth = parentDepth + 1;
    const manager = getSubAgentManager();
    const subAgentId = opts.subAgentId ?? generateSubAgentId(sessionId, depth);

    // Guard rail (2): concorrência — adquire slot (defesa em profundidade).
    if (!manager.acquire(sessionId, subAgentId)) {
        log.warn(
            `Delegação rejeitada por concorrência: ${manager.activeCount(sessionId)} ativos (sessão="${sessionId}").`,
        );
        throw new ConcurrentSubAgentsExceededError();
    }

    // Guard rail (4): métrica de delegação por sessão.
    manager.incrementDelegation(sessionId);

    try {
        const run = opts.run ?? (async (task: string) => task);
        const raw = await run(opts.task, depth);
        const { summary, truncated } = truncateSummary(raw);
        return { summary, depth, truncated };
    } finally {
        manager.release(sessionId, subAgentId);
    }
}
