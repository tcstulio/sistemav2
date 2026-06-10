export function chunk<T>(arr: T[], size: number): T[][] {
    if (size <= 0) return [];
    if (arr.length === 0) return [];

    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}
