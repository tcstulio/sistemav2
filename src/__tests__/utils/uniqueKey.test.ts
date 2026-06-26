import { describe, it, expect } from 'vitest';
import { stableUniqueKeys } from '../../utils/uniqueKey';

// #825: chaves baseadas em campo natural (ex.: nome de armazém, nome de doc) podem
// colidir quando há entradas duplicadas, gerando chaves React duplicadas. O helper
// garante unicidade mantendo estabilidade (determinístico para uma dada ordem).
describe('stableUniqueKeys (#825 — chaves duplicadas)', () => {
    it('usa a chave natural quando não há colisão', () => {
        const keys = stableUniqueKeys(['a', 'b', 'c'], v => v);
        expect(keys).toEqual(['a', 'b', 'c']);
    });

    it('sufixa numericamente apenas as repetições', () => {
        const keys = stableUniqueKeys(['a', 'b', 'a', 'a', 'b'], v => v);
        expect(keys).toEqual(['a', 'b', 'a-2', 'a-3', 'b-2']);
    });

    it('é determinístico (estável) para a mesma ordem de entrada', () => {
        const items = [{ n: 'WH-1' }, { n: 'WH-1' }, { n: 'WH-2' }];
        expect(stableUniqueKeys(items, i => i.n)).toEqual(
            stableUniqueKeys(items, i => i.n),
        );
    });

    it('gera todas as chaves únicas mesmo com totais duplicados', () => {
        const keys = stableUniqueKeys(
            Array.from({ length: 5 }, () => ({ n: 'dup' })),
            i => i.n,
        );
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('lida com valores numéricos e nulos', () => {
        const keys = stableUniqueKeys(
            [{ id: 1 }, { id: 1 }, { id: null }, { id: null }],
            i => i.id,
        );
        expect(new Set(keys).size).toBe(4);
    });
});
