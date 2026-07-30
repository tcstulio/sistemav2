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
  // MiniMax: o 429 vem como "Token Plan usage limit reached: Upgrade your Token Plan or
  // purchase Credits" — 'usage limit' já casa, mas 'token plan' cobre variantes sem essa
  // frase exata. NÃO adicionamos o 1211/"unknown model" aqui de propósito: globalmente 1211
  // é "modelo desconhecido" e classificá-lo como cota faria o robô (juiz/escalada) segurar-e-
  // retentar para sempre num erro real de config. O bot do WhatsApp cobre o 1211 pela REDE DE
  // SEGURANÇA (recado técnico genérico), sem sujar o estado global de cota.
  'token plan',
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

// Marcadores de falha TRANSITÓRIA DE INFRA — a chamada não chegou a ser recusada por
// cota; ela não terminou a tempo, ou a conexão caiu. São um SUBCONJUNTO de QUOTA_MARKERS
// (que os inclui de propósito, para o TaskRunner segurar-e-retomar também em timeout).
const TRANSIENT_INFRA_MARKERS = [
  'econnaborted',
  'etimedout',
  'econnreset',
  'econnrefused',
  'socket hang up',
  'network error',
  'timeout of',
];

/**
 * true quando o erro é timeout/queda de conexão e NÃO um limite real do provedor.
 *
 * Por que existe: `isQuotaError` lista 'econnaborted'/'etimedout' como marcadores de cota
 * de propósito — o TaskRunner usa esse sinal para segurar-e-retomar, e ali tratar timeout
 * como transitório queimaria as re-tentativas. Mas para o CIRCUIT BREAKER a mesma mistura
 * é destrutiva: um provider saudável que demorou demais era marcado `exhausted`, com
 * cooldown escalando 30s → 2min → 10min, e o usuário recebia "limite do provedor atingido"
 * com o provedor de pé (verificado 2026-07-30: MiniMax respondendo 200 em 1,8s enquanto o
 * bot dizia estar sem capacidade).
 *
 * Um erro que casa AQUI deve ser tratado como transitório mesmo casando em `isQuotaError`.
 * A precedência é esta função primeiro; `isQuotaError` só decide o que sobra.
 */
export function isTransientInfraError(msg?: string | null): boolean {
  if (!msg) return false;
  const m = String(msg).toLowerCase();
  // Um 429/402 COM texto de cota é limite real, mesmo que a mensagem cite timeout.
  if (m.includes('limit exhausted') || m.includes('insufficient balance') || m.includes('usage limit')) return false;
  return TRANSIENT_INFRA_MARKERS.some((k) => m.includes(k));
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
