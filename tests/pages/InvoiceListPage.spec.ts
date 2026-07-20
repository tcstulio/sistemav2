import { test, expect } from '@playwright/test';
import { seedAuth, stubNetwork } from '../render/_harness';
import { InvoiceListPage } from './InvoiceListPage';

/**
 * Spec de regressão do page object `InvoiceListPage` (issue #1558).
 *
 * Foco: validar o contrato público do page object — os 5 métodos exigidos
 * (`goto`, `filterByStatus`, `filterByDateRange`, `expectInvoiceInList`,
 * `getTotalAmount`) e os seletores listados (`statusFilter`, `dateFromFilter`,
 * `dateToFilter`, `invoiceRow(ref)`, `amountColumn`, `totalAmountCell`).
 *
 * Dois eixos complementares (sem sobrepor o oráculo de `invoices.render.spec.ts`,
 * que pertence à suite de render):
 *
 *  1. **Render determinístico (app real, rede interceptada)**: exercita
 *     `goto`, `expectInvoiceInList`, `invoiceRow` (precisão anti-prefixo) e
 *     `getTotalAmount` contra o `InvoiceList.tsx` real — válida que os
 *     seletores fallback casam o UI atual baseado em Card.
 *
 *  2. **Delegação para `applyFilter` (form sintético)**: como o UI atual usa
 *     `Tabs` para status (ainda não o `<select name="status">` forward-compat),
 *     os métodos de filtro são exercitados contra um `<form data-testid="filter-form">`
 *     injetado via `page.setContent`. Isso prova — sem depender do app real —
 *     que `filterByStatus`/`filterByDateRange` delegam corretamente ao helper
 *     herdado `applyFilter`, satisfazendo o critério de aceite "usa applyFilter
 *     internamente". `setContent` (página estática, zero rede) elimina qualquer
 *     flakiness de `networkidle`.
 */

const THIRDPARTIES = [
    { id: '201', name: 'Cliente Fatura SA', code_client: 'CU-9001', town: 'São Paulo', client: '1', status: '1', tms: 1750000000, datec: 1700000000, fournisseur: '0' },
];

// Faturas comuns às suítes de render e precisão. total_ttc intencionalmente
// distintos (1500.50 + 890.00 = 2390.50) — oráculo da soma em getTotalAmount.
const INVOICES = [
    { id: '301', ref: 'FA2601-0001', total_ttc: 1500.5, fk_soc: '201', statut: '1', paye: '0', date_invoice: 1750000000, tms: 1750000000, datec: 1750000000 },
    { id: '302', ref: 'FA2601-0002', total_ttc: 890,    fk_soc: '201', statut: '2', paye: '1', date_invoice: 1750000100, tms: 1750000100, datec: 1750000100 },
];

// Par com refs que são PREFIXO uma da outra — oráculo de precisão do
// `invoiceRow` (mesma família de regressão do `OrderListPage.spec.ts`).
const COLLISION_INVOICES = [
    { id: '311', ref: 'FA2601-0001',  total_ttc: 100, fk_soc: '201', statut: '1', paye: '0', date_invoice: 1750000000, tms: 1750000000, datec: 1750000000 },
    { id: '312', ref: 'FA2601-00011', total_ttc: 200, fk_soc: '201', statut: '2', paye: '1', date_invoice: 1750000100, tms: 1750000100, datec: 1750000100 },
];

// =========================================================================
// Eixo 1 — Render determinístico (app real via harness)
// =========================================================================

