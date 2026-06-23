import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Import the class internals via the singleton — we reset state between tests via resetProvider.
// We also test module isolation via a fresh import using vi.resetModules where needed.

describe('llmHealthService', () => {
  // Use a fresh module instance per describe block by dynamically importing
  // (avoids cross-test state leakage from the singleton Map).

  let service: import('../../services/llmHealthService').LlmHealthService;
  // We can't re-export the class, so we test through the singleton but reset between tests.

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../services/llmHealthService');
    // Access the singleton; reset all known providers between tests
    service = (mod.llmHealthService as any);
    // Clear internal map
    (service as any).health.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('cooldown escalonado', () => {
    it('1ª quota error → cooldown de 30s', () => {
      service.recordQuotaError('glm', 'rate limit');
      const h = service.getStatus('glm') as import('../../services/llmHealthService').ProviderHealth;
      expect(h.state).toBe('exhausted');
      expect(h.cooldownMs).toBe(30_000);
      expect(h.consecutiveErrors).toBe(1);
    });

    it('2ª quota error consecutiva → cooldown de 2min', () => {
      service.recordQuotaError('glm', 'rate limit');
      service.recordQuotaError('glm', 'rate limit again');
      const h = service.getStatus('glm') as import('../../services/llmHealthService').ProviderHealth;
      expect(h.cooldownMs).toBe(120_000);
      expect(h.consecutiveErrors).toBe(2);
    });

    it('3ª+ quota error consecutiva → cooldown de 10min', () => {
      service.recordQuotaError('glm');
      service.recordQuotaError('glm');
      service.recordQuotaError('glm');
      service.recordQuotaError('glm');
      const h = service.getStatus('glm') as import('../../services/llmHealthService').ProviderHealth;
      expect(h.cooldownMs).toBe(600_000);
      expect(h.consecutiveErrors).toBe(4);
    });
  });

  describe('isAvailable com auto-expiração via Date.now mock', () => {
    it('retorna false durante cooldown e true após expirar', () => {
      vi.useFakeTimers();
      const now = Date.now();

      service.recordQuotaError('glm', 'rate limit');
      expect(service.isAvailable('glm')).toBe(false);

      // Advance time past 30s cooldown
      vi.setSystemTime(now + 31_000);
      expect(service.isAvailable('glm')).toBe(true);
      const h = service.getStatus('glm') as import('../../services/llmHealthService').ProviderHealth;
      expect(h.state).toBe('healthy');
    });

    it('não expira antes do cooldown terminar', () => {
      vi.useFakeTimers();
      const now = Date.now();

      service.recordQuotaError('glm');
      vi.setSystemTime(now + 29_000); // 29s < 30s
      expect(service.isAvailable('glm')).toBe(false);
    });
  });

  describe('recordSuccess', () => {
    it('zera consecutiveErrors e volta a healthy', () => {
      service.recordQuotaError('minimax', 'insufficient balance');
      service.recordQuotaError('minimax', 'insufficient balance');
      expect((service.getStatus('minimax') as any).consecutiveErrors).toBe(2);
      expect((service.getStatus('minimax') as any).state).toBe('exhausted');

      service.recordSuccess('minimax');
      const h = service.getStatus('minimax') as import('../../services/llmHealthService').ProviderHealth;
      expect(h.state).toBe('healthy');
      expect(h.consecutiveErrors).toBe(0);
      expect(h.exhaustedSince).toBeUndefined();
    });

    it('incrementa totalCalls', () => {
      service.recordSuccess('glm');
      service.recordSuccess('glm');
      const h = service.getStatus('glm') as import('../../services/llmHealthService').ProviderHealth;
      expect(h.totalCalls).toBe(2);
    });
  });

  describe('resetProvider', () => {
    it('remove completamente o estado do provider', () => {
      service.recordQuotaError('glm', 'rate limit');
      expect(service.isAvailable('glm')).toBe(false);

      service.resetProvider('glm');
      // Unknown provider → assumed available
      expect(service.isAvailable('glm')).toBe(true);
      // getStatus creates a fresh healthy entry
      const h = service.getStatus('glm') as import('../../services/llmHealthService').ProviderHealth;
      expect(h.state).toBe('healthy');
      expect(h.totalCalls).toBe(0);
    });
  });

  describe('allExhausted', () => {
    it('retorna false quando não há providers registrados', () => {
      expect(service.allExhausted()).toBe(false);
    });

    it('retorna false quando pelo menos 1 provider está saudável', () => {
      service.recordQuotaError('glm', 'rate limit');
      service.recordSuccess('minimax');
      expect(service.allExhausted()).toBe(false);
    });

    it('retorna true somente quando TODOS estão exhausted', () => {
      service.recordQuotaError('glm', 'rate limit');
      service.recordQuotaError('minimax', 'insufficient balance');
      expect(service.allExhausted()).toBe(true);
    });

    it('retorna false após auto-expirar 1 provider', () => {
      vi.useFakeTimers();
      const now = Date.now();

      service.recordQuotaError('glm', 'rate limit');    // 30s cooldown
      service.recordQuotaError('minimax', 'balance');    // 30s cooldown
      expect(service.allExhausted()).toBe(true);

      // After 31s, glm expires but minimax is still exhausted
      // (minimax exhaustedSince was set at the same time, so it expires too)
      vi.setSystemTime(now + 31_000);
      expect(service.allExhausted()).toBe(false);
    });
  });

  describe('getStatusByModule', () => {
    it('retorna a cadeia correta para chat', () => {
      const status = service.getStatusByModule('chat');
      expect(status.chain).toEqual(['glm', 'minimax']);
    });

    it('retorna active = primeiro provider saudável', () => {
      service.recordQuotaError('glm');
      const status = service.getStatusByModule('chat');
      expect(status.active).toBe('minimax');
    });

    it('retorna chain vazia para módulo desconhecido', () => {
      const status = service.getStatusByModule('unknown-module');
      expect(status.chain).toEqual([]);
    });
  });
});
