import { describe, it, expect } from 'vitest';
import { clamp } from '../../utils/clamp';

describe('clamp', () => {
    it('returns value when it is within the interval', () => {
        expect(clamp(5, 0, 10)).toBe(5);
    });

    it('returns min when value is below min', () => {
        expect(clamp(-1, 0, 10)).toBe(0);
    });

    it('returns max when value is above max', () => {
        expect(clamp(11, 0, 10)).toBe(10);
    });

    it('returns value when it equals min', () => {
        expect(clamp(0, 0, 10)).toBe(0);
    });

    it('returns value when it equals max', () => {
        expect(clamp(10, 0, 10)).toBe(10);
    });

    it('throws RangeError when min is greater than max', () => {
        expect(() => clamp(5, 10, 0)).toThrow(RangeError);
    });
});
