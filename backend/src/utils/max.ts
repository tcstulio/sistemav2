export function max(values: number[]): number {
    if (values.length === 0) {
        throw new RangeError('max() requires a non-empty array of numbers');
    }
    return values.reduce((best, n) => (n > best ? n : best), values[0]);
}
