import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Auditoria de telas (varredura parte 2) — LOCAL, sessão admin semeada.
 *
 * Para cada rota do MENU_REGISTRY: captura erros de console, exceções não tratadas,
 * respostas de rede >=400 (separando 429 do rate-limiter dos erros reais), e o estado
 * de render (restrito / erro / em branco / spinner preso / contagem de elementos).
 *
 * Auth: semeia localStorage.coolgroove_config (apiKey = DOLIBARR_API_KEY, currentUser admin)
 * + cookie dolapikey. Tudo passa pelo proxy do backend (/api/dolibarr/*) — ver e2e recipe.
 *
 * Uso: npx tsx scripts/audit-screens.ts            (todas as rotas)
 *      AUDIT_ROUTES="/,/customers" npx tsx scripts/audit-screens.ts   (subconjunto)
 */

const BASE = 'http://localhost:3003';

// Lê DOLIBARR_API_KEY do backend/.env (sem expor)
function readKey(): string {
    const envTxt = readFileSync(join(process.cwd(), 'backend', '.env'), 'utf-8');
    const line = envTxt.split(/\r?\n/).find((l) => l.startsWith('DOLIBARR_API_KEY='));
    return (line ? line.slice('DOLIBARR_API_KEY='.length) : '').trim().replace(/^["']|["']$/g, '');
}

const ALL_ROUTES = [
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

interface RouteResult {
    route: string; finalUrl: string;
    consoleErrors: string[]; pageErrors: string[];
    failed: { url: string; status: number }[]; count429: number;
    restricted: boolean; errorBoundary: boolean; blank: boolean; stuckSpinner: boolean;
    buttons: number; tables: number; inputs: number; textLen: number;
    flags: string[];
}

async function main() {
    const KEY = readKey();
    if (!KEY) { console.error('DOLIBARR_API_KEY não encontrada em backend/.env'); process.exit(1); }
    const routes = (process.env.AUDIT_ROUTES ? process.env.AUDIT_ROUTES.split(',') : ALL_ROUTES).map((r) => r.trim()).filter(Boolean);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
    await context.addInitScript((key) => {
        try {
            localStorage.setItem('coolgroove_config', JSON.stringify({
                apiKey: key,
                apiUrl: 'https://sistema.coolgroove.com.br/api/index.php',
                currentUser: { id: '1', login: 'admin', admin: 1, firstname: 'Admin', lastname: 'Auditor' },
                companyName: 'CoolGroove',
            }));
        } catch { /* noop */ }
    }, KEY);
    await context.addCookies([{ name: 'dolapikey', value: KEY, url: BASE }]);

    const results: RouteResult[] = [];

    // UMA página só + navegação client-side (pushState) → o background-sync roda 1x (no 1º load),
    // evitando estourar o rate-limiter (500/15min) que um page.goto por rota dispararia.
    const page = await context.newPage();
    const mk = (route: string): RouteResult => ({
        route, finalUrl: '', consoleErrors: [], pageErrors: [], failed: [], count429: 0,
        restricted: false, errorBoundary: false, blank: false, stuckSpinner: false,
        buttons: 0, tables: 0, inputs: 0, textLen: 0, flags: [],
    });
    let cur: RouteResult = mk('__init__');
    page.on('console', (m) => { if (m.type() === 'error') cur.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => cur.pageErrors.push(String(e.message).slice(0, 300)));
    page.on('response', (resp) => {
        const s = resp.status();
        if (s >= 400) {
            if (s === 429) cur.count429++;
            else cur.failed.push({ url: resp.url().replace(BASE, '').slice(0, 120), status: s });
        }
    });

    // Carga inicial (dispara o background-sync uma única vez); espera assentar.
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });
    await page.waitForTimeout(5000);

    for (let i = 0; i < routes.length; i++) {
        const route = routes[i];
        const r = mk(route);
        cur = r;
        try {
            // 1ª rota '/' já está carregada; demais via navegação client-side (sem reload → sem re-sync).
            if (!(i === 0 && route === '/')) {
                await page.evaluate((to) => {
                    window.history.pushState({}, '', to);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }, route);
            }
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
            await page.waitForTimeout(1800);
            r.finalUrl = page.url().replace(BASE, '') || '/';

            // Sem page.evaluate (tsx/esbuild injeta __name e quebra no browser): usa locators + regex no Node.
            const txt = ((await page.locator('body').innerText().catch(() => '')) || '').trim();
            r.textLen = txt.length;
            r.restricted = /Acesso Restrito|Acesso restrito|sem permiss[aã]o|n[aã]o tem permiss/i.test(txt);
            r.errorBoundary = /Algo deu errado|Ops!|Something went wrong|Erro inesperado|Tente recarregar/i.test(txt);
            r.buttons = await page.locator('button').count().catch(() => 0);
            r.tables = await page.locator('table').count().catch(() => 0);
            r.inputs = await page.locator('input,textarea,select').count().catch(() => 0);
            r.stuckSpinner = (await page.locator('.animate-spin').count().catch(() => 0)) > 0;
            r.blank = r.textLen < 120 && r.buttons < 3;

            if (r.pageErrors.length) r.flags.push('PAGE_ERROR');
            if (r.failed.length) r.flags.push('NET_' + r.failed.map((f) => f.status).join('/'));
            if (r.count429 > 0) r.flags.push('RATE_LIMIT_429x' + r.count429);
            if (r.errorBoundary) r.flags.push('ERROR_BOUNDARY');
            if (r.restricted) r.flags.push('RESTRICTED');
            if (r.blank) r.flags.push('BLANK');
            if (r.stuckSpinner) r.flags.push('SPINNER');
            if (r.consoleErrors.length) r.flags.push('CONSOLE_ERR_' + r.consoleErrors.length);
            const redirected = r.finalUrl.split('?')[0] !== route && !(route === '/' && r.finalUrl === '/');
            if (redirected) r.flags.push('REDIRECT->' + r.finalUrl);
        } catch (e: any) {
            r.flags.push('NAV_FAIL:' + String(e.message).slice(0, 80));
        }

        const tag = r.flags.length ? r.flags.join(' ') : 'OK';
        console.log(`${tag === 'OK' ? '✅' : '⚠️ '} ${route.padEnd(26)} btn=${r.buttons} tbl=${r.tables} txt=${r.textLen}  ${tag}`);
        results.push(r);
    }

    await browser.close();
    mkdirSync(join(process.cwd(), 'test-reports'), { recursive: true });
    const out = join(process.cwd(), 'test-reports', 'screen-audit.json');
    writeFileSync(out, JSON.stringify(results, null, 2), 'utf-8');
    const suspects = results.filter((r) => r.flags.some((f) => /PAGE_ERROR|ERROR_BOUNDARY|BLANK|SPINNER|NET_(?!404)|CONSOLE_ERR|NAV_FAIL/.test(f)));
    console.log(`\n=== ${results.length} rotas | suspeitas (fora 429/404/restrito): ${suspects.length} ===`);
    suspects.forEach((s) => console.log(`  ${s.route}: ${s.flags.join(' ')}`));
    console.log(`\nrelatório: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
