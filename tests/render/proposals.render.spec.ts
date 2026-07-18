import { test, expect } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';
import { ProposalListPage } from '../pages/ProposalListPage';

/**
 * Render determinístico da tela de Propostas (/proposals) EXERCITANDO o Page Object
 * `ProposalListPage` contra o DOM real.
 *
 * Diferente dos testes unitários em `src/__tests__/pages/ProposalListPage.test.ts` (que
 * mockam o Playwright e só validam o contrato estrutural), ESTA suíte renderiza o app
 * real com dados controlados e chama os métodos/Seletores do Page Object contra o
 * navegador — é o oráculo que prova que os seletores (`data-testid="proposal-row"`,
 * `data-ref`, `span.inline-flex.rounded-full`, `data-testid="new-proposal"`, etc.)
 * RESOLVEM de fato contra a UI atual.
 *
 * Oráculo: alimento propostas com refs/status conhecidos → o Page Object DEVE enxergá-los.
 */

const THIRDPARTIES = [
    { id: '201', name: 'Cliente Proposta SA', code_client: 'CU-7001', town: 'São Paulo', client: '1', status: '1', tms: 1750000000, datec: 1700000000, fournisseur: '0' },
];

// statut: '0'=Rascunho '1'=Aberta '2'=Assinada '3'=Recusada '4'=Faturada (ProposalList.tsx)
const PROPOSALS = [
    { id: '501', ref: 'PR2601-0001', fk_soc: '201', total_ht: 1000, total_ttc: 1100, total_tva: 100, statut: '1', datep: 1750000000, tms: 1750000000, datec: 1750000000 },
    { id: '502', ref: 'PR2601-0002', fk_soc: '201', total_ht: 500, total_ttc: 550, total_tva: 50, statut: '2', datep: 1750000100, tms: 1750000100, datec: 1750000100 },
];

test.describe('Render determinístico — Propostas (Page Object)', () => {
    test('estado VAZIO mostra o empty-state', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { proposals: [], thirdparties: [] });

        const proposalsPage = new ProposalListPage(page);
        await proposalsPage.goto();

        await expect(page.getByText(/Nenhuma proposta encontrada|Nenhuma proposta/i).first())
            .toBeVisible({ timeout: 15000 });
    });

    test('Page Object resolve seletores contra o DOM real (goto + proposalRow + statusBadge)', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { proposals: PROPOSALS, thirdparties: THIRDPARTIES });

        const proposalsPage = new ProposalListPage(page);
        await proposalsPage.goto();

        // Seletor primário "Nova" (data-testid="new-proposal") deve resolver visível.
        await expect(proposalsPage.newProposalButton).toBeVisible({ timeout: 15000 });

        // proposalRow(ref) deve resolver para a linha da proposta conhecida.
        await proposalsPage.expectProposalInList('PR2601-0001');
        await proposalsPage.expectProposalInList('PR2601-0002');

        // statusBadge(ref) deve resolver dentro da linha e mostrar o label correto.
        await proposalsPage.expectStatus('PR2601-0001', 'Aberta');
        await proposalsPage.expectStatus('PR2601-0002', 'Assinada');
    });

    test('helpers herdados de CommercialBasePage também resolvem contra a UI real', async ({ page, context }) => {
        await seedAuth(context);
        await stubNetwork(page, { proposals: PROPOSALS, thirdparties: THIRDPARTIES });

        const proposalsPage = new ProposalListPage(page);
        await proposalsPage.goto();

        // expectRowVisible é herdado de CommercialBasePage — valida que a herança
        // está consistente com a tabela/Card da tela de propostas.
        await proposalsPage.expectRowVisible('PR2601-0001');
    });
});
