import { describe, it, expect, vi } from 'vitest';
import { makeEditItem } from '../../components/SupplierInvoiceList';

describe('makeEditItem — estabilidade de key de linhas (SupplierInvoiceList #848)', () => {
    it('atribui um _rowId único e estável a cada item', () => {
        const a = makeEditItem();
        const b = makeEditItem();
        expect(a._rowId).toBeTruthy();
        expect(b._rowId).toBeTruthy();
        expect(a._rowId).not.toBe(b._rowId);
    });

    it('usa crypto.randomUUID() para gerar o _rowId', () => {
        const spy = vi.spyOn(crypto, 'randomUUID');
        const item = makeEditItem();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(item._rowId).toEqual(expect.any(String));
        spy.mockRestore();
    });

    it('preserva o id do servidor e os campos informados', () => {
        const item = makeEditItem({ id: '42', desc: 'Serviço X', qty: 3, price: 9.9, remise_percent: 5 });
        expect(item).toMatchObject({ id: '42', desc: 'Serviço X', qty: 3, price: 9.9, remise_percent: 5 });
    });

    it('aplica defaults sensatos para itens novos/vazios', () => {
        const item = makeEditItem();
        expect(item).toMatchObject({ desc: '', qty: 1, price: 0, remise_percent: 0 });
        expect(item.id).toBeUndefined();
    });

    it('mantém a identidade de cada linha ao remover um item do meio (sem troca de dados)', () => {
        const rows = [
            makeEditItem({ id: '1', desc: 'A' }),
            makeEditItem({ id: '2', desc: 'B' }),
            makeEditItem({ desc: 'C' }),
        ];
        const idsBefore = rows.map(r => r._rowId);

        const remaining = rows.filter((_, i) => i !== 1);

        expect(remaining.map(r => r._rowId)).toEqual([idsBefore[0], idsBefore[2]]);
        expect(remaining.map(r => r.desc)).toEqual(['A', 'C']);
    });

    it('garante _rowIds distintos mesmo ao construir múltiplas linhas de uma vez', () => {
        const rows = Array.from({ length: 50 }, () => makeEditItem({ desc: 'x' }));
        const unique = new Set(rows.map(r => r._rowId));
        expect(unique.size).toBe(rows.length);
    });
});
