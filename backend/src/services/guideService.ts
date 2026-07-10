import { chromium, type Browser } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';

const log = createLogger('GuideService');

const GUIDES_DIR = path.join(__dirname, '../../data/guides');
const BASE_URL = process.env.GUIDE_BASE_URL || 'http://localhost:3003';

export interface GuideOptions {
    /** rota da tela a guiar (ex.: '/customers') */
    path: string;
    /** texto do BOTÃO a destacar (ex.: 'Novo'); opcional */
    targetText?: string;
    /** legenda do balão vermelho (ex.: '① Clique aqui para cadastrar'); opcional */
    callout?: string;
    /** fixtures determinísticos por entidade (dado de EXEMPLO — sem PII real) p/ a tela renderizar limpa */
    fixtures?: Record<string, unknown[]>;
    /** nome do arquivo de saída (sem extensão) */
    label: string;
    darkMode?: boolean;
}

/**
 * Gera PRINTS-GUIA de telas: renderiza a tela com dado de EXEMPLO (limpo/sem PII, via stub de rede —
 * NÃO toca backend/Dolibarr reais) e DESTACA o elemento-alvo (contorno vermelho + balão) pelo
 * boundingBox REAL. Reusa a receita do harness de render + a técnica da "linha vermelha".
 *
 * É a base do "guia visual no chat" (#1050 pirâmide): o agente responde "como faço X?" com um print
 * anotado da tela real + (futuro) um deeplink. A fiação no chat/agente é follow-up — aqui está o
 * gerador reutilizável.
 */
export const guideService = {
    async generateScreenGuide(opts: GuideOptions): Promise<string> {
        if (!fs.existsSync(GUIDES_DIR)) fs.mkdirSync(GUIDES_DIR, { recursive: true });
        const outputPath = path.join(GUIDES_DIR, `${opts.label}.png`);
        const apiKey = process.env.DOLIBARR_API_KEY || 'guide-key';
        const dolUrl = process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php';
        const fixtures = opts.fixtures || {};

        let browser: Browser | undefined;
        try {
            browser = await chromium.launch({ headless: true });
            const ctx = await browser.newContext({
                viewport: { width: 1440, height: 900 },
                colorScheme: opts.darkMode ? 'dark' : 'light',
                ignoreHTTPSErrors: true,
            });
            // Sessão admin semeada (sem tela de login).
            await ctx.addInitScript((cfg) => {
                try { window.localStorage.setItem('coolgroove_config', JSON.stringify(cfg)); } catch { /* noop */ }
            }, {
                apiKey, apiUrl: dolUrl,
                currentUser: { id: '1', login: 'admin', admin: 1, firstname: 'Guia', lastname: 'Visual' },
                companyName: 'CoolGroove',
            });
            const page = await ctx.newPage();
            // Stub determinístico: só `/api/` (predicado por pathname — NÃO glob, que pegaria os
            // módulos-fonte do vite). Dado do Dolibarr vem dos fixtures; resto volta vazio/benigno.
            await page.route((u) => u.pathname.startsWith('/api/'), (route) => {
                const url = route.request().url();
                const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
                if (/custom_sync|\/dolibarr\//i.test(url)) {
                    const m = url.match(/[?&]type=([a-z_]+)/i) || url.match(/\/dolibarr\/([a-z_]+)/i);
                    return json(fixtures[m ? m[1].toLowerCase() : ''] ?? []);
                }
                if (/ui-config/i.test(url)) return json({ companyName: 'CoolGroove', taskAutomation: {}, screenPermissions: { groups: {}, users: {} } });
                return json([]);
            });

            await page.goto(BASE_URL + opts.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(4000);

            // Destaca o alvo pelo boundingBox REAL (contorno vermelho + balão + seta).
            if (opts.targetText) {
                const target = page.getByRole('button', { name: new RegExp(opts.targetText, 'i') }).first();
                const box = await target.boundingBox().catch(() => null);
                if (box) {
                    await target.evaluate((el) => {
                        const s = (el as HTMLElement).style;
                        s.outline = '4px solid #ef4444'; s.outlineOffset = '3px'; s.borderRadius = '12px';
                        s.boxShadow = '0 0 0 8px rgba(239,68,68,.25)';
                    }).catch(() => { /* alvo sem style — ignora */ });
                    if (opts.callout) {
                        await page.evaluate(({ x, y, w, h, text }) => {
                            const arrow = document.createElement('div');
                            Object.assign(arrow.style, { position: 'fixed', left: (x + w / 2 - 7) + 'px', top: (y + h + 5) + 'px', width: '0', height: '0', borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '10px solid #ef4444', zIndex: '99999' });
                            const tip = document.createElement('div');
                            tip.textContent = text;
                            Object.assign(tip.style, { position: 'fixed', top: (y + h + 15) + 'px', background: '#ef4444', color: '#fff', padding: '9px 13px', borderRadius: '9px', font: '600 13px system-ui, sans-serif', zIndex: '99999', boxShadow: '0 6px 16px rgba(0,0,0,.25)', whiteSpace: 'nowrap' });
                            // Botão perto da borda direita → ancora o balão pela DIREITA (não corta na tela).
                            if (x > window.innerWidth / 2) tip.style.right = Math.max(8, window.innerWidth - (x + w)) + 'px';
                            else tip.style.left = Math.max(8, x - 40) + 'px';
                            document.body.appendChild(arrow); document.body.appendChild(tip);
                        }, { x: box.x, y: box.y, w: box.width, h: box.height, text: opts.callout }).catch(() => { /* balão best-effort */ });
                    }
                    await page.waitForTimeout(200);
                } else {
                    log.warn(`Guia ${opts.label}: alvo "${opts.targetText}" não encontrado — print sem destaque.`);
                }
            }

            await page.screenshot({ path: outputPath, fullPage: false, type: 'png' });
            log.info(`Guia gerado: ${outputPath}`);
            return outputPath;
        } finally {
            await browser?.close();
        }
    },
};
