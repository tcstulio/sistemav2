import { test, expect } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';

/**
 * Render determinístico da tela de Faturas (/invoices), estados VAZIO e MOCKADO.
 * Oráculo: alimento faturas com refs conhecidas → elas DEVEM aparecer; alimento 0 → empty-state.
 * As faturas apontam pra um cliente (fk_soc) que também mockamos, pra o nome resolver.
 */

const THIRDPARTIES = [
    { id: '201', name: 'Cliente Fatura SA', code_client: 'CU-9001', town: 'São Paulo', client: '1', status: '1', tms: 1750000000, datec: 1700000000, fournisseur: '0' },
];
const INVOICES = [
    { id: '301', ref: 'FA2601-0001', total_ttc: 1500.5, fk_soc: '201', statut: '1', paye: '0', date_invoice: 1750000000, tms: 1750000000, datec: 1750000000 },
    { id: '302', ref: 'FA2601-0002', total_ttc: 890, fk_soc: '201', statut: '1', paye: '1', date_invoice: 1750000100, tms: 1750000100, datec: 1750000100 },
];

test.describe('Render determinístico — Faturas', () => {
    test('estado VAZIO mostra o empty-state', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { invoices: [], thirdparties: [] });

        await page.goto('/invoices', { waitUntil: 'domcontentloaded' });

        await expect(page.getByText(/Nenhuma fatura encontrada/i).first()).toBeVisible({ timeout: 15000 });
    });

    test('com DADOS MOCKADOS renderiza as faturas alimentadas', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { invoices: INVOICES, thirdparties: THIRDPARTIES });

        await page.goto('/invoices', { waitUntil: 'domcontentloaded' });

        await expect(page.getByText('FA2601-0001')).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('FA2601-0002')).toBeVisible();
    });
});
