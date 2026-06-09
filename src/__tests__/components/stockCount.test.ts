import { describe, it, expect } from 'vitest';
import { isValidCount, allCountsValid, buildMovements, CountRow } from '../../components/Tasks/stockCount';

describe('isValidCount', () => {
    it('aceita número >= 0', () => {
        expect(isValidCount(0)).toBe(true);
        expect(isValidCount(5)).toBe(true);
        expect(isValidCount('3')).toBe(true);
    });
    it('rejeita vazio, negativo e não-número', () => {
        expect(isValidCount(null)).toBe(false);
        expect(isValidCount('')).toBe(false);
        expect(isValidCount(-1)).toBe(false);
        expect(isValidCount('abc')).toBe(false);
    });
});

describe('allCountsValid', () => {
    it('true só quando todos preenchidos e válidos', () => {
        expect(allCountsValid([{ productId: 'a', current: 1, counted: 2 }])).toBe(true);
        expect(allCountsValid([{ productId: 'a', current: 1, counted: null }])).toBe(false);
        expect(allCountsValid([])).toBe(false);
    });
});

describe('buildMovements', () => {
    const rows: CountRow[] = [
        { productId: 'a', current: 10, counted: 8 },  // -2
        { productId: 'b', current: 5, counted: 5 },   // sem mudança
        { productId: 'c', current: 0, counted: 3 },   // +3
        { productId: 'd', current: 1, counted: null }, // inválido -> ignora
    ];

    it('gera movimentos só p/ itens que mudaram (delta assinado)', () => {
        const mv = buildMovements(rows);
        expect(mv).toEqual([
            { productId: 'a', delta: -2 },
            { productId: 'c', delta: 3 },
        ]);
    });

    it('lista vazia quando nada mudou', () => {
        expect(buildMovements([{ productId: 'x', current: 7, counted: 7 }])).toEqual([]);
    });
});
