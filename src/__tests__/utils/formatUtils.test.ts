import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/dateUtils', () => ({
    formatDateLocal: vi.fn((ts: number) => {
        if (!ts) return '-';
        return `formatted-date-${ts}`;
    }),
}));

import { formatCurrency, formatDate } from '../../utils/formatUtils';

describe('formatUtils', () => {
    describe('formatCurrency', () => {
        it('returns dash for undefined', () => {
            expect(formatCurrency(undefined)).toBe('-');
        });

        it('returns dash for null', () => {
            expect(formatCurrency(null)).toBe('-');
        });

        it('formats positive number as BRL currency', () => {
            const result = formatCurrency(1234.56);
            expect(result).toContain('1');
            expect(result).toContain('234');
            expect(result).toContain('56');
        });

        it('formats zero', () => {
            const result = formatCurrency(0);
            expect(result).not.toBe('-');
        });

        it('formats negative number', () => {
            const result = formatCurrency(-500.50);
            expect(result).not.toBe('-');
        });

        it('respects the custom currency parameter (different currencies differ)', () => {
            const resultBRL = formatCurrency(100, 'BRL');
            const resultUSD = formatCurrency(100, 'USD');
            // Antes do fix o corpo hardcodava 'BRL' e ignorava o argumento;
            // agora cada moeda deve produzir uma string distinta.
            expect(resultBRL).not.toBe(resultUSD);
        });

        it('formats USD with US dollar symbol', () => {
            const result = formatCurrency(1234.56, 'USD');
            expect(result).toContain('1.234,56'); // pt-BR grouping
            expect(result).toMatch(/US\$|US\$|USD|\$/i);
        });

        it('formats EUR with euro symbol', () => {
            const result = formatCurrency(1234.56, 'EUR');
            expect(result).toContain('1.234,56');
            expect(result).toMatch(/€|EUR/i);
        });

        it('defaults to BRL when no currency is provided', () => {
            const withDefault = formatCurrency(100);
            const explicitBRL = formatCurrency(100, 'BRL');
            expect(withDefault).toBe(explicitBRL);
        });

        it('never produces "NaN" for missing values (null/undefined)', () => {
            expect(formatCurrency(null)).toBe('-');
            expect(formatCurrency(undefined)).toBe('-');
            expect(formatCurrency(null)).not.toContain('NaN');
            expect(formatCurrency(undefined)).not.toContain('NaN');
        });

        it('falls back to BRL for an invalid currency code', () => {
            const result = formatCurrency(100, 'NOT_A_CODE');
            expect(result).toContain('R$');
        });
    });

    describe('formatDate (alias)', () => {
        it('delegates to formatDateLocal', () => {
            const result = formatDate(1234567890);
            expect(result).toBe('formatted-date-1234567890');
        });

        it('returns dash for null', () => {
            const result = formatDate(null);
            expect(result).toBe('-');
        });

        it('returns dash for undefined', () => {
            const result = formatDate(undefined);
            expect(result).toBe('-');
        });
    });
});