/**
 * #1037 — Guard rails de delegação de sub-agentes.
 *
 * Constantes que limitam a explosão combinatória e os loops infinitos no sistema de
 * delegação: um agente pode chamar a tool `delegate` para spawnar um sub-agente, que
 * por sua vez pode delegar novamente. Sem estes tetos, uma cadeia recursiva de
 * delegações consome todo o orçamento de tokens/iterações do sistema.
 *
 * Os limites são intencionalmente CONSERVADORES e fixos (não expostos ao LLM) para
 * funcionarem como travas de segurança, não como sugestões.
 */

/**
 * Profundidade MÁXIMA de delegação. Um sub-agente rodando em profundidade >= este
 * valor NÃO pode chamar `delegate` novamente — `runSubAgent` rejeita com erro claro.
 *
 *   - depth 1 = raiz delega (parentDepth 0) ✓
 *   - depth 2 = sub-agente delega (parentDepth 1) ✓
 *   - depth 3 = rejeitado (parentDepth 2 >= 2) ✗
 */
export const MAX_DELEGATION_DEPTH = 2;

/**
 * Número MÁXIMO de sub-agentes rodando CONCORRENTEMENTE por sessão. A tool `delegate`
 * recusa o enésimo sub-agente quando o contador de ativos já atingiu este valor.
 */
export const MAX_CONCURRENT_SUBAGENTS = 3;

/**
 * Tamanho MÁXIMO (em caracteres) do resumo que um sub-agente devolve ao pai. Resumos
 * maiores são truncados e um WARNING é logado — evita inchar o contexto do pai com a
 * saída integral de um sub-agente verboso.
 */
export const MAX_DELEGATION_SUMMARY_LENGTH = 500;

/**
 * Número de delegações, em uma mesma tarefa, a partir do qual o pai recebe um WARNING
 * no log (suspeita de loop de delegação). NÃO bloqueia — apenas alerta.
 */
export const MAX_DELEGATIONS_PER_TASK = 5;

/**
 * Mensagem de erro explícita quando o limite de PROFUNDIDADE é excedido. Exportada
 * para os testes de enforcement asseverarem o texto exato (#1037 critério nº1).
 */
export const DELEGATION_DEPTH_EXCEEDED_MSG = `Limite de profundidade de delegação atingido (${MAX_DELEGATION_DEPTH}). Um sub-agente neste nível não pode delegar novamente.`;

/**
 * Mensagem de erro explícita quando o limite de CONCORRÊNCIA é excedido. Exportada para
 * os testes de enforcement asseverarem o texto exato (#1037 critério nº2).
 */
export const CONCURRENT_SUBAGENTS_EXCEEDED_MSG = `Limite de sub-agentes concorrentes atingido (${MAX_CONCURRENT_SUBAGENTS}). Aguarde os atuais terminarem.`;
