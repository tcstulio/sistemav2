import { describe, it, expect } from 'vitest';
import { max } from '../../utils/max';

describe('max', () => {
    it('returns the largest value in the list', () => {
        expect(max([3, 1, 2])).toBe(3);
    });

    it('returns the single value for a one-element array', () => {
        expect(max([5])).toBe(5);
    });

    it('returns the largest value when all values are negative', () => {
        expect(max([-1, -5, -3])).toBe(-1);
    });

    it('throws RangeError for an empty array', () => {
        expect(() => max([])).toThrow(RangeError);
    });
});
