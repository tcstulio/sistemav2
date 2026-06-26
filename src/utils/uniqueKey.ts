/**
 * Gera chaves estáveis E únicas para cada item de uma lista a partir de um
 * extrator de chave natural. Quando a mesma chave natural ocorre múltiplas
 * vezes, um sufixo numérico (-2, -3, ...) é adicionado para que o React nunca
 * encontre chaves duplicadas. O resultado é determinístico para uma dada
 * ordem de lista, mantendo as chaves estáveis entre renders.
 */
export function stableUniqueKeys<T>(
    items: readonly T[],
    keyOf: (item: T) => string | number | null | undefined,
): string[] {
    const seen = new Map<string, number>();
    return items.map(item => {
        const base = String(keyOf(item) ?? '');
        const count = (seen.get(base) ?? 0) + 1;
        seen.set(base, count);
        return count === 1 ? base : `${base}-${count}`;
    });
}
