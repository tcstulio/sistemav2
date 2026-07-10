import { test, expect } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';

/**
 * Render determinístico da tela de Clientes (/customers), estados VAZIO e MOCKADO.
 * Roda em desktop e mobile (os projects Mobile Chrome/Safari do playwright.config).
 * O oráculo: eu alimento N clientes → a tela DEVE mostrar exatamente eles; alimento 0 → estado-vazio.
 */

// Fixture de exemplo (dado sintético, sem PII real). endpoint do hook de clientes = 'thirdparties'.
const CUSTOMERS = [
    { id: '101', name: 'ACME Comércio Ltda', code_client: 'CU-0001', town: 'São Paulo', client: '1', status: '1', email: 'contato@acme.com.br', tms: 1750000000, datec: 1700000000, fournisseur: '0' },
    { id: '102', name: 'Beta Serviços ME', code_client: 'CU-0002', town: 'Rio de Janeiro', client: '1', status: '1', email: 'fin@beta.com.br', tms: 1750000100, datec: 1700000100, fournisseur: '0' },
    { id: '103', name: 'Gamma Indústria SA', code_client: 'CU-0003', town: 'Belo Horizonte', client: '1', status: '1', email: 'compras@gamma.com.br', tms: 1750000200, datec: 1700000200, fournisseur: '0' },
];

test.describe('Render determinístico — Clientes', () => {
    test('estado VAZIO mostra o empty-state (sem NaN/spinner preso)', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { thirdparties: [] });

        await page.goto('/customers', { waitUntil: 'domcontentloaded' });

        await expect(page.getByText(/Nenhum cliente encontrado/i)).toBeVisible({ timeout: 15000 });
    });

    test('com DADOS MOCKADOS renderiza exatamente os clientes alimentados', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { thirdparties: CUSTOMERS });

        await page.goto('/customers', { waitUntil: 'domcontentloaded' });

        // O oráculo: o que EU aliment(ei) tem que aparecer, e o empty-state NÃO.
        await expect(page.getByText('ACME Comércio Ltda')).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('Beta Serviços ME')).toBeVisible();
        await expect(page.getByText('Gamma Indústria SA')).toBeVisible();
        await expect(page.getByText(/Nenhum cliente encontrado/i)).toHaveCount(0);
    });
});
