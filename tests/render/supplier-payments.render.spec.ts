import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';

/**
 * Render determinístico de Pagamentos de Fornecedores (/supplier_payments) —
 * oráculo do total PRÓPRIO do componente.
 *
 * Assim como o PaymentList (cliente), o SupplierPaymentList calcula o total
 * localmente em src/components/SupplierPaymentList.tsx:97
 *   `totalPaid = payments.reduce((acc, p) => acc + Number(p.amount), 0)`
 * e o renderiza num badge inline ao lado do título (linhas 196-200), com prefixo
 * "-" (saída de caixa):
 *
 *   <div className="flex items-center gap-2 bg-rose-50 ...">          ← container flex
 *       <div className="text-rose-600 ... font-bold text-lg">         ← 1º filho (VALOR)
 *           -{formatCurrency(totalPaid)}
 *       </div>
 *       <div className="text-xs text-rose-800 ... uppercase ...">      ← 2º filho (RÓTULO)
 *           Total
 *       </div>
 *   </div>
 *
 * Aqui exercitamos o cômputo + a renderização, em dois cenários:
 *   - VAZIO: total = R$ 0,00 (reduce sobre [] → 0 → formatCurrency(0) = "R$ 0,00").
 *   - POPULATED: total EXATO = Σ fixture payments.amount (prova que o reduce soma certo).
 *
 * Sem relógio: datas fixas em string ('2001-01-01'); sem new Date() no teste.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * VERIFICAÇÕES FEITAS (passos 1, 2 e 3 da issue #1832)
 * ──────────────────────────────────────────────────────────────────────────────
 * 1) Endpoint do hook (src/hooks/dolibarr/hooks.ts:445-451):
 *      export const useSupplierPayments = createDolibarrHook<...>({
 *          queryKey: 'supplier_payments',
 *          storeName: 'supplierPayments',
 *          endpoint: 'supplier_payments',  ← confirmado: 'supplier_payments'
 *          ...
 *          mapper: mappers.mapSupplierPayment,
 *      });
 *    ⇒ stubNetwork recebe a chave 'supplier_payments' (lowercase, casada pelo
 *      regex do _harness: /[?&]type=([a-z_]+)/i).
 *
 * 2) Shape RAW (antes do mapper em src/hooks/dolibarr/mappers.ts:399-412):
 *      export const mapSupplierPayment = (data: any): SupplierPayment => ({
 *          id: Number(data.id),
 *          ref: data.ref || `SPAY-${data.id}`,
 *          date_payment: new Date(toTimestamp(data.date_payment)).toISOString(),
 *          amount: Number(data.amount || 0),
 *          // Campos opcionais (fk_bank, mode_id, etc.) → undefined se ausentes.
 *      });
 *    ⇒ As fixtures precisam apenas de id, ref, date_payment, amount. Campos
 *      opcionais ficam ausentes → o mapper produz undefined para eles, sem erro.
 *
 * 3) Comportamento do total (src/components/SupplierPaymentList.tsx:97):
 *      const totalPaid = useMemo(() =>
 *          payments.reduce((acc, p) => acc + Number(p.amount), 0),
 *          [payments]);
 *    ⇒ Diferente do pending-payments (que usa ListTotalBar + soma de total_ttc),
 *      aqui o campo é `amount` (NÃO `total_ttc`) e o reduce é direto, sem
 *      filtragem por statut. Reflete fielmente a lógica real.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * SELETOR (passo 6 da issue #1832 — diverge do padrão pending-payments)
 * ──────────────────────────────────────────────────────────────────────────────
 * O padrão pending-payments.render.spec.ts usa `following-sibling::h3`, mas
 * aqui o SupplierPaymentList NÃO usa ListTotalBar — usa um badge inline no
 * header (SupplierPaymentList.tsx:196-200) idêntico ao PaymentList (linhas
 * 253-256). Portanto o VALOR é o PRECEDING-sibling do rótulo "Total" (e ambos
 * são <div>, não <h3>). Daí `preceding-sibling::div[1]`.
 */

const brl = (intReais: string, cents = '00') => new RegExp(`^-R\\$\\s*${intReais},${cents}$`);

// Fixtures no SHAPE RAW consumido por mapSupplierPayment (mappers.ts:399).
// Datas em string fixa ('2001-01-01') — zero dependência de relógio.
// Aritmética validada: 50,00 + 100,00 + 2500,00 = 2650,00.
const SUPPLIER_PAYMENTS = [
    { id: '601', ref: 'SPAY-2001-0001', date_payment: '2001-01-01', amount: 50 },
    { id: '602', ref: 'SPAY-2001-0002', date_payment: '2001-01-01', amount: 100 },
    { id: '603', ref: 'SPAY-2001-0003', date_payment: '2001-01-01', amount: 2500 },
];

function totalValue(page: Page): Locator {
    return page.getByText('Total', { exact: true }).locator('xpath=preceding-sibling::div[1]');
}

test.describe('Render determinístico — Pagamentos de Fornecedores (/supplier_payments)', () => {
    test('estado VAZIO: total = R$ 0,00', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { supplier_payments: [] });

        await page.goto('/supplier_payments', { waitUntil: 'domcontentloaded' });

        // Reduce sobre [] = 0 → formatCurrency(0) = "R$ 0,00". \s* cobre NBSP (Intl pt-BR).
        await expect(totalValue(page)).toHaveText(brl('0'), { timeout: 15000 });
    });

    test('POPULATED: total = Σ fixture supplier_payments.amount (2650,00)', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { supplier_payments: SUPPLIER_PAYMENTS });

        await page.goto('/supplier_payments', { waitUntil: 'domcontentloaded' });

        // 50 + 100 + 2500 = 2650 — prova que o reduce soma exatamente os 3 itens.
        await expect(totalValue(page)).toHaveText(brl('2.650'), { timeout: 15000 });
    });
});