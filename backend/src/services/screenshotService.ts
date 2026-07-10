import { chromium, type Browser, type Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';

const log = createLogger('Screenshot');

const SCREENSHOTS_DIR = path.join(__dirname, '../../data/screenshots');

export interface ScreenshotResult {
    beforePath: string;
    afterPath: string;
}

async function ensureDir(): Promise<void> {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
}

async function capturePage(url: string, outputPath: string, options?: { darkMode?: boolean; width?: number; height?: number; auth?: boolean }): Promise<void> {
    let browser: Browser | undefined;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            viewport: { width: options?.width || 1440, height: options?.height || 900 },
            colorScheme: options?.darkMode ? 'dark' : 'light',
        });

        // Autenticação (receita validada 2026-07-04): o app do Coolgroove lê a sessão de
        // localStorage['coolgroove_config'] = { apiKey, url } e fala com o Dolibarr por header —
        // SEM cookie. Sem semear isso, QUALQUER tela interna captura a landing de LOGIN (screenshot
        // cego). addInitScript roda ANTES de todo script da página, então já está no 1º paint.
        if (options?.auth) {
            const apiKey = process.env.DOLIBARR_API_KEY;
            const dolUrl = process.env.DOLIBARR_URL;
            if (apiKey && dolUrl) {
                await context.addInitScript((cfg) => {
                    try { window.localStorage.setItem('coolgroove_config', JSON.stringify(cfg)); } catch { /* storage bloqueado */ }
                }, { apiKey, url: dolUrl });
            } else {
                log.warn('capturePage: auth pedido mas DOLIBARR_API_KEY/DOLIBARR_URL ausentes no env — capturando SEM sessão (vai cair no login)');
            }
        }

        const page: Page = await context.newPage();

        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);

        await page.screenshot({
            path: outputPath,
            fullPage: false,
            type: 'png',
        });

        log.info(`Screenshot saved: ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(0)}KB)`);
    } catch (e: any) {
        log.error(`Failed to capture ${url}: ${e.message}`);
        throw e;
    } finally {
        await browser?.close();
    }
}

export const screenshotService = {
    async captureForTask(issueNumber: number, beforeUrl: string, afterUrl: string, options?: { auth?: boolean }): Promise<ScreenshotResult> {
        await ensureDir();

        const beforePath = path.join(SCREENSHOTS_DIR, `${issueNumber}_before.png`);
        const afterPath = path.join(SCREENSHOTS_DIR, `${issueNumber}_after.png`);

        log.info(`Capturing screenshots for task #${issueNumber}${options?.auth ? ' (autenticado)' : ''}`);
        log.info(`  BEFORE: ${beforeUrl}`);
        log.info(`  AFTER:  ${afterUrl}`);

        await capturePage(beforeUrl, beforePath, { auth: options?.auth });
        await capturePage(afterUrl, afterPath, { auth: options?.auth });

        return { beforePath, afterPath };
    },

    async captureSingle(url: string, label: string, options?: { darkMode?: boolean; auth?: boolean }): Promise<string> {
        await ensureDir();
        const outputPath = path.join(SCREENSHOTS_DIR, `${label}.png`);
        await capturePage(url, outputPath, options);
        return outputPath;
    },

    getScreenshotPath(issueNumber: number, type: 'before' | 'after'): string {
        return path.join(SCREENSHOTS_DIR, `${issueNumber}_${type}.png`);
    },

    screenshotsExist(issueNumber: number): boolean {
        const before = path.join(SCREENSHOTS_DIR, `${issueNumber}_before.png`);
        const after = path.join(SCREENSHOTS_DIR, `${issueNumber}_after.png`);
        return fs.existsSync(before) && fs.existsSync(after);
    },
};
