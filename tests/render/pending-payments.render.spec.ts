import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';

/**
 * Render determinístico de Pagamentos Pendentes (/pending_payments) — ORÁCULO RICO.
 *
 * Vai além de somar um campo: exercita FILTRO + DERIVAÇÃO + SPLIT numa tacada (PendingPayments.tsx:57-107):
 *   Total a Receber = Σ total_ttc de invoices com statut '1'          (exclui pagas)
 *   Total a Pagar   = Σ total_ttc de supplier_invoices com statut '1' (fonte DIFERENTE = split)
 *   "X em atraso"   = Σ das que estão vencidas (isOverdue: dueDate < now)
 *
 * O "em atraso" seria time-dependent — driblo com datas EXTREMAS em date_lim_reglement:
 * 1000000000 (ano 2001) = SEMPRE vencida; 4000000000 (ano 2096) = NUNCA. Assim o total vencido
 * é determinístico p/ qualquer "now" entre 2001 e 2096 (i.e., sempre), sem depender do relógio.
 */

const brl = (intReais: string, cents = '00') => new RegExp(`^R\\$\\s*${intReais},${cents}$`);

// Faturas de CLIENTE (receivables). Só statut '1' entra; a paga (statut '2') é ignorada.
const INVOICES = [
    { id: '1', ref: 'FR-1', statut: '1', total_ttc: 1000, date_lim_reglement: 1000000000, socid: '0', date: 1750000000, tms: 1750000000, datec: 1750000000 }, // vencida
    { id: '2', ref: 'FR-2', statut: '1', total_ttc: 500, date_lim_reglement: 4000000000, socid: '0', date: 1750000100, tms: 1750000100, datec: 1750000100 },  // a vencer
    { id: '3', ref: 'FR-3', statut: '2', total_ttc: 9999, socid: '0', date: 1750000200, tms: 1750000200, datec: 1750000200 },                                  // PAGA → excluída
];
// Faturas de FORNECEDOR (payables). Fonte distinta → prova o split receber/pagar.
const SUPPLIER_INVOICES = [
    { id: '10', ref: 'FP-1', statut: '1', total_ttc: 700, date_lim_reglement: 1000000000, socid: '0', date: 1750000000, tms: 1750000000, datec: 1750000000 }, // vencida
    { id: '11', ref: 'FP-2', statut: '1', total_ttc: 300, date_lim_reglement: 4000000000, socid: '0', date: 1750000100, tms: 1750000100, datec: 1750000100 },  // a vencer
];
// Esperado: Receber 1500 (2 de 3, exclui a paga) | Pagar 1000 | Vencido receber 1000 | Vencido pagar 700

function totalH3(page: Page, label: string): Locator {
    return page.getByText(label, { exact: true }).locator('xpath=following-sibling::h3');
}

test.describe('Render determinístico — Pagamentos Pendentes (oráculo de filtro+derivação)', () => {
    test('estado VAZIO: Receber/Pagar zerados, sem bloco "em atraso"', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { invoices: [], supplier_invoices: [] });

        await page.goto('/pending_payments', { waitUntil: 'domcontentloaded' });

        await expect(totalH3(page, 'Total a Receber')).toHaveText(brl('0'), { timeout: 15000 });
        await expect(totalH3(page, 'Total a Pagar')).toHaveText(brl('0'));
        await expect(page.getByText(/em atraso/)).toHaveCount(0); // bloco só aparece se vencido > 0
    });

    test('com DADOS: totais respeitam statut, split e vencimento (determinístico)', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { invoices: INVOICES, supplier_invoices: SUPPLIER_INVOICES });

        await page.goto('/pending_payments', { waitUntil: 'domcontentloaded' });

        // Receber = 1000 + 500 = 1500 (a fatura PAGA de 9999 NÃO entra → prova o filtro statut '1').
        await expect(totalH3(page, 'Total a Receber')).toHaveText(brl('1.500'), { timeout: 15000 });
        // Pagar = 700 + 300 = 1000 (vem de supplier_invoices → prova o split receber/pagar).
        await expect(totalH3(page, 'Total a Pagar')).toHaveText(brl('1.000'));
        // Vencido determinístico (datas extremas): só as de 2001 contam.
        await expect(page.getByText(/1\.000,00 em atraso/)).toBeVisible(); // receber vencido = 1000
        await expect(page.getByText(/700,00 em atraso/)).toBeVisible();    // pagar vencido = 700
    });
});
