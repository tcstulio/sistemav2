import { test, expect } from '@playwright/test';
import { seedAuth, stubNetwork } from '../render/_harness';
import { OrderListPage } from './OrderListPage';

/**
 * Guard de regressão do page object `OrderListPage` — focado no ponto apontado
 * na revisão da #1557 (round 2): a FRAGILIDADE do `orderRow` (casamento por
 * substring). A versão correta ancora o ref com `new RegExp('^' + escape + '$')`
 * aplicado ao nó de texto do ref, de modo que refs que são PREFIXO uma da outra
 * (`PV2601-0001` vs `PV2601-00011`) NÃO colidam.
 *
 * Este spec complementa `tests/render/orders.render.spec.ts` (fluxos felizes)
 * sem duplicá-lo: aqui o oráculo é a PRECISÃO da seleção, não o fluxo de negócio.
 * Roda no mesmo harness de render determinístico (rede interceptada, zero backend).
 */

const THIRDPARTIES = [
    { id: '201', name: 'Cliente Colisao SA', code_client: 'CU-9101', town: 'São Paulo', client: '1', status: '1', tms: 1750000000, datec: 1700000000, fornisseur: '0' },
];

// Dois pedidos cujas refs são PREFIXO uma da outra. Statuses DISTINTOS
// (1=Validado, 3=Entregue) é o oráculo: se orderRow casar o ref curto pelo card
// errado (substring), `expectStatus` vai receber o badge do pedido errado e
// falhar — provando a colisão. Sem colisão, cada ref resolve seu próprio card.
const COLLISION_ORDERS = [
    { id: '401', ref: 'PV2601-0001',  total_ttc: 100, fk_soc: '201', statut: '1', datec: 1750000000, tms: 1750000000 },
    { id: '402', ref: 'PV2601-00011', total_ttc: 200, fk_soc: '201', statut: '3', datec: 1750000100, tms: 1750000100 },
];

test.describe('OrderListPage — precisão de seletores (regressão #1557)', () => {
    test('orderRow distingue refs que são prefixo uma da outra', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { orders: COLLISION_ORDERS, thirdparties: THIRDPARTIES });

        const ordersPage = new OrderListPage(page);
        await ordersPage.goto();

        // Ambos localizados pela ref exata.
        await ordersPage.expectOrderInList('PV2601-0001');
        await ordersPage.expectOrderInList('PV2601-00011');

        // O badge retornado deve ser o do pedido CORRETO. Se orderRow casasse por
        // substring, o ref curto acharia também o card `-00011` (Entregue) e a
        // primeira asserção falharia com 'Entregue' != 'Validado'.
        await ordersPage.expectStatus('PV2601-0001',  'Validado');
        await ordersPage.expectStatus('PV2601-00011', 'Entregue');
    });

    test('orderRow não casa ref parcial, ausente nem com dígito extra', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { orders: COLLISION_ORDERS, thirdparties: THIRDPARTIES });

        const ordersPage = new OrderListPage(page);
        await ordersPage.goto();

        // Prefixo sem o último dígito: substring antigo casaria `PV2601-000` em
        // `PV2601-0001`; ancorado (`^PV2601-000$`), não casa nenhum.
        await expect(ordersPage.orderRow('PV2601-000')).toHaveCount(0);
        // Dígito extra além do real: também não deve casar.
        await expect(ordersPage.orderRow('PV2601-000111')).toHaveCount(0);
        // Ref totalmente inexistente.
        await expect(ordersPage.orderRow('PV9999-ZZZZ')).toHaveCount(0);
    });

    test('goto aterrissa na rota /orders', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { orders: COLLISION_ORDERS, thirdparties: THIRDPARTIES });

        const ordersPage = new OrderListPage(page);
        await ordersPage.goto();

        await expect(page).toHaveURL(/\/orders/);
    });
});
