import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Crawler de exploração da UI (fase 3 do processo de achar lacunas).
 * Loga uma vez, navega por todas as telas de topo, e em cada uma captura:
 *   - erros de console (console.error)
 *   - exceções não tratadas (pageerror)
 *   - respostas HTTP >= 400 (APIs falhando)
 *   - screenshot
 * Ao final gera test-results/crawler/REPORT.md com as telas problemáticas.
 *
 * Pré-requisito: credenciais via env (não commitar senha):
 *   TEST_LOGIN=seu_usuario TEST_PASSWORD=sua_senha npx playwright test ui-crawler --project=chromium
 * Roda só no chromium (1 navegador basta p/ auditar).
 */

const ROUTES = [
    '/', '/my-tasks', '/whatsapp', '/email', '/automation',
    '/customers', '/contacts', '/suppliers', '/venues',
    '/invoices', '/supplier_invoices', '/pending_payments',
    '/proposals', '/supplier_proposals', '/smart_quotation',
    '/orders', '/shipments', '/projects', '/tasks', '/tickets',
    '/bank_accounts', '/products', '/services', '/expense_report_payments',
    '/reports', '/monthly-report', '/activity', '/development',
    '/chat-sessions', '/settings', '/opencode-tasks', '/issues',
    '/chat', '/simulator', '/centrovibe',
];

const OUT_DIR = path.join(process.cwd(), 'test-results', 'crawler');
const API_URL = process.env.TEST_API_URL || 'https://sistema.coolgroove.com.br/api/index.php';

interface RouteFinding {
    route: string;
    consoleErrors: string[];
    pageErrors: string[];
    httpErrors: string[];
    navError?: string;
}

async function login(page: Page) {
    await page.goto('/');
    await page.waitForTimeout(1500);
    // Já logado? (config no localStorage da origem) — não há form de senha.
    const hasPassword = await page.locator('input[type="password"]').first().isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasPassword) return;

    const inputs = page.locator('input');
    await inputs.nth(0).fill(API_URL);                          // apiUrl
    await inputs.nth(1).fill(process.env.TEST_LOGIN || '');     // usuário
    await page.locator('input[type="password"]').first().fill(process.env.TEST_PASSWORD || '');
    await page.locator('button[type="submit"], button:has-text("Conect"), button:has-text("Entrar")').first().click();
    // espera sair do wizard (some o campo de senha)
    await expect(page.locator('input[type="password"]').first()).toBeHidden({ timeout: 20000 });
}

test('crawl UI e coleta lacunas/erros por tela', async ({ page }) => {
    test.skip(!process.env.TEST_LOGIN || !process.env.TEST_PASSWORD, 'Defina TEST_LOGIN e TEST_PASSWORD para rodar o crawler.');
    test.setTimeout(ROUTES.length * 15000 + 60000);
    fs.mkdirSync(OUT_DIR, { recursive: true });

    await login(page);

    const findings: RouteFinding[] = [];

    for (const route of ROUTES) {
        const f: RouteFinding = { route, consoleErrors: [], pageErrors: [], httpErrors: [] };
        const onConsole = (msg: any) => { if (msg.type() === 'error') f.consoleErrors.push(String(msg.text()).slice(0, 200)); };
        const onPageError = (err: Error) => f.pageErrors.push(`${err.name}: ${err.message}`.slice(0, 200));
        const onResponse = (res: any) => { if (res.status() >= 400) f.httpErrors.push(`${res.status()} ${res.request().method()} ${new URL(res.url()).pathname}`); };
        page.on('console', onConsole);
        page.on('pageerror', onPageError);
        page.on('response', onResponse);

        try {
            await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 12000 });
            await page.waitForTimeout(2500); // deixa as chamadas de API resolverem
            const safe = route === '/' ? 'home' : route.replace(/\//g, '_').replace(/^_/, '');
            await page.screenshot({ path: path.join(OUT_DIR, `${safe}.png`), fullPage: true }).catch(() => {});
        } catch (e: any) {
            f.navError = String(e?.message || e).slice(0, 200);
        } finally {
            page.off('console', onConsole);
            page.off('pageerror', onPageError);
            page.off('response', onResponse);
        }
        findings.push(f);
        // dedup httpErrors
        f.httpErrors = [...new Set(f.httpErrors)];
        console.log(`[crawler] ${route} → console:${f.consoleErrors.length} pageErr:${f.pageErrors.length} http>=400:${f.httpErrors.length}${f.navError ? ' NAV-FAIL' : ''}`);
    }

    // Relatório
    const problem = findings.filter((f) => f.navError || f.pageErrors.length || f.consoleErrors.length || f.httpErrors.length);
    const md: string[] = [`# Crawler da UI — relatório`, '', `Telas visitadas: ${findings.length} · com problema: ${problem.length}`, ''];
    for (const f of problem) {
        md.push(`## \`${f.route}\``);
        if (f.navError) md.push(`- ❌ **Falha ao carregar:** ${f.navError}`);
        if (f.pageErrors.length) md.push(`- 💥 **Exceções:** ${f.pageErrors.length}`, ...f.pageErrors.map((e) => `  - \`${e}\``));
        if (f.consoleErrors.length) md.push(`- ⚠️ **Console errors:** ${f.consoleErrors.length}`, ...f.consoleErrors.slice(0, 8).map((e) => `  - \`${e}\``));
        if (f.httpErrors.length) md.push(`- 🌐 **HTTP ≥400:** ${f.httpErrors.length}`, ...f.httpErrors.slice(0, 12).map((e) => `  - \`${e}\``));
        md.push('');
    }
    fs.writeFileSync(path.join(OUT_DIR, 'REPORT.md'), md.join('\n'));
    console.log(`\n[crawler] Relatório: ${path.join(OUT_DIR, 'REPORT.md')} · screenshots em ${OUT_DIR}`);
});
