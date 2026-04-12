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

        it('accepts custom currency parameter but ignores it (BRL default)', () => {
            const resultBRL = formatCurrency(100, 'BRL');
            const resultUSD = formatCurrency(100, 'USD');
            expect(resultBRL).toBe(resultUSD);
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