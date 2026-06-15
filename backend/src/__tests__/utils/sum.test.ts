import { describe, it, expect } from 'vitest';
import { sum } from '../../utils/sum';

describe('sum', () => {
    it('returns the sum of all values', () => {
        expect(sum([1, 2, 3])).toBe(6);
    });

    it('returns 0 for an empty array', () => {
        expect(sum([])).toBe(0);
    });

    it('returns the single value for a one-element array', () => {
        expect(sum([5])).toBe(5);
    });

    it('returns 0 for opposite values cancelling out', () => {
        expect(sum([-2, 2])).toBe(0);
    });
});
