import { test, expect, type Page } from '@playwright/test';
import { seedAuth, stubNetwork } from './_harness';

/**
 * SWEEP determinístico de TODAS as telas — "o que está errado em todas as telas", feito certo.
 *
 * Substitui o crawler contra prod (scripts/audit-screens.ts), que é cego/instável: bate no backend
 * real cross-origin, trava no gate de loading (App.tsx:100 `if(!config) return null`) e devolve
 * falso "tudo em branco". Aqui: semeio auth + STUB da rede (toda entidade vazia) → o app passa do
 * gate e pinta o estado-VAZIO de cada tela. Assim o sweep pega quem QUEBRA no vazio:
 *   - crash de render capturado pelo ErrorBoundary ("Reportar ao Assistente" / "Algo deu errado");
 *   - exceção NÃO-tratada durante o render (pageerror);
 *   - "NaN" renderizado (parse/divisão sem guarda);
 *   - tela que fica presa em branco (nada pintado além do mínimo).
 * CI-pure: zero backend, zero credencial. Espelha o ALL_ROUTES de scripts/audit-screens.ts.
 */

const ROUTES = [
    '/', '/my-tasks', '/agenda',
    '/whatsapp', '/chat', '/email', '/automation', '/venues', '/centrovibe', '/simulator',
    '/customers', '/proposals', '/orders', '/shipments', '/contracts', '/interventions', '/tickets',
    '/invoices', '/payments', '/tax_payments',
    '/suppliers', '/supplier_proposals', '/supplier_invoices', '/supplier_payments', '/pending_payments', '/expense_report_payments',
    '/projects', '/hr', '/salary_payments', '/bank_accounts', '/reports', '/monthly-report',
    '/products', '/categories', '/warehouses', '/manufacturing',
    '/notifications', '/issues', '/activity', '/system-events', '/admin/groups', '/development', '/chat-sessions', '/settings',
    '/permissions',
];

async function gotoEmpty(page: Page, context: import('@playwright/test').BrowserContext, route: string, pageErrors: string[]) {
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));
    await seedAuth(context);
    await stubNetwork(page, {}); // toda entidade → [] : estado-vazio de cada tela
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    // Sai do gate de loading: algo real pintado (o #root deixa de ser ~vazio). Se ficar preso em
    // branco (como o crawler-contra-prod), este poll estoura = a própria falha que queremos flagrar.
    await expect
        .poll(async () => (await page.locator('#root').innerText().catch(() => '')).trim().length, { timeout: 15000 })
        .toBeGreaterThan(30);
}

test.describe('Sweep de render — todas as telas (estado vazio)', () => {
    for (const route of ROUTES) {
        test(`renderiza sem crash: ${route}`, async ({ page, context }) => {
            const pageErrors: string[] = [];
            await gotoEmpty(page, context, route, pageErrors);

            // 1) ErrorBoundary NÃO disparou (crash de render capturado). Texto exclusivo do fallback.
            await expect(page.getByText('Reportar ao Assistente')).toHaveCount(0);
            await expect(page.getByRole('heading', { name: /Algo deu errado|Erro em /i })).toHaveCount(0);
            // 2) Nada de "NaN" renderizado.
            await expect(page.getByText(/\bNaN\b/).first()).toHaveCount(0);
            // 3) Sem exceção não-tratada durante o render.
            expect(pageErrors, `pageerror em ${route}:\n${pageErrors.join('\n')}`).toEqual([]);
        });
    }
});
