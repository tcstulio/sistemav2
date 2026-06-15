import { describe, it, expect } from 'vitest';
import { average } from '../../utils/average';

describe('average', () => {
    it('computes the arithmetic mean of multiple values', () => {
        expect(average([2, 4, 6])).toBe(4);
    });

    it('returns the single value when array has one element', () => {
        expect(average([5])).toBe(5);
    });

    it('returns fractional mean for non-integer averages', () => {
        expect(average([1, 2])).toBe(1.5);
    });

    it('throws RangeError for an empty array', () => {
        expect(() => average([])).toThrow(RangeError);
    });
});
