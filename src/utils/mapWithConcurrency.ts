/**
 * Mapeia `items` aplicando `fn` com no máximo `limit` execuções simultâneas,
 * preservando a ordem dos resultados.
 *
 * Criado para evitar o fan-out N+1 sem limite (Promise.all sobre listas grandes),
 * que pode disparar centenas de requisições simultâneas — ex.: estoque por produto
 * no Dolibarr (#125).
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const size = Math.max(1, Math.min(limit, items.length));
    const workers = Array.from({ length: size }, async () => {
        while (true) {
            const i = cursor++;
            if (i >= items.length) break;
            results[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return results;
}
