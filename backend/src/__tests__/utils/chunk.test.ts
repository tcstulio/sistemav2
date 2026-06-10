import { describe, it, expect } from 'vitest';
import { chunk } from '../../utils/chunk';

describe('chunk', () => {
    it('splits array into chunks of the given size', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('returns empty array for empty input', () => {
        expect(chunk([], 3)).toEqual([]);
    });

    it('returns empty array when size is 0', () => {
        expect(chunk([1, 2, 3], 0)).toEqual([]);
    });

    it('returns single chunk when size exceeds array length', () => {
        expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
    });
});
