import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../../utils/mapWithConcurrency';

// Auditoria (#125): WarehouseList.loadStock fazia Promise.all(candidates.map(...)) — uma
// requisição HTTP por produto, TODAS simultâneas. Com centenas de produtos isso pode
// derrubar o Dolibarr. O helper limita a concorrência preservando a ordem dos resultados.
describe('mapWithConcurrency (#125/auditoria — N+1 sem limite)', () => {
    it('nunca excede o limite de concorrência', async () => {
        let active = 0;
        let peak = 0;
        const items = Array.from({ length: 50 }, (_, i) => i);
        const limit = 5;
        await mapWithConcurrency(items, limit, async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 3));
            active--;
        });
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThanOrEqual(limit);
    });

    it('preserva a ordem e mapeia todos os itens', async () => {
        const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
        expect(out).toEqual([10, 20, 30, 40]);
    });

    it('processa todos mesmo com mais itens que o limite', async () => {
        const items = Array.from({ length: 23 }, (_, i) => i);
        const out = await mapWithConcurrency(items, 4, async (n) => n);
        expect(out).toEqual(items);
    });
});
