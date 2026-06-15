import { describe, it, expect } from 'vitest';
import { clamp } from '../../utils/clamp';

describe('clamp', () => {
    it('returns the value when within the interval', () => {
        expect(clamp(5, 0, 10)).toBe(5);
    });

    it('returns min when value is below min', () => {
        expect(clamp(-3, 0, 10)).toBe(0);
    });

    it('returns max when value is above max', () => {
        expect(clamp(15, 0, 10)).toBe(10);
    });

    it('returns the value when equal to min', () => {
        expect(clamp(0, 0, 10)).toBe(0);
    });

    it('returns the value when equal to max', () => {
        expect(clamp(10, 0, 10)).toBe(10);
    });

    it('throws RangeError when min is greater than max', () => {
        expect(() => clamp(5, 10, 0)).toThrow(RangeError);
    });
});
