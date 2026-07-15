/**
 * #1408 — Fachada canônica do "runner do agente".
 *
 * A issue #1408 cita `backend/src/agent/runner.ts` como o arquivo que controla o loop de
 * iterações e a chamada de tools — "(ou arquivo equivalente que controla o loop de iterações
 * e a chamada de tools)". A IMPLEMENTAÇÃO concreta do loop vive em `services/aiService.ts`
 * (que cresceu ao longo dos anos para ~2.3k linhas, agregando providers + helpers + chain +
 * síntese). Este módulo é a FACHADA FINO/CANÔNICA que re-exporta os símbolos relevantes
 * do runner — constantes, tipos, helpers do loop — para que:
 *
 *   1. O caminho descrito na issue (`backend/src/agent/runner.ts`) EXISTA com uma função
 *      clara, em vez de ficar implícito na escolha entre alternativas.
 *   2. Consumidores externos (testes, integrações, novas tools) possam importar do
 *      `runner` em vez de conhecer a estrutura interna do `aiService.ts`.
 *   3. Mudanças no loop (novos dials, novos helpers) tenham um único ponto de re-export
 *      a atualizar — em vez de N importadores espalhados.
 *
 * Os tipos e funções exportados daqui são PROVENIENTES de `aiService.ts` (a implementação
 * real) — este arquivo apenas os RE-EXPORTA. Mantém a fidelidade ao código existente e
 * ao mesmo tempo dá ao runner uma "casa" canônica.
 */

// === Tipos do runner ===
export type {
    ChatMessage,
    TokenUsage,
    GenerateReplyResult,
    GenerateReplyOptions,
} from '../services/aiService';

// === Constantes do loop (#1408) ===
/**
 * Teto de quantas vezes o gate de conclusão (#957/#955) cutuca um "anuncia e para" antes
 * de desistir e forçar síntese. Substitui o "dispara no máximo 1x" do nudge lexical #954.
 */
export { MAX_CONCLUSION_NUDGES } from '../services/aiService';

/**
 * Mensagem EXPLÍCITA de teto de tool-calls atingido. Antes o loop caía em síntese
 * silenciosa ao bater o teto (parecia uma resposta normal). Agora o teto interrompe com
 * um aviso claro, dizendo qual dial ajustar. Exportada para os testes de enforcement
 * asseverarem (#1408, critério de aceite nº1).
 */
export { TOOL_BUDGET_EXHAUSTED_MSG } from '../services/aiService';

// === Helpers do gate HITL (#1408) ===
/**
 * Gate de confirmação (HITL) do runner. Uma ferramenta listada em `requireConfirmationFor`
 * (config do agente) só pode ser executada com aprovação explícita do usuário
 * (`options.approvedTools`) OU quando o chamador é admin (bypass — uso interno/testes).
 * Retorna a MENSAGEM de bloqueio quando a execução deve ser BARRADA, ou `null` para liberar.
 */
export { confirmationBlock } from '../services/aiService';

// === Provider concreto usado pelo `aiService.generateReply` ===
/**
 * Provider LLM padrão (LocalProvider — Ollama/GLM/MiniMax). O loop de iteração vive
 * dentro do método `generateReply` deste provider; a fachada do runner apenas centraliza
 * os símbolos exportáveis. `GoogleProvider` é o outro implementador de `AIProvider`
 * (também em aiService.ts), mas a maior parte dos usuários cai no LocalProvider.
 */
export { LocalProvider } from '../services/aiService';

// === Interface pública do provider (para type-checks de implementadores novos) ===
/**
 * Re-export do TIPO `AIProvider` para que código externo (novos providers, mocks de teste)
 * possam referenciar a interface sem importar o módulo interno. O tipo é exportado via
 * `export type` porque a interface em si é `interface AIProvider` (não `export` direto
 * em aiService.ts — fica encapsulada no módulo).
 */
// Nota: a `interface AIProvider` em aiService.ts NÃO é exportada por design — é
// detalhe de implementação do factory. Consumidores externos devem usar `LocalProvider`
// ou `GoogleProvider` diretamente. Esta fachada segue o mesmo contrato: nada de vazar
// o tipo interno.