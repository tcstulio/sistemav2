/**
 * LlmHealthService (#815) — rastreia saúde por provider com cooldown escalonado.
 *
 * Falhas consecutivas → cooldown automático:
 *   1ª falha → 30s   |   2ª → 2min   |   3ª+ → 10min
 *
 * `isAvailable(provider)` retorna false enquanto cooldown não expirar.
 * `runWithChain` no aiService consulta isso para pular providers doentes.
 */

const log = (() => {
    try { return require('../utils/logger').logger.child('LlmHealth'); }
    catch { return { warn: console.warn, info: console.info, debug: () => {} }; }
})();

export type ProviderStatus = 'healthy' | 'degraded' | 'exhausted';

interface ProviderHealth {
    consecutiveErrors: number;
    cooldownUntil: number | null;
    totalCalls: number;
    totalErrors: number;
    totalFallbacks: number;
    lastErrorMsg?: string;
    lastErrorTs?: number;
}

// Cooldown por nível de erro consecutivo (ms)
const COOLDOWN_TABLE: Record<number, number> = {
    1: 30_000,
    2: 120_000,
};
const COOLDOWN_DEFAULT = 600_000; // 10 min para 3ª+

function cooldownFor(consecutiveErrors: number): number {
    return COOLDOWN_TABLE[consecutiveErrors] ?? COOLDOWN_DEFAULT;
}

class LlmHealthService {
    private state: Record<string, ProviderHealth> = {};

    private get(provider: string): ProviderHealth {
        if (!this.state[provider]) {
            this.state[provider] = {
                consecutiveErrors: 0,
                cooldownUntil: null,
                totalCalls: 0,
                totalErrors: 0,
                totalFallbacks: 0,
            };
        }
        return this.state[provider];
    }

    isAvailable(provider: string): boolean {
        const h = this.get(provider);
        if (h.cooldownUntil === null) return true;
        if (Date.now() >= h.cooldownUntil) {
            h.cooldownUntil = null; // cooldown expirou
            return true;
        }
        return false;
    }

    recordSuccess(provider: string): void {
        const h = this.get(provider);
        h.consecutiveErrors = 0;
        h.cooldownUntil = null;
        h.totalCalls++;
    }

    recordQuotaError(provider: string, err?: any): void {
        this._recordError(provider, err);
    }

    recordTransientError(provider: string, err?: any): void {
        this._recordError(provider, err);
    }

    private _recordError(provider: string, err?: any): void {
        const h = this.get(provider);
        h.consecutiveErrors++;
        h.totalCalls++;
        h.totalErrors++;
        h.lastErrorMsg = err?.message || String(err ?? '');
        h.lastErrorTs = Date.now();
        const ms = cooldownFor(h.consecutiveErrors);
        h.cooldownUntil = Date.now() + ms;
        log.warn(`LlmHealth: provider '${provider}' em cooldown por ${ms / 1000}s (${h.consecutiveErrors} erros consecutivos)`);
    }

    recordFallback(provider: string): void {
        const h = this.get(provider);
        h.totalFallbacks++;
    }

    resetProvider(provider: string): void {
        this.state[provider] = {
            consecutiveErrors: 0,
            cooldownUntil: null,
            totalCalls: this.get(provider).totalCalls,
            totalErrors: this.get(provider).totalErrors,
            totalFallbacks: this.get(provider).totalFallbacks,
        };
        log.info(`LlmHealth: cooldown de '${provider}' resetado manualmente.`);
    }

    getStatus(provider: string): ProviderStatus {
        const h = this.get(provider);
        if (h.cooldownUntil !== null && Date.now() < h.cooldownUntil) return 'exhausted';
        if (h.consecutiveErrors > 0) return 'degraded';
        return 'healthy';
    }

    getAllStatuses(): Record<string, { status: ProviderStatus; consecutiveErrors: number; totalCalls: number; totalErrors: number; totalFallbacks: number; lastErrorMsg?: string; lastErrorTs?: number; cooldownRemainingMs: number | null }> {
        const result: ReturnType<typeof this.getAllStatuses> = {};
        for (const [provider, h] of Object.entries(this.state)) {
            const now = Date.now();
            result[provider] = {
                status: this.getStatus(provider),
                consecutiveErrors: h.consecutiveErrors,
                totalCalls: h.totalCalls,
                totalErrors: h.totalErrors,
                totalFallbacks: h.totalFallbacks,
                lastErrorMsg: h.lastErrorMsg,
                lastErrorTs: h.lastErrorTs,
                cooldownRemainingMs: h.cooldownUntil !== null && h.cooldownUntil > now ? h.cooldownUntil - now : null,
            };
        }
        return result;
    }
}

export const llmHealthService = new LlmHealthService();
export { LlmHealthService };
