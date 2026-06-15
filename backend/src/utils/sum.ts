export function sum(values: number[]): number {
    return values.reduce((acc, n) => acc + n, 0);
}
