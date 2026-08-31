import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';

/**
 * Render determinístico de Pagamentos (/payments) — oráculo do total PRÓPRIO do componente.
 *
 * Diferente do pending-payments (que usa ListTotalBar), o PaymentList calcula o total
 * localmente em src/components/PaymentList.tsx:131
 *   `totalReceived = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0)`
 * e o renderiza num badge ao lado do título (linhas 253-256). Aqui exercitamos esse
 * cômputo + a renderização do valor formatado, em dois cenários:
 *   - VAZIO: total = R$ 0,00 (reduce sobre []).
 *   - POPULATED: total EXATO = Σ fixture payments.amount (prova que o reduce soma certo).
 *
 * Sem relógio: datas fixas em string ISO-like ('2001-01-01'); sem new Date() no teste.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * VERIFICAÇÕES FEITAS (passos 1 e 2 da issue #1827)
 * ──────────────────────────────────────────────────────────────────────────────
 * 1) Endpoint do hook (src/hooks/dolibarr/hooks.ts:324-330):
 *      export const usePayments = createDolibarrHook<RawDolibarrRecord, Payment>({
 *          queryKey: 'payments',
 *          storeName: 'payments',
 *          endpoint: 'payments',       ← confirmado: 'payments'
 *          dateField: 'date_modification',
 *          mapper: mappers.mapPayment,
 *      });
 *    ⇒ stubNetwork recebe a chave 'payments' (lowercase, casada pelo regex do _harness).
 *
 * 2) Shape RAW (antes do mapper em src/hooks/dolibarr/mappers.ts:377-397):
 *      export const mapPayment = (data: any): Payment => ({
 *          id: Number(data.id),
 *          ref: data.ref || `PAY-${data.id}`,
 *          date_payment: new Date(toTimestamp(data.date_payment)).toISOString(),
 *          amount: Number(data.amount || 0),
 *          ...campos opcionais (fk_bank, mode_id, etc.) — undefined se ausentes.
 *      });
 *    ⇒ As fixtures precisam apenas de id, ref, date_payment, amount. Campos opcionais
 *      ficam ausentes → o mapper produz undefined para eles, sem erro.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * SELETOR (passo 6 da issue #1827 — diverge do padrão pending-payments)
 * ──────────────────────────────────────────────────────────────────────────────
 * O padrão pending-payments.render.spec.ts usa `following-sibling::h3`, mas aqui o
 * PaymentList NÃO usa ListTotalBar — usa um badge inline no header (PaymentList.tsx:253-256):
 *
 *   <div className="flex items-center gap-2 bg-emerald-50 ...">          ← container flex
 *       <div className="text-emerald-600 ... font-bold text-lg">         ← 1º filho (VALOR)
 *           {formatCurrency(totalReceived)}
 *       </div>
 *       <div className="text-xs text-emerald-800 ... uppercase ...">      ← 2º filho (RÓTULO)
 *           Total
 *       </div>
 *   </div>
 *
 * Portanto o VALOR é o PRECEDING-sibling do rótulo "Total" (e ambos são <div>, não <h3>).
 * Daí `preceding-sibling::div[1]` em vez de `following-sibling::h3`.
 */

const brl = (intReais: string, cents = '00') => new RegExp(`^R\\$\\s*${intReais},${cents}$`);

// Fixtures no SHAPE RAW consumido por mapPayment (mappers.ts:377). Datas em string
// fixa ('2001-01-01') — zero dependência de relógio. Aritmética validada:
//   1234,56 + 765,44 + 2500,00 = 4500,00
const PAYMENTS = [
    { id: '501', ref: 'PAY-2001-0001', date_payment: '2001-01-01', amount: 1234.56 },
    { id: '502', ref: 'PAY-2001-0002', date_payment: '2001-01-01', amount: 765.44 },
    { id: '503', ref: 'PAY-2001-0003', date_payment: '2001-01-01', amount: 2500 },
];

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
