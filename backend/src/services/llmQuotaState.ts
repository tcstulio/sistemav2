// Estado de esgotamento de cota/saldo de LLM — wrappers sobre llmHealthService.
//
// Preserva as 5 assinaturas usadas por taskRunnerService e demais call-sites.
// CRÍTICO: isQuotaExhausted() retorna true APENAS quando TODOS os providers conhecidos
// estão exhausted — TaskRunner não deve travar enquanto houver 1 provider saudável.

import { llmHealthService } from './llmHealthService';

// Marcadores de erro de cota/saldo/transiente-de-infra (case-insensitive).
const QUOTA_MARKERS = [
  'rate limit',
  'limit exhausted',
  'insufficient balance',
  'too many requests',
  'quota',
  // Esgotamento de saldo/uso do Claude (CLI local do juiz/escalada). A mensagem é
  // "You've hit your monthly spend limit" / "usage limit reached" — NÃO casa com os
  // marcadores acima, então sem isto o juiz contaria como erro transitório e queimaria
  // as 3 re-tentativas → revisão humana, em vez de segurar-e-retomar quando o saldo volta.
  'spend limit',
  'monthly spend',
  'usage limit',
  'econnaborted',
  'etimedout',
  'http 429',
  'http 402',
  '"code":"1310"',
  '"code":"1302"',
  '(1008)',
  'status":429',
  'status":402',
];

/** true se a mensagem de erro indica esgotamento de cota/saldo (ou timeout de infra). */
export function isQuotaError(msg?: string | null): boolean {
  if (!msg) return false;
  const m = String(msg).toLowerCase();
  return QUOTA_MARKERS.some((k) => m.includes(k));
}

/** Sinaliza que a cota/saldo de LLM está esgotada.
 *  Sem provider explícito → registra no provider 'global' (representa "todos"). */
export function markQuotaExhausted(reason: string): void {
  llmHealthService.recordQuotaError('global', reason);
}

/** Limpa o sinal — chamado quando uma chamada LLM volta a ter SUCESSO. */
export function clearQuotaExhausted(): void {
  llmHealthService.resetProvider('global');
}

/** true APENAS quando TODOS os providers conhecidos estão exhausted.
 *  Se não há nenhum provider registrado, retorna false (estado inicial = saudável). */
export function isQuotaExhausted(): boolean {
  return llmHealthService.allExhausted();
}

export function quotaStatus(): { exhausted: boolean; since: number | null; reason: string } {
  const h = llmHealthService.getStatus('global') as import('./llmHealthService').ProviderHealth;
  const exhausted = h.state === 'exhausted';
  return {
    exhausted,
    since: exhausted ? (h.exhaustedSince ?? null) : null,
    reason: h.lastError || '',
  };
}
