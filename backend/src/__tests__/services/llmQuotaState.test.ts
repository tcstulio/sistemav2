import { describe, it, expect, beforeEach } from 'vitest';
import {
  isQuotaError,
  markQuotaExhausted,
  clearQuotaExhausted,
  isQuotaExhausted,
  quotaStatus,
} from '../../services/llmQuotaState';

describe('llmQuotaState', () => {
  beforeEach(() => clearQuotaExhausted());

  describe('isQuotaError', () => {
    it('detecta os erros reais de cota/saldo observados em produção', () => {
      // GLM cota semanal esgotada (code 1310)
      expect(isQuotaError('HTTP 429 {"error":{"code":"1310","message":"Weekly/Monthly Limit Exhausted"}}')).toBe(true);
      // GLM rate limit por minuto (code 1302)
      expect(isQuotaError('HTTP 429 {"error":{"code":"1302","message":"Rate limit reached for requests"}}')).toBe(true);
      // MiniMax saldo insuficiente (402 / 1008)
      expect(isQuotaError('HTTP 402 {"error":{"message":"insufficient balance (1008)"}}')).toBe(true);
      // timeout de infra
      expect(isQuotaError('ECONNABORTED')).toBe(true);
      expect(isQuotaError('ETIMEDOUT')).toBe(true);
      // Claude CLI (juiz/escalada) — esgotamento de saldo/uso mensal
      expect(isQuotaError("You've hit your monthly spend limit · raise it at claude.ai/settings/usage")).toBe(true);
      expect(isQuotaError('Claude usage limit reached. Try again later.')).toBe(true);
    });

    it('NÃO marca erros genuínos de código como cota', () => {
      expect(isQuotaError("TypeError: cannot read 'x' of undefined")).toBe(false);
      expect(isQuotaError('Modo cumulativo: nenhuma mudança produzida.')).toBe(false);
      expect(isQuotaError('PR com conflitos (mergeable=CONFLICTING)')).toBe(false);
      expect(isQuotaError(undefined)).toBe(false);
      expect(isQuotaError('')).toBe(false);
    });
  });

  describe('ciclo de vida do sinal', () => {
    it('marca, reporta e limpa o esgotamento', () => {
      expect(isQuotaExhausted()).toBe(false);
      markQuotaExhausted('primário esgotado: HTTP 429 1310');
      expect(isQuotaExhausted()).toBe(true);
      const st = quotaStatus();
      expect(st.exhausted).toBe(true);
      expect(st.reason).toContain('1310');
      expect(typeof st.since).toBe('number');
      clearQuotaExhausted();
      expect(isQuotaExhausted()).toBe(false);
      expect(quotaStatus().since).toBeNull();
    });

    it('mark é idempotente — preserva o primeiro timestamp', () => {
      markQuotaExhausted('primeira');
      const first = quotaStatus().since;
      markQuotaExhausted('segunda');
      expect(quotaStatus().since).toBe(first);
    });
  });
});
