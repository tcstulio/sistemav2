import { describe, it, expect } from 'vitest';
import { getMonthlyCashFlow } from '../../utils/analytics/financial';

// #1083 — bugs de unidade de data (ms x segundos) no fluxo de caixa mensal.
// O mapper toTimestamp entrega timestamps em MILISSEGUNDOS. Salários/impostos/VAT
// chegam com date_payment numérico (ms); payments/supplierPayments chegam como ISO string.
// Datas usadas abaixo são a meio do mês para serem à prova de fuso/limite de mês.
describe('getMonthlyCashFlow — unidades de data (ms x segundos) #1083', () => {
    const MONTH = 6; // junho/2024
    const YEAR = 2024;

    // Meados de junho (ms) — mesmo formato produzido pelos mappers
    const juneMs = new Date('2024-06-10T10:00:00Z').getTime();
    // Meados de maio (ms) — fora da janela selecionada
    const mayMs = new Date('2024-05-10T10:00:00Z').getTime();

    it('filtra salários (date_payment em ms) corretamente pelo mês selecionado', () => {
        const salaries = [
            { date_payment: juneMs, amount: 5000 },
            { date_payment: mayMs, amount: 3000 },
        ];
        const result = getMonthlyCashFlow(MONTH, YEAR, [], [], salaries, [], []);
        expect(result.breakdown.salaries).toBe(5000);
        expect(result.outflow).toBe(5000);
    });

    it('filtra impostos (SocialContribution) e VAT com date_payment em ms', () => {
        const taxes: any[] = [{ date_payment: juneMs, amount: 500 }];
        const vat: any[] = [{ date_payment: juneMs, amount: 500 }];
        const result = getMonthlyCashFlow(MONTH, YEAR, [], [], [], taxes, vat);
        expect(result.breakdown.taxes).toBe(1000);
        expect(result.outflow).toBe(1000);
    });

    it('normaliza date_payment numérico em segundos (legado) para ms', () => {
        const juneSec = Math.floor(juneMs / 1000);
        const salaries = [{ date_payment: juneSec, amount: 2000 }];
        const result = getMonthlyCashFlow(MONTH, YEAR, [], [], salaries, [], []);
        expect(result.breakdown.salaries).toBe(2000);
    });

    it('aceita date_payment como string ISO (payments/supplierPayments)', () => {
        const payments: any[] = [{ date_payment: '2024-06-10T10:00:00Z', amount: 1000 }];
        const result = getMonthlyCashFlow(MONTH, YEAR, payments, [], [], [], []);
        expect(result.inflow).toBe(1000);
    });

    it('NÃO produz NaN quando amount está ausente ou não-numérico (#1083)', () => {
        const salaries = [
            { date_payment: juneMs },                 // sem amount
            { date_payment: juneMs, amount: 'abc' },  // não-numérico
            { date_payment: juneMs, amount: 1500 },   // válido
        ];
        const result = getMonthlyCashFlow(MONTH, YEAR, [], [], salaries, [], []);
        expect(Number.isNaN(result.outflow)).toBe(false);
        expect(Number.isNaN(result.net)).toBe(false);
        expect(result.breakdown.salaries).toBe(1500);
    });

    it('calcula resultado líquido = entradas - saídas (todas as fontes)', () => {
        const payments: any[] = [{ date_payment: '2024-06-10T10:00:00Z', amount: 8000 }];
        const supplierPayments: any[] = [{ date_payment: '2024-06-11T10:00:00Z', amount: 1000 }];
        const salaries: any[] = [{ date_payment: juneMs, amount: 2000 }];
        const taxes: any[] = [{ date_payment: juneMs, amount: 500 }];
        const vat: any[] = [{ date_payment: juneMs, amount: 500 }];
        const result = getMonthlyCashFlow(MONTH, YEAR, payments, supplierPayments, salaries, taxes, vat);
        expect(result.inflow).toBe(8000);
        expect(result.outflow).toBe(4000);
        expect(result.net).toBe(4000);
        expect(result.breakdown.suppliers).toBe(1000);
        expect(result.breakdown.taxes).toBe(1000);
    });

    it('ignora lançamentos fora do mês selecionado', () => {
        const payments: any[] = [{ date_payment: '2024-05-10T10:00:00Z', amount: 9999 }];
        const salaries: any[] = [{ date_payment: mayMs, amount: 9999 }];
        const result = getMonthlyCashFlow(MONTH, YEAR, payments, [], salaries, [], []);
        expect(result.inflow).toBe(0);
        expect(result.outflow).toBe(0);
        expect(result.net).toBe(0);
    });
});
