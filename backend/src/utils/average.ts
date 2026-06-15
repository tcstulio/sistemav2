export function average(values: number[]): number {
    if (values.length === 0) {
        throw new RangeError('Cannot compute average of an empty array');
    }

    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
}
