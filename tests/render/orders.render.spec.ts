import { test, expect } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';
import { OrderListPage } from '../pages/OrderListPage';

/**
 * Exercita o page object `OrderListPage` contra a tela real de `/orders`,
 * no harness de render determinístico (rede interceptada — sem backend/Dolibarr).
 * Oráculo: alimentamos pedidos com refs/status conhecidos → os seletores e
 * métodos do page object DEVEM localizá-los corretamente.
 */

const THIRDPARTIES = [
    { id: '201', name: 'Cliente Pedido SA', code_client: 'CU-9100', town: 'São Paulo', client: '1', status: '1', tms: 1750000000, datec: 1700000000, fournisseur: '0' },
];

// statut: 0=Rascunho, 1=Validado, 2=Em Envio, 3=Entregue
const ORDERS = [
    { id: '401', ref: 'PV2601-0001', total_ttc: 1500.5, fk_soc: '201', statut: '1', datec: 1750000000, tms: 1750000000 },
    { id: '402', ref: 'PV2601-0002', total_ttc: 320, fk_soc: '201', statut: '3', datec: 1750000100, tms: 1750000100 },
];

test.describe('OrderListPage — render determinístico em /orders', () => {
    test('goto + expectOrderInList localiza pedidos mockados', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { orders: ORDERS, thirdparties: THIRDPARTIES });

        const ordersPage = new OrderListPage(page);
        await ordersPage.goto();

        await ordersPage.expectOrderInList('PV2601-0001');
        await ordersPage.expectOrderInList('PV2601-0002');
    });

    test('expectStatus valida o badge do pedido (Validado / Entregue)', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { orders: ORDERS, thirdparties: THIRDPARTIES });

        const ordersPage = new OrderListPage(page);
        await ordersPage.goto();

        await ordersPage.expectStatus('PV2601-0001', 'Validado');
        await ordersPage.expectStatus('PV2601-0002', 'Entregue');
    });

    test('expectOrderInList falha para ref ausente (oráculo negativo)', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { orders: ORDERS, thirdparties: THIRDPARTIES });

        const ordersPage = new OrderListPage(page);
        await ordersPage.goto();

        // Ref inexistente não deve aparecer na lista.
        await expect(ordersPage.orderRow('PV9999-ZZZZ')).toHaveCount(0);
    });

    test('convertToInvoice abre o detalhe e dispara "Gerar Fatura" do pedido validado', async ({ page, context }) => {
        await seedAuth(context);
        // createInvoiceFromOrder faz POST .../invoices →cai no fallback genérico do harness (200, []).
        await stubNetwork(page, { orders: ORDERS, thirdparties: THIRDPARTIES });

        const ordersPage = new OrderListPage(page);
        await ordersPage.goto();

        // Pedido validado (statut=1) expõe o botão "Gerar Fatura" na aba Faturas.
        await ordersPage.convertToInvoice('PV2601-0001');

        // Toast de sucesso é a confirmação observável da conversão.
        await expect(page.getByText(/Fatura criada com sucesso/i).first()).toBeVisible({ timeout: 10000 });
    });
});
