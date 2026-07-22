// O orçamento máximo de 11min (4 providers × 150s + 60s) fica abaixo do teto de polling de 20min do cliente.
export const CLIENT_MAX_WAIT_MS = 20 * 60 * 1000;
export const DEADLINE_MARGIN_MS = 60 * 1000;
export const MAX_CHAINED_CALLS = 4;
export const PRIMARY_CALL_TIMEOUT_MS = 60 * 1000;
export const RETRY_DEADLINE_MS = 30 * 1000;
export const FALLBACK_CALL_TIMEOUT_MS = 60 * 1000;
export const MAX_CHAINED_CALL_DEADLINE_MS = PRIMARY_CALL_TIMEOUT_MS + RETRY_DEADLINE_MS + FALLBACK_CALL_TIMEOUT_MS;
export const AI_JOB_LIVENESS_MS = MAX_CHAINED_CALLS * MAX_CHAINED_CALL_DEADLINE_MS + DEADLINE_MARGIN_MS;

export function getAiJobLivenessExpiresAt(now = Date.now()): string {
    return new Date(now + AI_JOB_LIVENESS_MS).toISOString();
}
