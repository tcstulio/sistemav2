/**
 * Lógica pura (testável) do template "contagem de estoque" (verificação N2).
 * Resposta LIMITADA: por item, um número >= 0. Ao enviar, gera os movimentos de ajuste
 * (delta = contado - atual) apenas para os itens que mudaram.
 */

export interface CountRow {
    productId: string;
    label?: string;
    current: number;            // estoque atual (sistema)
    counted: number | null;     // contagem informada (null = não preenchido)
}

/** Um valor de contagem é válido quando é um número finito >= 0. */
export function isValidCount(v: unknown): boolean {
    if (v === null || v === undefined || v === '') return false;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0;
}

/** Todos os itens preenchidos e válidos? */
export function allCountsValid(rows: CountRow[]): boolean {
    return rows.length > 0 && rows.every((r) => isValidCount(r.counted));
}

export interface StockMovement {
    productId: string;
    delta: number; // contado - atual (assinado); >0 entra, <0 sai
}

/** Movimentos de ajuste apenas para os itens cujo contado difere do atual. */
export function buildMovements(rows: CountRow[]): StockMovement[] {
    return rows
        .filter((r) => isValidCount(r.counted) && Number(r.counted) !== r.current)
        .map((r) => ({ productId: r.productId, delta: Number(r.counted) - r.current }));
}
