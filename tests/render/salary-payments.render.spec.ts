import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';

/**
 * Render determinístico de Pagamentos de Salários (/salary_payments) — oráculo do total PRÓPRIO do componente.
 *
 * O SalaryPaymentList calcula o total localmente em src/components/HR/SalaryPaymentList.tsx:68
 *   `totalPaid = payments.reduce((acc, p) => acc + p.amount, 0)`
 * e o renderiza num badge inline no header (linhas 313-318), SEM prefixo de sinal
 * (diferente do SupplierPaymentList, que prefixa '-' para sinalizar saída):
 *
 *   <div className="flex items-center gap-4 bg-blue-50 ...">           ← container flex
 *       <div className="text-blue-600 ... font-bold text-lg">          ← 1º filho (VALOR)
 *           {formatCurrency(totalPaid)}
 *       </div>
 *       <div className="text-xs text-blue-800 ... uppercase ...">      ← 2º filho (RÓTULO)
 *           Total Pago
 *       </div>
 *   </div>
 *
 * Aqui exercitamos o cômputo + a renderização, em dois cenários:
 *   - VAZIO: total = R$ 0,00 (reduce sobre [] → 0 → formatCurrency(0) = "R$ 0,00").
 *   - POPULATED: total EXATO = Σ fixture salary_payments.amount (prova que o reduce soma certo).
 *
 * Sem relógio: datas fixas em string ('2001-01-01'); sem new Date() no teste.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * VERIFICAÇÕES FEITAS (passos 1, 2 e 3 da issue #1833)
 * ──────────────────────────────────────────────────────────────────────────────
 * 1) Endpoint do hook (src/hooks/dolibarr/hooks.ts:176-182):
 *      export const useSalaryPayments = createDolibarrHook<RawDolibarrRecord, SalaryPayment>({
 *          queryKey: 'salary_payments',
 *          storeName: 'salaryPayments',
 *          endpoint: 'salary_payments',  ← confirmado: 'salary_payments'
 *          dateField: 'tms',
 *          mapper: mappers.mapSalaryPayment,
 *      });
 *    ⇒ stubNetwork recebe a chave 'salary_payments' (lowercase, casada pelo
 *      regex do _harness: /[?&]type=([a-z_]+)/i).
 *
 * 2) Shape RAW (antes do mapper em src/hooks/dolibarr/mappers.ts:1136-1148):
 *      export const mapSalaryPayment = (raw: any): SalaryPayment => ({
 *          id: toString(raw.id),
 *          ref: raw.ref || '',
 *          num_payment: raw.num_payment || undefined,
 *          fk_user: toString(raw.fk_user),                 // '' se ausente
 *          fk_salary: raw.fk_salary ? toString(raw.fk_salary) : undefined,
 *          date_payment: toTimestamp(raw.date_payment || raw.datep),
 *          amount: toNumber(raw.amount),                   // 0 se ausente
 *          salary: toNumber(raw.salary),                   // 0 se ausente
 *          fk_bank: toString(raw.fk_bank),                 // '' se ausente
 *          fk_typepayment: raw.fk_typepayment || undefined,
 *          date_modification: toTimestamp(raw.tms),
 *      });
 *    ⇒ As fixtures precisam apenas de id, ref, date_payment, amount. Campos
 *      opcionais ficam ausentes → o mapper produz '' / undefined / 0, sem erro.
 *
 * 3) Comportamento do total (src/components/HR/SalaryPaymentList.tsx:68):
 *      const totalPaid = useMemo(() =>
 *          payments.reduce((acc, p) => acc + p.amount, 0),
 *          [payments]);
 *    ⇒ Diferente do pending-payments (que usa ListTotalBar + soma de total_ttc),
 *      aqui o campo é `amount` (NÃO `total_ttc`) e o reduce é direto, sem
 *      filtragem por statut. Reflete fielmente a lógica real.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * SELETOR (passo 6 da issue #1833 — diverge do padrão pending-payments)
 * ──────────────────────────────────────────────────────────────────────────────
 * O padrão pending-payments.render.spec.ts usa `following-sibling::h3`, mas
 * aqui o SalaryPaymentList NÃO usa ListTotalBar — usa um badge inline no
 * header (SalaryPaymentList.tsx:313-318) com RÓTULO "Total Pago" (não apenas
 * "Total"). Portanto o VALOR é o PRECEDING-sibling do rótulo "Total Pago" (e
 * ambos são <div>, não <h3>). Daí `preceding-sibling::div[1]`.
 *
 * Diferentemente do PaymentList/SupplierPaymentList (rótulo = "Total"), aqui o
 * rótulo é composto ("Total Pago") e o valor NÃO tem prefixo '-' (é apenas
 * `formatCurrency(totalPaid)` na linha 316 — o '-' só aparece em cada item da
 * lista, linha 130, não no total agregado).
 */

const brl = (intReais: string, cents = '00') => new RegExp(`^R\\$\\s*${intReais},${cents}$`);

// Fixtures no SHAPE RAW consumido por mapSalaryPayment (mappers.ts:1136).
// Datas em string fixa ('2001-01-01') — zero dependência de relógio.
// Aritmética validada: 1234,56 + 765,44 + 2500,00 = 4500,00.
const SALARY_PAYMENTS = [
    { id: '801', ref: 'SAL-2001-0001', date_payment: '2001-01-01', amount: 1234.56 },
    { id: '802', ref: 'SAL-2001-0002', date_payment: '2001-01-01', amount: 765.44 },
    { id: '803', ref: 'SAL-2001-0003', date_payment: '2001-01-01', amount: 2500 },
];

function totalValue(page: Page): Locator {
    return page.getByText('Total Pago', { exact: true }).locator('xpath=preceding-sibling::div[1]');
}

test.describe('Render determinístico — Pagamentos de Salários (/salary_payments)', () => {
    test('estado VAZIO: total = R$ 0,00', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { salary_payments: [] });

        await page.goto('/salary_payments', { waitUntil: 'domcontentloaded' });

        // Reduce sobre [] = 0 → formatCurrency(0) = "R$ 0,00". \s* cobre NBSP (Intl pt-BR).
        await expect(totalValue(page)).toHaveText(brl('0'), { timeout: 15000 });
    });

    test('POPULATED: total = Σ fixture salary_payments.amount (4500,00)', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { salary_payments: SALARY_PAYMENTS });

        await page.goto('/salary_payments', { waitUntil: 'domcontentloaded' });

        // 1234,56 + 765,44 + 2500,00 = 4500,00 — prova que o reduce soma exatamente os 3 itens.
        await expect(totalValue(page)).toHaveText(brl('4.500'), { timeout: 15000 });
    });
});