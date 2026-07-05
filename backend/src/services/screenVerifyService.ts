import { chromium, type Browser } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';
import { affectedScreens } from '../utils/affectedScreens';

const log = createLogger('ScreenVerify');

const VERIFY_DIR = path.join(__dirname, '../../data/screen-verify');

export interface ScreenVerifyResult {
    route: string;
    ok: boolean;
    /** motivos da falha (pageerror / console.error crítico / tela branca / error-boundary) */
    errors: string[];
    screenshotPath: string | null;
}

/**
 * Verifica que uma TELA renderiza corretamente com dado MOCKADO (determinístico): navega a `route`
 * no frontend servido em `baseUrl`, semeia a sessão + stuba a rede (fixtures), e detecta falhas de
 * render — pageerror, console.error crítico, #root vazio (tela branca), error-boundary. Reusa a
 * receita do render harness. Retorna veredito + screenshot como PROVA.
 *
 * É a base do "robô verifica a tela AFETADA": em vez de fotografar o dashboard, o robô confere a
 * tela que ele mexeu (via affectedScreens) e prova que ela RENDERIZA — não só que "algo montou".
 */
export const screenVerifyService = {
    async verifyScreen(baseUrl: string, route: string, fixtures: Record<string, unknown[]> = {}): Promise<ScreenVerifyResult> {
        if (!fs.existsSync(VERIFY_DIR)) fs.mkdirSync(VERIFY_DIR, { recursive: true });
        const label = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
        const screenshotPath = path.join(VERIFY_DIR, `${label}.png`);
        const apiKey = process.env.DOLIBARR_API_KEY || 'verify-key';
        const dolUrl = process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php';
        const errors: string[] = [];

        let browser: Browser | undefined;
        try {
            browser = await chromium.launch({ headless: true });
            const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
            await ctx.addInitScript((cfg) => {
                try { window.localStorage.setItem('coolgroove_config', JSON.stringify(cfg)); } catch { /* noop */ }
            }, { apiKey, apiUrl: dolUrl, currentUser: { id: '1', login: 'admin', admin: 1, firstname: 'Verify', lastname: 'Bot' }, companyName: 'CoolGroove' });
            const page = await ctx.newPage();

            // Stub determinístico (só `/api/` por pathname — NÃO glob, que pega os módulos-fonte do vite).
            await page.route((u) => u.pathname.startsWith('/api/'), (r) => {
                const url = r.request().url();
                const json = (b: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
                if (/custom_sync|\/dolibarr\//i.test(url)) {
                    const m = url.match(/[?&]type=([a-z_]+)/i) || url.match(/\/dolibarr\/([a-z_]+)/i);
                    return json(fixtures[m ? m[1].toLowerCase() : ''] ?? []);
                }
                if (/ui-config/i.test(url)) return json({ companyName: 'CoolGroove', taskAutomation: {}, screenPermissions: { groups: {}, users: {} } });
                return json([]);
            });

            page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 160)}`));
            page.on('console', (m) => {
                if (m.type() !== 'error') return;
                const t = m.text();
                // Ruído de dev/rede que não indica tela quebrada.
                if (/favicon|hot-update|DevTools|WebSocket|ERR_CONNECTION_REFUSED|Download the React DevTools/i.test(t)) return;
                errors.push(`console.error: ${t.slice(0, 160)}`);
            });

            await page.goto(baseUrl.replace(/\/$/, '') + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3500);

            // Detectores de tela-quebrada (mesma lógica do audit-screens).
            const rootLen = (await page.locator('#root').innerHTML().catch(() => '')).length;
            if (rootLen < 50) errors.push('tela em branco (#root praticamente vazio)');
            const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
            if (/algo deu errado|something went wrong|error boundary|tela n[ãa]o encontrada/i.test(body)) errors.push('error-boundary/tela de erro renderizada');

            await page.screenshot({ path: screenshotPath, fullPage: false, type: 'png' });
            const ok = errors.length === 0;
            log.info(`verify ${route}: ${ok ? 'OK' : `FALHOU (${errors.length}: ${errors[0]})`}`);
            return { route, ok, errors, screenshotPath };
        } catch (e: any) {
            errors.push(`erro na verificação: ${e?.message || e}`);
            return { route, ok: false, errors, screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null };
        } finally {
            await browser?.close();
        }
    },

    /**
     * Composição que o robô chama: dado os ARQUIVOS ALTERADOS (git diff) + a URL do preview da branch,
     * descobre as telas afetadas (affectedScreens) e verifica CADA uma. Fallback: se nenhuma tela casar
     * (ex.: só componentes compartilhados mudaram), verifica o dashboard. `ok` = todas renderizaram.
     */
    async verifyAffectedScreens(
        baseUrl: string,
        changedFiles: string[],
        fixturesByRoute: Record<string, Record<string, unknown[]>> = {},
    ): Promise<{ screens: ScreenVerifyResult[]; ok: boolean; routes: string[] }> {
        let routes = affectedScreens(changedFiles);
        if (routes.length === 0) routes = ['/']; // fallback: dashboard
        const screens: ScreenVerifyResult[] = [];
        for (const route of routes) {
            screens.push(await this.verifyScreen(baseUrl, route, fixturesByRoute[route] || {}));
        }
        return { screens, ok: screens.every((s) => s.ok), routes };
    },
};
