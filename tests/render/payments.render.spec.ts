import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';

/**
 * Render determinístico de Pagamentos (/payments) — oráculo do total PROPRIO do componente.
 *
 * Diferente do pending-payments (que usa ListTotalBar), o PaymentList calcula o total
 * localmente em PaymentList.tsx:131 (`totalReceived = Σ payments.amount`) e o renderiza
 * num badge ao lado do título. Aqui exercitamos esse computo + a renderização do valor
 * formatado, em dois cenários:
 *   - VAZIO: total = R$ 0,00 (reduce sobre []).
 *   - POPULATED: total EXATO = Σ fixture payments.amount (prova que o reduce soma certo).
 *
 * Sem relógio: datas fixas em string ISO-like ('2001-01-01'); sem new Date() no teste.
 */

const brl = (intReais: string, cents = '00') => new RegExp(`^R\\$\\s*${intReais},${cents}$`);

// Fixtures no SHAPE RAW (antes do mapper em src/hooks/dolibarr/mappers.ts:377). Apenas os campos
// que o mapper consome precisam estar presentes; demais campos opcionais ficam indefinidos.
const PAYMENTS = [
    { id: '501', ref: 'PAY-2001-0001', date_payment: '2001-01-01', amount: 1234.56 },
    { id: '502', ref: 'PAY-2001-0002', date_payment: '2001-01-01', amount: 765.44 },
    { id: '503', ref: 'PAY-2001-0003', date_payment: '2001-01-01', amount: 2500 },
];
// Esperado: 1234,56 + 765,44 + 2500 = 4500,00.

// No PaymentList.tsx o VALOR é o PRIMEIRO filho do badge e o rótulo "Total" é o SEGUNDO.
// Logo, o valor está em `preceding-sibling::div` (não following-sibling, como o padrão
// pending-payments.render.spec.ts usa para h3).
function totalValue(page: Page): Locator {
    return page.getByText('Total', { exact: true }).locator('xpath=preceding-sibling::div[1]');
}

test.describe('Render determinístico — Pagamentos (/payments)', () => {
    test('estado VAZIO: total = R$ 0,00', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { payments: [] });

        await page.goto('/payments', { waitUntil: 'domcontentloaded' });

        // Reduce sobre [] = 0 → formatCurrency(0) = "R$ 0,00". \s* cobre NBSP (Intl pt-BR).
        await expect(totalValue(page)).toHaveText(brl('0'), { timeout: 15000 });
    });

    test('POPULATED: total = Σ fixture payments.amount (4500,00)', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { payments: PAYMENTS });

        await page.goto('/payments', { waitUntil: 'domcontentloaded' });

        // 1234,56 + 765,44 + 2500,00 = 4500,00 — prova que o reduce soma exatamente os 3 itens.
        await expect(totalValue(page)).toHaveText(brl('4.500'), { timeout: 15000 });
    });
});