export interface ProviderHealth {
  provider: string;
  state: 'healthy' | 'exhausted';
  exhaustedSince?: number;
  consecutiveErrors: number;
  lastError?: string;
  cooldownMs?: number;
  totalCalls: number;
  totalErrors: number;
  totalFallbacks: number;
}

// Cooldown escalonado: 1ª quota error → 30s, 2ª → 2min, 3ª+ → 10min
const COOLDOWN_STEPS_MS = [30_000, 120_000, 600_000];

function cooldownFor(consecutiveErrors: number): number {
  const idx = Math.min(consecutiveErrors - 1, COOLDOWN_STEPS_MS.length - 1);
  return COOLDOWN_STEPS_MS[Math.max(0, idx)];
}

// Module → provider chain mapping
const MODULE_CHAINS: Record<string, string[]> = {
  chat: ['glm', 'minimax'],
  taskrunner: ['glm', 'minimax'],
  transcription: ['glm'],
  vision: ['glm'],
};

class LlmHealthService {
  private health = new Map<string, ProviderHealth>();

  private ensure(provider: string): ProviderHealth {
    if (!this.health.has(provider)) {
      this.health.set(provider, {
        provider,
        state: 'healthy',
        consecutiveErrors: 0,
        totalCalls: 0,
        totalErrors: 0,
        totalFallbacks: 0,
      });
    }
    return this.health.get(provider)!;
  }

  private autoExpire(h: ProviderHealth): void {
    if (
      h.state === 'exhausted' &&
      h.cooldownMs !== undefined &&
      h.exhaustedSince !== undefined &&
      Date.now() - h.exhaustedSince >= h.cooldownMs
    ) {
      h.state = 'healthy';
      h.exhaustedSince = undefined;
      h.cooldownMs = undefined;
      h.consecutiveErrors = 0;
    }
  }

  recordSuccess(provider: string): void {
    const h = this.ensure(provider);
    h.totalCalls++;
    h.consecutiveErrors = 0;
    h.state = 'healthy';
    h.exhaustedSince = undefined;
    h.cooldownMs = undefined;
    h.lastError = undefined;
  }

  recordQuotaError(provider: string, err?: string): void {
    const h = this.ensure(provider);
    h.totalCalls++;
    h.totalErrors++;
    h.consecutiveErrors++;
    h.lastError = err;
    h.state = 'exhausted';
    // preserve 1st exhaustedSince (idempotent like markQuotaExhausted)
    if (h.exhaustedSince === undefined) h.exhaustedSince = Date.now();
    h.cooldownMs = cooldownFor(h.consecutiveErrors);
  }

  recordTransientError(provider: string, err?: string): void {
    const h = this.ensure(provider);
    h.totalCalls++;
    h.totalErrors++;
    h.consecutiveErrors++;
    h.lastError = err;
    // transient errors don't exhaust the provider
  }

  recordFallback(provider: string): void {
    const h = this.ensure(provider);
    h.totalFallbacks++;
  }

  isAvailable(provider: string): boolean {
    const h = this.health.get(provider);
    if (!h) return true;
    this.autoExpire(h);
    return h.state === 'healthy';
  }

  getStatus(provider?: string): ProviderHealth | ProviderHealth[] {
    if (provider) {
      const h = this.ensure(provider);
      this.autoExpire(h);
      return { ...h };
    }
    const result: ProviderHealth[] = [];
    for (const h of this.health.values()) {
      this.autoExpire(h);
      result.push({ ...h });
    }
    return result;
  }

  getStatusByModule(module: string): { chain: string[]; active?: string; providers: ProviderHealth[] } {
    const chain = MODULE_CHAINS[module];
    if (!chain) return { chain: [], providers: [] };
    const providers = chain.map((p) => {
      const h = this.ensure(p);
      this.autoExpire(h);
      return { ...h };
    });
    const active = providers.find((p) => p.state === 'healthy')?.provider;
    return { chain, active, providers };
  }

  /** Returns true only when ALL known providers are exhausted (empty map = false). */
  allExhausted(): boolean {
    if (this.health.size === 0) return false;
    for (const h of this.health.values()) {
      this.autoExpire(h);
      if (h.state === 'healthy') return false;
    }
    return true;
  }

  resetProvider(provider: string): void {
    this.health.delete(provider);
  }

  getModuleChains(): Record<string, { chain: string[]; active?: string }> {
    const result: Record<string, { chain: string[]; active?: string }> = {};
    for (const [mod, chain] of Object.entries(MODULE_CHAINS)) {
      const active = chain.find((p) => this.isAvailable(p));
      result[mod] = { chain, active };
    }
    return result;
  }
}

export const llmHealthService = new LlmHealthService();