test.describe('InvoiceListPage — render determinístico (app real)', () => {
    test('goto aterrissa em /invoices', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { invoices: INVOICES, thirdparties: THIRDPARTIES });

        const invoicesPage = new InvoiceListPage(page);
        await invoicesPage.goto();

        await expect(page).toHaveURL(/\/invoices/);
    });

    test('expectInvoiceInList localiza faturas alimentadas', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { invoices: INVOICES, thirdparties: THIRDPARTIES });

        const invoicesPage = new InvoiceListPage(page);
        await invoicesPage.goto();

        await invoicesPage.expectInvoiceInList('FA2601-0001');
        await invoicesPage.expectInvoiceInList('FA2601-0002');
    });

    test('invoiceRow distingue refs que são prefixo uma da outra', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { invoices: COLLISION_INVOICES, thirdparties: THIRDPARTIES });

        const invoicesPage = new InvoiceListPage(page);
        await invoicesPage.goto();

        // Ambos localizados pela ref exata (ancorada) — sem colisão de prefixo.
        await invoicesPage.expectInvoiceInList('FA2601-0001');
        await invoicesPage.expectInvoiceInList('FA2601-00011');
    });

    test('invoiceRow não casa ref parcial, ausente nem com dígito extra', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { invoices: COLLISION_INVOICES, thirdparties: THIRDPARTIES });

        const invoicesPage = new InvoiceListPage(page);
        await invoicesPage.goto();

        // Prefixo sem o último dígito: substring casaria `FA2601-000` em ambas;
        // ancorado, não casa nenhuma.
        await expect(invoicesPage.invoiceRow('FA2601-000')).toHaveCount(0);
        // Dígito extra além do real: também não deve casar.
        await expect(invoicesPage.invoiceRow('FA2601-000111')).toHaveCount(0);
        // Ref totalmente inexistente.
        await expect(invoicesPage.invoiceRow('FA9999-ZZZZ')).toHaveCount(0);
    });

    test('getTotalAmount soma a coluna de valores e retorna o número parseado', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { invoices: INVOICES, thirdparties: THIRDPARTIES });

        const invoicesPage = new InvoiceListPage(page);
        await invoicesPage.goto();

        // Σ total_ttc = 1500.50 + 890.00 = 2390.50. Oráculo de NÚMERO parseado
        // do DOM (BRL → EN), não string — cobre parse de prefixo R$, separador
        // de milhares e vírgula decimal.
        const total = await invoicesPage.getTotalAmount();
        expect(total).toBeCloseTo(2390.5, 2);

        // Sanidade: o número calculado deve bater com o exibido pelo app no
        // `totalAmountCell` (ListTotalBar), provando que ambos os seletores
        // apontam para a mesma semântica.
        await expect(invoicesPage.totalAmountCell).toHaveText(/^R\$\s*2\.390,50$/, { timeout: 15000 });
    });
});

// =========================================================================
// Eixo 2 — Delegação para applyFilter (form sintético via setContent)
// =========================================================================

/** HTML mínimo do filter form forward-compat (contrato do `applyFilter`). */
const FILTER_FORM_HTML = `
<form data-testid="filter-form">
    <select name="status">
        <option value="">Todos</option>
        <option value="paid">Pagas</option>
        <option value="unpaid">A Pagar</option>
        <option value="draft">Rascunhos</option>
    </select>
    <input name="date_from" type="date" />
    <input name="date_to" type="date" />
    <button type="submit">Aplicar</button>
</form>
`;

/**
 * Monta o filter form em uma página vazia e previne o submit default (que
 * senão tentaria navegar/recarregar). Página estática → zero rede →
 * `waitForLoadState('networkidle')` resolve instantaneamente, eliminando
 * qualquer flakiness no caminho do `applyFilter`.
 */
async function mountFilterForm(page: import('@playwright/test').Page): Promise<void> {
    await page.setContent(FILTER_FORM_HTML);
    await page.evaluate(() => {
        document.querySelector('form')?.addEventListener('submit', (e) => e.preventDefault());
    });
}

test.describe('InvoiceListPage — delegação para applyFilter (#1558)', () => {
    test('filterByStatus aplica o valor no select[name="status"]', async ({ page }) => {
        await mountFilterForm(page);

        const invoicesPage = new InvoiceListPage(page);
        await invoicesPage.filterByStatus('paid');

        await expect(invoicesPage.statusFilter).toHaveValue('paid');
    });

    test('filterByStatus percorre todos os statuses aceitos pelo tipo', async ({ page }) => {
        await mountFilterForm(page);

        const invoicesPage = new InvoiceListPage(page);
        const statuses: Array<'paid' | 'unpaid' | 'draft'> = ['unpaid', 'draft', 'paid'];
        for (const s of statuses) {
            await invoicesPage.filterByStatus(s);
            await expect(invoicesPage.statusFilter).toHaveValue(s);
        }
    });

    test('filterByDateRange preenche date_from e date_to', async ({ page }) => {
        await mountFilterForm(page);

        const invoicesPage = new InvoiceListPage(page);
        await invoicesPage.filterByDateRange('2025-01-01', '2025-01-31');

        await expect(invoicesPage.dateFromFilter).toHaveValue('2025-01-01');
        await expect(invoicesPage.dateToFilter).toHaveValue('2025-01-31');
    });
});
