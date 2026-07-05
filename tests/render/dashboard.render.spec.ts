import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';

/**
 * Render determinístico do Dashboard — ORÁCULO DE CORRETUDE DE DADO.
 *
 * As specs de Clientes/Faturas provam PRESENÇA (o nome que alimentei aparece). Esta prova
 * CORRETUDE DE NÚMERO: alimento bank_lines/bank_accounts/invoices conhecidos e verifico que os
 * KPIs do Dashboard batem EXATAMENTE com o cálculo esperado — o que nem permissão nem visão-LLM
 * conseguem validar (uma tela autorizada com o número ERRADO passaria nos dois).
 *
 * Cálculo (Dashboard.tsx:129-133):
 *   Receita Total        = Σ bank_lines.amount > 0
 *   Despesas             = |Σ bank_lines.amount < 0|
 *   Saldo em Caixa       = Σ bank_accounts.solde
 *   Pagamentos Pendentes = nº de invoices com statut === '1'
 * KPIs gated por canAccess('invoices'/'supplier_invoices'/'bank_accounts') — o harness semeia admin.
 */

// Fixtures RAW (shape do custom_sync, antes dos mappers): amount (bank_lines), solde (bank_accounts).
const BANK_LINES = [
    { id: '1', amount: 1000, date_modification: 1750000000 },
    { id: '2', amount: 500, date_modification: 1750000100 },
    { id: '3', amount: -300, date_modification: 1750000200 }, // despesa
];
const BANK_ACCOUNTS = [
    { id: '1', ref: 'CX-1', label: 'Caixa Geral', solde: 2000, status: '1', tms: 1750000000 },
    { id: '2', ref: 'CX-2', label: 'Conta Banco', solde: 500, status: '1', tms: 1750000100 },
];
const INVOICES = [
    { id: '1', ref: 'FA-0001', statut: '1', total_ttc: 100, socid: '101', date: 1750000000, tms: 1750000000 }, // em aberto
    { id: '2', ref: 'FA-0002', statut: '2', total_ttc: 200, socid: '102', date: 1750000100, tms: 1750000100 }, // paga
];
// Esperado: Receita 1500 | Despesas 300 | Caixa 2500 | Pendentes 1

// <h3> do valor, irmão do <p> do título, escopado ao grid de KPIs (evita colisão com legendas de
// gráfico). Retorna Locator p/ asserção web-first (retry) — o valor chega DEPOIS do sync assíncrono.
function kpiH3(page: Page, title: string): Locator {
    const grid = page.locator('div.grid').filter({ has: page.getByText('Receita Total', { exact: true }) });
    return grid.getByText(title, { exact: true }).locator('xpath=following-sibling::h3');
}
// Regex com \s* p/ o espaço da moeda (ICU do Node vs Chromium podem diferir: nbsp vs narrow-nbsp);
// âncoras ^$ garantem match EXATO (não substring — senão "0,00" casaria dentro de "1.500,00").
const money = (intReais: string, cents = '00') => new RegExp(`^R\\$\\s*${intReais},${cents}$`);

test.describe('Render determinístico — Dashboard (oráculo de número)', () => {
    test('estado VAZIO: todos os KPIs zerados (sem NaN)', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { bank_lines: [], bank_accounts: [], invoices: [] });

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await expect(kpiH3(page, 'Receita Total')).toHaveText(money('0'), { timeout: 15000 });
        await expect(kpiH3(page, 'Despesas')).toHaveText(money('0'));
        await expect(kpiH3(page, 'Saldo em Caixa')).toHaveText(money('0'));
        await expect(kpiH3(page, 'Pagamentos Pendentes')).toHaveText(/^0$/);
        // Nenhum KPI pode conter "NaN" (regressão clássica de divisão/parse).
        await expect(page.getByText(/NaN/)).toHaveCount(0);
    });

    test('com DADOS: KPIs batem EXATAMENTE com o cálculo esperado', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { bank_lines: BANK_LINES, bank_accounts: BANK_ACCOUNTS, invoices: INVOICES });

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        // 1º com timeout longo: espera o sync assíncrono (custom_sync → mapper → IndexedDB → re-render).
        await expect(kpiH3(page, 'Receita Total')).toHaveText(money('1.500'), { timeout: 15000 }); // Σ positivos
        await expect(kpiH3(page, 'Despesas')).toHaveText(money('300'));                            // |Σ negativos|
        await expect(kpiH3(page, 'Saldo em Caixa')).toHaveText(money('2.500'));                    // Σ solde
        await expect(kpiH3(page, 'Pagamentos Pendentes')).toHaveText(/^1$/);                       // statut === '1'
        await expect(page.getByText(/NaN/)).toHaveCount(0);
    });
});
