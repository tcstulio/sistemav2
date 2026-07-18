import { describe, it, expect } from 'vitest';
import { isRevenueInvoice } from '../../components/ReportsView';

// #1086: a Receita/gráficos só contam faturas REAIS — exclui rascunho (statut 0), abandonada
// (statut 3) e nota de crédito (type 2, estorno). Antes somava total_ttc de TUDO, inflando a receita.
describe('isRevenueInvoice (#1086)', () => {
    it('fatura validada (statut 1, type 0) → conta', () => {
        expect(isRevenueInvoice({ statut: '1', type: '0' })).toBe(true);
    });
    it('fatura paga (statut 2) → conta', () => {
        expect(isRevenueInvoice({ statut: '2', type: '0' })).toBe(true);
    });
    it('RASCUNHO (statut 0) → NÃO conta', () => {
        expect(isRevenueInvoice({ statut: '0', type: '0' })).toBe(false);
    });
    it('ABANDONADA (statut 3) → NÃO conta', () => {
        expect(isRevenueInvoice({ statut: '3', type: '0' })).toBe(false);
    });
    it('NOTA DE CRÉDITO (type 2) → NÃO conta (estorno)', () => {
        expect(isRevenueInvoice({ statut: '1', type: '2' })).toBe(false);
    });
    it('aceita statut/type numéricos (coerção)', () => {
        expect(isRevenueInvoice({ statut: 0, type: 0 })).toBe(false); // rascunho numérico
        expect(isRevenueInvoice({ statut: 1, type: 0 })).toBe(true);
    });
});
