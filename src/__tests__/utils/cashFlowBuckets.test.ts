import { describe, it, expect } from 'vitest';
import { buildCashFlowBuckets } from '../../utils/cashFlowBuckets';

describe('buildCashFlowBuckets', () => {
    const ref = new Date(2026, 5, 15);

    it('returns correct number of buckets for 6 months', () => {
        const result = buildCashFlowBuckets([], 6, ref);
        expect(result).toHaveLength(6);
    });

    it('returns correct number of buckets for 12 months', () => {
        const result = buildCashFlowBuckets([], 12, ref);
        expect(result).toHaveLength(12);
    });

    it('returns correct number of buckets for 24 months', () => {
        const result = buildCashFlowBuckets([], 24, ref);
        expect(result).toHaveLength(24);
    });

    it('sorts buckets chronologically', () => {
        const result = buildCashFlowBuckets([], 6, ref);
        for (let i = 1; i < result.length; i++) {
            expect(result[i].month).not.toBe(result[i - 1].month);
        }
    });

    it('aggregates income correctly', () => {
        const lines = [
            { date_operation: new Date(2026, 5, 1).getTime(), amount: 100 },
            { date_operation: new Date(2026, 5, 10).getTime(), amount: 200 },
        ];
        const result = buildCashFlowBuckets(lines, 6, ref);
        const june = result[result.length - 1];
        expect(june.income).toBe(300);
        expect(june.expense).toBe(0);
    });

    it('aggregates expense correctly', () => {
        const lines = [
            { date_operation: new Date(2026, 5, 1).getTime(), amount: -150 },
            { date_operation: new Date(2026, 5, 10).getTime(), amount: -50 },
        ];
        const result = buildCashFlowBuckets(lines, 6, ref);
        const june = result[result.length - 1];
        expect(june.income).toBe(0);
        expect(june.expense).toBe(200);
    });

    it('handles mixed income and expense', () => {
        const lines = [
            { date_operation: new Date(2026, 5, 1).getTime(), amount: 500 },
            { date_operation: new Date(2026, 5, 5).getTime(), amount: -200 },
        ];
        const result = buildCashFlowBuckets(lines, 6, ref);
        const june = result[result.length - 1];
        expect(june.income).toBe(500);
        expect(june.expense).toBe(200);
    });

    it('ignores lines outside the window', () => {
        const lines = [
            { date_operation: new Date(2025, 0, 1).getTime(), amount: 9999 },
        ];
        const result = buildCashFlowBuckets(lines, 6, ref);
        const totalIncome = result.reduce((sum, b) => sum + b.income, 0);
        expect(totalIncome).toBe(0);
    });

    it('includes lines from 24 months ago when months=24', () => {
        const jul2024 = new Date(2024, 6, 1).getTime();
        const lines = [{ date_operation: jul2024, amount: 1000 }];
        const result = buildCashFlowBuckets(lines, 24, ref);
        const totalIncome = result.reduce((sum, b) => sum + b.income, 0);
        expect(totalIncome).toBe(1000);
    });

    it('skips lines with undefined date_operation', () => {
        const lines = [
            { date_operation: undefined, amount: 500 },
            { date_operation: new Date(2026, 5, 1).getTime(), amount: 300 },
        ];
        const result = buildCashFlowBuckets(lines, 6, ref);
        const totalIncome = result.reduce((sum, b) => sum + b.income, 0);
        expect(totalIncome).toBe(300);
    });

    it('handles seconds-based timestamps (< 100000000000)', () => {
        const secondsTimestamp = Math.floor(new Date(2026, 5, 1).getTime() / 1000);
        const lines = [{ date_operation: secondsTimestamp, amount: 250 }];
        const result = buildCashFlowBuckets(lines, 6, ref);
        const totalIncome = result.reduce((sum, b) => sum + b.income, 0);
        expect(totalIncome).toBe(250);
    });

    it('returns zeroed buckets when no bank lines provided', () => {
        const result = buildCashFlowBuckets([], 12, ref);
        result.forEach((bucket) => {
            expect(bucket.income).toBe(0);
            expect(bucket.expense).toBe(0);
        });
    });
});
