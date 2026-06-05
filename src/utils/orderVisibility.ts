import { safeStorage } from './safeStorage';

// Fundação compartilhada do "admin define o padrão + override do usuário" (#110 menu, #111 dashboard).
// Aplica visibilidade + ordem a qualquer lista de itens identificados por id.

export interface OrderVisibilityPrefs {
    hidden: string[];
    order: string[];
}

export const EMPTY_PREFS: OrderVisibilityPrefs = { hidden: [], order: [] };

/** Lê o override pessoal do usuário (localStorage) para um namespace (ex.: 'coolgroove_menu_prefs'). */
export function getUserPrefs(key: string): OrderVisibilityPrefs {
    const p = safeStorage.getJSON<Partial<OrderVisibilityPrefs>>(key, {});
    return {
        hidden: Array.isArray(p.hidden) ? p.hidden : [],
        order: Array.isArray(p.order) ? p.order : [],
    };
}

/** Persiste o override pessoal do usuário. */
export function setUserPrefs(key: string, prefs: OrderVisibilityPrefs): void {
    safeStorage.setJSON(key, prefs);
}

/**
 * Aplica visibilidade + ordem a uma lista.
 * - Oculta itens cujo id esteja em `orgPrefs.hidden` OU `userPrefs.hidden`.
 * - Ordena por `userPrefs.order` se houver; senão por `orgPrefs.order`.
 *   Ids fora da ordem preferida mantêm a ordem original, ao final (estável).
 */
export function applyOrderVisibility<T>(
    items: T[],
    getId: (item: T) => string,
    orgPrefs?: Partial<OrderVisibilityPrefs> | null,
    userPrefs?: Partial<OrderVisibilityPrefs> | null,
): T[] {
    const hidden = new Set<string>([
        ...(orgPrefs?.hidden || []),
        ...(userPrefs?.hidden || []),
    ]);
    const order = (userPrefs?.order && userPrefs.order.length > 0)
        ? userPrefs.order
        : (orgPrefs?.order || []);

    const visible = items.filter((it) => !hidden.has(getId(it)));
    if (order.length === 0) return visible;

    const rank = new Map<string, number>();
    order.forEach((id, idx) => rank.set(id, idx));

    return visible
        .map((it, idx) => ({ it, idx, r: rank.has(getId(it)) ? rank.get(getId(it))! : Number.MAX_SAFE_INTEGER }))
        .sort((a, b) => (a.r - b.r) || (a.idx - b.idx)) // ids sem ordem preferida ficam no fim, ordem original
        .map((x) => x.it);
}
