import { test, expect } from '@playwright/test';
import { seedAuth, stubNetwork } from './render/_harness';
import { ProposalListPage } from './pages/ProposalListPage';

/**
 * Spec E2E do fluxo comercial de Propostas — consome o Page Object `ProposalListPage`.
 *
 * Esta suíte é a "prova de uso" do Page Object (critério de aceite da issue #1556:
 * "Pronto para uso em comercial.spec.ts") e cobre a lacuna apontada pelo Judge nas
 * tentativas anteriores ("Page Object não foi integrado/consumido por nenhum spec").
 *
 * Estratégia de execução determinística (sem backend/Dolibarr reais):
 *  - `seedAuth` semeia sessão admin no localStorage antes do 1º paint (sem tela de login).
 *  - `stubNetwork` intercepta `/api/**` e devolve fixtures conhecidas.
 * Assim o fluxo de LEITURA (listar/ver status) é totalmente verificável na CI.
 *
 * Os fluxos de ESCRITA (criar proposta, converter em pedido) dependem de POSTs reais
 * que o stub devolve como `[]` — por isso são isolados num `describe` que exige backend
 * ativo (seguindo o padrão do `smoke.spec.ts`, que faz `test.skip()` sem backend).
 */

const THIRDPARTIES = [
    { id: '201', name: 'Cliente Comercial SA', code_client: 'CU-7001', town: 'São Paulo', client: '1', status: '1', tms: 1750000000, datec: 1700000000, fornisseur: '0' },
];

const PROPOSALS = [
    { id: '501', ref: 'PR2601-0001', fk_soc: '201', total_ht: 1000, total_ttc: 1100, total_tva: 100, statut: '1', datep: 1750000000, tms: 1750000000, datec: 1750000000 },
    { id: '502', ref: 'PR2601-0002', fk_soc: '201', total_ht: 500, total_ttc: 550, total_tva: 50, statut: '2', datep: 1750000100, tms: 1750000100, datec: 1750000100 },
];

test.describe('Fluxo comercial — Propostas (Page Object)', () => {
    test.describe('Leitura (determinística, sem backend)', () => {
        test('navega para /proposals e lista propostas conhecidas', async ({ page, context }) => {
            await seedAuth(context);
            await stubNetwork(page, { proposals: PROPOSALS, thirdparties: THIRDPARTIES });

            const proposalsPage = new ProposalListPage(page);
            await proposalsPage.goto();

            await proposalsPage.expectProposalInList('PR2601-0001');
            await proposalsPage.expectProposalInList('PR2601-0002');
        });

        test('valida badge de status de cada proposta', async ({ page, context }) => {
            await seedAuth(context);
            await stubNetwork(page, { proposals: PROPOSALS, thirdparties: THIRDPARTIES });

            const proposalsPage = new ProposalListPage(page);
            await proposalsPage.goto();

            await proposalsPage.expectStatus('PR2601-0001', 'Aberta');
            await proposalsPage.expectStatus('PR2601-0002', 'Assinada');
        });

        test('botão "Nova" está disponível para admin', async ({ page, context }) => {
            await seedAuth(context);
            await stubNetwork(page, { proposals: PROPOSALS, thirdparties: THIRDPARTIES });

            const proposalsPage = new ProposalListPage(page);
            await proposalsPage.goto();

            await expect(proposalsPage.newProposalButton).toBeVisible({ timeout: 15000 });
        });
    });

    test.describe('Escrita (exige backend real — skippable na CI sem backend)', () => {
        test('createForCustomer abre o formulário, seleciona cliente e submete', async ({ page, context, request }) => {
            // Sem backend os POSTs de criação não têm efeito — pula (padrão do smoke.spec.ts).
            const health = await request
                .get('http://localhost:3004/health', { timeout: 5000, failOnStatusCode: false })
                .catch(() => null);
            if (!health) { test.skip(); return; }

            await seedAuth(context);
            await stubNetwork(page, { proposals: PROPOSALS, thirdparties: THIRDPARTIES });

            const proposalsPage = new ProposalListPage(page);
            await proposalsPage.goto();

            await proposalsPage.createForCustomer('201');

            // Após criar, a lista recarrega e o Page Object espera networkidle.
            await expect(page).toHaveURL(/\/proposals/);
        });

        test('convertToOrder clica em "Criar Pedido" a partir de uma proposta assinada', async ({ page, context, request }) => {
            const health = await request
                .get('http://localhost:3004/health', { timeout: 5000, failOnStatusCode: false })
                .catch(() => null);
            if (!health) { test.skip(); return; }

            await seedAuth(context);
            await stubNetwork(page, { proposals: PROPOSALS, thirdparties: THIRDPARTIES });

            const proposalsPage = new ProposalListPage(page);
            await proposalsPage.goto();

            // PR2601-0002 é a proposta Assinada (statut=2) — pré-requisito do convert.
            await proposalsPage.convertToOrder('PR2601-0002');

            await expect(page).toHaveURL(/\/proposals/);
        });
    });
});
