// Estado GLOBAL de esgotamento de cota/saldo de LLM.
//
// Problema que resolve: quando GLM/Z.AI (429 / code 1310 "limit exhausted" / 1302) E o
// fallback MiniMax (402 "insufficient balance") estão esgotados, o robô NÃO deve marcar as
// tasks como `failed` (terminal) — isso destruiria o backlog. Em vez disso, sinaliza
// "esgotado", as tasks voltam para `pending`, o dispatch é segurado, e uma sonda periódica
// retoma SOZINHO quando a API volta. Erro de cota é INFRA (temporário), não falha da task.

let exhaustedSince: number | null = null;
let lastReason = '';

// Marcadores de erro de cota/saldo/transiente-de-infra (case-insensitive).
// Textuais (inequívocos) + códigos específicos dos provedores.
const QUOTA_MARKERS = [
  'rate limit',
  'limit exhausted',
  'insufficient balance',
  'too many requests',
  'quota',
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

/** Sinaliza que a cota/saldo de LLM está esgotada (idempotente — preserva o 1º timestamp). */
export function markQuotaExhausted(reason: string): void {
  if (exhaustedSince === null) exhaustedSince = Date.now();
  lastReason = reason || lastReason;
}

/** Limpa o sinal — chamado quando uma chamada LLM volta a ter SUCESSO (cota voltou). */
export function clearQuotaExhausted(): void {
  exhaustedSince = null;
  lastReason = '';
}

export function isQuotaExhausted(): boolean {
  return exhaustedSince !== null;
}

export function quotaStatus(): { exhausted: boolean; since: number | null; reason: string } {
  return { exhausted: exhaustedSince !== null, since: exhaustedSince, reason: lastReason };
}
